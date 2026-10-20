import "dotenv/config";
import type { Address, Hex } from "viem";

function stripSlash(s: string): string {
  return s.replace(/\/$/, "");
}

const port = Number(process.env.PORT || 8787);

/**
 * Same-origin Vercel deploy (preferred): FRONTEND_ORIGIN === API_ORIGIN === production URL
 *   e.g. https://tapecat.vercel.app  → cookies SameSite=Lax, empty NEXT_PUBLIC_VERIFIER_URL
 * Local: FRONTEND_ORIGIN=http://localhost:3000, API_ORIGIN=http://localhost:8787
 * Legacy split (HashPort + VPS) still works if the two origins differ.
 */
const frontendOrigin = stripSlash(
  process.env.FRONTEND_ORIGIN || process.env.PUBLIC_ORIGIN || "http://localhost:3000",
);
const apiOrigin = stripSlash(
  process.env.API_ORIGIN || process.env.PUBLIC_ORIGIN || `http://localhost:${port}`,
);
const frontendOrigins = (process.env.FRONTEND_ORIGINS || frontendOrigin)
  .split(",")
  .map((s) => stripSlash(s.trim()))
  .filter(Boolean);
// Always allow local Next / static preview when developing against a remote API.
for (const local of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
  if (!frontendOrigins.includes(local)) frontendOrigins.push(local);
}

const feHost = new URL(frontendOrigin).host;
const apiHost = new URL(apiOrigin).host;
const crossSite = feHost !== apiHost;

let cookieSameSite = (process.env.COOKIE_SAMESITE || "").toLowerCase();
if (cookieSameSite !== "lax" && cookieSameSite !== "strict" && cookieSameSite !== "none") {
  cookieSameSite = crossSite ? "none" : "lax";
}
const cookieSecure =
  process.env.COOKIE_SECURE === "1" ||
  cookieSameSite === "none" ||
  apiOrigin.startsWith("https://") ||
  frontendOrigin.startsWith("https://");
const cookieDomain = process.env.COOKIE_DOMAIN || ""; // e.g. .tapecat.xyz

const dataDir = process.env.VERIFIER_DATA_DIR || "verifier/data";
const tursoUrl = process.env.TURSO_DATABASE_URL || `file:${dataDir}/verifier.sqlite`;

function parseLimit(v: string | undefined, def: string): { limit: number; windowSec: number } {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(v || def) || /^(\d+)\/(\d+)$/.exec(def)!;
  return { limit: Number(m[1]), windowSec: Math.max(1, Number(m[2])) };
}

export const config = {
  port,
  /** @deprecated Prefer frontendOrigin / apiOrigin; kept as alias of apiOrigin for older docs. */
  publicOrigin: apiOrigin,
  frontendOrigin,
  apiOrigin,
  frontendOrigins,
  cookieSameSite: cookieSameSite as "lax" | "strict" | "none",
  cookieSecure,
  cookieDomain: cookieDomain || undefined,

  sessionSecret: process.env.SESSION_SECRET || "dev-only-change-me",
  /** Reverse proxies (Cloudflare + nginx = 2). On Vercel default 1. */
  trustProxyHops: Number(process.env.TRUST_PROXY || (process.env.VERCEL ? "1" : "0")),
  /** Where the X OAuth callback sends the user back to on the frontend. */
  xReturnPath: process.env.X_RETURN_PATH || "/join",

  chainId: Number(process.env.CHAIN_ID || 56),
  rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org",
  /** RPC handed to browsers; keep private/paid RPC keys out of it. */
  publicRpcUrl: process.env.PUBLIC_RPC_URL || process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org",

  /** May be empty before contract deploy; signing routes require it. */
  sale: (process.env.SALE_ADDRESS || "") as Address | "",
  saleSaltText: process.env.SALE_SALT || "",
  signerKey: (process.env.SIGNER_PRIVATE_KEY || "") as Hex | "",
  /** How long a signed allocation stays valid (capped at the sale end). */
  allocationTtlSec: Number(process.env.ALLOCATION_TTL_SEC || 1800),

  x: {
    clientId: process.env.X_CLIENT_ID || "",
    clientSecret: process.env.X_CLIENT_SECRET || "",
    redirectUri: process.env.X_REDIRECT_URI || `${apiOrigin}/api/x/callback`,
    bearer: process.env.X_BEARER_TOKEN || "",
    projectUserId: process.env.X_PROJECT_USER_ID || "",
    projectHandle: process.env.X_PROJECT_HANDLE || "TapeCat_",
    campaignTweetId: process.env.X_CAMPAIGN_TWEET_ID || "",
  },

  geo: {
    blocked: (process.env.BLOCKED_COUNTRIES || "CN,US,CU,IR,KP,SY")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    header: (process.env.GEO_HEADER || "cf-ipcountry").toLowerCase(),
    allowUnknown: process.env.ALLOW_UNKNOWN_COUNTRY === "1",
    devCountry: process.env.DEV_COUNTRY || "",
  },

  termsVersion: process.env.TERMS_VERSION || "v0.10",

  /**
   * Turso / libSQL URL.
   * Local: file:verifier/data/verifier.sqlite (default)
   * Vercel: libsql://….turso.io
   */
  tursoUrl,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || "",

  /** @deprecated Prefer TURSO_DATABASE_URL; still used for the file: default path. */
  dataDir,

  /** H-01: durable per-key limits for /api/allocation, format "N/windowSec". */
  rateLimits: {
    allocPerX: parseLimit(process.env.ALLOC_RL_PER_X, "6/60"),
    allocPerIp: parseLimit(process.env.ALLOC_RL_PER_IP, "20/60"),
  },

  keeper: {
    kyberClientId: process.env.KYBER_CLIENT_ID || "tapecat",
  },
};

/** Throw a clear error when sale signing config is incomplete. */
export function requireSaleConfig(): { sale: Address; saleSaltText: string; signerKey: Hex } {
  if (!config.sale) throw new Error("missing env SALE_ADDRESS");
  if (!config.saleSaltText) throw new Error("missing env SALE_SALT");
  if (!config.signerKey) throw new Error("missing env SIGNER_PRIVATE_KEY");
  return { sale: config.sale as Address, saleSaltText: config.saleSaltText, signerKey: config.signerKey as Hex };
}

export function requireXConfig() {
  if (!config.x.clientId) throw new Error("missing env X_CLIENT_ID");
  if (!config.x.bearer) throw new Error("missing env X_BEARER_TOKEN");
  if (!config.x.projectUserId) throw new Error("missing env X_PROJECT_USER_ID");
  if (!config.x.campaignTweetId) throw new Error("missing env X_CAMPAIGN_TWEET_ID");
}

export const CAP_FOLLOW = 100_000_000n; // 1 BEM (8 decimals)
export const CAP_FOLLOW_RETWEET = 150_000_000n; // 1.5 BEM
