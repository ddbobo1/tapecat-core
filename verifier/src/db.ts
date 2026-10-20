import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Binding {
  x_user_id: string;
  x_username: string;
  wallet: string;
  x_id_hash: string;
  followed: number;
  retweeted: number;
  cap: string;
  bound_at: number;
  updated_at: number;
}

function ensureFileDir(url: string) {
  if (!url.startsWith("file:")) return;
  let path = url.slice("file:".length);
  // libsql accepts file:./rel or file:/abs; strip leading ./ 
  if (path.startsWith("./")) path = path.slice(2);
  const dir = dirname(path);
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bindings (
    x_user_id  TEXT PRIMARY KEY,
    x_username TEXT NOT NULL,
    wallet     TEXT NOT NULL UNIQUE,
    x_id_hash  TEXT NOT NULL UNIQUE,
    followed   INTEGER NOT NULL DEFAULT 0,
    retweeted  INTEGER NOT NULL DEFAULT 0,
    cap        TEXT NOT NULL DEFAULT '0',
    bound_at   INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS signatures (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet    TEXT NOT NULL,
    x_id_hash TEXT NOT NULL,
    cap       TEXT NOT NULL,
    deadline  INTEGER NOT NULL,
    ip        TEXT,
    country   TEXT,
    terms     TEXT,
    issued_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS id_cache (
    kind  TEXT NOT NULL,
    x_id  TEXT NOT NULL,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (kind, x_id)
  );
  CREATE TABLE IF NOT EXISTS x_tokens (
    sid   TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    exp   INTEGER NOT NULL
  );
  -- H-01: cross-instance fixed-window rate limits (per xId / per IP)
  CREATE TABLE IF NOT EXISTS rate_limits (
    k            TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count        INTEGER NOT NULL
  );
  -- H-01: short-TTL cache of follow / retweet task results
  CREATE TABLE IF NOT EXISTS task_checks (
    x_user_id  TEXT PRIMARY KEY,
    followed   INTEGER NOT NULL,
    retweeted  INTEGER NOT NULL,
    checked_at INTEGER NOT NULL
  );
  -- H-01: small numeric key/value (refresh leases, X 429 backoff), values in ms
  CREATE TABLE IF NOT EXISTS kv_num (
    k TEXT PRIMARY KEY,
    v INTEGER NOT NULL
  );
`;

function rowBinding(r: Record<string, unknown> | undefined): Binding | undefined {
  if (!r) return undefined;
  return {
    x_user_id: String(r.x_user_id),
    x_username: String(r.x_username),
    wallet: String(r.wallet),
    x_id_hash: String(r.x_id_hash),
    followed: Number(r.followed),
    retweeted: Number(r.retweeted),
    cap: String(r.cap),
    bound_at: Number(r.bound_at),
    updated_at: Number(r.updated_at),
  };
}

export type Db = {
  raw: Client;
  getByX: (xUserId: string) => Promise<Binding | undefined>;
  getByWallet: (wallet: string) => Promise<Binding | undefined>;
  /** First come, first served. Returns the binding or an error string. */
  bind: (xUserId: string, username: string, wallet: string, xIdHash: string) => Promise<Binding | string>;
  updateTasks: (xUserId: string, username: string, followed: boolean, retweeted: boolean, cap: bigint) => Promise<void>;
  logSignature: (
    wallet: string,
    xIdHash: string,
    cap: bigint,
    deadline: number,
    ip: string,
    country: string,
    terms: string,
  ) => Promise<void>;
  allBindings: () => Promise<Binding[]>;
  cacheHas: (kind: string, id: string) => Promise<boolean>;
  cacheAdd: (kind: string, id: string) => Promise<void>;
  setXToken: (sid: string, token: string, expMs: number) => Promise<void>;
  getXToken: (sid: string) => Promise<string | undefined>;
  deleteXToken: (sid: string) => Promise<void>;
  /** Fixed-window counter: returns the count after this hit. `nowSec` / `windowSec` in seconds. */
  rateHit: (key: string, windowSec: number, nowSec: number) => Promise<number>;
  getTaskCheck: (xUserId: string) => Promise<TaskCheckRow | undefined>;
  putTaskCheck: (xUserId: string, followed: boolean, retweeted: boolean, checkedAtMs: number) => Promise<void>;
  kvGet: (k: string) => Promise<number | undefined>;
  kvSet: (k: string, v: number) => Promise<void>;
  /** Atomically set k=v if k is missing or its current value is < `ifBelow`. Returns true if this caller won. */
  kvClaim: (k: string, ifBelow: number, v: number) => Promise<boolean>;
};

export interface TaskCheckRow {
  followed: boolean;
  retweeted: boolean;
  checkedAtMs: number;
}

let singleton: Promise<Db> | null = null;

/** Open (or reuse) the Turso / libSQL database. */
export function openDb(url: string, authToken = ""): Promise<Db> {
  if (!singleton) singleton = openDbOnce(url, authToken);
  return singleton;
}

/** Test helper: reset the module singleton (not used in production). */
export function resetDbSingleton() {
  singleton = null;
}

async function openDbOnce(url: string, authToken: string): Promise<Db> {
  ensureFileDir(url);
  const client = createClient({
    url,
    authToken: authToken || undefined,
  });
  await client.executeMultiple(SCHEMA);

  const now = () => Math.floor(Date.now() / 1000);

  const db: Db = {
    raw: client,

    async getByX(xUserId: string) {
      const r = await client.execute({ sql: "SELECT * FROM bindings WHERE x_user_id = ?", args: [xUserId] });
      return rowBinding(r.rows[0] as Record<string, unknown> | undefined);
    },

    async getByWallet(wallet: string) {
      const r = await client.execute({
        sql: "SELECT * FROM bindings WHERE wallet = ?",
        args: [wallet.toLowerCase()],
      });
      return rowBinding(r.rows[0] as Record<string, unknown> | undefined);
    },

    async bind(xUserId, username, wallet, xIdHash) {
      const w = wallet.toLowerCase();
      const byX = await db.getByX(xUserId);
      if (byX) return byX.wallet === w ? byX : "x_account_bound_to_other_wallet";
      const byW = await db.getByWallet(w);
      if (byW) return "wallet_bound_to_other_x_account";
      const t = now();
      try {
        await client.execute({
          sql: `INSERT INTO bindings (x_user_id, x_username, wallet, x_id_hash, bound_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [xUserId, username, w, xIdHash, t, t],
        });
      } catch {
        const againX = await db.getByX(xUserId);
        if (againX) return againX.wallet === w ? againX : "x_account_bound_to_other_wallet";
        const againW = await db.getByWallet(w);
        if (againW) return "wallet_bound_to_other_x_account";
        throw new Error("bind_failed");
      }
      return (await db.getByX(xUserId))!;
    },

    async updateTasks(xUserId, username, followed, retweeted, cap) {
      await client.execute({
        sql: "UPDATE bindings SET followed = ?, retweeted = ?, cap = ?, x_username = ?, updated_at = ? WHERE x_user_id = ?",
        args: [followed ? 1 : 0, retweeted ? 1 : 0, cap.toString(), username, now(), xUserId],
      });
    },

    async logSignature(wallet, xIdHash, cap, deadline, ip, country, terms) {
      await client.execute({
        sql: `INSERT INTO signatures (wallet, x_id_hash, cap, deadline, ip, country, terms, issued_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [wallet.toLowerCase(), xIdHash, cap.toString(), deadline, ip, country, terms, now()],
      });
    },

    async allBindings() {
      const r = await client.execute("SELECT * FROM bindings ORDER BY bound_at");
      return r.rows.map((row) => rowBinding(row as Record<string, unknown>)!);
    },

    async cacheHas(kind, id) {
      const r = await client.execute({
        sql: "SELECT 1 AS ok FROM id_cache WHERE kind = ? AND x_id = ?",
        args: [kind, id],
      });
      return r.rows.length > 0;
    },

    async cacheAdd(kind, id) {
      await client.execute({
        sql: "INSERT OR IGNORE INTO id_cache (kind, x_id, seen_at) VALUES (?, ?, ?)",
        args: [kind, id, now()],
      });
    },

    async setXToken(sid, token, expMs) {
      await client.execute({
        sql: `INSERT INTO x_tokens (sid, token, exp) VALUES (?, ?, ?)
              ON CONFLICT(sid) DO UPDATE SET token = excluded.token, exp = excluded.exp`,
        args: [sid, token, expMs],
      });
    },

    async getXToken(sid) {
      const r = await client.execute({ sql: "SELECT token, exp FROM x_tokens WHERE sid = ?", args: [sid] });
      const row = r.rows[0] as { token?: string; exp?: number } | undefined;
      if (!row) return undefined;
      if (Number(row.exp) < Date.now()) {
        await db.deleteXToken(sid);
        return undefined;
      }
      return String(row.token);
    },

    async deleteXToken(sid) {
      await client.execute({ sql: "DELETE FROM x_tokens WHERE sid = ?", args: [sid] });
    },

    async rateHit(key, windowSec, nowSec) {
      const ws = nowSec - (nowSec % windowSec);
      const r = await client.execute({
        sql: `INSERT INTO rate_limits (k, window_start, count) VALUES (?, ?, 1)
              ON CONFLICT(k) DO UPDATE SET
                count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
                window_start = excluded.window_start
              RETURNING count`,
        args: [key, ws],
      });
      return Number((r.rows[0] as { count?: number } | undefined)?.count ?? 1);
    },

    async getTaskCheck(xUserId) {
      const r = await client.execute({
        sql: "SELECT followed, retweeted, checked_at FROM task_checks WHERE x_user_id = ?",
        args: [xUserId],
      });
      const row = r.rows[0] as { followed?: number; retweeted?: number; checked_at?: number } | undefined;
      if (!row) return undefined;
      return { followed: !!Number(row.followed), retweeted: !!Number(row.retweeted), checkedAtMs: Number(row.checked_at) };
    },

    async putTaskCheck(xUserId, followed, retweeted, checkedAtMs) {
      await client.execute({
        sql: `INSERT INTO task_checks (x_user_id, followed, retweeted, checked_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(x_user_id) DO UPDATE SET followed = excluded.followed, retweeted = excluded.retweeted,
                checked_at = excluded.checked_at`,
        args: [xUserId, followed ? 1 : 0, retweeted ? 1 : 0, checkedAtMs],
      });
    },

    async kvGet(k) {
      const r = await client.execute({ sql: "SELECT v FROM kv_num WHERE k = ?", args: [k] });
      const row = r.rows[0] as { v?: number } | undefined;
      return row ? Number(row.v) : undefined;
    },

    async kvSet(k, v) {
      await client.execute({
        sql: "INSERT INTO kv_num (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        args: [k, v],
      });
    },

    async kvClaim(k, ifBelow, v) {
      const r = await client.execute({
        sql: `INSERT INTO kv_num (k, v) VALUES (?, ?)
              ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE kv_num.v < ?`,
        args: [k, v, ifBelow],
      });
      return r.rowsAffected > 0;
    },
  };

  return db;
}
