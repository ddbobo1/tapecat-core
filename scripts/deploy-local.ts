/**
 * Local dev stack on `npx hardhat node`: mock BEM/WBNB/USDT, real Uniswap V2 factory bytecode,
 * mock V3 quoter/pools/aggregator, and a Sale whose raise starts in 60s and lasts RAISE_SECONDS.
 * Signer = hardhat account #2. Usage: npx hardhat run scripts/deploy-local.ts --network localhost
 */
import { ethers } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";

async function main() {
  const s = await ethers.getSigners();
  const [deployer, safe, signer, official, fund, tax] = s;
  const ERC = await ethers.getContractFactory("MockERC20");
  const bem = await ERC.deploy("BEM", "BEM", 8);
  const wbnb = await ERC.deploy("Wrapped BNB", "WBNB", 18);
  const usdt = await ERC.deploy("Tether", "USDT", 18);
  const v2 = await new ethers.ContractFactory(UniswapV2Factory.abi, UniswapV2Factory.bytecode, deployer).deploy(deployer.address);
  const v3f = await (await ethers.getContractFactory("MockV3Factory")).deploy();
  const Pool = await ethers.getContractFactory("MockV3Pool");
  const pBU = await Pool.deploy();
  const pUW = await Pool.deploy();
  await v3f.setPool(bem, usdt, 10000, pBU);
  await v3f.setPool(usdt, wbnb, 100, pUW);
  const quoter = await (await ethers.getContractFactory("MockQuoter")).deploy();
  await quoter.setRate(
    ethers.solidityPacked(["address", "uint24", "address", "uint24", "address"], [await bem.getAddress(), 10000, await usdt.getAddress(), 100, await wbnb.getAddress()]),
    45n * 10n ** 25n,
  );
  const agg = await (await ethers.getContractFactory("MockAggregator")).deploy();
  const router = await (await ethers.getContractFactory("MockV3Router")).deploy();
  await router.setRate(45n * 10n ** 25n);
  await wbnb.mint(router, ethers.parseEther("10000"));

  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const start = now + 60;
  const endTime = start + Number(process.env.RAISE_SECONDS || 3600);
  const cfg = {
    bem: await bem.getAddress(),
    wbnb: await wbnb.getAddress(),
    usdt: await usdt.getAddress(),
    v2Factory: await v2.getAddress(),
    v3Factory: await v3f.getAddress(),
    v3Router: await router.getAddress(),
    quoter: await quoter.getAddress(),
    kyberRouter: await agg.getAddress(),
    oneInchRouter: ethers.ZeroAddress,
    feeBemUsdt: 10000,
    feeUsdtWbnb: 100,
    feeBemWbnb: 10000,
    start,
    endTime,
    owner: safe.address,
    signer: signer.address,
    officialReferrer: official.address,
    fundWallet: fund.address,
    taxReceiver: tax.address,
    saleSalt: ethers.id(process.env.SALE_SALT || "tapecat-local"),
    initialKeepers: [deployer.address], // local: deployer acts as keeper for aggregator routes
  };
  const sale = await (await ethers.getContractFactory("TapeCatSale")).deploy(cfg);
  for (const u of s.slice(6, 20)) await bem.mint(u, ethers.parseUnits("100", 8));

  const out = { sale: await sale.getAddress(), token: await sale.token(), bem: cfg.bem, start, endTime };
  mkdirSync(join(__dirname, "..", "deployments"), { recursive: true });
  writeFileSync(join(__dirname, "..", "deployments", "localhost.local.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
