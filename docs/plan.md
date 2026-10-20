# tapecat tape-out issuance plan (BNB Chain · BEM raise · two-pool launch)

> Version v0.11 · 2026-10-19 (UTC+8) · drafted for the tapecat project team
> This document is not legal, tax, or investment advice. On-chain figures are a snapshot from the 2026-10-18 query. Re-check them before deploy.

---

## Changelog

### v0.11 (2026-10-19) relative to v0.10

| # | Change |
|---|---|
| 1 | **`MIN_RAISE` moved from 10 BEM to 300 BEM** (`300e8`). Below that, a full BEM refund. No swap, no launch. The per-address cap is still 1.5 BEM, so at least 200 full-cap addresses are required. The Sale already deployed on mainnet is still 10 BEM. This takes effect on the next deploy. |

### v0.10 (2026-10-18) relative to v0.9

| # | Change |
|---|---|
| 1 | Aligned with implementation / contract design **v1.2**: flat contribute (no nonce), short signature lifetime 30–60 min, minimum batch so dust cannot burn the batch budget, `spent ≥ 99.9%`, TWAP 120s, worst case about 4–5% per batch. |
| 2 | `cap` may be only 1 or 1.5 BEM. Referrer bound only on the first contribution. `setTaxReceiver` rejects pair/Sale. Launch dust goes to the fund. |
| 3 | The public swap plan returns Direct only. Gelato simulation sets the keeper `from`. |

### v0.9 (2026-10-18) relative to v0.8

| # | Change |
|---|---|
| 1 | **Decided**: aggregator routes on `swapBatch` (KyberSwap / 1inch) **may be called only by allowlisted keepers** (Gelato executor + self-hosted bot). **The direct BEM→WBNB route stays open to anyone.** |
| 2 | New keeper allowlist `isKeeper`, managed by Safe `setKeeper(address, bool)` (no timelock), event `KeeperSet`. A leaked keeper key loses at most about 4–5% per batch (2% minOut + ~2% TWAP tolerance). The Safe can revoke immediately. |
| 3 | §5.2, §6, the sketch, and §11 updated. The full spec is [contract-design.md](contract-design.md) v1.1 and later. |

### v0.8 (2026-10-18) relative to v0.7

| # | Change |
|---|---|
| 1 | **`MIN_RAISE = 10 BEM` was confirmed** (a constant; from v0.11 it is **300 BEM**). |
| 2 | **Keep “one X account receives one allocation”**: the signer binds the X user id to one wallet. The signature includes `xIdHash`. The contract stores a one-to-one `xIdHash → wallet` and `wallet → xIdHash`. Reusing the same X account on another wallet is rejected. |
| 3 | The sketch `contribute` adds an `xIdHash` argument and the binding check. Remaining open items: deploy addresses, backup aggregator (1inch / OpenOcean), raise start and end, and the public disclosure text. |

### v0.7 (2026-10-18) relative to v0.6

| # | Change |
|---|---|
| 1 | New **public 1% buy/sell tax**: the rate is an immutable constant. Charged only on trades with the two launch LP pairs. Sale and dEaD are exempt. Tax is tapecat sent straight to the EOA `taxReceiver` (the Safe can replace it at any time). No design that tries to hide the tax from scanners. |
| 2 | **No vesting**: 100% claimable after launch. |
| 3 | **No soft cap**: only a technical floor `MIN_RAISE` (v0.7 suggested 10 BEM; from v0.11 it is **300 BEM**). Below that, a full refund. |
| 4 | Remaining tapecat at launch is **all burned**: 1,000M − 600M (participants) − 240M (LP) = **160M**. The keeper bounty is removed. |
| 5 | Slippage is a fixed **2%** per batch. No cumulative floor D. Route order **KyberSwap → 1inch → direct BEM→WBNB**. |
| 6 | The fund Safe is **not locked and has no timelock**. `officialReferrer` can be replaced by the Safe, **with no timelock**. |
| 7 | Allocation signing is **option A: a single signer** (project server key, `setSigner` replaceable by the Safe). Options A/B/C and the mitigations are recorded. After the raise, the list plus a Merkle root are still published (IPFS). |
| 8 | **No anti-sybil threshold and no anti-snipe limit** (risks in §11). |
| 9 | Keeper: **Gelato primary + self-hosted bot backup + anyone may call**. |
| 10 | The frontend geo-blocks mainland China, the United States, and OFAC-sanctioned regions, and requires a terms checkbox. Disclosure / risk copy added. The sketch and the open-items list were updated with it. The live site copy in `web/` stays Chinese. The English disclosure is in §8. |

### v0.6 (2026-10-18) relative to v0.5

| # | Change |
|---|---|
| 1 | **Default swap path goes through USDT / an aggregator** (BEM→USDT→WBNB, KyberSwap and similar). Direct BEM→WBNB is **the fallback when the aggregator fails**. |
| 2 | The impact table is refreshed at **0.40R** with the KyberSwap numbers from the slippage analysis (interpolated at 200/600/1200/2000/4000), plus a single-path BEM→USDT(1%)→WBNB comparison. |
| 3 | `swapBatch`: allowlisted aggregator + on-chain `minOut`. Direct V3 is fallback only. The split stays **80/10/10**. |
| 4 | Brand ties to other projects, community airdrops, and the related open items are removed. tapecat is a separate project. |

### v0.5 (2026-10-18) relative to v0.4

| # | Change |
|---|---|
| 1 | **Split changed to 80/10/10**: 40%·R → tapecat/BEM pool; 40%·R swapped to BNB → tapecat/WBNB pool; **10% → project fund** (Gnosis Safe `fundWallet` set at deploy); 10% referral rebate (same rule: no referrer → `officialReferrer`, replaceable by the multisig). |
| 2 | **Primary swap path changed to direct BEM→WBNB** (PancakeSwap V3 BEM/WBNB 1%; Pancake Infinity BEM/BNB optional). QuoterV2 was called again and impact recomputed at 0.40R. Direct impact is heavy for R ≳ 1,000, and R ≥ 5,000 **drains the pool**. |
| 3 | Circuit breaker raised: 1.5–3% per batch **plus a cumulative price floor D (suggested 10%)**, and batches become **adaptive**. The table shows “actually sold / sent to the BEM pool” at each R. The aggregator route through USDT is **optional** (much less impact). |
| 4 | tapecat required for LP changed to **0.40·T_P = 240M**. The freed 30M joins the remainder and is **burned by default**. Worked examples, sell pressure, the sketch, risks, and the open-items list were updated. |

### v0.4 (2026-10-18) relative to v0.3

| # | Change |
|---|---|
| 1 | Replaced the v0.2/v0.3 impact table, which used only the WBNB-pool x·y=k and **badly overstated** impact (old −19/−44/−64/−90%), with on-chain QuoterV2 + KyberSwap full-market routing from the offline slippage notes. |
| 2 | `swapBatch` goes through an **aggregator (KyberSwap and similar)** or a **three-pool split** (Pancake V3 BEM/USDT 1%, BEM/USDT 0.01%, BEM/WBNB 1%; primary path BEM→USDT→WBNB). Per-batch slippage cap **1.5–3%** (on-chain Quoter/TWAP). The keeper uses an **MEV-protected RPC**. |
| 3 | Stated clearly: **batching alone does not reduce total AMM impact**. Only external net buying improves it. Added LP-withdrawal, front-run, and BEM-downtrend risks. Discussed the trust tradeoff of a contract calling an aggregator (allowlisted router + on-chain `minOut`). Sketch updated. |

### v0.3 (2026-10-18) relative to v0.2

| # | Change |
|---|---|
| 1 | **Confirmed**: if there is no referrer or the referral is invalid, that contribution’s 10% rebate is the **official referrer’s (`officialReferrer`)** result. It is not added to LP and it is not burned. |
| 2 | **`officialReferrer` can be replaced later**: an initial value is set at deploy and **is not frozen**. A **Gnosis Safe multisig on BSC** calls `setOfficialReferrer`. A short **timelock** (for example 24–48h) was suggested for transparency. Only the official-referrer address changes. It **does not** move `claimableRebate` already booked to the old address. |

### v0.2 (2026-10-18) relative to v0.1, from review comments

| # | Change |
|---|---|
| 1 | **Hard cap removed**. The raise ends only at a fixed end time. Hard-cap and pro-rata refund logic deleted. A soft-cap refund was marked as an **optional suggestion**. |
| 2 | The old “10% treasury” became a **10% referral rebate (BEM)**. On-chain referral links, the split rule, where a missing referrer’s share goes, and anti-self-referral / sybil notes were added. The bounty for calling `launch` became tapecat supply or a pure gas incentive (no longer taken from the 10% BEM). |
| 3 | The wait after the raise changed from **24h to 1h**: batched BEM→BNB inside the window, pools and launch at **end+1h**. “Automatic” means a permissionless function + a keeper (Chainlink Automation / Gelato / self-hosted bot) + anyone may call the fallback. |
| 4 | Because there is no hard cap, added an impact table for selling 45%·R BEM inside 1h at different raise sizes R, a per-batch slippage cap, and a rule for BEM that did not become BNB (the opening price stays exactly 2× cost). |
| 5 | Token economics, worked examples, the Solidity sketch, risks, and the open-items list were updated together. |

---

## 0. Short version (TL;DR · updated through v0.11)

| Item | Design |
|---|---|
| Chain / DEX | BNB Chain. The two tapecat pools are **PancakeSwap V2** (full range, LP sent to the burn address, created in the same transaction) |
| How to join | Site: connect wallet → bind X → follow (1 BEM cap) / repost (+0.5 BEM) → contribute BEM with an optional referrer |
| Allocation signature | **Single signer (option A)**: a project server key signs an EIP-712 allocation. The Safe can replace the signer address. The contract hard-codes ≤1.5 BEM per address. **One X account binds one wallet** (on-chain `xIdHash`). After the raise, publish the list + Merkle root (IPFS) |
| Raise | **No hard cap, no soft cap.** Ends only at `endTime`. The only threshold is the technical floor **`MIN_RAISE = 300 BEM`** (decided). Below that, a full refund. Per address ≤1.5 BEM, so at least 200 full-cap addresses |
| Fund flow | **80% → liquidity** (40%·R → tapecat/BEM pool; 40%·R swapped to BNB via an aggregator → tapecat/WBNB pool; unsold BEM joins the BEM pool). **10% → project-fund Safe.** **10% → referral rebates** (no referrer → `officialReferrer`) |
| Pricing | Participant cost `c = R / T_P`. Opening price `p = 2c` (a pricing rule, **not a promise of returns**). The BNB pool is anchored to the realized swap price |
| Unlock | **No vesting**: participants can claim 100% after launch |
| Supply | 1 billion: participants 600M + LP 240M. **The other 160M is sent to 0x…dEaD at launch** |
| Trading tax | **Public 1% buy/sell tax** (constant, cannot be changed), only on transfers with the two LP pairs. Paid in tapecat to the tax EOA. The Safe can replace that address at any time. Scanners will show a 1% tax |
| Swap path | KyberSwap (primary) → 1inch (backup aggregator) → direct BEM→WBNB (last resort). Fixed **2%** on-chain `minOut` per batch. **No cumulative floor** |
| Timeline | Raise ends → 1h of batched swaps (Gelato primary + self-hosted bot on the aggregator, allowlisted only; anyone may use the direct fallback) → `launch()` at end+1h creates the pools |
| Governance (Safe multisig) | Can change only: `signer`, `officialReferrer`, `fundWallet` (before launch), `taxReceiver`. **No timelock** on any of them. Cannot move funds, mint, or change the tax rate / pricing / schedule |
| Explicitly not done | No anti-sybil threshold, no anti-snipe limit, no vesting (risks in §11) |
| Regions | The frontend geo-blocks mainland China, the United States, and OFAC-sanctioned regions, and requires a terms checkbox (§8) |

---

## 1. BEM research (sourced)

| Item | Contents | Source |
|---|---|---|
| What it is | TapeOut protocol’s official example miner token, mined by Proof of Design | GeckoTerminal, KCEX, tapeout.net |
| Contract | BNB Chain BEP-20: `0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a` | KCEX, BscScan, the RPC used for this note |
| decimals | **8** (the contract math must respect this) | RPC `decimals()` |
| Supply | Max 21,000,000; about 376,780 at query time; about 7,200 per day | RPC, tapeout.link |
| Price snapshot | about $32–35; market cap about $12–13M | CoinGecko, GeckoTerminal |
| Liquidity (detailed check 2026-10-18) | **Most depth is in USDT**: V3 BEM/USDT 1% ≈ **$443K**, BEM/USDT 0.01% ≈ **$99K**; BEM/WBNB 1% ≈ **$128K**. Also Uni V4 / Infinity / PropAMM and others. The best path is usually **BEM→USDT→WBNB** | offline slippage notes, DexScreener, on-chain QuoterV2 |
| V2 BEM/WBNB | the pair exists but reserves are nearly empty. **Not usable** | the RPC used for this note |

**Key constraint (v0.6, via USDT / aggregator)**: default to the best full-market route (depth is mostly BEM/USDT). At 0.40R, average slippage is about 1–4% for R ≤ 3,000 and about −15% at R = 10,000. **Direct BEM→WBNB is backup only** (about 61–63 WBNB, easy to drain). Fixed 2% on-chain `minOut` per batch. Unsold BEM joins the BEM pool (§4.5, §5.2).

The slippage curves cited below come from offline notes that are **not in this repository**. Re-run the quotes before relying on the numbers.

---

## 2. Overall architecture

```
┌──────── Site frontend (open source; geo block + terms checkbox) ──────────┐
│ connect wallet → SIWE → X OAuth → allocation signature → contribute(...)  │
└──────────┬─────────────────────────────────────────────┬──────────────────┘
           │                                             │ RPC
┌──────────▼──────────────┐               ┌──────────────▼─────────────────────────┐
│ Verifier (open source)  │ EIP-712       │ TapeCatToken (1% LP tax) / TapeCatSale │
│ X follow/repost checks  │──one signer──▶│ raise · referrals · 1h batched swap · launch │
│ list → IPFS + Merkle    │               │ Pancake V2 pools; Kyber→1inch→direct   │
└─────────────────────────┘               │ Keeper: Gelato+bot (allowlist) / anyone (direct) │
                                          └─────────────────────────────────────────┘
```

---

## 3. Task checks and allocation signatures

### 3.1 Practical limits

- **X follow/repost cannot be fully verified on-chain.** An off-chain verifier is required. The verifier code is open source.
- X API (2026 usage pricing; the developer console is the source of truth): reading **your own** follower list is about $0.001 per row; `retweeted_by` is about $0.01 per returned user. The repost endpoint may be incomplete. Measure it. The fallback is “a quote post that contains a short wallet code”.
- Contract hard limits: `cap ≤ 1.5 BEM` (constant). The signing domain includes chainId and the contract address. Signatures carry a `deadline`.

### 3.2 Signing options (A is selected)

| Option | How | Trust / risk | Status |
|---|---|---|---|
| **A. Single signer** | One key on the project server signs EIP-712 allocations. The Safe can replace `signer` | Single point: a leaked key can forge allocations | **Selected** |
| B. 2-of-3 | Three keys held by team members / the server. The contract requires two signatures | Lowers single-key leak risk. Slightly more ops | Not used |
| C. External signer | A 2-of-3 that includes an external community / partner signer | Most decentralized | Possible later (needs a new contract or a reserved interface) |

**Mitigations for option A**

- Keep the key on a **dedicated server**, in an HSM or cloud KMS (no plaintext on disk). Rate-limit the signing API, sign only requests that passed the checks, and log them.
- **A leak has a cap**: the contract hard-codes ≤1.5 BEM per address. The signer can **only issue extra allocations** (the attacker must supply their own BEM). They **cannot move funds in the contract**, and they cannot change pricing, the schedule, or the tax rate.
- On an anomaly, the Safe calls `setSigner(newSigner)` and rotates the key immediately (no timelock; decided). Old signatures die at once.
- After the raise, publish the full list `{wallet, X id hash, cap}` and the Merkle root to **IPFS**, and record the CID in an on-chain event so the community can check it.

### 3.3 Anti-sybil (decided: no threshold)

- No threshold on X account age, follower count, wallet history, BABT, or similar. The verifier only checks “did this account finish the task”.
- **“One X account, one allocation” stays** (task integrity, not an anti-sybil threshold):
  - After OAuth the verifier has the X user id and computes `xIdHash = keccak256(abi.encodePacked(saleSalt, xUserId))`. `saleSalt` is a public salt for this campaign so hashes do not link across campaigns. The X id space is small and the hash can be enumerated, so this only de-identifies. It is not a privacy protection.
  - The verifier binds `xUserId ↔ wallet` locally first (first come, first served) and signs only for the bound wallet. The signed body is `Allocation(wallet, xIdHash, cap, deadline)`.
  - On the first contribution the contract writes `walletOfX[xIdHash] = wallet` and `xOfWallet[wallet] = xIdHash`. After that the same `xIdHash` can be used only by that wallet, and that wallet cannot switch to another X account. Even if the signer key leaks or the verifier is wrong, the chain cannot attach one X account to two contributing wallets (an attacker can still forge an `xIdHash` that does not exist, still limited to 1.5 BEM per address).
  - The public IPFS list after the raise contains `{wallet, xIdHash, cap}`. Anyone can check the one-to-one relation.
- Risk: the cost of farming is “register or buy an X account + supply BEM”, plus the referral rebate. Farmers will take a meaningful share of caps and rebates (§11).

---

## 4. Token economics and pricing math (80% to LP)

### 4.1 Symbols

- `S`: tapecat total supply (suggested 1,000,000,000, 18 decimals)
- `T_P`: **fixed** amount for participants (independent of R; suggested 600M)
- `R`: BEM actually received when the raise ends (**no hard cap**)
- `c = R / T_P`: participant cost (BEM/tapecat), moves with R
- `p = 2c = 2R / T_P`: opening price (BEM/tapecat)
- `B_target = 0.40R`: BEM planned to be swapped to BNB
- `B_sold ≤ B_target`: amount actually sold inside the 1h window (subject to the circuit breaker)
- `B_unsold = B_target − B_sold`: what did not sell. **Hard rule: it joins the tapecat/BEM pool**
- `W`: WBNB actually received. `r_exec = W / B_sold` (realized swap price)

### 4.2 BEM split

| Use | Share | Where |
|---|---|---|
| tapecat/BEM pool | **40%·R** + `B_unsold` | V2 pool, LP → dEaD |
| tapecat/WBNB pool | **40%·R** planned to be swapped to BNB (actual `B_sold` becomes `W`) | V2 pool, LP → dEaD |
| Project fund | **10%·R** | `fundWallet` (BSC Gnosis Safe, set at deploy). See §5.6 |
| Referral rebate | **10%·R** | personal referrer, otherwise `officialReferrer` (the multisig can replace it). See §5.3 |

**The fund and the rebates are paid only after `launch` succeeds.** If `R < MIN_RAISE` or the safety valve fires, all BEM is refunded the way it came in.

### 4.3 Pools and pricing (`p = 2c` holds exactly)

| Pool | BEM / WBNB | tapecat |
|---|---|---|
| tapecat/BEM | `0.40R + B_unsold` | `T_BEM = (0.40R + B_unsold) / p` |
| tapecat/WBNB | `W` | `T_BNB = W / (p · r_exec) = B_sold / p` |

**Identity (however much is sold):**

\[
T_\text{BEM}+T_\text{BNB}=\frac{0.40R+B_\text{unsold}+B_\text{sold}}{p}=\frac{0.80R}{p}=\frac{0.80R\cdot T_P}{2R}=0.40\,T_P
\]

- Fully sold: `T_BEM = T_BNB = 0.20·T_P`.
- Nothing sold: `T_BEM = 0.40·T_P`, `T_BNB = 0` (BEM-only pool; disclose this fallback in the copy ahead of time).
- The BNB pool is priced at **`r_exec`**: both pools equal `p` when measured in BEM. A spot drop in BEM from sell pressure does not warp tapecat’s anchor (at the open there can be an arb between tapecat/WBNB and tapecat/BEM equal to the gap between `r_exec` and the BEM spot price; see risks).

### 4.4 Supply split (`S = 1 billion`, frozen in v0.7)

| Use | Share | Amount | Notes |
|---|---|---|---|
| Participants `T_P` | 60% | 600,000,000 | split by `contribution_i / R`. **100% claimable** after launch |
| LP total | 24% | 240,000,000 | = `0.40·T_P`, split between the two pools per §4.3 |
| **Burn** | **16%** | **160,000,000** | `1,000M − 600M − 240M = 160M`. All of it goes to `0x…dEaD` at launch |

- The keeper bounty was removed (keepers pay gas only), so the remainder is exactly 160M.
- If someone donates BEM/WBNB into a pair before launch, the contract adds a little extra tapecat against the pair balance to hold the price. That comes out of the 160M, so the actual burn is slightly under 160M (visible in the on-chain event).
- Circulating at the open ≈ 840M (600M participants + 240M in the pools). Opening FDV ≈ `p × 840M = 2.8·R` BEM.

### 4.5 Swap impact via USDT / aggregator (default path)

**Default path**: KyberSwap full-market aggregation (1inch as the backup aggregator). In practice this is mostly **BEM→USDT→WBNB** (Pancake V3 BEM/USDT 1% / 0.01% + USDT/WBNB 0.01%, and it may split into Uni V4 / Infinity / PropAMM).
**Last resort**: only when both allowlisted aggregators fail (revert / no route) is a direct Pancake V3 BEM/WBNB 1% swap allowed. Direct is also bound by `minOut`, and shallow depth easily leaves a large `B_unsold`.

**Data**: KyberSwap curve from the offline slippage notes (2026-10-18 ≈12:35 UTC+8, spot ≈0.04503 BNB/BEM), linearly interpolated at **200 / 600 / 1,200 / 2,000 / 4,000** (= 0.40R). Comparison: same-day QuoterV2 single path BEM→USDT(1%)→WBNB.

**Table A: sell all of 0.40R on the default path (no external bids, no circuit breaker)**

| R | Sell 0.40R | Kyber WBNB out | **Average fill slippage** | **Marginal / end drop (est.)** | Single-path USDT average slippage (comparison) |
|---:|---:|---:|---:|---:|---:|
| 500 | 200 | ≈8.89 | **−1.3%** | ≈−1.6% | ≈−0.7% |
| 1,500 | 600 | ≈26.4 | **−2.3%** | ≈−3.7% | ≈−2.1% |
| 3,000 | 1,200 | ≈51.8 | **−4.1%** | ≈−6.2% | ≈−4.5% |
| 5,000 | 2,000 | ≈84.1 | **−6.6%** | ≈−11% | ≈−9.1% |
| 10,000 | 4,000 | ≈153.7 | **−14.7%** | ≈−24% | ≈−22.6% |

> Compared with the v0.5 direct path (same 0.40R): direct was already −7.2% / −14.7% at R = 1,500, and R ≥ 5,000 **drained the pool**. Through USDT, small and mid R can finish the swap at about an order of magnitude less impact.

**Table B: 1h × 12 batches + a rolling Quoter `minOut` of 2% per batch (decided), adaptive size**

| R | Plan | Typical result |
|---:|---:|---|
| ≤5,000 | ≤2,000 BEM | **Usually sells out** (cumulative average price in table A) |
| 10,000 | 4,000 BEM | sells about **~2,300**, and about **~1,700** joins the BEM pool (external bids can sell more) |

**No cumulative floor D** (decided): each batch checks 2% against the quote at execution time, so a large R has no cap on the cumulative BEM price drop (a full sell at R = 10,000 is about −24%; the 2% gate in practice stops near 2,300 BEM).

**Circuit breaker and unsold**: 2% fixed per batch. A failure or a remainder → all of `B_unsold` joins the BEM pool. `r_exec` anchors the BNB pool. `p = 2c` does not change. Batching does not reduce total impact when there are no bids.

**Aggregator trust**: Kyber and 1inch routers are an immutable allowlist. `minOut` is computed inside the contract with QuoterV2. Approve the batch amount and clear it to zero. Do not allow an arbitrary `calldata` target. Direct V3 is the last resort only.

### 4.6 Worked example (R = 1,500 BEM, default aggregator, fully sold)

| Item | Calculation | Result |
|---|---|---|
| Cost c / opening price p | 1500/600M; 2c | 2.5×10⁻⁶ / **5×10⁻⁶ BEM** |
| Fund / rebate | 0.10×1500 each | **150 BEM each** |
| Planned / actual swap | 0.40×1500 | **600 BEM sold out** |
| WBNB received | Kyber interpolation | **≈26.4 WBNB** (r_exec≈0.0440) |
| tapecat/BEM pool | 600 BEM; 600/p | **600 BEM + 120M tapecat** |
| tapecat/WBNB pool | 26.4 WBNB; 600/p | **26.4 WBNB + 120M tapecat** |
| LP total | 120M+120M | **240M = 0.40·T_P** |
| Burn | 1,000M−600M−240M | **160M → 0x…dEaD** |
| Opening FDV | p×840M | ≈4,200 BEM (≈$136K at $32.4) |

### 4.7 Sell pressure (no vesting + 1% tax)

- Book value is 2R, but the two pools hold only **0.80R** of assets. If every participant sells after the open, constant-product math returns about **0.57R**, and the 1% sell tax leaves about **0.56R** — an average loss of about 44%.
- **No vesting** means that sell pressure can start in the first block after launch. Early sellers benefit. Later sellers absorb it.
- Copy must describe “opening price = 2× cost” as a **pricing rule** and must publish the math above. Do not imply a return.

---

## 5. Raise, referrals, 1h swap, launch, tax, and fund

### 5.1 Raise parameters (v0.7, floor updated in v0.11)

| Parameter | Design |
|---|---|
| Asset | BEM (8 decimals), accounted by balance delta |
| Per-address cap | signed `cap` ∈ {1, 1.5} BEM; contract constant `MAX_CAP = 1.5e8` |
| Hard cap / soft cap | **neither** |
| Technical floor | **`MIN_RAISE = 300 BEM` (decided, a constant)** (≈$9,750 if you scale the old 10 BEM ≈ $325 unit price): keeps both V2 pools’ initial liquidity far above `MINIMUM_LIQUIDITY`, keeps the swap from being dust, and avoids precision problems in divisions such as `T_P/R`. Per-address cap is 1.5 BEM, so at least 200 full-cap participants. `R < MIN_RAISE` (including 0) ⇒ no swap, no launch, everyone `refund()`s the full amount |
| End | fixed `endTime`. Anyone may call `finalizeEnd()` |
| Safety valve | if still not launched at `endTime + 1h + 7d` ⇒ refund is available (if some BEM was already swapped, refund pro rata in BEM + WBNB balances; production must implement this) |
| Minimum size | for example 0.1 BEM |

### 5.2 One-hour window, keeper, and the swap

**Keeper (decided)**

1. **Gelato** (primary): Automate / Web3 Functions calls `swapBatch` and `launch` on a schedule (BSC support and pricing follow Gelato’s docs at the time). The Web3 Function fetches Kyber/1inch calldata off-chain and submits it.
2. **Self-hosted bot** (backup): the same logic on a project server, takes over if Gelato fails, uses an MEV-protected RPC.
3. **Anyone may call (adjusted in v0.9)**: `launch` and the **direct-route** `swapBatch` are permissionless, and the site has a one-click button. **Aggregator routes (Kyber / 1inch) are allowlisted keepers only** (`isKeeper`; the Safe adds and removes them with `setKeeper(addr, bool)`). Every call is bound by the on-chain `minOut` (2%) and the TWAP deviation check (defined in contract design §7.5). A leaked keeper key loses at most about 4–5% per batch. The Safe can revoke immediately.

**Timeline**

| Time | Action |
|---|---|
| `t < endTime` | `contribute` |
| `t = endTime` | raise ends. If `R ≥ MIN_RAISE`, book `B_target = 0.40R` |
| `endTime … endTime+1h` | one batch every ≥5 minutes, at most 12, `swapBatch` |
| `t ≥ endTime+1h` | `launch()`: create pools, LP → dEaD, pay the fund, burn 160M, enable trading, open 100% claims and rebate claims |

**`swapBatch` rules (frozen in v0.7)**

- **Route order**: (1) **KyberSwap** (MetaAggregationRouter, primary) → (2) **1inch** (Aggregation Router, backup aggregator) → (3) **direct** Pancake V3 BEM/WBNB 1% (last resort).
  - Note: during the analysis the OpenOcean public quote failed. 1inch needs an API key and was not measured live. **1inch is the backup.** Before deploy, measure the BSC BEM quote with an API key. OpenOcean is an alternative.
- **Slippage**: a fixed **2%** per batch (constant). `minOut = QuoterV2 quote of the reference path (the higher of BEM→USDT(1%)→WBNB and direct) × 98%`, computed inside the contract. **Do not trust** a minimum embedded in calldata. After the fill, check the WBNB balance delta.
- **No cumulative floor D** (decided).
- **Adaptive size**: the keeper picks `amount ≤ remaining`. On failure, shrink and retry, or drop to the next route.
- **Unsold BEM** all enters the tapecat/BEM pool at launch. The BNB pool is priced at `r_exec`. `p = 2c` does not change.
- With no external bids, batching does not reduce total impact (§4.5).

### 5.3 Referral rebate (10% BEM)

**Interface**: `contribute(uint256 amount, address referrer, bytes32 xIdHash, uint256 cap, uint256 deadline, bytes sig)` (single signer; one-to-one X binding)

**Accounting**

- Each valid contribution `x`: the protocol reserves `0.1x` as the “rebate budget”.
- Resolve the effective referrer `ref` (table below). **Always** `claimableRebate[ref] += 0.1x`.
- **No referrer / invalid referral ⇒ `ref = officialReferrer`** (official-referrer rule, confirmed). There is therefore **no** “orphan goes to LP / burn” branch in the accounts. All of `0.10R` is assigned to some referrer address (personal or official).

**How the effective referrer is resolved**

| Priority | Condition | Result |
|---|---|---|
| 1 | `referrer != 0` and `referrer != msg.sender` and (optional) not a malicious contract | `ref = referrer` |
| 2 | otherwise | `ref = officialReferrer` |
| At claim (personal referrer) | recommended: `contributed[ref] > 0`, otherwise that amount is **reassigned to `officialReferrer`** at settlement | avoids an “empty referrer” collecting for free |
| At claim (official) | **`officialReferrer` does not need to have contributed** | the official address can be a Safe and may not join the raise |

**`officialReferrer` admin (confirmed: replaceable, not frozen at deploy)**

| Item | Design |
|---|---|
| Initial value | written in the constructor (project Safe or an operations address) |
| Replacement | `setOfficialReferrer(address newRef)`, only **`owner`** |
| **Recommended owner** | a **Gnosis Safe multisig on BSC** (for example 3/5). **Do not** use a single-signer EOA |
| Timelock | **none** (decided). The change is immediate. The on-chain event is the record |
| Meaning of a change | **affects only later contributions**. `claimableRebate` already booked to the old `officialReferrer` is **not moved and not zeroed** (the old official can still `claimRebate`) |
| Safety | `newRef != address(0)`. Recommend forbidding `address(this)`. Event `OfficialReferrerUpdated(old, new)` |
| Permission boundary | On the Sale the Safe can change only `signer`, `officialReferrer`, `fundWallet` (before launch), and the keeper allowlist (v0.9). On the token it can change only `taxReceiver`. It **cannot** move raised funds, mint, or change the tax rate / pricing / schedule |

**When it binds**: `referrerOf[user]` is written once at contribution (the personal referrer the user typed, which may be 0). It cannot be changed later. The frontend uses `?ref=0x…`. No parameter means the official referrer.

**When it is paid (recommended: claimable after a successful launch)**

| Option | Upside | Downside |
|---|---|---|
| **A. Claim after launch (recommended)** | Matches `MIN_RAISE` / the safety-valve refund. No clawback of rebates already paid. Simple | Referrers wait 1h+ |
| B. Transfer BEM at contribution time | Better UX | A refund then needs a clawback. Accounting is harder |

After `launch`, personal referrers and `officialReferrer` both call `claimRebate()` to receive BEM.

**Sybil amplification (must be in the risk text)**

- With a personal referrer: a farmer points their addresses at themselves and extracts an extra 10% BEM, which raises the ROI of farming.
- With the official referrer: the 10% goes to `officialReferrer` (multisig-controlled) and **does not go to a personal farm**, which weakens the private rebate incentive for farming without a referrer. The official treasury does accumulate 10% of unreferred flow. Disclose that and govern it with the multisig.
- No anti-sybil threshold (decided). The only constraints are that a personal referrer must have contributed themselves to claim, and each address is capped at 1.5 BEM.

### 5.4 Launch and front-run pool defense

- Before launch, tapecat can leave only from the Sale contract, so an outsider cannot add a pool early.
- **Do not use Router `addLiquidity`**: direct `transfer` + `pair.mint(DEAD)`, so a donation into the pair plus `sync` cannot DoS the launch.
- The BNB pool uses `r_exec` (the realized swap price).
- **No anti-snipe limit** (decided): bots may buy in the first block (risk in §11).
- LP → `0x…dEaD`. The remaining 160M → `0x…dEaD`. The token has no mint.

### 5.5 Trigger incentive

- **Gas only**: Gelato fees and the self-hosted bot’s gas come from the project fund. No tapecat bounty.

### 5.6 Project fund (10% BEM, decided)

| Item | Design |
|---|---|
| Receiver | `fundWallet` = a BSC **Gnosis Safe**, written at deploy |
| When it is paid | `launch()` transfers `0.10R` BEM once, on success. Until then it stays in the Sale (refundable if under `MIN_RAISE` or if the safety valve fires) |
| Replacement | the Safe may call `setFundWallet` **before launch**. Changing it after payment does nothing |
| Lock / timelock | **neither** (decided) |
| Disclosure | publish the Safe address and who the signers are. Publish monthly use (audit, X API, Gelato, marketing, and so on) |

### 5.7 Trading tax (1%, public)

| Item | Design |
|---|---|
| Rate | **constant 1%** (`TAX_BPS = 100`). **Nobody can change it.** State it in the public docs, the site, and the token description |
| What is taxed | only when `from` or `to` is one of the **two LP pairs** registered at launch (buy = pair→user; sell = user→pair). Wallet-to-wallet transfers are not taxed |
| Exempt | the Sale contract (pool creation, distributions), `0x…dEaD`. The tax receiver itself should also be exempt |
| Form | **tapecat sent straight to `taxReceiver`** (simplest: no auto-swap, nothing accumulated in the contract, no callback reentrancy) |
| Receiver | an **EOA**. The Safe may `setTaxReceiver` **at any time** (no timelock; decided) |
| Considered and not used | accumulate tax tokens to a threshold and auto-swap to BNB/BEM. That adds complexity, reentrancy, and sandwich risk, and every auto-sell hits the price |
| Scanners | GoPlus / Token Sniffer / DexScreener and similar will show a **1% buy/sell tax** and may warn that “an owner exists / the tax address can be changed”. **Do not design anything to evade scanner detection.** Those warnings match the public disclosure |
| Compatibility | sells must use a fee-on-transfer function such as `swapExactTokensForTokensSupportingFeeOnTransferTokens`. The PancakeSwap frontend and major aggregators handle this. Users should set slippage above 1% |
| Limit | only the two launch pairs are registered. Pools the community creates later (tapecat/USDT, a V3 pool) are **not taxed**. That is intentional, so the owner cannot “add a tax to any address” |
| Tax sell pressure | the receiving EOA selling tax tokens is ongoing sell pressure. Publish the tax address and what the tax is for |

---

## 6. Decentralization checklist (v0.7)

| Item | Status |
|---|---|
| Token: no mint, tax rate a constant 1%, LP → dEaD, 160M burned | Yes |
| Raise, rebate, refund conditions, swap and launch logic | Yes. Hard-coded on-chain, permissionless calls |
| 1h cadence | Depends on Gelato / the self-hosted bot. Aggregator routes are allowlisted keepers only. The public can use the direct route and `launch` as fallback |
| X task check + allocation signature | Off-chain single signer (option A). Mitigated by open source + IPFS list + the hard cap |
| Parameters the Safe can change | `signer`, `officialReferrer`, `fundWallet` (before launch), `taxReceiver`, keeper allowlist. **No timelock** |
| 10% fund | Held by the multisig, not locked |
| Frontend | Open source and self-hostable. Geo blocking is frontend-only. Anyone can still call the contract |

---

## 7. Security

- Audit + BscScan source verification + Foundry (BSC fork): 8/18 decimals, donation DoS, aggregator callbacks and `minOut`, 1inch / direct fallback, **transfer tax interacting with pairs** (buys, sells, tax-exempt pool creation, `SupportingFeeOnTransfer` path), `MIN_RAISE` refund, pro-rata safety-valve refund.
- `ReentrancyGuard`, `SafeERC20`, EIP-712 domain separation. Signer key in an HSM/KMS.
- Aggregator router addresses are an immutable allowlist. Approve the batch amount and clear it to zero.
- Watch liquidity leaving the main BEM/USDT pools, and BEM / TapeOut’s own risks.

---

## 8. Compliance, region limits, and disclosure copy (not legal advice)

### 8.1 Points

- A presale plus a pricing rule may be treated as a securities offering in some jurisdictions. Mainland China prohibits token fundraising. A referral rebate may be treated as a promotion reward. A 10% fund makes the activity look more like financing. Talk to counsel before launch.
- **Region limits**: the frontend geo-blocks **mainland China, the United States, and OFAC-sanctioned regions** by IP, and requires a terms checkbox (the person states they are not in a restricted region and has read the risk disclosure). The geo block is frontend-only. The contract cannot stop a direct call.
- Do not describe “opening price = 2× cost” as a return or a yield on any channel.
- tapecat is close in name to TapeOut / BEMCAT and similar. Do not let it be mistaken for an official affiliation.

### 8.2 Risk disclosure (English)

The live site keeps its Chinese product copy in `web/components`. This is the English statement of that disclosure.

> **Risk Disclosure**
> tapecat is an experimental token with no promised utility, value, or returns. By participating you acknowledge:
> 1. **Transaction tax**: every buy and sell between tapecat and the official liquidity pairs carries a **1%** tax. The rate is hard-coded and cannot be changed. Tax is paid in tapecat to a published tax-receiver address, which the project multisig may change.
> 2. **Pricing rule, not a return promise**: the opening price is set at 2× the participants' average cost purely as an initial pricing rule. After launch the price is set by the market and may fall far below your cost; you may lose everything.
> 3. **Use of funds**: 80% of the BEM raised goes to liquidity (LP permanently locked), 10% to the project fund multisig, 10% to referral rebates.
> 4. **No vesting, no protections**: all tokens are freely tradable at launch; concentrated selling and bot front-running may occur.
> 5. **Centralized components**: task verification and allocation signing are done by a project server. The project multisig can change the signer, official referrer, fund address (before launch) and tax receiver, but cannot change the tax rate, mint tokens or touch liquidity.
> 6. **Other risks**: smart-contract bugs, BEM price volatility, regulatory changes.
> 7. **Restricted regions**: not offered to persons in mainland China, the United States or sanctioned jurisdictions.
> 8. Nothing here is investment advice. DYOR and only commit funds you can afford to lose entirely.

---

## 9. Implementation roadmap (about 5–7 weeks of calendar work, recorded as originally planned)

| Week | Work |
|---|---|
| W1 | Close the remaining 4 items (§12). Prepare the Safe, tax EOA, signing server (HSM/KMS), Gelato account, 1inch API key |
| W1–W3 | Contracts (including the 1% tax) + verifier + frontend (geo block, terms, disclosure). Gelato Web3 Function + self-hosted bot |
| W3 | Full testnet flow. Re-run quotes on a BSC fork. Stress the aggregator / fallback / tax |
| W3–W5 | Audit, fixes, bounty |
| W5–W6 | Mainnet deploy, BscScan verification, publish addresses and the public docs (including the 1% tax disclosure) |
| W6 | Raise → 1h swap → launch → publish the IPFS list and Merkle root |

---

## 10. Solidity sketch (illustrative, not production code · v0.9)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPancakeV2Factory {
    function getPair(address, address) external view returns (address);
    function createPair(address, address) external returns (address);
}
interface IPancakeV2Pair { function mint(address to) external returns (uint256); }
interface IV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256);
}
interface IQuoterV2 {
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external returns (uint256 amountOut, uint160[] memory, uint32[] memory, uint256);
}

/// ---------------- Token: fixed supply + public 1% LP trading tax ----------------
contract TapeCatToken is ERC20 {
    uint256 public constant TAX_BPS = 100;          // 1%, constant, cannot be changed
    address public immutable sale;
    address public immutable taxAdmin;               // Gnosis Safe: can change only taxReceiver
    address public taxReceiver;                      // EOA
    bool    public tradingEnabled;
    mapping(address => bool) public isPair;          // registered twice at launch, then immutable
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    event TaxReceiverUpdated(address indexed oldR, address indexed newR);

    constructor(address _sale, address _taxAdmin, address _taxReceiver, uint256 supply)
        ERC20("tapecat", "TAPECAT")
    {
        sale = _sale; taxAdmin = _taxAdmin; taxReceiver = _taxReceiver;
        _mint(_sale, supply);                        // the only mint; no mint function
    }

    function enableTrading(address[] calldata pairs) external {
        require(msg.sender == sale && !tradingEnabled, "only sale/once");
        for (uint256 i; i < pairs.length; ++i) isPair[pairs[i]] = true;
        tradingEnabled = true;
    }

    function setTaxReceiver(address r) external {
        require(msg.sender == taxAdmin, "admin");
        require(r != address(0), "zero");
        emit TaxReceiverUpdated(taxReceiver, r);
        taxReceiver = r;
    }

    function _update(address from, address to, uint256 v) internal override {
        if (!tradingEnabled) {
            require(from == address(0) || from == sale || to == sale, "not launched");
            super._update(from, to, v);
            return;
        }
        bool exempt = from == sale || to == sale || from == DEAD || to == DEAD
            || from == taxReceiver || to == taxReceiver;
        if (!exempt && (isPair[from] || isPair[to])) {
            uint256 tax = v * TAX_BPS / 10000;
            super._update(from, taxReceiver, tax);   // paid in tapecat, no auto-swap
            super._update(from, to, v - tax);
        } else {
            super._update(from, to, v);
        }
    }
}

/// ---------------- Sale / Launcher ----------------
contract TapeCatSale is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20  public immutable BEM;                 // 8 decimals
    address public immutable WBNB;
    IPancakeV2Factory public immutable factory;
    IV3SwapRouter public immutable v3Router;      // direct fallback
    IQuoterV2 public immutable quoter;
    address public immutable kyberRouter;         // primary
    address public immutable oneInchRouter;       // backup aggregator
    uint24  public constant FEE_WBNB = 10000;
    uint256 public immutable start;
    uint256 public immutable endTime;
    uint256 public constant MIN_RAISE = 300e8;    // 300 BEM technical floor
    uint256 public constant MAX_CAP = 1.5e8;      // 1.5 BEM / address (constant)
    uint256 public constant S  = 1_000_000_000e18;
    uint256 public constant TP = 600_000_000e18;
    uint256 public constant LP_TOTAL_T = TP * 40 / 100;   // 240M; the other 160M is burned
    uint256 public constant LP_BPS = 4000;
    uint256 public constant FUND_BPS = 1000;
    uint256 public constant REF_BPS = 1000;
    uint256 public constant SLIP_BPS = 200;       // 2% per batch (constant)
    uint256 public constant WINDOW = 1 hours;
    uint256 public constant BATCH_CD = 5 minutes;
    uint256 public constant MAX_BATCHES = 12;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bytes32 constant ALLOC_TYPEHASH =
        keccak256("Allocation(address wallet,bytes32 xIdHash,uint256 cap,uint256 deadline)");

    enum Route { Kyber, OneInch, Direct }

    // ---- parameters the Safe can change (no timelock) ----
    address public immutable owner;               // Gnosis Safe
    address public signer;                        // option A: single signer
    address public officialReferrer;
    address public fundWallet;

    TapeCatToken public token;
    uint256 public totalRaised;
    uint256 public raiseEnd;
    mapping(address => uint256) public contributed;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public claimableRebate;
    mapping(address => bool)    public claimed;
    mapping(bytes32 => address) public walletOfX;   // xIdHash → unique wallet
    mapping(address => bytes32) public xOfWallet;   // wallet → unique xIdHash
    mapping(address => bool)    public isKeeper;    // aggregator-route allowlist (Safe-managed)
    uint256 public swapTarget;
    uint256 public bemSold;
    uint256 public wbnbReceived;
    uint256 public lastBatchAt;
    uint256 public batchesDone;
    bool    public launched;

    event Contributed(address indexed user, address indexed ref, uint256 amount, uint256 rebate);
    event SwapBatch(uint256 bemIn, uint256 wbnbOut, Route route, uint256 batchesDone);
    event Launched(uint256 pX18, address pairBem, address pairBnb, uint256 tBem, uint256 tBnb, uint256 burned);
    event SignerUpdated(address indexed oldS, address indexed newS);
    event OfficialReferrerUpdated(address indexed oldR, address indexed newR);
    event FundWalletUpdated(address indexed oldW, address indexed newW);
    event AllowlistPublished(bytes32 merkleRoot, string ipfsCid);
    event KeeperSet(address indexed keeper, bool allowed);

    modifier onlyOwner() { require(msg.sender == owner, "owner"); _; }

    constructor(/* BEM, WBNB, factory, routers, quoter, start, endTime, owner, signer, officialReferrer, fundWallet, taxReceiver */)
        EIP712("tapecat-sale", "1") {}

    // ---------------- raise ----------------
    function contribute(
        uint256 amount, address referrer, bytes32 xIdHash,
        uint256 cap, uint256 deadline, bytes calldata sig
    ) external nonReentrant {
        require(block.timestamp >= start && block.timestamp < endTime, "closed");
        require(cap <= MAX_CAP && block.timestamp <= deadline && xIdHash != bytes32(0), "bad alloc");
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(ALLOC_TYPEHASH, msg.sender, xIdHash, cap, deadline)));
        require(ECDSA.recover(digest, sig) == signer, "sig");    // single signer

        // one X account ↔ one wallet (two-way, bound on the first contribution)
        address boundWallet = walletOfX[xIdHash];
        bytes32 boundX = xOfWallet[msg.sender];
        if (boundWallet == address(0) && boundX == bytes32(0)) {
            walletOfX[xIdHash] = msg.sender;
            xOfWallet[msg.sender] = xIdHash;
        } else {
            require(boundWallet == msg.sender && boundX == xIdHash, "x bound");
        }

        uint256 before = BEM.balanceOf(address(this));
        BEM.safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = BEM.balanceOf(address(this)) - before;
        require(got > 0 && contributed[msg.sender] + got <= cap, "cap");

        if (referrerOf[msg.sender] == address(0) && referrer != address(0) && referrer != msg.sender) {
            referrerOf[msg.sender] = referrer;
        }
        address personal = referrerOf[msg.sender];
        address ref = personal != address(0) ? personal : officialReferrer;

        contributed[msg.sender] += got;
        totalRaised += got;
        uint256 rebate = got * REF_BPS / 10000;
        claimableRebate[ref] += rebate;
        emit Contributed(msg.sender, ref, got, rebate);
    }

    function finalizeEnd() public {
        if (raiseEnd == 0 && block.timestamp >= endTime) {
            raiseEnd = endTime;
            if (totalRaised >= MIN_RAISE) swapTarget = totalRaised * LP_BPS / 10000;
        }
    }

    // ---------------- 1h batched swap: Kyber → 1inch → direct ----------------
    function swapBatch(uint256 amount, Route route, bytes calldata data) external nonReentrant {
        if (route != Route.Direct) require(isKeeper[msg.sender], "not keeper"); // aggregator allowlist only; direct is anyone
        finalizeEnd();
        require(totalRaised >= MIN_RAISE, "min");
        require(block.timestamp < raiseEnd + WINDOW, "window");
        require(batchesDone == 0 || block.timestamp >= lastBatchAt + BATCH_CD, "cd");
        require(batchesDone < MAX_BATCHES, "done");
        require(amount > 0 && amount <= swapTarget - bemSold, "amt");

        uint256 minOut = _bestQuote(amount) * (10000 - SLIP_BPS) / 10000;  // computed on-chain
        uint256 bemBefore = BEM.balanceOf(address(this));
        uint256 wBefore = IERC20(WBNB).balanceOf(address(this));

        if (route == Route.Direct) {
            BEM.forceApprove(address(v3Router), amount);
            v3Router.exactInputSingle(IV3SwapRouter.ExactInputSingleParams({
                tokenIn: address(BEM), tokenOut: WBNB, fee: FEE_WBNB, recipient: address(this),
                amountIn: amount, amountOutMinimum: minOut, sqrtPriceLimitX96: 0
            }));
            BEM.forceApprove(address(v3Router), 0);
        } else {
            address r = route == Route.Kyber ? kyberRouter : oneInchRouter;  // allowlisted routers only
            BEM.forceApprove(r, amount);
            (bool ok, ) = r.call(data);
            BEM.forceApprove(r, 0);
            require(ok, "agg fail");   // keeper falls back: Kyber → OneInch → Direct
        }

        uint256 spent = bemBefore - BEM.balanceOf(address(this));
        uint256 out = IERC20(WBNB).balanceOf(address(this)) - wBefore;
        require(spent > 0 && out >= minOut * spent / amount, "slippage"); // do not trust a minimum inside calldata

        bemSold += spent;
        wbnbReceived += out;
        lastBatchAt = block.timestamp;
        batchesDone += 1;
        emit SwapBatch(spent, out, route, batchesDone);
    }

    // ---------------- end+1h: pools / pay fund / burn / open ----------------
    function launch() external nonReentrant {
        finalizeEnd();
        require(!launched && totalRaised >= MIN_RAISE, "state");
        require(block.timestamp >= raiseEnd + WINDOW, "not yet");
        launched = true;

        uint256 R = totalRaised;
        uint256 bemForPool = R * LP_BPS / 10000 + (swapTarget - bemSold);

        address pBem = _pairOf(address(BEM));
        uint256 tBem = (BEM.balanceOf(pBem) + bemForPool) * TP / (2 * R);
        BEM.safeTransfer(pBem, bemForPool);
        token.transfer(pBem, tBem);
        IPancakeV2Pair(pBem).mint(DEAD);

        address pBnb; uint256 tBnb;
        if (bemSold > 0) {
            pBnb = _pairOf(WBNB);
            uint256 wInPair = IERC20(WBNB).balanceOf(pBnb) + wbnbReceived;
            tBnb = wInPair * bemSold * TP / (2 * R * wbnbReceived);
            IERC20(WBNB).safeTransfer(pBnb, wbnbReceived);
            token.transfer(pBnb, tBnb);
            IPancakeV2Pair(pBnb).mint(DEAD);
        }

        BEM.safeTransfer(fundWallet, R * FUND_BPS / 10000);      // 10% fund, not locked

        address[] memory pairs = new address[](pBnb == address(0) ? 1 : 2);
        pairs[0] = pBem; if (pBnb != address(0)) pairs[1] = pBnb;
        token.enableTrading(pairs);

        // keep only the 600M for participants; burn the rest (about 160M)
        uint256 burnAmt = token.balanceOf(address(this)) - TP;
        token.transfer(DEAD, burnAmt);

        emit Launched(2 * R * 1e18 / TP, pBem, pBnb, tBem, tBnb, burnAmt);
        // BEM left in the contract is the 10% rebate, waiting on claimRebate
    }

    /// no vesting: 100% claimable in one shot after launch
    function claim() external nonReentrant {
        require(launched && !claimed[msg.sender], "no");
        claimed[msg.sender] = true;
        token.transfer(msg.sender, TP * contributed[msg.sender] / totalRaised);
    }

    function claimRebate() external nonReentrant {
        require(launched, "not launched");
        if (msg.sender != officialReferrer) require(contributed[msg.sender] > 0, "not participant");
        uint256 a = claimableRebate[msg.sender]; claimableRebate[msg.sender] = 0;
        BEM.safeTransfer(msg.sender, a);
    }

    function refund() external nonReentrant {
        finalizeEnd();
        bool belowMin = raiseEnd != 0 && totalRaised < MIN_RAISE;
        bool stuck = !launched && raiseEnd != 0 && block.timestamp > raiseEnd + WINDOW + 7 days;
        require(belowMin || stuck, "no refund");
        uint256 a = contributed[msg.sender]; contributed[msg.sender] = 0;
        // if stuck and some BEM was already swapped, refund pro rata in (BEM, WBNB) balances — production must implement this fully
        BEM.safeTransfer(msg.sender, a);
    }

    // ---------------- Safe admin (no timelock) ----------------
    function setSigner(address n) external onlyOwner {
        require(n != address(0), "zero"); emit SignerUpdated(signer, n); signer = n;
    }
    function setOfficialReferrer(address n) external onlyOwner {
        require(n != address(0) && n != address(this), "bad");
        emit OfficialReferrerUpdated(officialReferrer, n); officialReferrer = n;
    }
    function setFundWallet(address n) external onlyOwner {
        require(!launched && n != address(0), "bad");
        emit FundWalletUpdated(fundWallet, n); fundWallet = n;
    }
    function setKeeper(address k, bool allowed) external onlyOwner {
        require(k != address(0), "zero"); isKeeper[k] = allowed; emit KeeperSet(k, allowed);
    }
    function publishAllowlist(bytes32 root, string calldata cid) external onlyOwner {
        emit AllowlistPublished(root, cid);                      // record only; does not move funds
    }

    function _bestQuote(uint256 bemAmt) internal returns (uint256) {
        /* QuoterV2: take the higher of BEM→USDT(1%)→WBNB and BEM→WBNB(1%); try/catch */
    }
    function _pairOf(address q) internal returns (address p) {
        p = factory.getPair(address(token), q);
        if (p == address(0)) p = factory.createPair(address(token), q);
    }
}
```

**Sketch notes (v0.7)**

1. **Tax**: charged only on the two launch pairs. Sale, dEaD, and `taxReceiver` are exempt. Sale→pair at pool creation is exempt, so `pair.mint` receives the full tapecat amount. Fork-test buys / sells (`SupportingFeeOnTransferTokens`) and aggregator compatibility.
2. **The rate is a constant.** The token has no function to change the rate, add a taxed address, or blacklist. `taxAdmin` can change only `taxReceiver`.
3. **Single signer**: `setSigner` rotates the key immediately. `MAX_CAP` caps the impact of a leak. `walletOfX` / `xOfWallet` enforce one X account per wallet on-chain (rotating the key does not change existing bindings).
4. **Aggregator**: call only immutable allowlisted addresses. Check the balance delta plus the on-chain `minOut`.
5. The pro-rata refund after a partial swap, 8/18 decimals, and Quoter try/catch must be finished and audited before production.

---

## 11. Risks (v0.7)

1. **Sell pressure (no vesting)**: book value is 2×, LP holds only 0.80R. If everyone sells they get about 0.56R back (including the 1% tax). Selling can start in the first block after launch.
2. **Bot sniping (no anti-snipe)**: at the open, bots may buy first and sell into later buyers.
3. **Sybil (no threshold)**: farms of extra accounts can take many allocations and refer each other or themselves for the 10% rebate, which squeezes real users’ share.
4. **Single signer**: a leaked key can forge allocations (limited by 1.5 BEM per address and by the attacker supplying their own BEM). Needs an HSM/KMS and a plan to rotate the key immediately.
5. **Tax and governance**: scanners will show a 1% tax and an owner (who can change the tax address, the signer, and similar). The tax EOA selling is ongoing sell pressure. The Safe has no timelock, so parameter changes are not delayed.
6. **Swap impact**: on the default aggregator path, average price is about 1–4% for R ≤ 3,000 and about −15% at R = 10,000. Liquidity leaving the main USDT pools, and MEV, make the result worse.
7. **Aggregator trust surface**: an allowlisted router is upgraded or attacked. Mitigated by on-chain `minOut`, a limited approve, and the fallback route. Aggregator routes are callable only by allowlisted keepers. A leaked keeper key loses about ≤4–5% per batch. Safe `setKeeper(addr, false)` revokes immediately.
8. **Compliance**: presale + rebate + fund + trading tax. The frontend block can be bypassed (call the contract directly).
9. X checks are off-chain. If the allowlisted keeper is down, the fallback is a public direct-route call plus `launch`, and the 7-day safety valve.
10. BEM / TapeOut supply and protocol-upgrade risk.

---

## 12. Still open (v0.9: four items)

1. **Deploy addresses**: Safe (owner / taxAdmin) and who the signers are, tax EOA, signing-server address, initial `officialReferrer`, fund Safe, **initial keeper allowlist** (Gelato executor + self-hosted bot).
2. **Backup aggregator**: 1inch (needs a live API-key quote) or OpenOcean.
3. **Raise start and end** (`start` / `endTime`, labeled UTC+8).
4. **Public docs and disclosure copy** (1% tax, pricing rule is not a promise of returns, region limits).

---

### Sources

- **BEM sell-impact check**: offline slippage notes (QuoterV2 + KyberSwap, 2026-10-18). Not published in this repository.
- **v0.5 direct-path recompute** (now the fallback reference): offline scripts, not in this repository.
- **v0.6 default path**: Kyber curve from those notes, interpolated at 0.40R, compared with the via-USDT single path.
- GeckoTerminal / DexScreener BEM pools. PancakeSwap QuoterV2 `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997`.
- CoinGecko / KCEX announcements (BEM contract address).
- tapeout.net, tapeout.link on-chain checks, PANews TapeOut article.
- X API pricing summary: https://opentweet.io/x-api-pricing (the console is the source of truth).
- RPC used for this note: BEM decimals = 8, V2 BEM/WBNB pool nearly empty.
