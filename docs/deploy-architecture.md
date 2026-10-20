# tapecat deploy architecture (decided)

## Full Vercel hosting (decided)

> **Frontend and verifier in one Vercel project, on one domain (same origin).**
> Do not use a TapeOut HashPort static export, and do not run the verifier on a separate VPS.
> The keeper is still Gelato plus a self-hosted bot (a long-running off-chain process, not part of this page).

Unrelated to LosstradeAI. Describe the project as a community project, not an official TapeOut product.

### Why one Vercel project

| Before (HashPort + VPS) | Now (decided) |
| --- | --- |
| Static frontend `output:'export'` on HashPort | Next on Vercel, normal SSR/static mix (**do not** set `output:'export'`) |
| Verifier on a VPS or another subdomain, cookie `SameSite=None` | Express wrapped as `api/index.ts`, routes `/api/*`, **same origin** as the frontend, `SameSite=Lax` |
| Local `node:sqlite` loses data on serverless | **Turso / libSQL** (`@libsql/client`) for bindings and X tokens |
| `NEXT_PUBLIC_VERIFIER_URL=https://api.…` | Leave empty in production → the browser calls the relative path `/api/…` |

### Layout

| Component | Where |
| --- | --- |
| `web/` Next pages | Same Vercel project (`@vercel/next`) |
| `verifier/` Express (`api/index.ts` entry) | Same project, serverless, `/api/*` |
| Bindings / signature log / X tokens | **Turso** (a free database is enough to start) |
| Keeper | Gelato Web3 Function + self-hosted bot (still needs a process or a schedule) |

### Environment variables (Vercel project → Settings → Environment Variables)

**Required before launch:**

- `SESSION_SECRET` — random session secret
- `TURSO_DATABASE_URL` — `libsql://…`
- `TURSO_AUTH_TOKEN` — Turso token (may be empty for a local `file:` URL)
- `FRONTEND_ORIGIN` / `API_ORIGIN` / `PUBLIC_ORIGIN` — **all three the same**, for example `https://tapecat.vercel.app` or the custom domain
- `FRONTEND_ORIGINS` — at least the production origin (the code also allows localhost:3000)
- `X_CLIENT_ID` / `X_BEARER_TOKEN` / `X_PROJECT_USER_ID` / `X_PROJECT_HANDLE` / `X_CAMPAIGN_TWEET_ID`
- `X_REDIRECT_URI` — `https://YOUR_DOMAIN/api/x/callback` (same domain as above)
- `SALE_SALT` / `SIGNER_PRIVATE_KEY`
- `SALE_ADDRESS` — fill after the mainnet deploy. **You can deploy without it.** `/api/health` and `/api/geo` still work. Signing routes return 503.

**Optional:** `X_CLIENT_SECRET`, `BLOCKED_COUNTRIES`, `GEO_HEADER`, `TERMS_VERSION`, `ALLOCATION_TTL_SEC`, `BSC_RPC_URL`, `PUBLIC_RPC_URL`, `CHAIN_ID`, `COOKIE_*`

**Frontend:** in production, **do not** set `NEXT_PUBLIC_VERIFIER_URL` (or set it empty).

Never commit `.env`, private keys, or a Turso token.

### Create a free Turso database (outline)

1. Sign up at [turso.tech](https://turso.tech). Use the CLI or the console.
2. `turso db create tapecat` → `turso db show tapecat --url`
3. `turso db tokens create tapecat`
4. Put the URL and token in the Vercel environment variables.
5. The verifier creates tables on first connect with `CREATE TABLE IF NOT EXISTS`.

Local development does not need Turso. The default is `TURSO_DATABASE_URL=file:verifier/data/verifier.sqlite`.

### Vercel deploy steps

1. Import the repository into Vercel (root directory = repo root, use the root `vercel.json`).
2. Fill the environment variables above.
3. Deploy. `vercel.json` will:
   - `npm install` at the root (includes verifier dependencies) and install `web`
   - build Next (`web`)
   - route `/api/*` to `api/index.ts` (Express)
4. In the X developer portal, set the callback URL to `https://<your-domain>/api/x/callback`.
5. After the mainnet `SALE_ADDRESS` exists, add it in Vercel and redeploy.

Local:

```bash
# terminal 1 — verifier (file: SQLite or local Turso)
npm install
npm run verifier

# terminal 2 — Next (rewrites /api → :8787)
cd web && npm install && npm run dev
```

### Hobby vs Pro

- **Hobby**: fine for a personal, non-commercial trial. Bandwidth and commercial terms are limited.
- **A public raise / commercial use**: use **Vercel Pro** (on the order of $20/month) and check X, Turso, and geo compliance yourself.

### Keeper (unchanged)

- Put the self-hosted bot in `INITIAL_KEEPERS` in `.env` first.
- After the Gelato dedicated `msg.sender` exists, the Safe adds it with `setKeeper`.
- The bot needs about **0.05 BNB** for gas.

### Security notes

- State-changing POSTs still require `Origin ∈ FRONTEND_ORIGINS`.
- X user access tokens live in the **Turso `x_tokens` table** (session id + TTL), not only in an in-process map (serverless instances would drop that).
- Rate limits, one X account per wallet, and the signing rules are unchanged.
- Private keys live only in Vercel environment variables or a local `.env`. They never go into the frontend bundle.

### Retired path (for comparison only)

HashPort static export, a separate `api.` subdomain plus VPS SQLite, and production `output:'export'` are **no longer the recommended path**. The code still accepts cross-origin CORS and `NEXT_PUBLIC_VERIFIER_URL` during a transition. This page is the source of truth.
