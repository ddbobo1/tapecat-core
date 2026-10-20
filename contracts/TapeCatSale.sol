// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {TapeCatToken} from "./TapeCatToken.sol";
import {
    IPancakeV2Factory,
    IPancakeV2Pair,
    IV3SwapRouter,
    IQuoterV2,
    IV3Factory,
    IV3Pool
} from "./interfaces/IExternal.sol";

/// @title tapecat Sale / Launcher (design v1.2 / plan v0.10)
/// @notice BEM raise with signed per-wallet allocations (one X account <-> one wallet), 10% referral
///         rebates, a 1h window of 2%-guarded BEM->WBNB batches (aggregator routes whitelisted-keeper
///         only; Direct permissionless), then a permissionless launch that seeds tapecat/BEM and
///         tapecat/WBNB PancakeSwap V2 pools at p = 2 * R / T_P, sends LP to 0xdEaD, pays 10% to the
///         fund Safe and burns the remaining supply.
contract TapeCatSale is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    // 300 BEM. Per-wallet cap is 1.5 BEM, so clearing this floor takes ≥200 max-cap participants.
    uint256 public constant MIN_RAISE = 300e8; // 300 BEM (BEM has 8 decimals)
    uint256 public constant CAP_BASE = 1e8; // 1 BEM (follow)
    uint256 public constant CAP_BONUS = 1.5e8; // 1.5 BEM (follow + retweet)
    uint256 public constant MAX_CAP = CAP_BONUS;
    uint256 public constant MIN_CONTRIBUTION = 0.1e8; // 0.1 BEM per call
    uint256 public constant S = 1_000_000_000e18;
    uint256 public constant TP = 600_000_000e18;
    uint256 public constant LP_BPS = 4000;
    uint256 public constant FUND_BPS = 1000;
    uint256 public constant REF_BPS = 1000;
    uint256 public constant SLIP_BPS = 200;
    /// Partial fill must sell at least 99.9% of the requested amount (dust tolerance).
    uint256 public constant FILL_BPS = 9990;
    uint256 public constant WINDOW = 1 hours;
    uint256 public constant BATCH_CD = 5 minutes;
    uint256 public constant MAX_BATCHES = 12;
    uint256 public constant SAFETY_DELAY = 7 days;
    /// TWAP window < BATCH_CD so a prior batch's impact is mostly absorbed before the next check.
    uint32 public constant TWAP_WINDOW = 120;
    /// |spot tick - TWAP tick| <= 200 (~2%). Combined with SLIP_BPS, worst-case per-batch loss ~4%.
    int24 public constant MAX_TICK_DEV = 200;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bytes32 public constant ALLOC_TYPEHASH =
        keccak256("Allocation(address wallet,bytes32 xIdHash,uint256 cap,uint256 deadline)");

    enum Route {
        Kyber,
        OneInch,
        Direct
    }

    enum Phase {
        NotStarted,
        Raising,
        SwapWindow,
        Launchable,
        Launched,
        RefundBelowMin,
        RefundStuck
    }

    struct Config {
        address bem;
        address wbnb;
        address usdt;
        address v2Factory;
        address v3Factory;
        address v3Router;
        address quoter;
        address kyberRouter;
        address oneInchRouter;
        uint24 feeBemUsdt;
        uint24 feeUsdtWbnb;
        uint24 feeBemWbnb;
        uint256 start;
        uint256 endTime;
        address owner;
        address signer;
        address officialReferrer;
        address fundWallet;
        address taxReceiver;
        bytes32 saleSalt;
        address[] initialKeepers;
    }

    // ---------------------------------------------------------------- immutables
    IERC20 public immutable BEM;
    address public immutable WBNB;
    address public immutable USDT;
    IPancakeV2Factory public immutable factory;
    IV3SwapRouter public immutable v3Router;
    IQuoterV2 public immutable quoter;
    address public immutable kyberRouter;
    address public immutable oneInchRouter;
    uint24 public immutable feeBemUsdt;
    uint24 public immutable feeUsdtWbnb;
    uint24 public immutable feeBemWbnb;
    address public immutable poolBemUsdt;
    address public immutable poolUsdtWbnb;
    address public immutable poolBemWbnb;
    uint256 public immutable start;
    uint256 public immutable endTime;
    address public immutable owner;
    bytes32 public immutable saleSalt;
    TapeCatToken public immutable token;

    // ---------------------------------------------------------------- Safe-controlled (no timelock)
    address public signer;
    address public officialReferrer;
    address public fundWallet;
    mapping(address => bool) public isKeeper;

    // ---------------------------------------------------------------- state
    uint256 public totalRaised;
    uint256 public raiseEnd;
    uint256 public swapTarget;
    uint256 public bemSold;
    uint256 public wbnbReceived;
    uint256 public lastBatchAt;
    uint256 public batchesDone;
    bool public launched;
    uint256 public totalRebateOutstanding;

    bool public stuckRefundOpen;
    uint256 public refundBemSnapshot;
    uint256 public refundWbnbSnapshot;

    mapping(address => uint256) public contributed;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public claimableRebate;
    mapping(address => bool) public claimed;
    mapping(address => bool) public wasOfficialReferrer;
    mapping(bytes32 => address) public walletOfX;
    mapping(address => bytes32) public xOfWallet;

    // ---------------------------------------------------------------- events
    event Contributed(address indexed user, address indexed ref, bytes32 indexed xIdHash, uint256 amount, uint256 rebate);
    event RaiseFinalized(uint256 totalRaised, uint256 swapTarget);
    event SwapBatch(uint256 bemIn, uint256 wbnbOut, Route route, uint256 batchesDone);
    event Launched(
        uint256 totalRaised,
        uint256 pricePerMillionX8,
        address pairBem,
        address pairBnb,
        uint256 bemToPool,
        uint256 tapecatBem,
        uint256 wbnbToPool,
        uint256 tapecatBnb,
        uint256 burned
    );
    event Claimed(address indexed user, uint256 amount);
    event RebateClaimed(address indexed ref, uint256 amount);
    event RebateReassigned(address indexed from, address indexed to, uint256 amount);
    event Refunded(address indexed user, uint256 bem, uint256 wbnb);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event OfficialReferrerUpdated(address indexed oldRef, address indexed newRef);
    event FundWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event KeeperSet(address indexed keeper, bool allowed);
    event AllowlistPublished(bytes32 merkleRoot, string ipfsCid);
    event ExcessSwept(uint256 amount);

    // ---------------------------------------------------------------- errors
    error OnlyOwner();
    error ZeroAddress();
    error BadConfig();
    error Closed();
    error BadAllocation();
    error BadSignature();
    error XBound();
    error CapExceeded();
    error TooSmall();
    error BelowMinRaise();
    error NotInWindow();
    error Cooldown();
    error BatchesDone();
    error BadAmount();
    error RouteDisabled();
    error NotKeeper();
    error NoQuote();
    error Slippage();
    error BadState();
    error NotYet();
    error NothingToClaim();
    error NotParticipant();
    error NoRefund();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(Config memory c) EIP712("tapecat-sale", "1") {
        if (
            c.bem == address(0) || c.wbnb == address(0) || c.v2Factory == address(0) || c.v3Router == address(0)
                || c.quoter == address(0) || c.owner == address(0) || c.signer == address(0)
                || c.officialReferrer == address(0) || c.fundWallet == address(0) || c.taxReceiver == address(0)
        ) revert ZeroAddress();
        if (c.endTime <= c.start) revert BadConfig();
        if (IERC20Metadata(c.bem).decimals() != 8) revert BadConfig();

        BEM = IERC20(c.bem);
        WBNB = c.wbnb;
        USDT = c.usdt;
        factory = IPancakeV2Factory(c.v2Factory);
        v3Router = IV3SwapRouter(c.v3Router);
        quoter = IQuoterV2(c.quoter);
        kyberRouter = c.kyberRouter;
        oneInchRouter = c.oneInchRouter;
        feeBemUsdt = c.feeBemUsdt;
        feeUsdtWbnb = c.feeUsdtWbnb;
        feeBemWbnb = c.feeBemWbnb;
        start = c.start;
        endTime = c.endTime;
        owner = c.owner;
        saleSalt = c.saleSalt;

        address pBU;
        address pUW;
        address pBW;
        if (c.v3Factory != address(0)) {
            if (c.usdt != address(0)) {
                pBU = IV3Factory(c.v3Factory).getPool(c.bem, c.usdt, c.feeBemUsdt);
                pUW = IV3Factory(c.v3Factory).getPool(c.usdt, c.wbnb, c.feeUsdtWbnb);
            }
            pBW = IV3Factory(c.v3Factory).getPool(c.bem, c.wbnb, c.feeBemWbnb);
        }
        poolBemUsdt = pBU;
        poolUsdtWbnb = pUW;
        poolBemWbnb = pBW;

        signer = c.signer;
        officialReferrer = c.officialReferrer;
        wasOfficialReferrer[c.officialReferrer] = true;
        fundWallet = c.fundWallet;

        for (uint256 i; i < c.initialKeepers.length; ++i) {
            address k = c.initialKeepers[i];
            if (k == address(0)) revert ZeroAddress();
            isKeeper[k] = true;
            emit KeeperSet(k, true);
        }

        token = new TapeCatToken(address(this), c.owner, c.taxReceiver, S);
    }

    // ================================================================ raise

    function contribute(
        uint256 amount,
        address referrer,
        bytes32 xIdHash,
        uint256 cap,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant {
        if (block.timestamp < start || block.timestamp >= endTime) revert Closed();
        if ((cap != CAP_BASE && cap != CAP_BONUS) || block.timestamp > deadline || xIdHash == bytes32(0)) {
            revert BadAllocation();
        }
        if (amount < MIN_CONTRIBUTION) revert TooSmall();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ALLOC_TYPEHASH, msg.sender, xIdHash, cap, deadline)));
        if (ECDSA.recover(digest, sig) != signer) revert BadSignature();

        address boundWallet = walletOfX[xIdHash];
        bytes32 boundX = xOfWallet[msg.sender];
        if (boundWallet == address(0) && boundX == bytes32(0)) {
            walletOfX[xIdHash] = msg.sender;
            xOfWallet[msg.sender] = xIdHash;
        } else if (boundWallet != msg.sender || boundX != xIdHash) {
            revert XBound();
        }

        uint256 before = BEM.balanceOf(address(this));
        BEM.safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = BEM.balanceOf(address(this)) - before;
        if (got == 0 || contributed[msg.sender] + got > cap) revert CapExceeded();

        // Referrer binds only on the first contribution (matches frontend copy).
        if (contributed[msg.sender] == 0 && referrer != address(0) && referrer != msg.sender) {
            referrerOf[msg.sender] = referrer;
        }
        address personal = referrerOf[msg.sender];
        address ref = personal != address(0) ? personal : officialReferrer;

        contributed[msg.sender] += got;
        totalRaised += got;
        uint256 rebate = got * REF_BPS / 10_000;
        claimableRebate[ref] += rebate;
        totalRebateOutstanding += rebate;
        emit Contributed(msg.sender, ref, xIdHash, got, rebate);
    }

    function finalizeEnd() public {
        if (raiseEnd == 0 && block.timestamp >= endTime) {
            raiseEnd = endTime;
            if (totalRaised >= MIN_RAISE) swapTarget = totalRaised * LP_BPS / 10_000;
            emit RaiseFinalized(totalRaised, swapTarget);
        }
    }

    // ================================================================ 1h swap window

    /// @notice Aggregator routes (Kyber / 1inch) require isKeeper[msg.sender]. Direct is permissionless.
    ///         `amount` must be at least ceil(remaining / batchesLeft) so tiny grief batches cannot
    ///         exhaust the 12-batch budget. Partial fills must sell >= 99.9% of `amount`.
    function swapBatch(uint256 amount, Route route, bytes calldata data) external nonReentrant {
        if (route != Route.Direct && !isKeeper[msg.sender]) revert NotKeeper();

        finalizeEnd();
        if (totalRaised < MIN_RAISE) revert BelowMinRaise();
        if (raiseEnd == 0 || block.timestamp >= raiseEnd + WINDOW) revert NotInWindow();
        if (batchesDone != 0 && block.timestamp < lastBatchAt + BATCH_CD) revert Cooldown();
        if (batchesDone >= MAX_BATCHES) revert BatchesDone();

        uint256 remaining = swapTarget - bemSold;
        if (amount == 0 || amount > remaining) revert BadAmount();
        uint256 batchesLeft = MAX_BATCHES - batchesDone;
        uint256 minAmt = (remaining + batchesLeft - 1) / batchesLeft; // ceil
        if (amount < minAmt) revert BadAmount();

        uint256 minOut = _bestQuote(amount) * (10_000 - SLIP_BPS) / 10_000;
        if (minOut == 0) revert NoQuote();

        uint256 bemBefore = BEM.balanceOf(address(this));
        uint256 wBefore = IERC20(WBNB).balanceOf(address(this));

        if (route == Route.Direct) {
            BEM.forceApprove(address(v3Router), amount);
            v3Router.exactInputSingle(
                IV3SwapRouter.ExactInputSingleParams({
                    tokenIn: address(BEM),
                    tokenOut: WBNB,
                    fee: feeBemWbnb,
                    recipient: address(this),
                    amountIn: amount,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                })
            );
            BEM.forceApprove(address(v3Router), 0);
        } else {
            address r = route == Route.Kyber ? kyberRouter : oneInchRouter;
            if (r == address(0)) revert RouteDisabled();
            BEM.forceApprove(r, amount);
            (bool ok, bytes memory ret) = r.call(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
            BEM.forceApprove(r, 0);
        }

        uint256 bemAfter = BEM.balanceOf(address(this));
        if (bemAfter > bemBefore) revert BadAmount();
        uint256 spent = bemBefore - bemAfter;
        uint256 out = IERC20(WBNB).balanceOf(address(this)) - wBefore;
        // Require near-full fill so a large `amount` cannot burn a batch slot while selling dust.
        if (spent == 0 || spent > amount || spent * 10_000 < amount * FILL_BPS) revert BadAmount();
        if (out == 0 || out < Math.mulDiv(minOut, spent, amount)) revert Slippage();

        bemSold += spent;
        wbnbReceived += out;
        lastBatchAt = block.timestamp;
        batchesDone += 1;
        emit SwapBatch(spent, out, route, batchesDone);
    }

    // ================================================================ launch

    function launch() external nonReentrant {
        finalizeEnd();
        if (launched || raiseEnd == 0 || totalRaised < MIN_RAISE) revert BadState();
        if (block.timestamp < raiseEnd + WINDOW) revert NotYet();
        if (block.timestamp > raiseEnd + WINDOW + SAFETY_DELAY) revert BadState();
        launched = true;

        uint256 R = totalRaised;
        uint256 bemForPool = R * LP_BPS / 10_000 + (swapTarget - bemSold);

        address pBem = _pairOf(address(BEM));
        address pBnb = bemSold > 0 ? _pairOf(WBNB) : address(0);

        // Account for anything already sitting in a pair (donations) so the opening price stays p = 2R/TP.
        uint256 tBem = Math.mulDiv(BEM.balanceOf(pBem) + bemForPool, TP, 2 * R);
        uint256 tBnb;
        if (pBnb != address(0)) {
            uint256 wInPair = IERC20(WBNB).balanceOf(pBnb) + wbnbReceived;
            tBnb = Math.mulDiv(Math.mulDiv(wInPair, bemSold, wbnbReceived), TP, 2 * R);
        }

        // Donations can only push the required tapecat above what is available (S - TP) at enormous
        // cost to the donor; cap instead of reverting so launch can never be bricked.
        uint256 available = token.balanceOf(address(this)) - TP;
        if (tBem + tBnb > available) {
            uint256 sum = tBem + tBnb;
            tBem = Math.mulDiv(tBem, available, sum);
            tBnb = available - tBem;
        }

        BEM.safeTransfer(pBem, bemForPool);
        IERC20(address(token)).safeTransfer(pBem, tBem);
        IPancakeV2Pair(pBem).mint(DEAD);

        if (pBnb != address(0)) {
            IERC20(WBNB).safeTransfer(pBnb, wbnbReceived);
            IERC20(address(token)).safeTransfer(pBnb, tBnb);
            IPancakeV2Pair(pBnb).mint(DEAD);
        }

        BEM.safeTransfer(fundWallet, R * FUND_BPS / 10_000);

        // Integer-division dust beyond outstanding rebates → fund.
        uint256 bal = BEM.balanceOf(address(this));
        if (bal > totalRebateOutstanding) {
            uint256 dust = bal - totalRebateOutstanding;
            BEM.safeTransfer(fundWallet, dust);
            emit ExcessSwept(dust);
        }

        address[] memory pairs = new address[](pBnb == address(0) ? 1 : 2);
        pairs[0] = pBem;
        if (pBnb != address(0)) pairs[1] = pBnb;
        token.enableTrading(pairs);

        uint256 burnAmt = token.balanceOf(address(this)) - TP;
        if (burnAmt > 0) IERC20(address(token)).safeTransfer(DEAD, burnAmt);

        // pricePerMillionX8 = 2R/600 : BEM raw units (8 decimals) per 1M tapecat tokens.
        emit Launched(R, 2 * R / 600, pBem, pBnb, bemForPool, tBem, wbnbReceived, tBnb, burnAmt);
    }

    // ================================================================ claims

    /// @notice No vesting: 100% claimable right after launch.
    function claim() external nonReentrant {
        if (!launched || claimed[msg.sender] || contributed[msg.sender] == 0) revert NothingToClaim();
        claimed[msg.sender] = true;
        uint256 amt = Math.mulDiv(TP, contributed[msg.sender], totalRaised);
        IERC20(address(token)).safeTransfer(msg.sender, amt);
        emit Claimed(msg.sender, amt);
    }

    /// @notice Personal referrers must have contributed themselves; any current or past official
    ///         referrer can claim without contributing.
    function claimRebate() external nonReentrant {
        if (!launched) revert NotYet();
        uint256 a = claimableRebate[msg.sender];
        if (a == 0) revert NothingToClaim();
        if (!wasOfficialReferrer[msg.sender] && contributed[msg.sender] == 0) revert NotParticipant();
        claimableRebate[msg.sender] = 0;
        totalRebateOutstanding -= a;
        BEM.safeTransfer(msg.sender, a);
        emit RebateClaimed(msg.sender, a);
    }

    /// @notice Permissionless. After launch, rebates owed to a personal referrer who never contributed
    ///         are reassigned to the current official referrer.
    function reassignRebate(address ref) external nonReentrant {
        if (!launched) revert NotYet();
        if (wasOfficialReferrer[ref] || contributed[ref] != 0) revert BadState();
        uint256 a = claimableRebate[ref];
        if (a == 0) revert NothingToClaim();
        claimableRebate[ref] = 0;
        claimableRebate[officialReferrer] += a;
        emit RebateReassigned(ref, officialReferrer, a);
    }

    /// @notice Below MIN_RAISE: full BEM refund. Not launched by end + 1h + 7d: pro-rata share of the
    ///         contract's BEM and WBNB balances (covers partially swapped funds).
    function refund() external nonReentrant {
        finalizeEnd();
        if (raiseEnd == 0) revert NoRefund();
        uint256 c = contributed[msg.sender];
        if (c == 0) revert NothingToClaim();

        if (totalRaised < MIN_RAISE) {
            contributed[msg.sender] = 0;
            BEM.safeTransfer(msg.sender, c);
            emit Refunded(msg.sender, c, 0);
            return;
        }

        if (launched || block.timestamp <= raiseEnd + WINDOW + SAFETY_DELAY) revert NoRefund();
        if (!stuckRefundOpen) {
            stuckRefundOpen = true;
            refundBemSnapshot = BEM.balanceOf(address(this));
            refundWbnbSnapshot = IERC20(WBNB).balanceOf(address(this));
        }
        contributed[msg.sender] = 0;
        uint256 bemOut = Math.mulDiv(c, refundBemSnapshot, totalRaised);
        uint256 wOut = Math.mulDiv(c, refundWbnbSnapshot, totalRaised);
        if (bemOut > 0) BEM.safeTransfer(msg.sender, bemOut);
        if (wOut > 0) IERC20(WBNB).safeTransfer(msg.sender, wOut);
        emit Refunded(msg.sender, bemOut, wOut);
    }

    // ================================================================ Safe governance (no timelock)

    function setSigner(address n) external onlyOwner {
        if (n == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, n);
        signer = n;
    }

    /// @notice Only affects future contributions; balances already credited to the old address stay claimable.
    function setOfficialReferrer(address n) external onlyOwner {
        if (n == address(0) || n == address(this) || n == address(token)) revert ZeroAddress();
        emit OfficialReferrerUpdated(officialReferrer, n);
        officialReferrer = n;
        wasOfficialReferrer[n] = true;
    }

    function setFundWallet(address n) external onlyOwner {
        if (launched) revert BadState();
        if (n == address(0) || n == address(this) || n == address(token)) revert ZeroAddress();
        emit FundWalletUpdated(fundWallet, n);
        fundWallet = n;
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function publishAllowlist(bytes32 root, string calldata cid) external onlyOwner {
        emit AllowlistPublished(root, cid);
    }

    // ================================================================ views

    function phase() external view returns (Phase) {
        if (launched) return Phase.Launched;
        if (block.timestamp < start) return Phase.NotStarted;
        if (block.timestamp < endTime) return Phase.Raising;
        if (totalRaised < MIN_RAISE) return Phase.RefundBelowMin;
        uint256 end = raiseEnd == 0 ? endTime : raiseEnd;
        if (block.timestamp < end + WINDOW) return Phase.SwapWindow;
        if (block.timestamp <= end + WINDOW + SAFETY_DELAY) return Phase.Launchable;
        return Phase.RefundStuck;
    }

    function remainingToSwap() external view returns (uint256) {
        if (raiseEnd == 0) return totalRaised >= MIN_RAISE ? totalRaised * LP_BPS / 10_000 : 0;
        return swapTarget - bemSold;
    }

    /// @notice Minimum amount the next swapBatch must request (ceil(remaining / batchesLeft)).
    function minNextBatch() external view returns (uint256) {
        if (batchesDone >= MAX_BATCHES) return 0;
        uint256 target = raiseEnd == 0
            ? (totalRaised >= MIN_RAISE ? totalRaised * LP_BPS / 10_000 : 0)
            : swapTarget;
        if (target <= bemSold) return 0;
        uint256 remaining = target - bemSold;
        uint256 batchesLeft = MAX_BATCHES - batchesDone;
        return (remaining + batchesLeft - 1) / batchesLeft;
    }

    /// @notice Tokens the user can claim after launch (no vesting).
    function claimableTokens(address user) external view returns (uint256) {
        if (totalRaised == 0 || claimed[user]) return 0;
        return Math.mulDiv(TP, contributed[user], totalRaised);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice minOut the next batch of `amount` would require (non-view because QuoterV2 is non-view; use eth_call).
    function quoteMinOut(uint256 amount) external returns (uint256) {
        return _bestQuote(amount) * (10_000 - SLIP_BPS) / 10_000;
    }

    // ================================================================ internal

    function _bestQuote(uint256 bemAmt) internal returns (uint256 best) {
        if (poolBemUsdt != address(0) && poolUsdtWbnb != address(0) && _poolSane(poolBemUsdt) && _poolSane(poolUsdtWbnb))
        {
            bytes memory path = abi.encodePacked(address(BEM), feeBemUsdt, USDT, feeUsdtWbnb, WBNB);
            try quoter.quoteExactInput(path, bemAmt) returns (uint256 out, uint160[] memory, uint32[] memory, uint256) {
                best = out;
            } catch {}
        }
        if (poolBemWbnb != address(0) && _poolSane(poolBemWbnb)) {
            bytes memory path = abi.encodePacked(address(BEM), feeBemWbnb, WBNB);
            try quoter.quoteExactInput(path, bemAmt) returns (uint256 out, uint160[] memory, uint32[] memory, uint256) {
                if (out > best) best = out;
            } catch {}
        }
        if (best == 0) revert NoQuote();
    }

    function _poolSane(address pool) internal view returns (bool) {
        int24 spot;
        try IV3Pool(pool).slot0() returns (uint160, int24 t, uint16, uint16, uint16, uint32, bool) {
            spot = t;
        } catch {
            return false;
        }
        uint32[] memory ago = new uint32[](2);
        ago[0] = TWAP_WINDOW;
        ago[1] = 0;
        try IV3Pool(pool).observe(ago) returns (int56[] memory cum, uint160[] memory) {
            int56 avg = (cum[1] - cum[0]) / int56(uint56(TWAP_WINDOW));
            int256 dev = int256(spot) - int256(avg);
            if (dev < 0) dev = -dev;
            return dev <= int256(MAX_TICK_DEV);
        } catch {
            return false;
        }
    }

    function _pairOf(address quote) internal returns (address p) {
        p = factory.getPair(address(token), quote);
        if (p == address(0)) p = factory.createPair(address(token), quote);
    }
}
