# Tax statement for the public docs

There is no separate whitepaper file in this repository. This section is the transaction-tax text that public materials must state. It matches `contracts/TapeCatToken.sol` and the site risk disclosure.

## Public 1% buy and sell tax

tapecat charges a **1%** tax on **buys and sells against the official liquidity pairs**.

- The rate is the constant `TAX_BPS = 100` (1% = 100 / 10,000). There is no function that changes it. The multisig cannot change it.
- The tax applies only after trading is enabled (`tradingEnabled`), and only when one side of the transfer is one of the two official pairs registered at launch. Both buys (pair → user) and sells (user → pair) are taxed.
- Ordinary wallet-to-wallet transfers are not taxed.
- The tax is paid in tapecat and sent directly to `taxReceiver`. On a buy the user receives about 99%. On a sell the pair receives about 99%.
- Tax is `value * 100 / 10000`, rounded down.
- Exempt addresses are only the Sale contract, the burn address `0x…dEaD`, and the current `taxReceiver`.
- The two pairs are registered once by the Sale at launch. No further pairs can be added.
- The Gnosis Safe (`taxAdmin`) can **only replace the tax-receiver address**. It cannot change the rate, mint, or set the receiver to a pair, the Sale, or the zero address.
- Block explorers and token scanners will show tapecat as a token with a 1% transfer fee. Sells should use a router that supports `SupportingFeeOnTransferTokens`.

This is not a promise of returns. The opening-price rule and the later market price are a separate topic. See the site risk page.
