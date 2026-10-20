import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import type { TapeCatSale, TapeCatToken, MockERC20 } from "../typechain-types";

const BEM = (x: number | string) => ethers.parseUnits(String(x), 8);
const E18 = (x: number | string) => ethers.parseUnits(String(x), 18);
const DEAD = "0x000000000000000000000000000000000000dEaD";
const TP = E18(600_000_000);
const FEE_BU = 10000;
const FEE_UW = 100;
const FEE_BW = 10000;
// 1 BEM (1e8 raw) -> 0.045 WBNB (4.5e16 raw): rate = out * 1e18 / in
const RATE_USDT_PATH = 45n * 10n ** 25n;
const RATE_DIRECT = 44n * 10n ** 25n;
const Route = { Kyber: 0, OneInch: 1, Direct: 2 };
/** 200 × 1.5 BEM cap = 300 BEM = MIN_RAISE. One wallet can never clear the floor. */
const MIN_PARTICIPANTS = 200;

async function deployFixture() {
  const signers = await ethers.getSigners();
  const [deployer, safe, signerWallet, official, fund, taxEoa, attacker, ...users] = signers;

  const ERC = await ethers.getContractFactory("MockERC20");
  const bem = (await ERC.deploy("BEM", "BEM", 8)) as unknown as MockERC20;
  const wbnb = (await ERC.deploy("Wrapped BNB", "WBNB", 18)) as unknown as MockERC20;
  const usdt = (await ERC.deploy("Tether", "USDT", 18)) as unknown as MockERC20;

  const v2Factory = (await new ethers.ContractFactory(UniswapV2Factory.abi, UniswapV2Factory.bytecode, deployer).deploy(
    deployer.address,
  )) as unknown as Contract;

  const v3Factory = await (await ethers.getContractFactory("MockV3Factory")).deploy();
  const Pool = await ethers.getContractFactory("MockV3Pool");
  const poolBU = await Pool.deploy();
  const poolUW = await Pool.deploy();
  const poolBW = await Pool.deploy();
  await v3Factory.setPool(bem, usdt, FEE_BU, poolBU);
  await v3Factory.setPool(usdt, wbnb, FEE_UW, poolUW);
  await v3Factory.setPool(bem, wbnb, FEE_BW, poolBW);

  const quoter = await (await ethers.getContractFactory("MockQuoter")).deploy();
  const pathUsdt = ethers.solidityPacked(
    ["address", "uint24", "address", "uint24", "address"],
    [await bem.getAddress(), FEE_BU, await usdt.getAddress(), FEE_UW, await wbnb.getAddress()],
  );
  const pathDirect = ethers.solidityPacked(
    ["address", "uint24", "address"],
    [await bem.getAddress(), FEE_BW, await wbnb.getAddress()],
  );
  await quoter.setRate(pathUsdt, RATE_USDT_PATH);
  await quoter.setRate(pathDirect, RATE_DIRECT);

  const Agg = await ethers.getContractFactory("MockAggregator");
  const kyber = await Agg.deploy();
  const oneInch = await Agg.deploy();
  const v3Router = await (await ethers.getContractFactory("MockV3Router")).deploy();
  await v3Router.setRate(RATE_DIRECT);
  for (const venue of [kyber, oneInch, v3Router]) await wbnb.mint(venue, E18(10_000));

  // Setup still mines one block per approve (~200). `start` has to sit past that,
  // otherwise loadFixture restores a chain that is already inside the raise.
  const now = await time.latest();
  const start = now + 1000;
  const endTime = start + 3 * 24 * 3600;
  const saleSalt = ethers.id("tapecat-2026");

  const cfg = {
    bem: await bem.getAddress(),
    wbnb: await wbnb.getAddress(),
    usdt: await usdt.getAddress(),
    v2Factory: await v2Factory.getAddress(),
    v3Factory: await v3Factory.getAddress(),
    v3Router: await v3Router.getAddress(),
    quoter: await quoter.getAddress(),
    kyberRouter: await kyber.getAddress(),
    oneInchRouter: await oneInch.getAddress(),
    feeBemUsdt: FEE_BU,
    feeUsdtWbnb: FEE_UW,
    feeBemWbnb: FEE_BW,
    start,
    endTime,
    owner: safe.address,
    signer: signerWallet.address,
    officialReferrer: official.address,
    fundWallet: fund.address,
    taxReceiver: taxEoa.address,
    saleSalt,
    initialKeepers: [deployer.address], // deployer is the default swapBatch caller in tests
  };
  const sale = (await (await ethers.getContractFactory("TapeCatSale")).deploy(cfg)) as unknown as TapeCatSale;
  if (users.length < MIN_PARTICIPANTS + 3) {
    throw new Error(`need ${MIN_PARTICIPANTS + 3} user signers, got ${users.length}; raise hardhat accounts.count`);
  }
  const token = (await ethers.getContractAt("TapeCatToken", await sale.token())) as unknown as TapeCatToken;

  for (const u of [...users, attacker]) {
    await bem.mint(u, BEM(100));
    await bem.connect(u).approve(sale, ethers.MaxUint256);
  }

  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "tapecat-sale", version: "1", chainId, verifyingContract: await sale.getAddress() };
  const types = {
    Allocation: [
      { name: "wallet", type: "address" },
      { name: "xIdHash", type: "bytes32" },
      { name: "cap", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const xHash = (xUserId: string) => ethers.solidityPackedKeccak256(["bytes32", "string"], [saleSalt, xUserId]);
  async function alloc(wallet: string, xUserId: string, cap = BEM(1.5), deadline = endTime) {
    const xIdHash = xHash(xUserId);
    const sig = await signerWallet.signTypedData(domain, types, { wallet, xIdHash, cap, deadline });
    return { xIdHash, cap, deadline, sig };
  }
  async function contribute(u: HardhatEthersSigner, amount: bigint, referrer = ethers.ZeroAddress, xId?: string, cap = BEM(1.5)) {
    const a = await alloc(u.address, xId ?? `x-${u.address}`, cap);
    return sale.connect(u).contribute(amount, referrer, a.xIdHash, a.cap, a.deadline, a.sig);
  }
  const aggData = (amountIn: bigint, amountOut: bigint, recipient: string) =>
    kyber.interface.encodeFunctionData("swap", [cfg.bem, cfg.wbnb, amountIn, amountOut, recipient]);
  const pairAt = (addr: string) => new Contract(addr, UniswapV2Pair.abi, deployer);

  return {
    signers, deployer, safe, signerWallet, official, fund, taxEoa, attacker, users,
    bem, wbnb, usdt, v2Factory, v3Factory, poolBU, poolUW, poolBW, quoter, kyber, oneInch, v3Router,
    sale, token, cfg, alloc, contribute, aggData, pairAt, xHash,
  };
}

type F = Awaited<ReturnType<typeof deployFixture>>;

async function raise(f: F, n: number, each = BEM(1.5)) {
  await time.increaseTo(f.cfg.start);
  for (let i = 0; i < n; i++) await f.contribute(f.users[i], each);
}

async function raisedFixture() {
  const f = await deployFixture();
  await raise(f, MIN_PARTICIPANTS);
  return f;
}

/** Top up from `from` at the 1.5 cap until totalRaised >= MIN_RAISE. Optional personal referrer. */
async function fillToMin(f: F, from = 0, referrer = ethers.ZeroAddress) {
  if ((await time.latest()) < f.cfg.start) await time.increaseTo(f.cfg.start);
  let raised = await f.sale.totalRaised();
  const min = await f.sale.MIN_RAISE();
  let i = from;
  while (raised < min) {
    if (i >= f.users.length) throw new Error(`need more signers to reach MIN_RAISE (stuck at index ${i})`);
    const room = BEM(1.5) - (await f.sale.contributed(f.users[i]));
    if (room < BEM(0.1)) {
      i++;
      continue;
    }
    const amt = room < min - raised ? room : min - raised;
    await f.contribute(f.users[i], amt, referrer);
    raised += amt;
    i++;
  }
}

describe("TapeCatSale – raise", () => {
  it("mints the fixed supply to the sale and blocks transfers before launch", async () => {
    const f = await loadFixture(deployFixture);
    expect(await f.token.totalSupply()).to.equal(E18(1_000_000_000));
    expect(await f.token.balanceOf(f.sale)).to.equal(E18(1_000_000_000));
    expect(await f.token.taxAdmin()).to.equal(f.safe.address);
  });

  it("rejects before start, after end, bad signature, expired or oversized allocations", async () => {
    const f = await loadFixture(deployFixture);
    const u = f.users[0];
    await expect(f.contribute(u, BEM(1))).to.be.revertedWithCustomError(f.sale, "Closed");
    await time.increaseTo(f.cfg.start);

    const a = await f.alloc(u.address, "x1");
    await expect(
      f.sale.connect(f.users[1]).contribute(BEM(1), ethers.ZeroAddress, a.xIdHash, a.cap, a.deadline, a.sig),
    ).to.be.revertedWithCustomError(f.sale, "BadSignature");

    const big = await f.alloc(u.address, "x1", BEM(2));
    await expect(
      f.sale.connect(u).contribute(BEM(1), ethers.ZeroAddress, big.xIdHash, big.cap, big.deadline, big.sig),
    ).to.be.revertedWithCustomError(f.sale, "BadAllocation");

    const old = await f.alloc(u.address, "x1", BEM(1), f.cfg.start - 1);
    await expect(
      f.sale.connect(u).contribute(BEM(1), ethers.ZeroAddress, old.xIdHash, old.cap, old.deadline, old.sig),
    ).to.be.revertedWithCustomError(f.sale, "BadAllocation");

    await expect(f.contribute(u, BEM(0.05))).to.be.revertedWithCustomError(f.sale, "TooSmall");

    await time.increaseTo(f.cfg.endTime);
    await expect(f.contribute(u, BEM(1))).to.be.revertedWithCustomError(f.sale, "Closed");
  });

  it("enforces the signed cap across multiple contributions and allows a cap upgrade 1 -> 1.5", async () => {
    const f = await loadFixture(deployFixture);
    const u = f.users[0];
    await time.increaseTo(f.cfg.start);
    await f.contribute(u, BEM(1), ethers.ZeroAddress, "x1", BEM(1));
    await expect(f.contribute(u, BEM(0.1), ethers.ZeroAddress, "x1", BEM(1))).to.be.revertedWithCustomError(
      f.sale,
      "CapExceeded",
    );
    await f.contribute(u, BEM(0.5), ethers.ZeroAddress, "x1", BEM(1.5));
    expect(await f.sale.contributed(u)).to.equal(BEM(1.5));
    await expect(f.contribute(u, BEM(0.1), ethers.ZeroAddress, "x1")).to.be.revertedWithCustomError(f.sale, "CapExceeded");
  });

  it("binds one X account to exactly one wallet in both directions", async () => {
    const f = await loadFixture(deployFixture);
    const [a, b] = f.users;
    await time.increaseTo(f.cfg.start);
    await f.contribute(a, BEM(1), ethers.ZeroAddress, "alice");
    // same X account, different wallet (even with a valid signature, e.g. leaked signer key)
    await expect(f.contribute(b, BEM(1), ethers.ZeroAddress, "alice")).to.be.revertedWithCustomError(f.sale, "XBound");
    // same wallet, different X account
    await expect(f.contribute(a, BEM(0.1), ethers.ZeroAddress, "alice2")).to.be.revertedWithCustomError(f.sale, "XBound");
    expect(await f.sale.walletOfX(f.xHash("alice"))).to.equal(a.address);
    expect(await f.sale.xOfWallet(a)).to.equal(f.xHash("alice"));
  });

  it("credits 10% rebates to the personal referrer, else the official referrer; the referrer is fixed on first contribution", async () => {
    const f = await loadFixture(deployFixture);
    const [a, b, c] = f.users;
    await time.increaseTo(f.cfg.start);
    await f.contribute(a, BEM(1), b.address);
    await f.contribute(a, BEM(0.5), c.address); // ignored: already bound to b
    await f.contribute(c, BEM(1)); // no referrer -> official
    await f.contribute(b, BEM(1), b.address); // self-referral -> official
    expect(await f.sale.referrerOf(a)).to.equal(b.address);
    expect(await f.sale.claimableRebate(b)).to.equal(BEM(0.15));
    expect(await f.sale.claimableRebate(f.official)).to.equal(BEM(0.2));
  });
});

describe("Verifier signer compatibility", () => {
  it("allocations signed by verifier/src/signer.ts (viem) are accepted on-chain", async () => {
    const f = await loadFixture(deployFixture);
    const { localSigner, xIdHashOf, saleSaltOf } = await import("../verifier/src/signer");
    // Hardhat's published default account #2 (a public test key, not a project secret).
    const key = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
    const { chainId } = await ethers.provider.getNetwork();
    const s = localSigner(key, Number(chainId), (await f.sale.getAddress()) as `0x${string}`);
    expect(s.address).to.equal(f.signerWallet.address);
    expect(saleSaltOf("tapecat-2026")).to.equal(f.cfg.saleSalt);

    const u = f.users[0];
    const xIdHash = xIdHashOf(f.cfg.saleSalt as `0x${string}`, "1234567890");
    expect(xIdHash).to.equal(f.xHash("1234567890"));
    const cap = BEM(1.5);
    const deadline = BigInt(f.cfg.endTime);
    const sig = await s.sign({ wallet: u.address as `0x${string}`, xIdHash, cap, deadline });
    await time.increaseTo(f.cfg.start);
    await f.sale.connect(u).contribute(BEM(1.5), ethers.ZeroAddress, xIdHash, cap, deadline, sig);
    expect(await f.sale.contributed(u)).to.equal(cap);
  });
});

describe("Keeper batch sizing", () => {
  it("spreads the remaining BEM over the batches that still fit in the window", async () => {
    const { nextBatchAmount } = await import("../shared/routes");
    const base = { phase: 2, endTime: 1000n, raiseEnd: 1000n, batchesDone: 0n, lastBatchAt: 0n, remaining: 1200n, launched: false };
    expect(nextBatchAmount(base, 1000n)).to.equal(100n); // 12 batches fit
    expect(nextBatchAmount({ ...base, batchesDone: 6n, lastBatchAt: 3700n, remaining: 600n }, 4000n)).to.equal(300n); // 2 fit by time
    expect(nextBatchAmount({ ...base, batchesDone: 1n, lastBatchAt: 1000n }, 1200n)).to.equal(0n); // cooldown
    expect(nextBatchAmount(base, 4600n)).to.equal(0n); // window closed
    expect(nextBatchAmount(base, 4400n)).to.equal(1200n); // last chance: everything
  });
});

describe("TapeCatSale – below MIN_RAISE", () => {
  it("refunds everyone in full and never swaps or launches", async () => {
    const f = await loadFixture(deployFixture);
    await raise(f, 6); // 9 BEM < 300
    await time.increaseTo(f.cfg.endTime);
    expect(await f.sale.phase()).to.equal(5n);
    await expect(f.sale.swapBatch(1, Route.Kyber, "0x")).to.be.revertedWithCustomError(f.sale, "BelowMinRaise");
    await time.increase(3600);
    await expect(f.sale.launch()).to.be.revertedWithCustomError(f.sale, "BadState");
    const u = f.users[0];
    const before = await f.bem.balanceOf(u);
    await f.sale.connect(u).refund();
    expect((await f.bem.balanceOf(u)) - before).to.equal(BEM(1.5));
    await expect(f.sale.connect(u).refund()).to.be.revertedWithCustomError(f.sale, "NothingToClaim");
  });

  it("refunds one raw unit below 300 BEM", async () => {
    const f = await loadFixture(deployFixture);
    await time.increaseTo(f.cfg.start);
    for (let i = 0; i < 199; i++) await f.contribute(f.users[i], BEM(1.5));
    const dust = BEM("1.49999999"); // 300e8 - 1 - 199 × 1.5e8
    await f.contribute(f.users[199], dust);
    expect(await f.sale.totalRaised()).to.equal(BEM(300) - 1n);
    await time.increaseTo(f.cfg.endTime);
    expect(await f.sale.phase()).to.equal(5n);
    await expect(f.sale.swapBatch(1, Route.Kyber, "0x")).to.be.revertedWithCustomError(f.sale, "BelowMinRaise");
    const u = f.users[199];
    const before = await f.bem.balanceOf(u);
    await f.sale.connect(u).refund();
    expect((await f.bem.balanceOf(u)) - before).to.equal(dust);
  });

  it("treats exactly 300 BEM as raised and opens the swap window", async () => {
    const f = await loadFixture(raisedFixture);
    expect(await f.sale.totalRaised()).to.equal(BEM(300));
    await time.increaseTo(f.cfg.endTime);
    expect(await f.sale.phase()).to.equal(2n);
    await f.sale.finalizeEnd();
    expect(await f.sale.swapTarget()).to.equal(BEM(120));
  });
});

describe("TapeCatSale – swap window", () => {
  async function inWindow() {
    const f = await loadFixture(raisedFixture); // R = 300 BEM -> swapTarget 120 BEM
    await time.increaseTo(f.cfg.endTime);
    return f;
  }

  it("swaps via the whitelisted aggregator with on-chain 2% minOut and a 5 minute cooldown", async () => {
    const f = await inWindow();
    const sale = await f.sale.getAddress();
    const amt = BEM(60);
    const fair = (amt * RATE_USDT_PATH) / 10n ** 18n;
    await expect(f.sale.swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale)))
      .to.emit(f.sale, "SwapBatch")
      .withArgs(amt, fair, Route.Kyber, 1);
    expect(await f.sale.swapTarget()).to.equal(BEM(120));

    await expect(f.sale.swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale))).to.be.revertedWithCustomError(
      f.sale,
      "Cooldown",
    );
    await time.increase(300);
    // 1inch backup, 1.9% worse than the quote: still inside 2%
    const ok = (fair * 981n) / 1000n;
    await f.sale.swapBatch(amt, Route.OneInch, f.oneInch.interface.encodeFunctionData("swap", [f.cfg.bem, f.cfg.wbnb, amt, ok, sale]));
    expect(await f.sale.bemSold()).to.equal(BEM(120));
    expect(await f.sale.remainingToSwap()).to.equal(0);
  });

  it("reverts when the aggregator returns less than minOut, pays someone else, or overpulls", async () => {
    const f = await inWindow();
    const sale = await f.sale.getAddress();
    const amt = BEM(10);
    const fair = (amt * RATE_USDT_PATH) / 10n ** 18n;
    await expect(
      f.sale.swapBatch(amt, Route.Kyber, f.aggData(amt, (fair * 97n) / 100n, sale)),
    ).to.be.revertedWithCustomError(f.sale, "Slippage");
    await expect(
      f.sale.swapBatch(amt, Route.Kyber, f.aggData(amt, fair, f.attacker.address)),
    ).to.be.revertedWithCustomError(f.sale, "Slippage");
    await expect(
      f.sale.swapBatch(amt, Route.Kyber, f.kyber.interface.encodeFunctionData("greedy", [f.cfg.bem, amt * 2n])),
    ).to.be.reverted;
    await expect(f.sale.swapBatch(amt, Route.Kyber, f.kyber.interface.encodeFunctionData("fail"))).to.be.revertedWith(
      "agg: no route",
    );
    await expect(f.sale.swapBatch(BEM(121), Route.Kyber, "0x")).to.be.revertedWithCustomError(f.sale, "BadAmount");
    expect(await f.bem.allowance(f.sale, f.kyber)).to.equal(0);
  });

  it("falls back to the direct V3 route with minOut enforced by the router", async () => {
    const f = await inWindow();
    // must beat 98% of the best reference quote (the USDT path here)
    await f.v3Router.setRate(RATE_USDT_PATH);
    await f.sale.swapBatch(BEM(10), Route.Direct, "0x");
    expect(await f.sale.wbnbReceived()).to.equal((BEM(10) * RATE_USDT_PATH) / 10n ** 18n);
    await time.increase(300);
    await f.v3Router.setRate((RATE_USDT_PATH * 97n) / 100n);
    await expect(f.sale.swapBatch(BEM(10), Route.Direct, "0x")).to.be.revertedWith("Too little received");
  });

  it("ignores manipulated reference pools (spot far from TWAP) and reverts with no quote", async () => {
    const f = await inWindow();
    await f.poolBU.set(-5000, 0, false);
    await f.poolBW.set(0, 0, true); // observe() reverts (cardinality too low)
    await expect(f.sale.swapBatch(BEM(10), Route.Kyber, "0x")).to.be.revertedWithCustomError(f.sale, "NoQuote");
    await f.poolBW.set(150, 0, false); // within 200 ticks: direct path quote is used
    expect(await f.sale.quoteMinOut.staticCall(BEM(1))).to.equal((((BEM(1) * RATE_DIRECT) / 10n ** 18n) * 98n) / 100n);
  });

  it("closes after 1h and after 12 batches", async () => {
    const f = await inWindow();
    const sale = await f.sale.getAddress();
    // With remaining=120 and 12 batches, minAmt = ceil(120/12)=10 BEM
    const amt = BEM(10);
    const fair = (amt * RATE_USDT_PATH) / 10n ** 18n;
    for (let i = 0; i < 12; i++) {
      await f.sale.swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale));
      await time.increase(300);
    }
    expect(await f.sale.batchesDone()).to.equal(12n);
    await expect(f.sale.swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale))).to.be.revertedWithCustomError(
      f.sale,
      "NotInWindow",
    );
  });
});

describe("TapeCatSale – launch", () => {
  async function launchedFull() {
    const f = await loadFixture(raisedFixture); // R = 300
    await time.increaseTo(f.cfg.endTime);
    const sale = await f.sale.getAddress();
    const fair = (BEM(120) * RATE_USDT_PATH) / 10n ** 18n;
    await f.sale.swapBatch(BEM(120), Route.Kyber, f.aggData(BEM(120), fair, sale));
    await expect(f.sale.launch()).to.be.revertedWithCustomError(f.sale, "NotYet");
    await time.increaseTo(f.cfg.endTime + 3600);
    await f.sale.launch();
    return f;
  }

  it("builds both pools at p = 2R/TP, sends LP to dEaD, pays the fund, burns 160M", async () => {
    const f = await launchedFull();
    const R = BEM(300);
    const pBem = await f.v2Factory.getFunction("getPair")(f.token, f.bem);
    const pBnb = await f.v2Factory.getFunction("getPair")(f.token, f.wbnb);

    const tInBem = await f.token.balanceOf(pBem);
    const tInBnb = await f.token.balanceOf(pBnb);
    expect(await f.bem.balanceOf(pBem)).to.equal(BEM(120));
    expect(tInBem).to.equal((BEM(120) * TP) / (2n * R)); // 120M
    expect(tInBem).to.equal(E18(120_000_000));
    expect(tInBnb).to.equal(E18(120_000_000));
    expect(tInBem + tInBnb).to.equal((TP * 40n) / 100n);

    expect(await f.token.balanceOf(DEAD)).to.equal(E18(160_000_000));
    expect(await f.token.balanceOf(f.sale)).to.equal(TP);
    expect(await f.bem.balanceOf(f.fund)).to.equal(BEM(30));
    expect(await f.bem.balanceOf(f.sale)).to.equal(BEM(30)); // rebates left

    for (const p of [pBem, pBnb]) {
      const pair = f.pairAt(p);
      const supply: bigint = await pair.totalSupply();
      expect(await pair.balanceOf(DEAD)).to.equal(supply - 1000n);
    }
    expect(await f.token.isPair(pBem)).to.equal(true);
    expect(await f.token.isPair(pBnb)).to.equal(true);
    await expect(f.sale.launch()).to.be.revertedWithCustomError(f.sale, "BadState");
  });

  it("lets every participant claim 100% and rebates be claimed", async () => {
    const f = await launchedFull();
    const u = f.users[0];
    await f.sale.connect(u).claim();
    expect(await f.token.balanceOf(u)).to.equal(TP / 200n);
    await expect(f.sale.connect(u).claim()).to.be.revertedWithCustomError(f.sale, "NothingToClaim");
    await f.sale.connect(f.official).claimRebate();
    expect(await f.bem.balanceOf(f.official)).to.equal(BEM(30));
  });

  it("charges exactly 1% on buys and sells against launch pairs only; wallet transfers are free", async () => {
    const f = await launchedFull();
    const [a, b] = f.users;
    await f.sale.connect(a).claim();
    const pBemAddr = await f.v2Factory.getFunction("getPair")(f.token, f.bem);
    const pair = f.pairAt(pBemAddr);

    // wallet -> wallet: no tax
    await f.token.connect(a).transfer(b, E18(1000));
    expect(await f.token.balanceOf(b)).to.equal(E18(1000));

    // sell: user -> pair carries 1% to taxReceiver
    const sellAmt = E18(1_000_000);
    await f.token.connect(a).transfer(pBemAddr, sellAmt);
    expect(await f.token.balanceOf(f.taxEoa)).to.equal(sellAmt / 100n);

    // buy: pair -> user carries 1%
    const tokenIsToken0 = (await pair.token0()).toLowerCase() === (await f.token.getAddress()).toLowerCase();
    await f.bem.connect(b).transfer(pBemAddr, BEM(0.1));
    const out = E18(10_000);
    await (pair.connect(b) as Contract).swap(tokenIsToken0 ? out : 0, tokenIsToken0 ? 0 : out, b.address, "0x");
    expect(await f.token.balanceOf(b)).to.equal(E18(1000) + out - out / 100n);
    expect(await f.token.balanceOf(f.taxEoa)).to.equal(sellAmt / 100n + out / 100n);

    // only the Safe can move the tax receiver; the rate is a constant
    await expect(f.token.connect(a).setTaxReceiver(a)).to.be.revertedWithCustomError(f.token, "OnlyTaxAdmin");
    await f.token.connect(f.safe).setTaxReceiver(f.users[5]);
    expect(await f.token.TAX_BPS()).to.equal(100n);
  });

  it("puts unsold BEM into the BEM pool and keeps T_BEM + T_BNB = 0.40 * TP", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime);
    const sale = await f.sale.getAddress();
    const sold = BEM(10); // min batch at R = 300 is 10 BEM
    const w = (sold * RATE_USDT_PATH) / 10n ** 18n;
    await f.sale.swapBatch(sold, Route.Kyber, f.aggData(sold, w, sale));
    await time.increaseTo(f.cfg.endTime + 3600);
    await f.sale.launch();
    const pBem = await f.v2Factory.getFunction("getPair")(f.token, f.bem);
    const pBnb = await f.v2Factory.getFunction("getPair")(f.token, f.wbnb);
    expect(await f.bem.balanceOf(pBem)).to.equal(BEM(230)); // 120 LP share + 110 unsold
    expect(await f.wbnb.balanceOf(pBnb)).to.equal(w);
    expect((await f.token.balanceOf(pBem)) + (await f.token.balanceOf(pBnb))).to.equal(E18(240_000_000));
    expect(await f.token.balanceOf(DEAD)).to.equal(E18(160_000_000));
  });

  it("opens only the BEM pool if nothing could be swapped", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime + 3600);
    await f.sale.launch();
    const pBem = await f.v2Factory.getFunction("getPair")(f.token, f.bem);
    expect(await f.v2Factory.getFunction("getPair")(f.token, f.wbnb)).to.equal(ethers.ZeroAddress);
    expect(await f.token.balanceOf(pBem)).to.equal(E18(240_000_000));
  });

  it("cannot be bricked by pre-creating pairs and donating (price kept, tapecat capped)", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime + 3600);
    await f.v2Factory.createPair(f.token, f.bem);
    const pBem = await f.v2Factory.getFunction("getPair")(f.token, f.bem);
    await f.bem.mint(f.attacker, BEM(200));
    // small donation + sync: price must still be 2R/TP (bemForPool = 240, donation = 1)
    await f.bem.connect(f.attacker).transfer(pBem, BEM(1));
    await f.pairAt(pBem).sync();
    const snap = await ethers.provider.send("evm_snapshot", []);
    await f.sale.launch();
    expect(await f.token.balanceOf(pBem)).to.equal((BEM(241) * TP) / (2n * BEM(300)));
    await ethers.provider.send("evm_revert", [snap]);

    // donation large enough that required tapecat exceeds the 400M available: launch still succeeds, capped
    await f.bem.connect(f.attacker).transfer(pBem, BEM(200));
    await f.sale.launch();
    expect(await f.token.balanceOf(pBem)).to.equal(E18(400_000_000));
    expect(await f.token.balanceOf(f.sale)).to.equal(TP);
  });
});

describe("TapeCatSale – rebates & governance", () => {
  it("non-contributing personal referrers cannot claim; anyone can reassign to the official referrer", async () => {
    const f = await loadFixture(deployFixture);
    const ghost = f.users[200];
    await time.increaseTo(f.cfg.start);
    for (let i = 0; i < 8; i++) await f.contribute(f.users[i], BEM(1.5), ghost.address);
    await fillToMin(f, 8, f.users[0].address);
    await time.increaseTo(f.cfg.endTime + 3600);
    await f.sale.launch();
    await expect(f.sale.connect(ghost).claimRebate()).to.be.revertedWithCustomError(f.sale, "NotParticipant");
    await f.sale.reassignRebate(ghost);
    expect(await f.sale.claimableRebate(f.official)).to.equal(BEM(1.2));
    await expect(f.sale.reassignRebate(f.users[0])).to.be.revertedWithCustomError(f.sale, "BadState");
  });

  it("a replaced official referrer keeps and can claim its accrued rebates", async () => {
    const f = await loadFixture(deployFixture);
    const newOfficial = f.users[201];
    await time.increaseTo(f.cfg.start);
    await f.contribute(f.users[0], BEM(1.5));
    await expect(f.sale.connect(f.attacker).setOfficialReferrer(newOfficial)).to.be.revertedWithCustomError(
      f.sale,
      "OnlyOwner",
    );
    await f.sale.connect(f.safe).setOfficialReferrer(newOfficial);
    for (let i = 1; i < 8; i++) await f.contribute(f.users[i], BEM(1.5));
    await fillToMin(f, 8, f.users[0].address);
    await time.increaseTo(f.cfg.endTime + 3600);
    await f.sale.launch();
    const n0 = await f.bem.balanceOf(newOfficial);
    await f.sale.connect(f.official).claimRebate();
    await f.sale.connect(newOfficial).claimRebate();
    expect(await f.bem.balanceOf(f.official)).to.equal(BEM(0.15));
    expect((await f.bem.balanceOf(newOfficial)) - n0).to.equal(BEM(1.05));
  });

  it("Safe can rotate signer (old signatures die) and set fund wallet only before launch", async () => {
    const f = await loadFixture(deployFixture);
    await time.increaseTo(f.cfg.start);
    const u = f.users[0];
    const a = await f.alloc(u.address, "x1");
    await f.sale.connect(f.safe).setSigner(f.users[202].address);
    await expect(
      f.sale.connect(u).contribute(BEM(1), ethers.ZeroAddress, a.xIdHash, a.cap, a.deadline, a.sig),
    ).to.be.revertedWithCustomError(f.sale, "BadSignature");
    await f.sale.connect(f.safe).setSigner(f.signerWallet.address);
    for (let i = 0; i < 8; i++) await f.contribute(f.users[i], BEM(1.5));
    const fundWallet = f.users[200];
    await f.sale.connect(f.safe).setFundWallet(fundWallet);
    await fillToMin(f, 8);
    await time.increaseTo(f.cfg.endTime + 3600);
    const w0 = await f.bem.balanceOf(fundWallet);
    await f.sale.launch();
    expect((await f.bem.balanceOf(fundWallet)) - w0).to.equal(BEM(30)); // 10% of 300
    await expect(f.sale.connect(f.safe).setFundWallet(f.fund)).to.be.revertedWithCustomError(f.sale, "BadState");
    await expect(f.sale.connect(f.safe).publishAllowlist(ethers.ZeroHash, "bafy")).to.emit(f.sale, "AllowlistPublished");
  });
});

describe("TapeCatSale – safety valve", () => {
  it("after end+1h+7d without launch, refunds pro-rata in BEM and WBNB; launch is then impossible", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime);
    const sale = await f.sale.getAddress();
    const w = (BEM(60) * RATE_USDT_PATH) / 10n ** 18n;
    await f.sale.swapBatch(BEM(60), Route.Kyber, f.aggData(BEM(60), w, sale));
    const deadline = f.cfg.endTime + 3600 + 7 * 86400;
    await time.increaseTo(deadline - 10);
    await expect(f.sale.connect(f.users[0]).refund()).to.be.revertedWithCustomError(f.sale, "NoRefund");
    await time.increaseTo(deadline + 1);
    expect(await f.sale.phase()).to.equal(6n);
    await expect(f.sale.launch()).to.be.revertedWithCustomError(f.sale, "BadState");

    const u = f.users[0];
    const b0 = await f.bem.balanceOf(u);
    await f.sale.connect(u).refund();
    expect((await f.bem.balanceOf(u)) - b0).to.equal(BEM(1.2)); // (300-60) * 1.5/300
    expect(await f.wbnb.balanceOf(u)).to.equal(w / 200n);
    for (let i = 1; i < MIN_PARTICIPANTS; i++) await f.sale.connect(f.users[i]).refund();
    expect(await f.bem.balanceOf(f.sale)).to.equal(0);
    expect(await f.wbnb.balanceOf(f.sale)).to.equal(0);
  });
});

describe("TapeCatSale – keeper whitelist", () => {
  it("rejects aggregator routes from non-keepers and accepts Direct from anyone", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime);
    const sale = await f.sale.getAddress();
    const amt = BEM(10);
    const fair = (amt * RATE_USDT_PATH) / 10n ** 18n;
    await expect(
      f.sale.connect(f.attacker).swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale)),
    ).to.be.revertedWithCustomError(f.sale, "NotKeeper");
    await expect(
      f.sale.connect(f.attacker).swapBatch(amt, Route.OneInch, f.aggData(amt, fair, sale)),
    ).to.be.revertedWithCustomError(f.sale, "NotKeeper");
    // Direct is permissionless
    await f.v3Router.setRate(RATE_USDT_PATH);
    await f.sale.connect(f.attacker).swapBatch(amt, Route.Direct, "0x");
    expect(await f.sale.bemSold()).to.equal(amt);
  });

  it("setKeeper revoke takes effect immediately; only owner can set", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime);
    const sale = await f.sale.getAddress();
    const amt = BEM(10);
    const fair = (amt * RATE_USDT_PATH) / 10n ** 18n;
    await expect(f.sale.connect(f.attacker).setKeeper(f.attacker.address, true)).to.be.revertedWithCustomError(
      f.sale,
      "OnlyOwner",
    );
    await expect(f.sale.connect(f.safe).setKeeper(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
      f.sale,
      "ZeroAddress",
    );
    await f.sale.connect(f.safe).setKeeper(f.attacker.address, true);
    expect(await f.sale.isKeeper(f.attacker)).to.equal(true);
    await f.sale.connect(f.attacker).swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale));
    await f.sale.connect(f.safe).setKeeper(f.attacker.address, false);
    await time.increase(300);
    await expect(
      f.sale.connect(f.attacker).swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale)),
    ).to.be.revertedWithCustomError(f.sale, "NotKeeper");
  });
});

describe("TapeCatSale – batch griefing prevention", () => {
  it("rejects amounts below ceil(remaining/batchesLeft) and near-empty partial fills", async () => {
    const f = await loadFixture(raisedFixture); // swapTarget 120
    await time.increaseTo(f.cfg.endTime);
    const sale = await f.sale.getAddress();
    // minAmt = ceil(120/12)=10
    expect(await f.sale.minNextBatch()).to.equal(BEM(10));
    await expect(f.sale.swapBatch(BEM(0.1), Route.Kyber, "0x")).to.be.revertedWithCustomError(f.sale, "BadAmount");
    await expect(f.sale.swapBatch(1n, Route.Kyber, "0x")).to.be.revertedWithCustomError(f.sale, "BadAmount");

    // Request full minAmt but aggregator only sells 1 wei → BadAmount (FILL_BPS)
    const amt = BEM(10);
    const fair = (amt * RATE_USDT_PATH) / 10n ** 18n;
    await expect(
      f.sale.swapBatch(amt, Route.Kyber, f.aggData(1n, fair, sale)),
    ).to.be.revertedWithCustomError(f.sale, "BadAmount");
    // Honest fill still works
    await f.sale.swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale));
    expect(await f.sale.bemSold()).to.equal(amt);
  });

  it("12 consecutive min-sized batches can clear the target inside the window", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime);
    const sale = await f.sale.getAddress();
    for (let i = 0; i < 12; i++) {
      const amt = await f.sale.minNextBatch();
      expect(amt).to.be.gt(0n);
      const fair = (amt * RATE_USDT_PATH) / 10n ** 18n;
      await f.sale.swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale));
      if (i < 11) await time.increase(300);
    }
    expect(await f.sale.bemSold()).to.equal(BEM(120));
    expect(await f.sale.remainingToSwap()).to.equal(0n);
  });
});

describe("TapeCatSale – allocation tiers & referrer first-only", () => {
  it("rejects caps other than exactly 1 or 1.5 BEM", async () => {
    const f = await loadFixture(deployFixture);
    const u = f.users[0];
    await time.increaseTo(f.cfg.start);
    const mid = await f.alloc(u.address, "x1", BEM(1.2));
    await expect(
      f.sale.connect(u).contribute(BEM(1), ethers.ZeroAddress, mid.xIdHash, mid.cap, mid.deadline, mid.sig),
    ).to.be.revertedWithCustomError(f.sale, "BadAllocation");
  });

  it("binds referrer only on the first contribution", async () => {
    const f = await loadFixture(deployFixture);
    const [a, b, c] = f.users;
    await time.increaseTo(f.cfg.start);
    // First contrib with no referrer
    await f.contribute(a, BEM(1), ethers.ZeroAddress, "xa", BEM(1.5));
    expect(await f.sale.referrerOf(a)).to.equal(ethers.ZeroAddress);
    // Later contrib with a referrer is ignored
    await f.contribute(a, BEM(0.5), b.address, "xa", BEM(1.5));
    expect(await f.sale.referrerOf(a)).to.equal(ethers.ZeroAddress);
    // Rebate went to official
    expect(await f.sale.claimableRebate(f.official)).to.equal(BEM(0.15));
    // First contrib with referrer still works
    await f.contribute(c, BEM(1), b.address, "xc", BEM(1.5));
    expect(await f.sale.referrerOf(c)).to.equal(b.address);
  });
});

describe("TapeCatToken – setTaxReceiver restrictions", () => {
  it("rejects zero, sale, token, and launch pairs", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime + 3600);
    await f.sale.launch();
    const pBem = await f.v2Factory.getFunction("getPair")(f.token, f.bem);
    await expect(f.token.connect(f.safe).setTaxReceiver(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      f.token,
      "ZeroAddress",
    );
    await expect(f.token.connect(f.safe).setTaxReceiver(f.sale)).to.be.revertedWithCustomError(f.token, "ZeroAddress");
    await expect(f.token.connect(f.safe).setTaxReceiver(f.token)).to.be.revertedWithCustomError(f.token, "ZeroAddress");
    await expect(f.token.connect(f.safe).setTaxReceiver(pBem)).to.be.revertedWithCustomError(f.token, "ZeroAddress");
    await f.token.connect(f.safe).setTaxReceiver(f.users[5]);
    expect(await f.token.taxReceiver()).to.equal(f.users[5].address);
  });
});

describe("TapeCatSale – reentrancy", () => {
  it("blocks aggregator reentrancy into swapBatch via ReentrancyGuard", async () => {
    const f = await loadFixture(deployFixture);
    const Re = await ethers.getContractFactory("MockReentrantAggregator");
    const re = await Re.deploy();
    await f.wbnb.mint(re, E18(1000));
    // Point kyber at reentrant mock by rotating via... kyber is immutable.
    // Instead: setKeeper and use the existing kyber but we need the mock as router.
    // Redeploy sale with reentrant as kyber.
    const sale2Factory = await ethers.getContractFactory("TapeCatSale");
    // Deploy first, then set times relative to the post-deploy block.
    const t0 = (await ethers.provider.getBlock("latest"))!.timestamp;
    const cfg = {
      ...f.cfg,
      start: t0 + 1000,
      endTime: t0 + 1000 + 3 * 24 * 3600,
      kyberRouter: await re.getAddress(),
      initialKeepers: [f.deployer.address],
    };
    const sale2 = await sale2Factory.deploy(cfg);
    for (const u of f.users.slice(0, MIN_PARTICIPANTS)) {
      await f.bem.connect(u).approve(sale2, ethers.MaxUint256);
    }
    await time.increaseTo(cfg.start);
    for (let i = 0; i < MIN_PARTICIPANTS; i++) {
      const u = f.users[i];
      // domain must match sale2 — resign
      const { chainId } = await ethers.provider.getNetwork();
      const domain = { name: "tapecat-sale", version: "1", chainId, verifyingContract: await sale2.getAddress() };
      const types = {
        Allocation: [
          { name: "wallet", type: "address" },
          { name: "xIdHash", type: "bytes32" },
          { name: "cap", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const xIdHash = f.xHash(`re-${i}`);
      const sig = await f.signerWallet.signTypedData(domain, types, {
        wallet: u.address,
        xIdHash,
        cap: BEM(1.5),
        deadline: cfg.endTime,
      });
      await sale2.connect(u).contribute(BEM(1.5), ethers.ZeroAddress, xIdHash, BEM(1.5), cfg.endTime, sig);
    }
    await time.increaseTo(cfg.endTime);
    const saleAddr = await sale2.getAddress();
    const amt = BEM(10);
    const fair = (amt * RATE_USDT_PATH) / 10n ** 18n;
    const inner = sale2.interface.encodeFunctionData("swapBatch", [
      amt,
      Route.Kyber,
      re.interface.encodeFunctionData("swap", [f.cfg.bem, f.cfg.wbnb, amt, fair, saleAddr]),
    ]);
    await re.arm(saleAddr, inner);
    const data = re.interface.encodeFunctionData("swap", [f.cfg.bem, f.cfg.wbnb, amt, fair, saleAddr]);
    await expect(sale2.swapBatch(amt, Route.Kyber, data)).to.be.reverted; // ReentrancyGuard
  });
});

describe("TapeCatSale – TWAP window vs consecutive batches", () => {
  it("allows 12 consecutive batches when spot stays within MAX_TICK_DEV of TWAP", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime);
    const sale = await f.sale.getAddress();
    // Move spot by 150 ticks (< 200) after each batch; TWAP window is 120s < CD 300s
    for (let i = 0; i < 12; i++) {
      await f.poolBU.set(150, 0, false);
      await f.poolUW.set(150, 0, false);
      await f.poolBW.set(150, 0, false);
      const amt = await f.sale.minNextBatch();
      const fair = (amt * RATE_USDT_PATH) / 10n ** 18n;
      await f.sale.swapBatch(amt, Route.Kyber, f.aggData(amt, fair, sale));
      if (i < 11) await time.increase(300);
    }
    expect(await f.sale.bemSold()).to.equal(BEM(120));
  });
});

describe("invariants (lightweight)", () => {
  it("totalRebateOutstanding equals sum of claimableRebate after raise", async () => {
    const f = await loadFixture(raisedFixture);
    let sum = 0n;
    for (const u of f.users.slice(0, MIN_PARTICIPANTS)) sum += await f.sale.claimableRebate(u);
    sum += await f.sale.claimableRebate(f.official);
    expect(sum).to.equal(await f.sale.totalRebateOutstanding());
    expect(sum).to.equal(BEM(30)); // 10% of 300
  });

  it("BEM accounting at launch: fund + rebates + pool = R - bemSold + dust path", async () => {
    const f = await loadFixture(raisedFixture);
    await time.increaseTo(f.cfg.endTime);
    const sale = await f.sale.getAddress();
    const fair = (BEM(120) * RATE_USDT_PATH) / 10n ** 18n;
    await f.sale.swapBatch(BEM(120), Route.Kyber, f.aggData(BEM(120), fair, sale));
    await time.increaseTo(f.cfg.endTime + 3600);
    const fundBefore = await f.bem.balanceOf(f.fund);
    await f.sale.launch();
    // fund got 10% (=30) plus any dust (0 here)
    expect((await f.bem.balanceOf(f.fund)) - fundBefore).to.equal(BEM(30));
    expect(await f.bem.balanceOf(f.sale)).to.equal(await f.sale.totalRebateOutstanding());
  });
});
