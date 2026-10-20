// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title tapecat
/// @notice Fixed supply, no mint function. A public, immutable 1% tax applies only to transfers
///         from/to the two launch pairs registered once by the Sale contract. The tax is paid in
///         tapecat directly to `taxReceiver`. The tax admin (Gnosis Safe) can only change `taxReceiver`.
contract TapeCatToken is ERC20 {
    uint256 public constant TAX_BPS = 100;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public immutable sale;
    address public immutable taxAdmin;
    address public taxReceiver;
    bool public tradingEnabled;
    mapping(address => bool) public isPair;

    event TaxReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event TradingEnabled(address[] pairs);

    error NotLaunched();
    error OnlySale();
    error OnlyTaxAdmin();
    error ZeroAddress();

    constructor(address sale_, address taxAdmin_, address taxReceiver_, uint256 supply)
        ERC20("tapecat", "TAPECAT")
    {
        if (sale_ == address(0) || taxAdmin_ == address(0) || taxReceiver_ == address(0)) revert ZeroAddress();
        sale = sale_;
        taxAdmin = taxAdmin_;
        taxReceiver = taxReceiver_;
        _mint(sale_, supply);
    }

    /// @notice Called exactly once by the Sale at launch. Pairs can never be added afterwards.
    function enableTrading(address[] calldata pairs) external {
        if (msg.sender != sale || tradingEnabled) revert OnlySale();
        for (uint256 i; i < pairs.length; ++i) {
            isPair[pairs[i]] = true;
        }
        tradingEnabled = true;
        emit TradingEnabled(pairs);
    }

    function setTaxReceiver(address newReceiver) external {
        if (msg.sender != taxAdmin) revert OnlyTaxAdmin();
        if (newReceiver == address(0) || newReceiver == sale || newReceiver == address(this) || isPair[newReceiver]) {
            revert ZeroAddress();
        }
        emit TaxReceiverUpdated(taxReceiver, newReceiver);
        taxReceiver = newReceiver;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!tradingEnabled) {
            if (from != address(0) && from != sale && to != sale) revert NotLaunched();
            super._update(from, to, value);
            return;
        }

        address receiver = taxReceiver;
        bool exempt = from == sale || to == sale || from == DEAD || to == DEAD || from == receiver
            || to == receiver;

        if (!exempt && (isPair[from] || isPair[to])) {
            uint256 tax = value * TAX_BPS / 10_000;
            if (tax > 0) super._update(from, receiver, tax);
            super._update(from, to, value - tax);
        } else {
            super._update(from, to, value);
        }
    }
}
