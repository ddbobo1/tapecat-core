/**
 * Read-only pre-deploy check against BSC mainnet (no fork needed):
 *  - QuoterV2 quotes for both reference paths the Sale uses (BEM->USDT->WBNB, BEM->WBNB)
 *  - spot vs 5-minute TWAP tick deviation of each reference pool (the Sale's manipulation guard)
 *  - KyberSwap route + build for the same size, with the Sale's own 2% minOut for comparison
 * Usage: npx tsx scripts/live-check.ts [bemAmount=3]
 */
import "dotenv/config";
import { createPublicClient, encodePacked, formatEther, http, parseAbi, parseUnits, type Address } from "viem";
import { bsc } from "viem/chains";
import { BSC } from "../shared/bsc";
import { v3FactoryAbi } from "../shared/abi";
import { buildKyber } from "../shared/routes";

const client = createPublicClient({ chain: bsc, transport: http(process.env.BSC_RPC_URL) });
const quoterAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint32, bool)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
]);

async function quote(path: `0x${string}`, amount: bigint) {
  const { result } = await client.simulateContract({
    address: BSC.PANCAKE_QUOTER_V2,
    abi: quoterAbi,
    functionName: "quoteExactInput",
    args: [path, amount],
  });
  return result[0];
}

async function twapDev(a: Address, b: Address, fee: number) {
  const pool = await client.readContract({ address: BSC.PANCAKE_V3_FACTORY, abi: v3FactoryAbi, functionName: "getPool", args: [a, b, fee] });
  const s0 = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
  const [cum] = await client.readContract({ address: pool, abi: poolAbi, functionName: "observe", args: [[300, 0]] });
  const avg = Number((cum[1] - cum[0]) / 300n);
  return { pool, spot: s0[1], twap: avg, dev: Math.abs(s0[1] - avg) };
}

async function main() {
  const amount = parseUnits(process.argv[2] || "3", 8);
  const pUsdt = encodePacked(["address", "uint24", "address", "uint24", "address"], [BSC.BEM, BSC.FEE_BEM_USDT, BSC.USDT, BSC.FEE_USDT_WBNB, BSC.WBNB]);
  const pDirect = encodePacked(["address", "uint24", "address"], [BSC.BEM, BSC.FEE_BEM_WBNB, BSC.WBNB]);

  const [qUsdt, qDirect] = await Promise.all([quote(pUsdt, amount), quote(pDirect, amount)]);
  const best = qUsdt > qDirect ? qUsdt : qDirect;
  const minOut = (best * 9800n) / 10000n;
  console.log(`amount            ${Number(amount) / 1e8} BEM`);
  console.log(`QuoterV2 via USDT ${formatEther(qUsdt)} WBNB`);
  console.log(`QuoterV2 direct   ${formatEther(qDirect)} WBNB`);
  console.log(`Sale minOut (98%) ${formatEther(minOut)} WBNB`);

  for (const [name, a, b, fee] of [
    ["BEM/USDT", BSC.BEM, BSC.USDT, BSC.FEE_BEM_USDT],
    ["USDT/WBNB", BSC.USDT, BSC.WBNB, BSC.FEE_USDT_WBNB],
    ["BEM/WBNB", BSC.BEM, BSC.WBNB, BSC.FEE_BEM_WBNB],
  ] as const) {
    try {
      const d = await twapDev(a, b, fee);
      console.log(`${name.padEnd(10)} spot=${d.spot} twap5m=${d.twap} dev=${d.dev} ticks ${d.dev <= 200 ? "OK" : "REJECTED"}`);
    } catch (e) {
      console.log(`${name.padEnd(10)} observe failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  try {
    const k = await buildKyber({
      sale: "0x000000000000000000000000000000000000bEEF",
      bem: BSC.BEM,
      wbnb: BSC.WBNB,
      amountIn: amount,
      expectedRouter: BSC.KYBER_META_ROUTER,
      clientId: "tapecat-live-check",
    });
    const out = k.expectedOut ?? 0n;
    console.log(`Kyber amountOut   ${formatEther(out)} WBNB (${out >= minOut ? "passes" : "FAILS"} the 2% guard), calldata ${(k.data.length - 2) / 2} bytes`);
  } catch (e) {
    console.log(`Kyber: ${(e as Error).message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
