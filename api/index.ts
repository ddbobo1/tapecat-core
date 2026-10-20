/**
 * Vercel serverless entry: Express verifier under /api/*.
 * Local: `npm run verifier` → verifier/src/server.ts (listen).
 */
import { createApp, warmupSale } from "../verifier/src/app";

const app = createApp();

// Fire-and-forget warmup; per-request loadSale() still caches on success.
void warmupSale();

export default app;
