/**
 * H-01 hardening: shared guards for X API usage.
 *
 *  - `XRateLimitedError`  : typed "x_rate_limited" error carrying Retry-After seconds.
 *  - `XBackoff`           : after an X 429 every app-level call short-circuits until the reset time
 *                           (from `x-rate-limit-reset` / `retry-after`, else exponential 60s→15min).
 *                           State lives in Turso (`kv_num`) so all serverless instances back off together.
 *  - `RateLimiter`        : fixed-window counters per key (xId / IP), persisted in Turso, with an
 *                           in-memory fallback if the DB call fails (logged once).
 *
 * Every DB-backed helper degrades to process memory instead of failing the request.
 */
import type { Db } from "./db";

export type Clock = () => number; // ms
export const systemClock: Clock = () => Date.now();

export class XRateLimitedError extends Error {
  constructor(public retryAfterSec: number) {
    super("x_rate_limited");
    this.name = "XRateLimitedError";
  }
}

export class RateLimitedError extends Error {
  constructor(
    public scope: string,
    public retryAfterSec: number,
  ) {
    super("rate_limited");
    this.name = "RateLimitedError";
  }
}

let warned = new Set<string>();
function warnOnce(tag: string, e: unknown) {
  if (warned.has(tag)) return;
  warned.add(tag);
  console.warn(`[xguard] ${tag}: DB unavailable, falling back to in-memory state:`, e instanceof Error ? e.message : e);
}
/** Test helper. */
export function resetWarnings() {
  warned = new Set();
}

/** Numeric KV with transparent memory fallback. */
export class SafeKv {
  private mem = new Map<string, number>();
  constructor(private db: Db | null) {}

  async get(k: string): Promise<number | undefined> {
    if (this.db) {
      try {
        const v = await this.db.kvGet(k);
        if (v !== undefined) this.mem.set(k, v);
        return v ?? this.mem.get(k);
      } catch (e) {
        warnOnce("kvGet", e);
      }
    }
    return this.mem.get(k);
  }

  async set(k: string, v: number): Promise<void> {
    this.mem.set(k, v);
    if (!this.db) return;
    try {
      await this.db.kvSet(k, v);
    } catch (e) {
      warnOnce("kvSet", e);
    }
  }

  /** Lease: succeed iff current value (or missing) < ifBelow; then store v. */
  async claim(k: string, ifBelow: number, v: number): Promise<boolean> {
    if (this.db) {
      try {
        const ok = await this.db.kvClaim(k, ifBelow, v);
        if (ok) this.mem.set(k, v);
        return ok;
      } catch (e) {
        warnOnce("kvClaim", e);
      }
    }
    const cur = this.mem.get(k);
    if (cur !== undefined && cur >= ifBelow) return false;
    this.mem.set(k, v);
    return true;
  }
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  clock?: Clock;
}

/** Global (cross-instance) backoff after X answers 429. */
export class XBackoff {
  private baseMs: number;
  private maxMs: number;
  private clock: Clock;
  constructor(
    private kv: SafeKv,
    opts: BackoffOptions = {},
  ) {
    this.baseMs = opts.baseMs ?? 60_000;
    this.maxMs = opts.maxMs ?? 15 * 60_000;
    this.clock = opts.clock ?? systemClock;
  }

  private untilKey = (scope: string) => `x_backoff_until:${scope}`;
  private levelKey = (scope: string) => `x_backoff_level:${scope}`;

  /** Throws XRateLimitedError while the scope is backing off. */
  async assertOpen(scope: string): Promise<void> {
    const until = (await this.kv.get(this.untilKey(scope))) ?? 0;
    const now = this.clock();
    if (until > now) throw new XRateLimitedError(Math.ceil((until - now) / 1000));
  }

  /**
   * Record a 429. `resetEpochSec` (x-rate-limit-reset) or `retryAfterSec` win over the exponential default.
   * Returns the seconds callers should wait.
   */
  async trip(scope: string, hint: { resetEpochSec?: number; retryAfterSec?: number } = {}): Promise<number> {
    const now = this.clock();
    const level = ((await this.kv.get(this.levelKey(scope))) ?? 0) + 1;
    let waitMs = Math.min(this.maxMs, this.baseMs * 2 ** (level - 1));
    if (hint.resetEpochSec && hint.resetEpochSec * 1000 > now) waitMs = hint.resetEpochSec * 1000 - now + 1000;
    else if (hint.retryAfterSec && hint.retryAfterSec > 0) waitMs = hint.retryAfterSec * 1000;
    waitMs = Math.min(waitMs, this.maxMs);
    await this.kv.set(this.untilKey(scope), now + waitMs);
    await this.kv.set(this.levelKey(scope), level);
    return Math.ceil(waitMs / 1000);
  }

  /** A successful call resets the exponential level. */
  async success(scope: string): Promise<void> {
    if (((await this.kv.get(this.levelKey(scope))) ?? 0) > 0) await this.kv.set(this.levelKey(scope), 0);
  }
}

export interface Limit {
  limit: number;
  windowSec: number;
}

/** Fixed-window limiter; Turso-backed (shared by all instances) with memory fallback. */
export class RateLimiter {
  private mem = new Map<string, { ws: number; count: number }>();
  private clock: Clock;
  constructor(
    private db: Db | null,
    opts: { clock?: Clock } = {},
  ) {
    this.clock = opts.clock ?? systemClock;
  }

  /** Count a hit; throws RateLimitedError when over the limit. */
  async hit(scope: string, id: string, l: Limit): Promise<number> {
    if (!id || l.limit <= 0) return 0;
    const nowSec = Math.floor(this.clock() / 1000);
    const key = `${scope}:${id}`;
    let count: number | undefined;
    if (this.db) {
      try {
        count = await this.db.rateHit(key, l.windowSec, nowSec);
      } catch (e) {
        warnOnce("rateHit", e);
      }
    }
    if (count === undefined) {
      const ws = nowSec - (nowSec % l.windowSec);
      const cur = this.mem.get(key);
      const next = cur && cur.ws === ws ? { ws, count: cur.count + 1 } : { ws, count: 1 };
      this.mem.set(key, next);
      if (this.mem.size > 50_000) this.mem.clear(); // crude bound for long-lived processes
      count = next.count;
    }
    if (count > l.limit) {
      const retry = l.windowSec - (nowSec % l.windowSec);
      throw new RateLimitedError(scope, retry);
    }
    return count;
  }
}
