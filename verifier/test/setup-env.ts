/** Test env: must be imported before any verifier module (config reads env at import). */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tc-verifier-test-"));
export const TEST_DB_URL = `file:${join(dir, "test.sqlite")}`;

Object.assign(process.env, {
  TURSO_DATABASE_URL: TEST_DB_URL,
  TURSO_AUTH_TOKEN: "",
  X_CLIENT_ID: "test-client",
  X_BEARER_TOKEN: "test-bearer",
  X_PROJECT_USER_ID: "999",
  X_CAMPAIGN_TWEET_ID: "777",
  SALE_ADDRESS: "0x000000000000000000000000000000000000dEaD",
  SALE_SALT: "test-salt",
  // Well-known public Hardhat account #0 test key (not a secret).
  SIGNER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  BSC_RPC_URL: "http://127.0.0.1:9",
  FRONTEND_ORIGIN: "http://localhost:3000",
  ALLOW_UNKNOWN_COUNTRY: "1",
  ALLOC_RL_PER_IP: "3/60",
  ALLOC_RL_PER_X: "2/60",
  SESSION_SECRET: "test-session-secret-test-session",
});
