// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IV3SwapRouter} from "../interfaces/IExternal.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

contract MockV3Factory {
    mapping(bytes32 => address) public pools;

    function setPool(address a, address b, uint24 fee, address pool) external {
        pools[keccak256(abi.encode(a, b, fee))] = pool;
        pools[keccak256(abi.encode(b, a, fee))] = pool;
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return pools[keccak256(abi.encode(a, b, fee))];
    }
}

/// slot0 tick and TWAP tick are set directly.
contract MockV3Pool {
    int24 public spotTick;
    int24 public twapTick;
    bool public observeReverts;

    function set(int24 spot, int24 twap, bool reverts) external {
        spotTick = spot;
        twapTick = twap;
        observeReverts = reverts;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint32, bool) {
        return (0, spotTick, 0, 1, 1, 0, true);
    }

    function observe(uint32[] calldata ago) external view returns (int56[] memory cum, uint160[] memory spl) {
        require(!observeReverts, "OLD");
        cum = new int56[](2);
        spl = new uint160[](2);
        cum[0] = 0;
        cum[1] = int56(twapTick) * int56(uint56(ago[0]));
    }
}

/// out = amountIn * rate[path] / 1e18
contract MockQuoter {
    mapping(bytes32 => uint256) public rate;

    function setRate(bytes calldata path, uint256 r) external {
        rate[keccak256(path)] = r;
    }

    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        view
        returns (uint256, uint160[] memory, uint32[] memory, uint256)
    {
        uint256 r = rate[keccak256(path)];
        require(r > 0, "no pool");
        return (amountIn * r / 1e18, new uint160[](0), new uint32[](0), 0);
    }
}

/// Stands in for Kyber / 1inch: pulls tokenIn from msg.sender and pays a pre-funded tokenOut to recipient.
contract MockAggregator {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address recipient)
        external
        returns (uint256)
    {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(recipient, amountOut);
        return amountOut;
    }

    /// Tries to pull more than approved.
    function greedy(address tokenIn, uint256 amountIn) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
    }

    function fail() external pure {
        revert("agg: no route");
    }
}

contract MockV3Router {
    uint256 public rate; // out = in * rate / 1e18

    function setRate(uint256 r) external {
        rate = r;
    }

    function exactInputSingle(IV3SwapRouter.ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        out = p.amountIn * rate / 1e18;
        require(out >= p.amountOutMinimum, "Too little received");
        IERC20(p.tokenOut).transfer(p.recipient, out);
    }
}

/// Tries to re-enter Sale.swapBatch / launch via the aggregator callback path.
contract MockReentrantAggregator {
    address public saleTarget;
    bytes public payload;
    bool public armed;

    function arm(address t, bytes calldata data) external {
        saleTarget = t;
        payload = data;
        armed = true;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address recipient)
        external
        returns (uint256)
    {
        if (armed) {
            armed = false;
            (bool ok,) = saleTarget.call(payload);
            require(ok, "reenter failed");
        }
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(recipient, amountOut);
        return amountOut;
    }
}
