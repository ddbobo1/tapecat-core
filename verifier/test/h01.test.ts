import { TEST_DB_URL } from "./setup-env";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { openDb, type Db } from "../src/db";
import { makeTaskChecker } from "../src/x";
import { RateLimiter, RateLimitedError, SafeKv, XBackoff, XRateLimitedError } from "../src/xguard";

type Call = { url: string; auth: string };
let calls: Call[] = [];
let followers: string[] = [];
let retweeters: string[] = [];
let next429: { reset?: number; retryAfter?: number } | null = null;

const realFetch = globalThis.fetch;
function installFetch() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.x.com/")) return realFetch(input as string, init);
    const auth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
    calls.push({ url, auth });
    if (next429) {
      const h = new Headers();
      if (next429.reset) h.set("x-rate-limit-reset", String(next429.reset));
      if (next429.retryAfter) h.set("retry-after", String(next429.retryAfter));
      return new Response("Too Many Requests", { status: 429, headers: h });
    }
    const list = url.includes("/followers") ? followers : url.includes("/retweeted_by") ? retweeters : [];
    if (url.includes("/users/") && url.includes("/tweets")) return Response.json({ data: [] });
    return Response.json({ data: list.map((id) => ({ id })), meta: {} });
  }) as typeof fetch;
}
installFetch();

let db: Db;
let t0 = Date.now();
let nowMs = t0;
const clock = () => nowMs;

beforeEach(async () => {
  db = await openDb(TEST_DB_URL);
  await db.raw.executeMultiple(
    "DELETE FROM id_cache; DELETE FROM task_checks; DELETE FROM kv_num; DELETE FROM rate_limits;",
  );
  calls = [];
  followers = [];
  retweeters = [];
  next429 = null;
  t0 = Date.now();
  nowMs = t0;
});

const opts = { clock, refreshMinIntervalMs: 60_000, negativeTtlMs: 30_000, positiveTtlMs: 600_000 };

test("H-01 regression: one checker instance throttles repeated misses (was 2+ X calls per request)", async () => {
  const tasks = makeTaskChecker(db, { ...opts, negativeTtlMs: 0 });
  await tasks.check("1", undefined, "abc");
  const first = calls.length;
  assert.equal(first, 2, "first miss refreshes followers + retweeters once");
  for (let i = 0; i < 5; i++) {
    nowMs += 1_000;
    await tasks.check("1", undefined, "abc");
  }
  assert.equal(calls.length, first, "no further X calls inside refresh interval");
});

test("negative result cache: same xId within TTL makes zero X calls and does not hit refresh path", async () => {
  const tasks = makeTaskChecker(db, opts);
  const r1 = await tasks.check("1", undefined, "abc");
  assert.deepEqual([r1.followed, r1.retweeted, r1.cached], [false, false, false]);
  const n = calls.length;
  nowMs += 10_000;
  const r2 = await tasks.check("1", undefined, "abc");
  assert.equal(r2.cached, true);
  assert.equal(calls.length, n);
});

test("cross-instance throttle: a second process sharing Turso does not refresh again", async () => {
  const a = makeTaskChecker(db, opts);
  const b = makeTaskChecker(db, opts);
  await a.check("1", undefined, "x");
  const n = calls.length;
  nowMs += 5_000;
  await b.check("2", undefined, "x");
  assert.equal(calls.length, n, "instance B honours instance A's refresh lease");
});

test("concurrent misses coalesce into one refresh", async () => {
  const tasks = makeTaskChecker(db, opts);
  await Promise.all(["1", "2", "3", "4", "5"].map((id) => tasks.check(id, undefined, "x")));
  assert.equal(calls.filter((c) => c.url.includes("/followers")).length, 1);
});

test("follower picked up after interval; positive result cached for positive TTL", async () => {
  const tasks = makeTaskChecker(db, opts);
  assert.equal((await tasks.check("42", undefined, "x")).followed, false);
  followers = ["42"];
  retweeters = ["42"];
  nowMs += 61_000; // past negative TTL and refresh interval
  const r = await tasks.check("42", undefined, "x");
  assert.deepEqual([r.followed, r.retweeted], [true, true]);
  const n = calls.length;
  nowMs += 300_000;
  const r2 = await tasks.check("42", undefined, "x");
  assert.equal(r2.cached, true);
  assert.equal(calls.length, n);
  // Already-known followers never need X even after TTL expiry.
  nowMs += 700_000;
  const r3 = await tasks.check("42", undefined, "x");
  assert.deepEqual([r3.followed, r3.retweeted, r3.cached], [true, true, false]);
  assert.equal(calls.length, n);
});

test("X 429 with x-rate-limit-reset: all instances back off until reset, then resume", async () => {
  const a = makeTaskChecker(db, opts);
  next429 = { reset: Math.floor(t0 / 1000) + 120 };
  await assert.rejects(a.check("1", undefined, "x"), (e: unknown) => {
    assert.ok(e instanceof XRateLimitedError);
    assert.ok(e.retryAfterSec >= 119 && e.retryAfterSec <= 122, `retryAfter=${e.retryAfterSec}`);
    return true;
  });
  const n = calls.length;
  next429 = null;
  const b = makeTaskChecker(db, opts); // another instance
  nowMs += 61_000; // refresh interval passed, but still inside backoff
  await assert.rejects(b.check("2", undefined, "x"), XRateLimitedError);
  assert.equal(calls.length, n, "no X call while backing off");
  nowMs = t0 + 125_000;
  followers = ["3"];
  const r = await b.check("3", undefined, "x");
  assert.equal(r.followed, true);
  assert.ok(calls.length > n, "resumed after reset");
});

test("X 429 without headers: exponential backoff 60s, 120s, capped", async () => {
  const kv = new SafeKv(db);
  const bo = new XBackoff(kv, { clock, baseMs: 60_000, maxMs: 150_000 });
  assert.equal(await bo.trip("follower"), 60);
  assert.equal(await bo.trip("follower"), 120);
  assert.equal(await bo.trip("follower"), 150);
  await bo.success("follower");
  assert.equal(await bo.trip("follower"), 60);
  await assert.rejects(bo.assertOpen("follower"), XRateLimitedError);
  await bo.assertOpen("retweeter"); // other scope unaffected
});

test("RateLimiter: per-key fixed window, durable across limiter instances", async () => {
  const l1 = new RateLimiter(db, { clock });
  const l2 = new RateLimiter(db, { clock });
  nowMs = Math.ceil(nowMs / 60_000) * 60_000 + 1_000; // start of a window
  const lim = { limit: 3, windowSec: 60 };
  await l1.hit("alloc_x", "u1", lim);
  await l2.hit("alloc_x", "u1", lim);
  await l1.hit("alloc_x", "u1", lim);
  await assert.rejects(l2.hit("alloc_x", "u1", lim), (e: unknown) => e instanceof RateLimitedError && e.retryAfterSec === 59);
  await l1.hit("alloc_x", "u2", lim); // other key fine
  nowMs += 60_000;
  await l1.hit("alloc_x", "u1", lim); // new window
});

test("RateLimiter / SafeKv fall back to memory when the DB fails", async () => {
  const broken = {
    rateHit: async () => {
      throw new Error("db down");
    },
    kvGet: async () => {
      throw new Error("db down");
    },
    kvSet: async () => {
      throw new Error("db down");
    },
    kvClaim: async () => {
      throw new Error("db down");
    },
  } as unknown as Db;
  const l = new RateLimiter(broken, { clock });
  const lim = { limit: 1, windowSec: 60 };
  await l.hit("ip", "1.2.3.4", lim);
  await assert.rejects(l.hit("ip", "1.2.3.4", lim), RateLimitedError);
  const kv = new SafeKv(broken);
  assert.equal(await kv.claim("k", 100, 50), true);
  assert.equal(await kv.claim("k", 40, 60), false);
  assert.equal(await kv.get("k"), 50);
});

test("kvClaim is a compare-and-set lease", async () => {
  assert.equal(await db.kvClaim("refresh:t", 1000, 1000), true);
  assert.equal(await db.kvClaim("refresh:t", 1000, 1500), false);
  assert.equal(await db.kvClaim("refresh:t", 1001, 2000), true);
  assert.equal(await db.kvGet("refresh:t"), 2000);
});
