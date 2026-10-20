import "./setup-env";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { createApp, getTaskChecker, getLimiter } from "../src/app";
import { openDb } from "../src/db";
import { TEST_DB_URL } from "./setup-env";

let server: Server | undefined;
after(() => server?.close());

test("TaskChecker and RateLimiter are process singletons", async () => {
  const db = await openDb(TEST_DB_URL);
  assert.equal(getTaskChecker(db), getTaskChecker(db));
  assert.equal(getLimiter(db), getLimiter(db));
});

test("/api/allocation: durable per-IP limit answers 429 rate_limited with Retry-After", async () => {
  const app = createApp();
  server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const statuses: number[] = [];
  let last: { error?: string; retryAfter?: number } = {};
  let retryHeader: string | null = null;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/api/allocation`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ acceptTerms: true, termsVersion: "x" }),
    });
    statuses.push(r.status);
    last = (await r.json()) as typeof last;
    retryHeader = r.headers.get("retry-after");
  }
  // First 3 pass the limiter (then fail later for unrelated reasons: no RPC in tests), 4th is limited.
  assert.notEqual(statuses[0], 429);
  assert.equal(statuses[3], 429);
  assert.equal(last.error, "rate_limited");
  assert.ok(Number(retryHeader) > 0);
});
