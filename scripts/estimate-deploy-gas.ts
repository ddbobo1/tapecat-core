/** One-off: gas for deploying TapeCatSale (includes TapeCatToken) on the in-process network. */
import { ethers } from "hardhat";

async function main() {
  const [a, b, c, d, e, f] = await ethers.getSigners();
  const ERC = await ethers.getContractFactory("MockERC20");
  const bem = await ERC.deploy("BEM", "BEM", 8);
  const v3 = await (await ethers.getContractFactory("MockV3Factory")).deploy();
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const cfg = {
    bem: await bem.getAddress(),
    wbnb: b.address,
    usdt: ethers.ZeroAddress,
    v2Factory: c.address,
    v3Factory: await v3.getAddress(),
    v3Router: d.address,
    quoter: e.address,
    kyberRouter: ethers.ZeroAddress,
    oneInchRouter: ethers.ZeroAddress,
    feeBemUsdt: 10000,
    feeUsdtWbnb: 100,
    feeBemWbnb: 10000,
    start: now + 60,
    endTime: now + 3600,
    owner: a.address,
    signer: b.address,
    officialReferrer: c.address,
    fundWallet: d.address,
    taxReceiver: f.address,
    saleSalt: ethers.id("estimate"),
    initialKeepers: [a.address],
  };
  const sale = await (await ethers.getContractFactory("TapeCatSale")).deploy(cfg);
  const receipt = await sale.deploymentTransaction()!.wait();
  console.log("gasUsed", receipt!.gasUsed.toString());
}

main();
