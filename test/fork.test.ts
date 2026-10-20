/**
 * BSC mainnet fork: real PancakeSwap QuoterV2 / V3 TWAP oracles / SmartRouter / V2 factory and live
 * KyberSwap calldata. Runs only with FORK_URL set (archive RPC; pin FORK_BLOCK to a recent block), e.g.
 *   $env:FORK_URL="https://bsc-mainnet.public.blastapi.io"; $env:FORK_BLOCK="<head-20>"; npx hardhat test test/fork.test.ts
 */
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BSC } from "../shared/bsc";
import { buildKyber } from "../shared/routes";
import type { TapeCatSale } from "../typechain-types";

const BEM = (x: number | string) => ethers.parseUnits(String(x), 8);
const DEAD = "0x000000000000000000000000000000000000dEaD";
const BEM_WHALE = "0x3098D7A051045000d68eC0360753A40C8cABEa31"; // Pancake V3 BEM/USDT 1% pool

(process.env.FORK_URL ? describe : describe.skip)("BSC fork – full lifecycle", function () {
  this.timeout(600_000);

  it("raise -> quote -> Kyber/Direct swap -> launch -> claim -> taxed sell", async () => {
    const signers = await ethers.getSigners();
    const [deployer, safe, signerW, official, fund, taxEoa, ...users] = signers;
    const bem = await ethers.getContractAt("MockERC20", BSC.BEM);
    const wbnb = await ethers.getContractAt("MockERC20", BSC.WBNB);

    await network.provider.request({ method: "hardhat_impersonateAccount", params: [BEM_WHALE] });
    await network.provider.send("hardhat_setBalance", [BEM_WHALE, "0x56BC75E2D63100000"]);
    const whale = await ethers.getSigner(BEM_WHALE);
    for (let i = 0; i < 200; i++) await bem.connect(whale).transfer(users[i], BEM(2));

    const now = await time.latest();
    const cfg = {
      bem: BSC.BEM,
      wbnb: BSC.WBNB,
      usdt: BSC.USDT,
      v2Factory: BSC.PANCAKE_V2_FACTORY,
      v3Factory: BSC.PANCAKE_V3_FACTORY,
      v3Router: BSC.PANCAKE_SMART_ROUTER,
      quoter: BSC.PANCAKE_QUOTER_V2,
      kyberRouter: BSC.KYBER_META_ROUTER,
      oneInchRouter: BSC.ONEINCH_ROUTER_V6,
      feeBemUsdt: BSC.FEE_BEM_USDT,
      feeUsdtWbnb: BSC.FEE_USDT_WBNB,
      feeBemWbnb: BSC.FEE_BEM_WBNB,
      start: now + 100,
      endTime: now + 100 + 3 * 24 * 3600,
      owner: safe.address,
      signer: signerW.address,
      officialReferrer: official.address,
      fundWallet: fund.address,
      taxReceiver: taxEoa.address,
      saleSalt: ethers.id("fork"),
      initialKeepers: [deployer.address],
    };
    const sale = (await (await ethers.getContractFactory("TapeCatSale")).deploy(cfg)) as unknown as TapeCatSale;
    const saleAddr = await sale.getAddress();
    console.log("    pools:", await sale.poolBemUsdt(), await sale.poolUsdtWbnb(), await sale.poolBemWbnb());

    const { chainId } = await ethers.provider.getNetwork();
    const domain = { name: "tapecat-sale", version: "1", chainId, verifyingContract: saleAddr };
    const types = {
      Allocation: [
        { name: "wallet", type: "address" },
        { name: "xIdHash", type: "bytes32" },
        { name: "cap", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    await time.increaseTo(cfg.start);
    for (let i = 0; i < 200; i++) {
      const u = users[i];
      const xIdHash = ethers.solidityPackedKeccak256(["bytes32", "string"], [cfg.saleSalt, `x${i}`]);
      const msg = { wallet: u.address, xIdHash, cap: BEM(1.5), deadline: cfg.endTime };
      const sig = await signerW.signTypedData(domain, types, msg);
      await bem.connect(u).approve(saleAddr, BEM(1.5));
      await sale.connect(u).contribute(BEM(1.5), ethers.ZeroAddress, xIdHash, msg.cap, msg.deadline, sig);
    }
    await time.increaseTo(cfg.endTime);

    const minOut = await sale.quoteMinOut.staticCall(BEM(10));
    console.log(`    quoteMinOut(10 BEM) = ${ethers.formatEther(minOut)} WBNB`);
    expect(minOut).to.be.gt(0n);

    // batch 1: live Kyber calldata
    let kyberOk = false;
    try {
      const r = await buildKyber({
        sale: saleAddr as `0x${string}`,
        bem: BSC.BEM,
        wbnb: BSC.WBNB,
        amountIn: BEM(10),
        expectedRouter: BSC.KYBER_META_ROUTER,
        clientId: "tapecat-fork-test",
      });
      await sale.swapBatch(BEM(10), r.route, r.data);
      kyberOk = true;
      console.log(`    Kyber batch ok: wbnb=${ethers.formatEther(await sale.wbnbReceived())}`);
    } catch (e) {
      console.log(`    Kyber batch skipped: ${(e as Error).message.split("\n")[0]}`);
    }

    // batch 2: direct Pancake V3 BEM/WBNB 1% fallback (may legitimately fail the 2% guard)
    await time.increase(300);
    try {
      await sale.swapBatch(BEM(kyberOk ? 10 : 20), 2, "0x");
      console.log(`    Direct batch ok: bemSold=${ethers.formatUnits(await sale.bemSold(), 8)}`);
    } catch (e) {
      console.log(`    Direct batch rejected by guard: ${(e as Error).message.split("\n")[0]}`);
    }

    await time.increaseTo(cfg.endTime + 3600);
    await sale.launch();
    const token = await ethers.getContractAt("TapeCatToken", await sale.token());
    const factory = await ethers.getContractAt(["function getPair(address,address) view returns (address)"], BSC.PANCAKE_V2_FACTORY);
    const pBem: string = await factory.getPair(token, BSC.BEM);
    const pBnb: string = await factory.getPair(token, BSC.WBNB);
    const tBem = await token.balanceOf(pBem);
    const tBnb = pBnb === ethers.ZeroAddress ? 0n : await token.balanceOf(pBnb);
    console.log(`    BEM pool: ${ethers.formatUnits(await bem.balanceOf(pBem), 8)} BEM / ${ethers.formatEther(tBem)} tapecat`);
    if (tBnb > 0n) console.log(`    BNB pool: ${ethers.formatEther(await wbnb.balanceOf(pBnb))} WBNB / ${ethers.formatEther(tBnb)} tapecat`);
    expect(tBem + tBnb).to.equal(ethers.parseEther("240000000"));
    expect(await token.balanceOf(DEAD)).to.equal(ethers.parseEther("160000000"));
    expect(await bem.balanceOf(fund)).to.equal(BEM(30));

    await sale.connect(users[0]).claim();
    const bal = await token.balanceOf(users[0]);
    expect(bal).to.equal(ethers.parseEther("3000000"));

    // sell through the real PancakeSwap V2 router (fee-on-transfer variant)
    const router = await ethers.getContractAt(
      ["function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)"],
      "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    );
    const sell = ethers.parseEther("1000000");
    await token.connect(users[0]).approve(router, sell);
    const b0 = await bem.balanceOf(users[0]);
    await router
      .connect(users[0])
      .getFunction("swapExactTokensForTokensSupportingFeeOnTransferTokens")(sell, 0, [await token.getAddress(), BSC.BEM], users[0].address, cfg.endTime + 99999);
    expect(await token.balanceOf(taxEoa)).to.equal(sell / 100n);
    console.log(`    sold 1M tapecat -> ${ethers.formatUnits((await bem.balanceOf(users[0])) - b0, 8)} BEM, tax 10,000 tapecat`);
    void deployer;
  });
});
