# Market-derived RWI pricing research — not selected for release

The user changed direction after this experiment and requested Pons-style curve completion and graduation instead. This directory preserves the evidence; it is not connected to LP and must not be deployed as a production launch oracle.

The reader uses the official Robinhood Uniswap v3 factory and a real RWI/WETH pool's cumulative ticks, composed with the existing ETH/USD feed. It uses 30-minute and 5-minute geometric prices, current spot, a conservative minimum, and a divergence indicator. ETH's underlying timestamp is retained separately from the market-history interval. It does not pretend that ETH has a five-minute heartbeat.

At block 102665981, no RWI/WETH pools existed in the official factory's four standard fee tiers. The existing Pons v4 hook's verified ABI contains no cumulative price-history interface. A new reference pool would therefore need real funding and history. The launched tokens could remain in v4 RWI pairs, but this option introduces reference-market capital and security requirements.

`test-fork.cjs` created a reference market only on a verified local Hardhat fork using existing chain contracts. The test reader rejected insufficient history, current empty liquidity and stale ETH/USD. It ignored a roughly ninefold instantaneous spot spike in the 30-minute price and flagged a five-minute divergence.

The deliberately thin fixture also demonstrated the limit: sustaining the manipulated price beyond the full window made all price checks agree. In the isolated fork, a 2 ETH round trip cost approximately 0.008 ETH before gas, with no competing arbitrageurs. This is a counterexample to treating time averaging alone as a security guarantee, not an estimate of attack cost on a production market. `validation.json` records the exact fork and results.

Before any future use, this approach would require independently reviewed market depth and withdrawal protection, aggregate exposure analysis, observation retention, sequencer recovery, and a volatility policy. The two-percent agreement check can also pause during legitimate rapid growth. `MarketReferenceReader` deliberately does not implement the production oracle interface.

Reproduce locally:

```text
node contracts/launch-market-reference/compile.cjs
```

From `contracts/launch`, start:

```text
node node_modules/hardhat/internal/cli/cli.js node --config ../launch-market-reference/hardhat.config.cjs --hostname 127.0.0.1 --port 8902
```

Then from the repository:

```text
node contracts/launch-market-reference/test-fork.cjs
```

The test hardcodes localhost and verifies Hardhat metadata before mutations. The reference liquidity is an artificial local fixture, not a mainnet funding method. No user wallet is used. No live contracts or website changed.

Sources: [Uniswap v3 oracle mechanics](https://developers.uniswap.org/docs/protocols/v3/concepts/price-oracles), [official Robinhood v3 deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments), [Uniswap's manipulation analysis](https://blog.uniswap.org/uniswap-v3-oracles).
