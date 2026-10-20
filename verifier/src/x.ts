import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";
import type { Db } from "./db";
import { SafeKv, XBackoff, XRateLimitedError, systemClock, type Clock } from "./xguard";

const API = "https://api.x.com/2";
const SCOPES = ["tweet.read", "users.read", "follows.read"];

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function newPkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  return { verifier, challenge, state };
}

export function authorizeUrl(challenge: string, state: string) {
  const u = new URL("https://x.com/i/oauth2/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.x.clientId);
  u.searchParams.set("redirect_uri", config.x.redirectUri);
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export async function exchangeCode(code: string, verifier: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: config.x.redirectUri,
    code_verifier: verifier,
    client_id: config.x.clientId,
  });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (config.x.clientSecret) {
    headers.authorization = "Basic " + Buffer.from(`${config.x.clientId}:${config.x.clientSecret}`).toString("base64");
  }
  const res = await fetch(`${API}/oauth2/token`, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`x token exchange failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string };
  return j.access_token;
}

/**
 * GET against the X v2 API.
 * `backoffScope` (app-level bearer calls) makes every instance stop calling that endpoint after a 429
 * until X's reset time; user-token calls are limited per user by X, so they pass no scope.
 */
async function xGet<T>(
  path: string,
  token: string,
  params: Record<string, string> = {},
  backoffScope?: string,
): Promise<T> {
  const bo = guards.backoff;
  if (backoffScope && bo) await bo.assertOpen(backoffScope);
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const reset = Number(res.headers.get("x-rate-limit-reset") || 0) || undefined;
    const retryAfter = Number(res.headers.get("retry-after") || 0) || undefined;
    let wait = retryAfter ?? 60;
    if (backoffScope && bo) wait = await bo.trip(backoffScope, { resetEpochSec: reset, retryAfterSec: retryAfter });
    else if (reset) wait = Math.max(1, Math.ceil(reset - Date.now() / 1000));
    console.warn(`[x] 429 on ${backoffScope ?? path.split("/").slice(0, 2).join("/")}; backing off ${wait}s`);
    throw new XRateLimitedError(wait);
  }
  if (!res.ok) throw new Error(`x api ${path} ${res.status}: ${await res.text()}`);
  if (backoffScope && bo) await bo.success(backoffScope);
  return (await res.json()) as T;
}

/** Module-level guard state (set by makeTaskChecker; tests may inject). */
const guards: { backoff: XBackoff | null } = { backoff: null };

export async function getMe(userToken: string) {
  const j = await xGet<{ data: { id: string; username: string; name: string } }>("/users/me", userToken);
  return j.data;
}

/**
 * Incremental cache of an X id list that the API returns newest first (project followers,
 * retweeters of the campaign tweet). A miss triggers at most one refresh per `minIntervalMs`
 * **across all instances** (lease row in Turso `kv_num`, memory fallback), paging until a page
 * contains only known ids or `maxPages` is reached. Concurrent misses in one instance share the
 * same in-flight refresh.
 */
export class NewestFirstCache {
  private lastRefresh = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private db: Db,
    private kv: SafeKv,
    private kind: string,
    private path: string,
    private bearer: string,
    private pageSize: number,
    private maxPages: number,
    private minIntervalMs: number,
    private clock: Clock = systemClock,
  ) {}

  async has(id: string): Promise<boolean> {
    if (await this.db.cacheHas(this.kind, id)) return true;
    await this.refresh();
    return await this.db.cacheHas(this.kind, id);
  }

  private async refresh() {
    if (this.inflight) return this.inflight;
    const now = this.clock();
    if (now - this.lastRefresh < this.minIntervalMs) return;
    this.inflight = (async () => {
      try {
        // Cross-instance lease: only one instance refreshes per interval.
        const won = await this.kv.claim(`refresh:${this.kind}`, now - this.minIntervalMs + 1, now);
        this.lastRefresh = now;
        if (!won) return;
        let token: string | undefined;
        for (let page = 0; page < this.maxPages; page++) {
          const params: Record<string, string> = { max_results: String(this.pageSize) };
          if (token) params.pagination_token = token;
          const j = await xGet<{ data?: { id: string }[]; meta?: { next_token?: string } }>(
            this.path,
            this.bearer,
            params,
            this.kind,
          );
          const ids = (j.data ?? []).map((u) => u.id);
          let fresh = 0;
          for (const id of ids) {
            if (!(await this.db.cacheHas(this.kind, id))) {
              await this.db.cacheAdd(this.kind, id);
              fresh++;
            }
          }
          token = j.meta?.next_token;
          if (!token || fresh === 0) break;
        }
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}

export interface TaskCheckerOptions {
  clock?: Clock;
  /** Min interval between list refreshes (followers / retweeters), across instances. */
  refreshMinIntervalMs?: number;
  /** TTL of a cached "followed + retweeted" result. */
  positiveTtlMs?: number;
  /** TTL of a cached incomplete result (not followed / not retweeted yet). */
  negativeTtlMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export type TaskResult = { followed: boolean; retweeted: boolean; cached: boolean };
export type TaskChecker = {
  check: (xUserId: string, userToken: string | undefined, shortCode: string) => Promise<TaskResult>;
  backoff: XBackoff;
};

const envMs = (name: string, defSec: number) => {
  const v = Number(process.env[name]);
  return (Number.isFinite(v) && v >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? v : defSec) * 1000;
};

/**
 * Build the follow/retweet checker. Create it ONCE per process (see `getTaskChecker` in app.ts):
 * the refresh throttle, in-flight coalescing and backoff live on the instance.
 */
export function makeTaskChecker(db: Db, opts: TaskCheckerOptions = {}): TaskChecker {
  const clock = opts.clock ?? systemClock;
  const kv = new SafeKv(db);
  const backoff = new XBackoff(kv, {
    clock,
    baseMs: opts.backoffBaseMs ?? envMs("X_BACKOFF_BASE_SEC", 60),
    maxMs: opts.backoffMaxMs ?? envMs("X_BACKOFF_MAX_SEC", 900),
  });
  guards.backoff = backoff;
  const refreshMs = opts.refreshMinIntervalMs ?? envMs("X_REFRESH_MIN_INTERVAL_SEC", 60);
  const posTtl = opts.positiveTtlMs ?? envMs("X_CHECK_POSITIVE_TTL_SEC", 600);
  const negTtl = opts.negativeTtlMs ?? envMs("X_CHECK_NEGATIVE_TTL_SEC", 30);
  const followers = new NewestFirstCache(
    db,
    kv,
    "follower",
    `/users/${config.x.projectUserId}/followers`,
    config.x.bearer,
    1000,
    5,
    refreshMs,
    clock,
  );
  const retweeters = new NewestFirstCache(
    db,
    kv,
    "retweeter",
    `/tweets/${config.x.campaignTweetId}/retweeted_by`,
    config.x.bearer,
    100,
    10,
    refreshMs,
    clock,
  );

  /** Retweet or quote of the campaign tweet in the user's own recent timeline. */
  async function timelineHasRetweet(xUserId: string, userToken: string, shortCode: string): Promise<boolean> {
    type T = { data?: { id: string; text: string; referenced_tweets?: { type: string; id: string }[] }[] };
    const j = await xGet<T>(`/users/${xUserId}/tweets`, userToken, {
      max_results: "50",
      "tweet.fields": "referenced_tweets",
    });
    for (const t of j.data ?? []) {
      for (const r of t.referenced_tweets ?? []) {
        if (r.id !== config.x.campaignTweetId) continue;
        if (r.type === "retweeted") return true;
        if (r.type === "quoted" && t.text.toLowerCase().includes(shortCode.toLowerCase())) return true;
      }
    }
    return false;
  }

  async function cachedResult(xUserId: string): Promise<TaskResult | undefined> {
    try {
      const row = await db.getTaskCheck(xUserId);
      if (!row) return undefined;
      const ttl = row.followed && row.retweeted ? posTtl : negTtl;
      if (clock() - row.checkedAtMs < ttl) return { followed: row.followed, retweeted: row.retweeted, cached: true };
    } catch (e) {
      console.warn("[x] task_checks read failed:", e instanceof Error ? e.message : e);
    }
    return undefined;
  }

  return {
    backoff,
    async check(xUserId, userToken, shortCode) {
      const hit = await cachedResult(xUserId);
      if (hit) return hit;
      const followed = await followers.has(xUserId);
      let retweeted = false;
      if (userToken) {
        try {
          retweeted = await timelineHasRetweet(xUserId, userToken, shortCode);
        } catch {
          retweeted = false;
        }
      }
      if (!retweeted) retweeted = await retweeters.has(xUserId);
      try {
        await db.putTaskCheck(xUserId, followed, retweeted, clock());
      } catch (e) {
        console.warn("[x] task_checks write failed:", e instanceof Error ? e.message : e);
      }
      return { followed, retweeted, cached: false };
    },
  };
}
