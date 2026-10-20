# tapecat (plan v0.10 / contract design v1.2 implementation)

tapecat issuance on BNB Chain: raise BEM, swap it in batches over one hour, then open two PancakeSwap V2 pools. This tree implements plan v0.10 and contract design v1.2. Later notes (plan v0.11, contract design v1.3) raise `MIN_RAISE` to 300 BEM.

> This repository is not legal, tax, or investment advice. Audit the contracts, talk to counsel, and finish the open items in plan §12 before launch.

## Layout

| Path | Contents |
|---|---|
| `contracts/TapeCatToken.sol` | Fixed 1,000,000,000 supply, no mint. A constant 1% tax on buys and sells against the two launch pairs, paid in tapecat to `taxReceiver`. The Safe can change only `taxReceiver`. |
| `contracts/TapeCatSale.sol` | Raise (EIP-712 single-signer allocation, one X account ↔ one wallet, ≤1.5 BEM), 10% referral rebate, 1h batched swap (Kyber → 1inch → direct, 2% on-chain `minOut`), launch (two pools, LP → dEaD, 10% fund, burn 160M), claim, refund. |
| `test/sale.test.ts` | Unit tests (real Uniswap V2 pair bytecode plus mock aggregator / Quoter / V3 pools). |
| `test/fork.test.ts` | BSC mainnet-fork flow (real QuoterV2, TWAP, SmartRouter, Kyber calldata, V2 Router sell). Needs `FORK_URL` (archive RPC). |
| `verifier/` | Off-chain verifier: SIWE sign-in, X OAuth2 PKCE, follow/repost checks, first-come binding, EIP-712 allocation signatures, geo block, public swap-plan API, `/api/config`. |
| `keeper/` | Self-hosted backup keeper bot (Gelato is the primary keeper). |
| `gelato/` | Gelato Web3 Function (primary keeper). |
| `web/` | Site (Next.js 16, existing design): home, `/join` (wallet sign-in → bind X → follow/repost → contribute BEM), `/invite`, `/claim`, `/risk`. Geo notice and terms checkbox. Product copy in `web/` stays Chinese. |
| `scripts/` | Deploy, address checks, live quotes, oracle prep, allowlist export (Merkle + IPFS + Safe transaction). |
| `docs/` | English design and ops notes. See below. |

## Docs

| Doc | What it is |
|---|---|
| [docs/plan.md](docs/plan.md) | Issuance plan (v0.11). |
| [docs/contract-design.md](docs/contract-design.md) | Contract design for development and audit (v1.3). |
| [docs/deploy-architecture.md](docs/deploy-architecture.md) | Decided hosting layout (one Vercel project, same origin). |
| [docs/tax-disclosure.md](docs/tax-disclosure.md) | Public 1% buy/sell tax statement. |

## Hardening versus the original sketch

0. **v0.10**: aggregator routes require `isKeeper`; minimum batch `ceil(remaining/batchesLeft)` plus 99.9% fill; TWAP 120s; `cap ∈ {1, 1.5}`; referrer bound only on the first contribution; `setTaxReceiver` rejects pair/Sale; launch dust goes to the fund; public `/api/keeper/plan` returns Direct only.
1. **TWAP manipulation check**: `swapBatch` is permissionless. A `minOut` taken only from a QuoterV2 quote inside the same transaction can be crashed first. Each reference V3 pool must satisfy `|spot tick − TWAP tick| ≤ 200` (~2%). A path that fails is ignored. If both fail, the batch does not run (unsold BEM ends in the BEM pool, which is the planned fallback). On 2026-10-18 the three pools were 3–17 ticks off spot, with observation cardinality 512–4500.
2. **Donations cannot brick launch**: a huge BEM/WBNB donation into a pair can demand more tapecat than the 400M budget. The sketch’s `balance − TP` would underflow and make `launch` impossible. Excess is now capped pro rata.
3. **Pro-rata safety-valve refund**: if launch has not happened by end+1h+7d, contributors are refunded pro rata from the BEM + WBNB balance snapshot. After that moment `launch()` cannot be called. The two paths are exclusive.
4. **Previous official referrers can still claim**: the sketch locked their rebates after `setOfficialReferrer`. `wasOfficialReferrer` records them.
5. **Empty referrers**: after launch anyone may call `reassignRebate(ref)` to move a personal referrer’s unpaid rebate to the current official referrer if that personal referrer never contributed (plan §5.3).
6. Aggregator failures bubble the revert reason. After a fill the contract checks BEM spent ≤ amount, WBNB balance delta ≥ the pro-rata `minOut`, and allowance cleared to zero.
7. Known tradeoff: 12 batches × 5-minute cooldown equals exactly 1 hour, so a 13th batch cannot fit in the window.

## Quick start

```powershell
npm install
npx hardhat test                    # unit tests; fork test skips without FORK_URL
npx tsx scripts/check-addresses.ts  # check BSC external contracts and reference pools
npx tsx scripts/live-check.ts 600   # live QuoterV2 / TWAP / Kyber quotes (0.40R = 600 BEM)
```

If Node must use a local proxy for Kyber, 1inch, or the X API, set `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY`.

Copy `.env.example` to `.env` for local runs. `.env` is gitignored. Do not commit private keys, API tokens, or filled environment files. Values in `.env.example` are placeholders. The Hardhat keys in `test/` and `scripts/smoke-verifier.ts` are Hardhat’s published default accounts, not project keys.

### Site (`web/`) — one Vercel project, same origin

Decided layout (see [docs/deploy-architecture.md](docs/deploy-architecture.md)): the Next site and the verifier share one Vercel project and one origin. Do not set `output: 'export'`. Leave `NEXT_PUBLIC_VERIFIER_URL` empty in production so the browser calls `/api/…`. Cookies are same-site (`SameSite=Lax`).

The earlier HashPort static export plus a separate API origin is deprecated. The code still accepts cross-origin CORS and `NEXT_PUBLIC_VERIFIER_URL` for a transition, but new deploys should follow the architecture doc.

```powershell
npm run verifier                         # :8787, Node >= 22
cd web; npm install
# local dev: leave NEXT_PUBLIC_VERIFIER_URL unset; next dev proxies /api → VERIFIER_URL
$env:VERIFIER_URL="http://127.0.0.1:8787"; npm run dev
```

- Do not point `NEXT_PUBLIC_VERIFIER_URL` at the static site itself.
- Verifier: `FRONTEND_ORIGIN`, `API_ORIGIN`, and `PUBLIC_ORIGIN` are the same production origin (SIWE). `X_REDIRECT_URI` is `https://<domain>/api/x/callback`. `X_RETURN_PATH=/join`. `FRONTEND_ORIGINS` is the CORS allowlist. Behind Cloudflare plus nginx, set `TRUST_PROXY=2`.
- `scripts/smoke-verifier.ts` can target `VERIFIER_URL` for a smoke test.
- A Google Fonts timeout on this machine can fail `next dev`. `npm run build` fetches fonts at build time.

## Launch sequence (plan §9)

1. Close the open items in §12 and fill `.env` from `.env.example`: Safe, signer address, official referrer, fund Safe, tax EOA, start/end, `SALE_SALT`, 1inch API key.
2. Re-check addresses and depth with `scripts/check-addresses.ts` and `scripts/live-check.ts`.
3. Fork test on an archive RPC: `FORK_URL=https://bsc-mainnet.public.blastapi.io`, `FORK_BLOCK` = head − 20, then `npx hardhat test test/fork.test.ts`. Add `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY` if you need a proxy, or the Kyber batch is skipped. Passed on 2026-10-18 at block 128357242 (Kyber batch + direct batch + two-pool launch + claim + 1% tax).
4. Testnet: `npm run deploy:testnet` (override BEM/WBNB/routers in `.env` with testnet mocks). Run verifier, frontend, and keeper.
5. Audit.
6. Mainnet: `npm run deploy:bsc` → `deployments/bsc.json`, then `hardhat verify` both contracts as the script prints.
7. `npm run oracle:prepare` (anyone can raise observation cardinality if a reference pool is under 600).
8. Verifier: set `SALE_ADDRESS`, `SIGNER_PRIVATE_KEY`, and X credentials, then `npm run verifier`, behind Cloudflare (`CF-IPCountry` geo block). Boot checks on-chain `saleSalt` and `signer`.
9. Keeper: Gelato (`gelato/`, `npm i && npm run deploy`, every minute from end−5min) plus `npm run keeper` on `PRIVATE_RPC_URL` (MEV-protected). The site button can also trigger the permissionless path.
10. Raise ends → 1h swap → `launch()`.
11. `npm run allowlist:export` → IPFS → Safe executes `publishAllowlist(root, cid)` from `out/safe-publishAllowlist.json`.

## Safe permission boundary

Sale: `setSigner`, `setOfficialReferrer`, `setFundWallet` (before launch only), `publishAllowlist` (event only). Token: `setTaxReceiver`. No timelock. The Safe cannot move funds, mint, or change the tax rate, pricing, schedule, or pairs.

## Still manual

- **Signer key custody**: `verifier/src/signer.ts` is a local-key implementation behind an interface. Production should use a KMS/HSM.
- **Gelato Web3 Function** has not been run with the SDK on this machine. Run `w3f test` before deploy.
- **Keeper allowlist**: `npx tsx scripts/init-keeper.ts` creates a dedicated bot wallet and writes `KEEPER_PRIVATE_KEY` and `INITIAL_KEEPERS` in `.env` (it does not print the key). Gelato’s dedicated `msg.sender` exists only after the task is created. Add it to `INITIAL_KEEPERS` (comma-separated) before deploy, or have the Safe call `setKeeper(addr, true)` after deploy. In both cases also set `keeperAddress` in `gelato/.../userArgs.json`.
- X API `followers` / `retweeted_by` availability and price follow the developer console. Reposts are checked on the user’s own timeline first; a quote post with a short code is the fallback.
- The site and verifier should share an origin (Next proxy, above). An IPFS static host makes the login cookie cross-site and needs CORS plus `SameSite=None`. On-chain claim, refund, and trigger calls do not depend on that cookie.
- Geo blocking is only in the frontend and verifier. Anyone can call the contracts directly (plan §8). Sub-regions such as Crimea cannot be blocked by country code.
