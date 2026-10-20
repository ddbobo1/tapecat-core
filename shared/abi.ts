import { parseAbi } from "viem";

export const saleAbi = parseAbi([
  "function BEM() view returns (address)",
  "function WBNB() view returns (address)",
  "function token() view returns (address)",
  "function start() view returns (uint256)",
  "function endTime() view returns (uint256)",
  "function raiseEnd() view returns (uint256)",
  "function saleSalt() view returns (bytes32)",
  "function signer() view returns (address)",
  "function kyberRouter() view returns (address)",
  "function oneInchRouter() view returns (address)",
  "function totalRaised() view returns (uint256)",
  "function swapTarget() view returns (uint256)",
  "function bemSold() view returns (uint256)",
  "function wbnbReceived() view returns (uint256)",
  "function lastBatchAt() view returns (uint256)",
  "function batchesDone() view returns (uint256)",
  "function launched() view returns (bool)",
  "function phase() view returns (uint8)",
  "function remainingToSwap() view returns (uint256)",
  "function contributed(address) view returns (uint256)",
  "function claimableRebate(address) view returns (uint256)",
  "function claimableTokens(address) view returns (uint256)",
  "function claimed(address) view returns (bool)",
  "function xOfWallet(address) view returns (bytes32)",
  "function walletOfX(bytes32) view returns (address)",
  "function quoteMinOut(uint256 amount) returns (uint256)",
  "function contribute(uint256 amount, address referrer, bytes32 xIdHash, uint256 cap, uint256 deadline, bytes sig)",
  "function swapBatch(uint256 amount, uint8 route, bytes data)",
  "function launch()",
  "function claim()",
  "function claimRebate()",
  "function reassignRebate(address ref)",
  "function refund()",
  "function publishAllowlist(bytes32 root, string cid)",
  "function isKeeper(address) view returns (bool)",
  "function setKeeper(address keeper, bool allowed)",
  "function minNextBatch() view returns (uint256)",
  "function totalRebateOutstanding() view returns (uint256)",
  "error NotKeeper()",
  "event KeeperSet(address indexed keeper, bool allowed)",
  "event Contributed(address indexed user, address indexed ref, bytes32 indexed xIdHash, uint256 amount, uint256 rebate)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

export const v3PoolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function increaseObservationCardinalityNext(uint16 observationCardinalityNext)",
]);

export const v3FactoryAbi = parseAbi(["function getPool(address, address, uint24) view returns (address)"]);

export enum Route {
  Kyber = 0,
  OneInch = 1,
  Direct = 2,
}

export enum Phase {
  NotStarted = 0,
  Raising = 1,
  SwapWindow = 2,
  Launchable = 3,
  Launched = 4,
  RefundBelowMin = 5,
  RefundStuck = 6,
}
