/**
 * Gelato Web3 Function (primary keeper). Schedule every 1 minute from end-5min to end+1h+10min.
 * Same logic as keeper/src/bot.ts: adaptive batch, Kyber first, Direct fallback; each candidate is
 * simulated with eth_call and the size is halved on failure. Then launch().
 */
import { Web3Function, type Web3FunctionContext } from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "@ethersproject/contracts";

const ABI = [
  "function BEM() view returns (address)",
  "function WBNB() view returns (address)",
  "function kyberRouter() view returns (address)",
  "function phase() view returns (uint8)",
  "function endTime() view returns (uint256)",
  "function raiseEnd() view returns (uint256)",
  "function batchesDone() view returns (uint256)",
  "function lastBatchAt() view returns (uint256)",
  "function remainingToSwap() view returns (uint256)",
  "function swapBatch(uint256 amount, uint8 route, bytes data)",
  "function launch()",
];
const KYBER = "https://aggregator-api.kyberswap.com/bsc/api/v1";
const MIN_BATCH = 1_000_000n;

async function kyberData(clientId: string, sale: string, bem: string, wbnb: string, router: string, amount: bigint) {
  const headers = { "x-client-id": clientId, "content-type": "application/json" };
  const r1 = await fetch(`${KYBER}/routes?tokenIn=${bem}&tokenOut=${wbnb}&amountIn=${amount}`, { headers });
  const j1 = await r1.json();
  if (!j1?.data?.routeSummary) return null;
  const r2 = await fetch(`${KYBER}/route/build`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      routeSummary: j1.data.routeSummary,
      sender: sale,
      recipient: sale,
      slippageTolerance: 200,
      deadline: Math.floor(Date.now() / 1000) + 600,
      skipSimulateTx: true,
      source: clientId,
    }),
  });
  const j2 = await r2.json();
  if (!j2?.data?.data || String(j2.data.routerAddress).toLowerCase() !== router.toLowerCase()) return null;
  return j2.data.data as string;
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;
  const provider = multiChainProvider.default();
  const saleAddr = userArgs.sale as string;
  const clientId = (userArgs.kyberClientId as string) || "tapecat";
  // Dedicated Gelato msg.sender for this task — must be isKeeper on Sale. Pass via userArgs.
  const keeperArg = (userArgs.keeperAddress as string) || "";
  const keeperFrom = /^0x0{40}$/i.test(keeperArg) ? undefined : keeperArg || undefined;
  const sale = new Contract(saleAddr, ABI, provider);

  const phase = Number(await sale.phase());
  if (phase === 3) {
    return { canExec: true, callData: [{ to: saleAddr, data: sale.interface.encodeFunctionData("launch") }] };
  }
  if (phase !== 2) return { canExec: false, message: `phase ${phase}` };

  const [endTime, raiseEnd, done, last, remaining] = (
    await Promise.all([sale.endTime(), sale.raiseEnd(), sale.batchesDone(), sale.lastBatchAt(), sale.remainingToSwap()])
  ).map((x: { toString(): string }) => BigInt(x.toString()));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const end = (raiseEnd === 0n ? endTime : raiseEnd) + 3600n;
  if (remaining === 0n || now >= end || done >= 12n) return { canExec: false, message: "nothing to swap" };
  if (done > 0n && now < last + 300n) return { canExec: false, message: "cooldown" };
  const fit = (end - 1n - now) / 300n + 1n;
  const left = 12n - done < fit ? 12n - done : fit;
  let amount = (remaining + left - 1n) / left;

  const [bem, wbnb, router] = await Promise.all([sale.BEM(), sale.WBNB(), sale.kyberRouter()]);
  while (amount >= MIN_BATCH) {
    const tries: [number, string | null][] = [
      [0, await kyberData(clientId, saleAddr, bem, wbnb, router, amount).catch(() => null)],
      [2, "0x"],
    ];
    for (const [route, data] of tries) {
      if (!data) continue;
      const callData = sale.interface.encodeFunctionData("swapBatch", [amount, route, data]);
      try {
        // Simulate as the whitelisted keeper so NotKeeper does not false-negative.
        await provider.call({ to: saleAddr, data: callData, ...(keeperFrom ? { from: keeperFrom } : {}) });
        return { canExec: true, callData: [{ to: saleAddr, data: callData }] };
      } catch {
        /* try next route */
      }
    }
    amount /= 2n;
  }
  return { canExec: false, message: "no route passes the 2% guard" };
});
