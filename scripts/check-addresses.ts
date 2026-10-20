/**
 * Read-only sanity check of every external BSC address the deployment depends on.
 * Usage: npx tsx scripts/check-addresses.ts   (BSC_RPC_URL optional)
 */
import "dotenv/config";
import { createPublicClient, http, formatUnits, type Address } from "viem";
import { bsc } from "viem/chains";
import { BSC } from "../shared/bsc";
import { erc20Abi, v3FactoryAbi, v3PoolAbi } from "../shared/abi";

const client = createPublicClient({ chain: bsc, transport: http(process.env.BSC_RPC_URL) });

async function main() {
  const contracts: [string, Address][] = [
    ["BEM", BSC.BEM],
    ["WBNB", BSC.WBNB],
    ["USDT", BSC.USDT],
    ["PANCAKE_V2_FACTORY", BSC.PANCAKE_V2_FACTORY],
    ["PANCAKE_V3_FACTORY", BSC.PANCAKE_V3_FACTORY],
    ["PANCAKE_SMART_ROUTER", BSC.PANCAKE_SMART_ROUTER],
    ["PANCAKE_QUOTER_V2", BSC.PANCAKE_QUOTER_V2],
    ["KYBER_META_ROUTER", BSC.KYBER_META_ROUTER],
    ["ONEINCH_ROUTER_V6", BSC.ONEINCH_ROUTER_V6],
  ];
  for (const [name, addr] of contracts) {
    const code = await client.getCode({ address: addr });
    console.log(`${name.padEnd(22)} ${addr} code=${code ? (code.length - 2) / 2 : 0} bytes`);
  }
  console.log("BEM decimals:", await client.readContract({ address: BSC.BEM, abi: erc20Abi, functionName: "decimals" }));

  const pools: [string, Address, Address, number][] = [
    ["BEM/USDT", BSC.BEM, BSC.USDT, BSC.FEE_BEM_USDT],
    ["USDT/WBNB", BSC.USDT, BSC.WBNB, BSC.FEE_USDT_WBNB],
    ["BEM/WBNB", BSC.BEM, BSC.WBNB, BSC.FEE_BEM_WBNB],
  ];
  for (const [name, a, b, fee] of pools) {
    const pool = await client.readContract({
      address: BSC.PANCAKE_V3_FACTORY,
      abi: v3FactoryAbi,
      functionName: "getPool",
      args: [a, b, fee],
    });
    if (pool === "0x0000000000000000000000000000000000000000") {
      console.log(`${name} fee ${fee}: NO POOL`);
      continue;
    }
    const s0 = await client.readContract({ address: pool, abi: v3PoolAbi, functionName: "slot0" });
    const balA = await client.readContract({ address: a, abi: erc20Abi, functionName: "balanceOf", args: [pool] });
    const decA = await client.readContract({ address: a, abi: erc20Abi, functionName: "decimals" });
    console.log(
      `${name} fee ${fee}: ${pool} tick=${s0[1]} obsCardinality=${s0[3]} next=${s0[4]} ${name.split("/")[0]} balance=${formatUnits(balA, decA)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
