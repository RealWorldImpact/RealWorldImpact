# RWI Launch V5 — Pons-style sellout

This is a replacement deployment, not an upgrade. It is prepared locally and remains inactive until a wallet-owner deployment is independently verified. No real funds were moved by the test suite. The existing live contracts are unchanged.

## What changed

The user selected Pons-style graduation instead of an RWI/USD oracle or a funded reference pool. V5 sells a fixed token allocation on a constant-product RWI curve and attempts graduation on the final purchase. Existing buys, sells, graduation and ETH creator claims never consult a price feed. Dollar values are opening estimates, **not live USD graduation guarantees**. The earlier guaranteed $40,000 / $5,000-liquidity design is superseded.

Creators pay gas only. Every RWI LP trade routes ETH → RWI → token or token → RWI → ETH. Graduation creates full-range Uniswap v4 liquidity against RWI. All initial liquidity and unused tokens are permanently locked in the factory, with no withdrawal, owner, upgrade, premine or arbitrary-call function. Creator rewards contain the 1% base fee plus an optional fixed 0%, 1%, 2% or 3% additional fee, claimed in ETH. The existing ETH/RWI pool charges its own route fee separately. Transfers are untaxed; third parties can create other markets.

## Pons research

Primary references: [Pons V2 documentation](https://docs.ponsfamily.com/v2), [Pons launchpad](https://ponsfamily.com/launchpad/create), and [verified factory sources](https://sourcify.dev/server/v2/contract/4663/0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e?fields=abi,metadata,sources).

The public factory was read at block 102673253 on 2026-10-31. Its active native-ETH configuration uses 1 billion tokens, 1.68 ETH phantom quote, 4.2 ETH graduation reserve, 1% curve fee, pool fee 0 and tick spacing 200. Pons computes a reserved token floor and graduates when the sellable allocation is exhausted. Its default ratio produces a 12.25× opening quote-denominated valuation and sells about 71.43% of supply. The reserve threshold is mathematically equivalent to sellout, not a live dollar trigger. Pons clamps the final buy, refunds unused input, and seeds the pool at the curve's closing price.

Pons currently charges a 0.0005 ETH launch fee and does not approve RWI as a pair asset at the recorded block. RWI therefore uses its own factory and hook. This is an emulation of the constant-product/sellout mechanism, **not an identical Pons deployment or default distribution**. It does not copy Pons' launch charge, early anti-snipe tax, owner controls or other tokenomics. See `../launch-pons-review/pons-current.json` for exact public reads and source hashes.

One deliberate improvement: if automatic graduation fails, V5 preserves phase 0 and allows sells. Anyone can retry graduation while the allocation remains sold out. A sell reopens the allocation; a later final buy retries automatically. Neither a failed mint nor a broken opening reference traps holders behind a graduation flag.

## Economics

Let S = 1 billion, p = the RWI/USD opening reference, P = phantom RWI, I = initial curve inventory, F = reserved token floor, Q = tracked net RWI, and T = tracked curve tokens. Fees are recorded separately.

Ignoring integer rounding:

```
growth = sqrt(40,000 / 5,000) = sqrt(8)
virtualUSD = 2,500.01 / (growth - 1)
I = S * virtualUSD / 5,000
P = virtualUSD / p
referenceQuote = 2,500.01 / p
F = I * P / (P + referenceQuote)

buyOutput = netRWI * T / (P + Q + netRWI)
sellGross = tokensIn * (P + Q) / (T + tokensIn)
graduation = T == F
poolRWI = Q
poolTokens = T * Q / (P + Q)
```

The initial inventory is approximately 27.3460% of supply. Approximately **17.67774% is sold**, **6.250025% seeds the pool**, and **76.07223% remains locked outside the pool**. This smaller sale allocation reduces required RWI relative to the default Pons distribution. The pool's ratio matches the curve's closing price, excluding unavoidable integer rounding. Tiny mint residuals stay locked. The mint must consume at least 99.99% of each intended reserve and return the expected position and liquidity.

At the checked example opening price of $0.000028202504875523/RWI, a launch collects about **88.645 million RWI net** (about 8.86% of a billion). This is still substantial. It is not a project deposit or creator obligation: buyers acquire RWI through the ETH route. The final net amount is determined by each launch's opening terms, with rounding variation. There is no shared global RWI quota, but **fixed sellout economics do imply a per-launch RWI funding amount**. A claim of “no RWI funding requirement” would be misleading. New launches recalibrate at their own opening price; an existing launch does not reduce its RWI amount when RWI rises.

| RWI price at graduation / opening price | Estimated graduation FDV | Estimated total pool value |
| --- | ---: | ---: |
| 0.1× | $4,000 | $500 |
| 0.5× | $20,000 | $2,500 |
| 1× | $40,000 | $5,000 |
| 2× | $80,000 | $10,000 |
| 10× | $400,000 | $50,000 |

These are scenarios, not predictions. Values ignore subsequent trading and execution costs. FDV uses the full billion-token supply including locked tokens; it is not circulating market cap or cash raised. A $5,000 pool is not a guaranteed minimum. Pool funding cannot be conjured from a nominal valuation. Many concurrent launches may compete for available RWI; this design does not guarantee enough market depth or demand for every launch. The onchain creation check rejects a reference reserve larger than RWI's entire total supply, but that is only an impossibility check, not a liquidity guarantee.

## Opening reference and residual risk

Creation uses the existing native ETH/RWI Uniswap v4 pool spot ratio and the independent ETH/USD feed at `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`. It checks the ETH feed's published 24-hour heartbeat, valid round, positive answer, timestamp and 8 decimals, and requires initialized RWI price plus nonzero active liquidity. The form binds the opening RWI price to a 0.5% range and expires the review after two minutes.

This is **not a manipulation-resistant RWI oracle**. Someone can move the RWI pool before a launch is reviewed, or within its accepted tolerance, changing that launch's starting quote and funding amount. Slippage bounds reject movement outside the reviewed range; they do not establish a fair dollar price. A nonzero-liquidity check is not a depth guarantee. A stale/failing ETH reference blocks new launches, but cannot stop existing holders selling, graduating or claiming. No sequencer-uptime gate is included; the reference is used solely for opening calibration. A separate mature market oracle would be needed for trustworthy live-dollar guarantees.

Immutable contracts and locked liquidity also mean defects cannot be patched for an existing token or recovered through an admin escape hatch. The existing ETH/RWI route remains a liquidity and availability dependency. Local tests are not an independent security audit and cannot establish zero risk.

## Validation

`validation.json` records the exact reviewed bytecode, fork block and completed checks. The test set includes 27,238 randomized accounting checks, 24 minimal-final-fill cases, 960 Solidity/model comparisons, all four fee settings in both currency orders, actual mainnet-fork pool minting, automatic graduation, failed mint/sell/retry recovery, ETH routing and overshoot refunds, exact-output swaps, feed removal after creation, reentrant/rejecting reward recipients, multi-launch reserve isolation and allowance cleanup. All test transactions run on a local fork only.

The LP tests cover price/review expiry, deployment identity and stale/reorganized RPC rejection, profile ownership, registry pagination, metadata escaping, image handling and complete token lists. No transaction-signing key is embedded in the application or tests. Local accounts are only accepted by tests after checking Hardhat metadata.

## Deployment and discovery

1. Build: `node contracts/launch-v5/compile.cjs --export`, then `node contracts/launch-v5/build-setup.cjs` and `npm run build --prefix scripts/lp`.
2. The wallet owner opens `setup.html` on the local preview, reviews terms and gas, and submits one zero-value deployment on chain 4663. Do not send a duplicate transaction if a pending deployment is saved.
3. Independently verify the returned transaction with `node contracts/launch-v5/verify-deployment.cjs <hash>`. Verification compares exact creation data, canonical receipt, recent pinned snapshot, all runtimes, CREATE2 hook permissions, factory bindings and opening terms.
4. Before activation, confirm the existing V1/V2 registries are empty; otherwise retain their trading and rewards in the UI. `--activate` enforces this and only writes local configuration. Rebuild and rerun LP tests, then publish through the existing GitHub/Vercel workflow.
5. Publish the exact Solidity standard-input bundle, ABI and verified deployment addresses, and verify deployed source with Sourcify/explorer. Recheck public routes after deployment.

The site exposes `/launchpad.json`, `/tokenlist.json`, `/tokens/{address}.json`, `/tokens/{address}`, `/tokens-sitemap.xml` and the paginated `/api/lp-launches?version=5` registry. Metadata includes the actual graduation rule and labels USD estimates. Public pages include canonical URLs, Open Graph metadata and structured data. Graduated pools emit standard Uniswap v4 events; the ABI/source bundle describes the custom pre-graduation curve and fee hook.

Third-party listing is not guaranteed: services must support Robinhood Chain and this hook, and custom-curve trading before graduation needs an integration. The immutable ERC-20 metadata is available directly onchain. Uploaded artwork availability still depends on hosting. All-list endpoints fail rather than silently returning partial lists, and currently cap complete aggregation at 4,096 launches; larger registries require the paginated API and a future scalable list/sitemap job.
