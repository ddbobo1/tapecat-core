import express, { type NextFunction, type Request, type Response } from "express";
import cookieSession from "cookie-session";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { createPublicClient, getAddress, http, type Address, type Chain, type Hex } from "viem";
import { bsc, bscTestnet, hardhat } from "viem/chains";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";

import { config, CAP_FOLLOW, CAP_FOLLOW_RETWEET, requireSaleConfig, requireXConfig } from "./config";
import { openDb, type Db } from "./db";
import { countryOf, geoGuard, isBlocked } from "./geo";
import { authorizeUrl, exchangeCode, getMe, makeTaskChecker, newPkce, type TaskChecker } from "./x";
import { RateLimiter, RateLimitedError, XRateLimitedError } from "./xguard";
import { localSigner, saleSaltOf, shortCodeOf, xIdHashOf, type AllocationSigner } from "./signer";
import { saleAbi } from "../../shared/abi";
import { directRoute, nextBatchAmount, readSale } from "../../shared/routes";

interface SessionData {
  sid?: string;
  nonce?: string;
  wallet?: Address;
  xUserId?: string;
  xUsername?: string;
  pkceVerifier?: string;
  pkceState?: string;
}

type SaleInfo = { endTime: bigint; start: bigint; bem: Address; token: Address; wbnb: Address; kyber: Address };

const chain: Chain = ({ 56: bsc, 97: bscTestnet, 31337: hardhat } as Record<number, Chain>)[config.chainId] ?? bsc;
const client = createPublicClient({ chain, transport: http(config.rpcUrl) });

let dbPromise: Promise<Db> | null = null;
function getDb(): Promise<Db> {
  if (!dbPromise) dbPromise = openDb(config.tursoUrl, config.tursoAuthToken);
  return dbPromise;
}

/**
 * H-01: one TaskChecker per process (was: one per request, which reset the refresh throttle and
 * in-flight coalescing on every call). Cross-instance throttling/backoff is persisted in Turso.
 */
let taskChecker: TaskChecker | null = null;
let taskCheckerDb: Db | null = null;
export function getTaskChecker(db: Db): TaskChecker {
  if (!taskChecker || taskCheckerDb !== db) {
    taskChecker = makeTaskChecker(db);
    taskCheckerDb = db;
  }
  return taskChecker;
}

let limiter: RateLimiter | null = null;
let limiterDb: Db | null = null;
export function getLimiter(db: Db): RateLimiter {
  if (!limiter || limiterDb !== db) {
    limiter = new RateLimiter(db);
    limiterDb = db;
  }
  return limiter;
}

let saleInfoCache: SaleInfo | null = null;
let saleInfoError: string | null = null;

async function loadSale(): Promise<SaleInfo> {
  if (saleInfoCache) return saleInfoCache;
  const { sale, saleSaltText, signerKey } = requireSaleConfig();
  const saleSalt = saleSaltOf(saleSaltText);
  const signer = localSigner(signerKey, config.chainId, sale);
  const c = { address: sale, abi: saleAbi } as const;
  try {
    const [onchainSalt, onchainSigner, endTime, start, bem, token, wbnb, kyber] = await Promise.all([
      client.readContract({ ...c, functionName: "saleSalt" }),
      client.readContract({ ...c, functionName: "signer" }),
      client.readContract({ ...c, functionName: "endTime" }),
      client.readContract({ ...c, functionName: "start" }),
      client.readContract({ ...c, functionName: "BEM" }),
      client.readContract({ ...c, functionName: "token" }),
      client.readContract({ ...c, functionName: "WBNB" }),
      client.readContract({ ...c, functionName: "kyberRouter" }),
    ]);
    if (onchainSalt.toLowerCase() !== saleSalt.toLowerCase()) {
      throw new Error(`SALE_SALT mismatch: on-chain ${onchainSalt}, env gives ${saleSalt}`);
    }
    if (onchainSigner.toLowerCase() !== signer.address.toLowerCase()) {
      console.warn(
        `WARNING: on-chain signer ${onchainSigner} != server signer ${signer.address}; signatures will be rejected`,
      );
    }
    saleInfoCache = { endTime, start, bem, token, wbnb, kyber };
    saleInfoError = null;
    return saleInfoCache;
  } catch (e) {
    saleInfoError = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

function getSigner(): AllocationSigner {
  const { sale, signerKey } = requireSaleConfig();
  return localSigner(signerKey, config.chainId, sale);
}

function getSaleSalt(): Hex {
  const { saleSaltText } = requireSaleConfig();
  return saleSaltOf(saleSaltText);
}

export function createApp() {
  const app = express();
  if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  /** CORS: needed for localhost↔prod and legacy split deploys; same-origin is a no-op. */
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.frontendOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(
    cookieSession({
      name: "tc",
      keys: [config.sessionSecret],
      httpOnly: true,
      sameSite: config.cookieSameSite,
      secure: config.cookieSecure,
      domain: config.cookieDomain,
      maxAge: 2 * 3600 * 1000,
    }),
  );
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

  /** CSRF defense: state-changing POSTs must carry an allowlisted Origin. */
  function requireFrontendOrigin(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;
    if (!origin || !config.frontendOrigins.includes(origin)) {
      res.status(403).json({ error: "bad_origin" });
      return;
    }
    next();
  }

  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  const sess = (req: Request): SessionData => {
    const s = req.session as SessionData;
    if (!s.sid) s.sid = randomBytes(16).toString("hex");
    return s;
  };

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      saleConfigured: Boolean(config.sale),
      saleLoaded: Boolean(saleInfoCache),
      saleError: saleInfoError,
      db: config.tursoUrl.startsWith("file:") ? "file" : "turso",
      frontendOrigin: config.frontendOrigin,
      apiOrigin: config.apiOrigin,
    });
  });

  app.get(
    "/api/config",
    wrap(async (_req, res) => {
      if (!config.sale) {
        res.json({
          chainId: config.chainId,
          rpcUrl: config.publicRpcUrl,
          sale: null,
          bem: null,
          token: null,
          xHandle: config.x.projectHandle,
          campaignTweetId: config.x.campaignTweetId || null,
          termsVersion: config.termsVersion,
          saleConfigured: false,
        });
        return;
      }
      try {
        const info = await loadSale();
        res.json({
          chainId: config.chainId,
          rpcUrl: config.publicRpcUrl,
          sale: config.sale,
          bem: info.bem,
          token: info.token,
          xHandle: config.x.projectHandle,
          campaignTweetId: config.x.campaignTweetId,
          termsVersion: config.termsVersion,
          saleConfigured: true,
        });
      } catch (e) {
        res.status(503).json({
          error: "sale_unavailable",
          detail: e instanceof Error ? e.message : String(e),
          sale: config.sale,
          saleConfigured: true,
        });
      }
    }),
  );

  app.get("/api/geo", (req, res) => {
    const country = countryOf(req);
    res.json({ country: country || null, blocked: isBlocked(country), blockedList: config.geo.blocked });
  });

  app.get("/api/siwe/nonce", geoGuard, (req, res) => {
    const s = sess(req);
    s.nonce = generateSiweNonce();
    res.json({
      nonce: s.nonce,
      domain: new URL(config.frontendOrigin).host,
      uri: config.frontendOrigin,
      chainId: config.chainId,
    });
  });

  app.post(
    "/api/siwe/verify",
    requireFrontendOrigin,
    geoGuard,
    wrap(async (req, res) => {
      const s = sess(req);
      const db = await getDb();
      const { message, signature } = req.body as { message?: string; signature?: Hex };
      if (!message || !signature || !s.nonce) return res.status(400).json({ error: "bad_request" });
      const parsed = parseSiweMessage(message);
      if (parsed.chainId !== config.chainId || parsed.uri !== config.frontendOrigin || !parsed.address) {
        return res.status(400).json({ error: "bad_message" });
      }
      const ok = await client.verifySiweMessage({
        message,
        signature,
        nonce: s.nonce,
        domain: new URL(config.frontendOrigin).host,
      });
      s.nonce = undefined;
      if (!ok) return res.status(401).json({ error: "bad_signature" });
      const wallet = getAddress(parsed.address);
      if (s.wallet && s.wallet !== wallet) {
        s.xUserId = undefined;
        s.xUsername = undefined;
      }
      s.wallet = wallet;
      const b = await db.getByWallet(wallet);
      if (b) {
        s.xUserId = b.x_user_id;
        s.xUsername = b.x_username;
      }
      res.json({ wallet });
    }),
  );

  app.post(
    "/api/logout",
    requireFrontendOrigin,
    wrap(async (req, res) => {
      const s = req.session as SessionData;
      if (s?.sid) {
        const db = await getDb();
        await db.deleteXToken(s.sid);
      }
      req.session = null;
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/x/login",
    geoGuard,
    wrap(async (req, res) => {
      requireXConfig();
      const s = sess(req);
      if (!s.wallet) return res.status(401).json({ error: "sign_in_first" });
      const p = newPkce();
      s.pkceVerifier = p.verifier;
      s.pkceState = p.state;
      res.redirect(authorizeUrl(p.challenge, p.state));
    }),
  );

  app.get(
    "/api/x/callback",
    geoGuard,
    wrap(async (req, res) => {
      requireXConfig();
      requireSaleConfig();
      const s = sess(req);
      const db = await getDb();
      const back = (q: string) => res.redirect(`${config.frontendOrigin}${config.xReturnPath}?${q}`);
      const { code, state, error } = req.query as Record<string, string | undefined>;
      if (error) return back(`x_error=${encodeURIComponent(error)}`);
      if (!s.wallet || !code || !state || state !== s.pkceState || !s.pkceVerifier) return back("x_error=bad_state");

      const token = await exchangeCode(code, s.pkceVerifier);
      s.pkceVerifier = undefined;
      s.pkceState = undefined;
      const me = await getMe(token);
      const bound = await db.bind(me.id, me.username, s.wallet, xIdHashOf(getSaleSalt(), me.id));
      if (typeof bound === "string") return back(`x_error=${bound}`);
      s.xUserId = me.id;
      s.xUsername = me.username;
      await db.setXToken(s.sid!, token, Date.now() + 2 * 3600 * 1000);
      back("x=ok");
    }),
  );

  app.get(
    "/api/me",
    wrap(async (req, res) => {
      const s = sess(req);
      if (!s.wallet) return res.json({ wallet: null });
      const db = await getDb();
      const b = s.xUserId ? await db.getByX(s.xUserId) : undefined;
      let shortCode: string | null = null;
      try {
        shortCode = shortCodeOf(getSaleSalt(), s.wallet);
      } catch {
        shortCode = null;
      }
      const xTokenLive = !!(s.sid && (await db.getXToken(s.sid)));
      res.json({
        wallet: s.wallet,
        shortCode,
        x: b
          ? {
              username: b.x_username,
              xIdHash: b.x_id_hash,
              followed: !!b.followed,
              retweeted: !!b.retweeted,
              cap: b.cap,
            }
          : null,
        xTokenLive,
      });
    }),
  );

  app.post(
    "/api/allocation",
    requireFrontendOrigin,
    rateLimit({ windowMs: 60_000, limit: 10 }),
    geoGuard,
    wrap(async (req, res) => {
      requireXConfig();
      requireSaleConfig();
      const s = sess(req);
      const db = await getDb();
      const rl = getLimiter(db);
      await rl.hit("alloc_ip", req.ip || "unknown", config.rateLimits.allocPerIp);
      const tasks = getTaskChecker(db);
      const saleInfo = await loadSale();
      const signer = getSigner();
      const saleSalt = getSaleSalt();

      const { acceptTerms, termsVersion } = req.body as { acceptTerms?: boolean; termsVersion?: string };
      if (!acceptTerms || termsVersion !== config.termsVersion) return res.status(400).json({ error: "accept_terms" });
      if (!s.wallet) return res.status(401).json({ error: "sign_in_first" });
      if (!s.xUserId) return res.status(401).json({ error: "connect_x_first" });
      const b = await db.getByX(s.xUserId);
      if (!b || b.wallet !== s.wallet.toLowerCase()) return res.status(403).json({ error: "binding_mismatch" });
      await rl.hit("alloc_x", s.xUserId, config.rateLimits.allocPerX);

      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now >= saleInfo.endTime) return res.status(400).json({ error: "sale_ended" });

      const userToken = s.sid ? await db.getXToken(s.sid) : undefined;
      const { followed, retweeted } = await tasks.check(s.xUserId, userToken, shortCodeOf(saleSalt, s.wallet));
      const cap = followed ? (retweeted ? CAP_FOLLOW_RETWEET : CAP_FOLLOW) : 0n;
      await db.updateTasks(s.xUserId, s.xUsername || b.x_username, followed, retweeted, cap);
      if (cap === 0n) return res.status(403).json({ error: "follow_required", followed, retweeted });

      const ttlEnd = now + BigInt(config.allocationTtlSec);
      const deadline = ttlEnd < saleInfo.endTime ? ttlEnd : saleInfo.endTime;
      const xIdHash = b.x_id_hash as Hex;
      const sig = await signer.sign({ wallet: s.wallet, xIdHash, cap, deadline });
      const country = countryOf(req);
      await db.logSignature(s.wallet, xIdHash, cap, Number(deadline), req.ip || "", country, config.termsVersion);
      res.json({
        wallet: s.wallet,
        xIdHash,
        cap: cap.toString(),
        deadline: deadline.toString(),
        sig,
        followed,
        retweeted,
      });
    }),
  );

  app.get(
    "/api/keeper/plan",
    rateLimit({ windowMs: 60_000, limit: 6 }),
    wrap(async (_req, res) => {
      if (!config.sale) return res.status(503).json({ error: "missing env SALE_ADDRESS" });
      const snap = await readSale(client, config.sale as Address);
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (snap.phase === 3) return res.json({ action: "launch" });
      const amount = nextBatchAmount(snap, now);
      if (snap.phase !== 2 || amount === 0n) return res.json({ action: "none", phase: snap.phase });
      const d = directRoute();
      res.json({ action: "swap", amount: amount.toString(), route: d.route, data: d.data });
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof RateLimitedError || err instanceof XRateLimitedError) {
      res.setHeader("Retry-After", String(err.retryAfterSec));
      res.status(429).json({ error: err.message, retryAfter: err.retryAfterSec });
      return;
    }
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("missing env ")) {
      res.status(503).json({ error: "misconfigured", detail: msg });
      return;
    }
    res.status(msg === "x_rate_limited" ? 429 : 500).json({ error: msg === "x_rate_limited" ? msg : "internal_error" });
  });

  return app;
}

/** Eagerly warm sale cache when config is present (local server). Safe to call on Vercel cold start too. */
export async function warmupSale(): Promise<void> {
  if (!config.sale) return;
  try {
    await loadSale();
  } catch (e) {
    console.warn("sale warmup failed (will retry per-request):", e instanceof Error ? e.message : e);
  }
}
