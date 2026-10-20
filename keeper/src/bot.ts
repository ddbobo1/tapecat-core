/**
 * Backup keeper (Gelato is primary). Every POLL_MS:
 *  - SwapWindow: adaptive batch, routes Kyber -> 1inch -> Direct, each simulated first; on failure halve size.
 *  - Launchable: launch().
 * Reads go through BSC_RPC_URL; transactions go through PRIVATE_RPC_URL (MEV-protected) when set.
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet, hardhat, type Chain } from "viem/chains";
import { saleAbi, Phase, Route } from "../../shared/abi";
import { buildKyber, buildOneInch, directRoute, nextBatchAmount, readSale, type BuiltRoute } from "../../shared/routes";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

const chainId = Number(env("CHAIN_ID", "56"));
const chain: Chain = ({ 56: bsc, 97: bscTestnet, 31337: hardhat } as Record<number, Chain>)[chainId] ?? bsc;
const sale = env("SALE_ADDRESS") as Address;
const account = privateKeyToAccount(env("KEEPER_PRIVATE_KEY") as Hex);
const reader = createPublicClient({ chain, transport: http(env("BSC_RPC_URL", "https://bsc-dataseed.bnbchain.org")) });
const sender = createWalletClient({
  account,
  chain,
  transport: http(process.env.PRIVATE_RPC_URL || env("BSC_RPC_URL", "https://bsc-dataseed.bnbchain.org")),
});
const POLL_MS = Number(env("KEEPER_POLL_MS", "15000"));
const MIN_BATCH = BigInt(env("KEEPER_MIN_BATCH_BEM_RAW", "1000000")); // 0.01 BEM
const kyberClientId = env("KYBER_CLIENT_ID", "tapecat");
const oneInchKey = process.env.ONEINCH_API_KEY || "";

let addrs: { bem: Address; wbnb: Address; kyber: Address; oneInch: Address } | undefined;

async function loadAddrs() {
  const c = { address: sale, abi: saleAbi } as const;
  const [bem, wbnb, kyber, oneInch] = await Promise.all([
    reader.readContract({ ...c, functionName: "BEM" }),
    reader.readContract({ ...c, functionName: "WBNB" }),
    reader.readContract({ ...c, functionName: "kyberRouter" }),
    reader.readContract({ ...c, functionName: "oneInchRouter" }),
  ]);
  addrs = { bem, wbnb, kyber, oneInch };
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function candidates(amount: bigint): Promise<BuiltRoute[]> {
  const a = addrs!;
  const out: BuiltRoute[] = [];
  try {
    out.push(await buildKyber({ sale, bem: a.bem, wbnb: a.wbnb, amountIn: amount, expectedRouter: a.kyber, clientId: kyberClientId }));
  } catch (e) {
    log("kyber build failed:", (e as Error).message);
  }
  if (oneInchKey && a.oneInch !== "0x0000000000000000000000000000000000000000") {
    try {
      out.push(
        await buildOneInch({
          sale,
          origin: account.address,
          bem: a.bem,
          wbnb: a.wbnb,
          amountIn: amount,
          expectedRouter: a.oneInch,
          apiKey: oneInchKey,
        }),
      );
    } catch (e) {
      log("1inch build failed:", (e as Error).message);
    }
  }
  out.push(directRoute());
  return out;
}

async function trySwap(amount: bigint): Promise<boolean> {
  for (const r of await candidates(amount)) {
    try {
      const { request } = await reader.simulateContract({
        account,
        address: sale,
        abi: saleAbi,
        functionName: "swapBatch",
        args: [amount, r.route, r.data],
      });
      const hash = await sender.writeContract(request);
      const rc = await reader.waitForTransactionReceipt({ hash });
      log(`swapBatch ${formatUnits(amount, 8)} BEM via ${Route[r.route]} -> ${rc.status} ${hash}`);
      if (rc.status === "success") return true;
    } catch (e) {
      log(`swapBatch via ${Route[r.route]} rejected:`, (e as Error).message.split("\n")[0]);
    }
  }
  return false;
}

async function tick() {
  const s = await readSale(reader, sale);
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (s.phase === Phase.SwapWindow) {
    let amount = nextBatchAmount(s, now);
    while (amount >= MIN_BATCH) {
      if (await trySwap(amount)) return;
      amount /= 2n;
    }
    return;
  }

  if (s.phase === Phase.Launchable && !s.launched) {
    try {
      const { request } = await reader.simulateContract({ account, address: sale, abi: saleAbi, functionName: "launch" });
      const hash = await sender.writeContract(request);
      const rc = await reader.waitForTransactionReceipt({ hash });
      log(`launch -> ${rc.status} ${hash}`);
    } catch (e) {
      log("launch rejected:", (e as Error).message.split("\n")[0]);
    }
  }
}

async function main() {
  await loadAddrs();
  log(`keeper ${account.address} watching ${sale} on chain ${chainId}`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      log("tick error:", (e as Error).message);
    }
    const s = await readSale(reader, sale).catch(() => undefined);
    if (s && (s.phase === Phase.Launched || s.phase === Phase.RefundBelowMin || s.phase === Phase.RefundStuck)) {
      log(`phase ${Phase[s.phase]}: nothing left to do`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
