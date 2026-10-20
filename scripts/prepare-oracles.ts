/**
 * Makes sure every reference V3 pool keeps enough observations for the Sale's 5-minute TWAP guard.
 * BSC produces sub-second blocks, so a busy pool can write one observation per block; we target
 * OBS_CARDINALITY (default 600) slots. Anyone can call increaseObservationCardinalityNext.
 */
import { ethers } from "hardhat";
import { BSC } from "../shared/bsc";

const target = Number(process.env.OBS_CARDINALITY || 600);

async function main() {
  const factory = await ethers.getContractAt(
    ["function getPool(address,address,uint24) view returns (address)"],
    BSC.PANCAKE_V3_FACTORY,
  );
  const pools: [string, string, string, number][] = [
    ["BEM/USDT", BSC.BEM, BSC.USDT, BSC.FEE_BEM_USDT],
    ["USDT/WBNB", BSC.USDT, BSC.WBNB, BSC.FEE_USDT_WBNB],
    ["BEM/WBNB", BSC.BEM, BSC.WBNB, BSC.FEE_BEM_WBNB],
  ];
  for (const [name, a, b, fee] of pools) {
    const addr: string = await factory.getPool(a, b, fee);
    if (addr === ethers.ZeroAddress) {
      console.log(`${name}: no pool, path disabled`);
      continue;
    }
    const pool = await ethers.getContractAt(
      [
        "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint32,bool)",
        "function increaseObservationCardinalityNext(uint16)",
      ],
      addr,
    );
    const s0 = await pool.slot0();
    const next = Number(s0[4]);
    if (next >= target) {
      console.log(`${name}: cardinalityNext=${next} >= ${target}, ok`);
      continue;
    }
    console.log(`${name}: cardinalityNext=${next} -> ${target}`);
    const tx = await pool.increaseObservationCardinalityNext(target);
    await tx.wait();
    console.log(`  tx ${tx.hash}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
