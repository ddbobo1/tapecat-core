import type { Address, Hex, PublicClient } from "viem";
import { saleAbi, Route } from "./abi";

export interface BuiltRoute {
  route: Route;
  data: Hex;
  router: Address | null;
  expectedOut?: bigint;
}

const KYBER = "https://aggregator-api.kyberswap.com/bsc/api/v1";

/**
 * KyberSwap: GET /routes then POST /route/build with sender = recipient = Sale.
 * Simulation is skipped because the Sale only approves inside swapBatch.
 */
export async function buildKyber(p: {
  sale: Address;
  bem: Address;
  wbnb: Address;
  amountIn: bigint;
  expectedRouter: Address;
  clientId: string;
  slippageBps?: number;
}): Promise<BuiltRoute> {
  const headers = { "x-client-id": p.clientId, "content-type": "application/json" };
  const q = new URLSearchParams({ tokenIn: p.bem, tokenOut: p.wbnb, amountIn: p.amountIn.toString() });
  const r1 = await fetch(`${KYBER}/routes?${q}`, { headers });
  if (!r1.ok) throw new Error(`kyber routes ${r1.status}: ${await r1.text()}`);
  const j1 = (await r1.json()) as { data?: { routeSummary: unknown; routerAddress: string } };
  if (!j1.data?.routeSummary) throw new Error("kyber: no route");

  const r2 = await fetch(`${KYBER}/route/build`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      routeSummary: j1.data.routeSummary,
      sender: p.sale,
      recipient: p.sale,
      slippageTolerance: p.slippageBps ?? 200,
      deadline: Math.floor(Date.now() / 1000) + 600,
      skipSimulateTx: true,
      source: p.clientId,
    }),
  });
  if (!r2.ok) throw new Error(`kyber build ${r2.status}: ${await r2.text()}`);
  const j2 = (await r2.json()) as { data?: { data: Hex; routerAddress: Address; amountOut: string } };
  if (!j2.data?.data) throw new Error("kyber: empty build");
  if (j2.data.routerAddress.toLowerCase() !== p.expectedRouter.toLowerCase()) {
    throw new Error(`kyber: unexpected router ${j2.data.routerAddress}`);
  }
  return { route: Route.Kyber, data: j2.data.data, router: j2.data.routerAddress, expectedOut: BigInt(j2.data.amountOut) };
}

/** 1inch Swap API v6 (needs an API key). disableEstimate because the Sale has no standing allowance. */
export async function buildOneInch(p: {
  sale: Address;
  origin: Address;
  bem: Address;
  wbnb: Address;
  amountIn: bigint;
  expectedRouter: Address;
  apiKey: string;
  slippagePct?: number;
}): Promise<BuiltRoute> {
  const q = new URLSearchParams({
    src: p.bem,
    dst: p.wbnb,
    amount: p.amountIn.toString(),
    from: p.sale,
    origin: p.origin,
    receiver: p.sale,
    slippage: String(p.slippagePct ?? 2),
    disableEstimate: "true",
    allowPartialFill: "false",
  });
  const res = await fetch(`https://api.1inch.dev/swap/v6.0/56/swap?${q}`, {
    headers: { authorization: `Bearer ${p.apiKey}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`1inch ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { dstAmount: string; tx: { to: Address; data: Hex } };
  if (j.tx.to.toLowerCase() !== p.expectedRouter.toLowerCase()) throw new Error(`1inch: unexpected router ${j.tx.to}`);
  return { route: Route.OneInch, data: j.tx.data, router: j.tx.to, expectedOut: BigInt(j.dstAmount) };
}

export const directRoute = (): BuiltRoute => ({ route: Route.Direct, data: "0x", router: null });

export interface SaleSnapshot {
  phase: number;
  endTime: bigint;
  raiseEnd: bigint;
  batchesDone: bigint;
  lastBatchAt: bigint;
  remaining: bigint;
  launched: boolean;
}

export async function readSale(client: PublicClient, sale: Address): Promise<SaleSnapshot> {
  const c = { address: sale, abi: saleAbi } as const;
  const [phase, endTime, raiseEnd, batchesDone, lastBatchAt, remaining, launched] = await Promise.all([
    client.readContract({ ...c, functionName: "phase" }),
    client.readContract({ ...c, functionName: "endTime" }),
    client.readContract({ ...c, functionName: "raiseEnd" }),
    client.readContract({ ...c, functionName: "batchesDone" }),
    client.readContract({ ...c, functionName: "lastBatchAt" }),
    client.readContract({ ...c, functionName: "remainingToSwap" }),
    client.readContract({ ...c, functionName: "launched" }),
  ]);
  return { phase, endTime, raiseEnd, batchesDone, lastBatchAt, remaining, launched };
}

const WINDOW = 3600n;
const COOLDOWN = 300n;
const MAX_BATCHES = 12n;

/**
 * Adaptive batch size: spread what is left evenly over the batches that still fit in the window.
 * Returns 0 when no batch can run now.
 */
export function nextBatchAmount(s: SaleSnapshot, now: bigint): bigint {
  const end = (s.raiseEnd === 0n ? s.endTime : s.raiseEnd) + WINDOW;
  if (s.remaining === 0n || now >= end || s.batchesDone >= MAX_BATCHES) return 0n;
  if (s.batchesDone > 0n && now < s.lastBatchAt + COOLDOWN) return 0n;
  const fitByTime = (end - 1n - now) / COOLDOWN + 1n;
  const left = MAX_BATCHES - s.batchesDone < fitByTime ? MAX_BATCHES - s.batchesDone : fitByTime;
  return (s.remaining + left - 1n) / left;
}
