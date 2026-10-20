/**
 * Deploys TapeCatSale (which deploys TapeCatToken in its constructor).
 * All parameters come from .env (see .env.example). Writes deployments/<network>.json.
 */
import { ethers, network } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BSC } from "../shared/bsc";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function unix(name: string): number {
  const raw = env(name);
  const t = /^\d+$/.test(raw) ? Number(raw) : Math.floor(new Date(raw).getTime() / 1000);
  if (!Number.isFinite(t) || t <= 0) throw new Error(`${name} is not a unix time or ISO date: ${raw}`);
  return t;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const start = unix("SALE_START");
  const endTime = unix("SALE_END");
  if (endTime <= start) throw new Error("SALE_END must be after SALE_START");

  const saleSaltText = env("SALE_SALT");
  const cfg = {
    bem: env("BEM_ADDRESS", BSC.BEM),
    wbnb: env("WBNB_ADDRESS", BSC.WBNB),
    usdt: env("USDT_ADDRESS", BSC.USDT),
    v2Factory: env("V2_FACTORY", BSC.PANCAKE_V2_FACTORY),
    v3Factory: env("V3_FACTORY", BSC.PANCAKE_V3_FACTORY),
    v3Router: env("V3_ROUTER", BSC.PANCAKE_SMART_ROUTER),
    quoter: env("QUOTER_V2", BSC.PANCAKE_QUOTER_V2),
    kyberRouter: env("KYBER_ROUTER", BSC.KYBER_META_ROUTER),
    oneInchRouter: env("ONEINCH_ROUTER", BSC.ONEINCH_ROUTER_V6),
    feeBemUsdt: Number(env("FEE_BEM_USDT", String(BSC.FEE_BEM_USDT))),
    feeUsdtWbnb: Number(env("FEE_USDT_WBNB", String(BSC.FEE_USDT_WBNB))),
    feeBemWbnb: Number(env("FEE_BEM_WBNB", String(BSC.FEE_BEM_WBNB))),
    start,
    endTime,
    owner: env("SAFE_ADDRESS"),
    signer: env("SIGNER_ADDRESS"),
    officialReferrer: env("OFFICIAL_REFERRER"),
    fundWallet: env("FUND_WALLET"),
    taxReceiver: env("TAX_RECEIVER"),
    saleSalt: ethers.id(saleSaltText),
    initialKeepers: (process.env.INITIAL_KEEPERS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  };

  console.log(`network=${network.name} deployer=${deployer.address}`);
  console.log(`raise ${new Date(start * 1000).toISOString()} -> ${new Date(endTime * 1000).toISOString()}`);
  console.table(cfg);

  const Sale = await ethers.getContractFactory("TapeCatSale");
  const sale = await Sale.deploy(cfg);
  const receipt = await sale.deploymentTransaction()!.wait();
  const saleAddr = await sale.getAddress();
  const tokenAddr = await sale.token();

  console.log(`TapeCatSale  ${saleAddr}`);
  console.log(`TapeCatToken ${tokenAddr}`);
  console.log(
    "reference pools:",
    await sale.poolBemUsdt(),
    await sale.poolUsdtWbnb(),
    await sale.poolBemWbnb(),
  );

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    sale: saleAddr,
    token: tokenAddr,
    deployBlock: receipt!.blockNumber,
    saleSaltText,
    config: { ...cfg, saleSalt: cfg.saleSalt },
  };
  mkdirSync(join(__dirname, "..", "deployments"), { recursive: true });
  const file = join(__dirname, "..", "deployments", `${network.name}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`saved ${file}`);
  console.log(
    `verify: npx hardhat verify --network ${network.name} ${saleAddr} --constructor-args scripts/verify-args.js`,
  );
  console.log(
    `token verify: npx hardhat verify --network ${network.name} ${tokenAddr} ${saleAddr} ${cfg.owner} ${cfg.taxReceiver} 1000000000000000000000000000`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
