# Bonding curve economic review — 2026-10-30

**Result: V3 must not be deployed.** Its earlier implementation tests passed, but the old specification does not meet the revised economics. No mainnet transactions were submitted and the live website has not changed. This engineering review is not an independent security audit.

## Approved requirements

- $5,000 starting valuation.
- Graduation when BOTH the current USD token valuation is at least $50,000 AND actual reserves can seed at least $5,000 total pool liquidity.
- The user explicitly selected waiting for minimum liquidity, then selected the $5,000 minimum.
- Half of that minimum requires $2,500 worth of RWI, excluding fees and virtual reserves. The RWI quantity must adjust to its verified live price.
- Keep ETH routing through RWI, zero creator RWI deposit, zero launch fee, the creator fee choices, ETH-only rewards and locked liquidity.
- With a billion-token total supply, $50,000 fully diluted valuation corresponds to $0.00005 per token. This is not circulating market capitalization when most tokens remain locked.

Waiting for minimum liquidity, price jumps and discrete oracle/transaction updates can make actual graduation occur above $50,000. The approved rule is now a minimum valuation plus minimum liquidity, not execution at exactly $50,000 in every circumstance.

## Critical findings

### Fixed RWI graduation does not keep a live dollar target

The current virtual reserve, graduation quote and inventory floor are fixed at creation. There is no USD oracle. When RWI changes after creation:

| RWI price relative to launch | Prepared V3 graduation valuation |
| --- | ---: |
| 0.1× | $5,000 |
| 0.5× | $25,000 |
| 1× | $50,000 |
| 2× | $100,000 |
| 10× | $500,000 |
| 100× | $5,000,000 |

This is a contract-design mismatch; changing displayed text cannot fix it. Pons custom-pair graduation is also counted in the pairing asset. Copying that ratio does not provide a USD trigger. [Pons documentation](https://docs.ponsfamily.com/v2).

### The old 1% RWI cap conflicts with the selected liquidity minimum

At the checked reference price of $0.00002728163605 and total RWI supply of 999,925,641.741752859464605861, the old ceiling contributes only $272.80 of RWI, supporting about $545.59 of total pool value. It cannot support the selected $5,000 pool.

The unavoidable liquidity lower bound is `RWI needed = $2,500 / verified RWI_USD`:

| RWI price scenario | Minimum RWI for the pool |
| --- | ---: |
| Checked reference | 91,636,733 RWI (~9.16% of total supply) |
| 10× reference | 9,163,673 RWI |
| 100× reference | 916,367 RWI |

These are reserve quantities, not promises about acquisition cost or available supply. A much lower price could require an impractical or unavailable quantity. A curve cannot create the missing quote asset. The old fixed cap must not silently remain as a requirement that strands launches. Capacity and slippage constraints need explicit behavior; future growth is not a safety assumption.

### Real execution depth matters

At Robinhood block 102083065, a read-only quote to acquire 91,636,733.054358006509657253 RWI in one swap estimated 1.733569952809682317 ETH, or approximately $3,877.38 at the verified ETH/USD feed. This includes the route's effect on execution price, before the launch's own trading fees. It is not a promised launch cost. Splitting orders, arbitrage, liquidity and changing prices alter execution. The old 458,183,665 RWI exact-output quote was unavailable.

Four thousand mathematical buy/sell round trips across all four fee choices returned principal reserves to rounding dust. Creator fees accumulated separately. Gross volume alone does not fund graduation and must not be counted as collateral.

### A verified live conversion source is still missing

The published Robinhood Chain Chainlink directory contained 58 feeds when checked, with no RWI feed listed. ETH/USD proxy `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` was verified onchain: 8 decimals, $2,236.64181548 at the reviewed round. Its published heartbeat is 86,400 seconds with a 0.5% deviation threshold. ETH/USD alone cannot price RWI. Source: [public Robinhood feed directory](https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json). The read-only chain snapshot and execution quotes are recorded in `oracle-review.json`.

A candidate conversion is `token_RWI × credible RWI_ETH × ETH_USD`. The RWI component still requires a reviewed manipulation-resistant source, freshness/liquidity checks and an operating update mechanism. Two APIs quoting the same pool are not independent markets. Same-transaction spot quotes or ordinary HTTP responses must not authorize irreversible graduation. [Chainlink feed-selection guidance](https://docs.chain.link/data-feeds/selecting-data-feeds).

The existing v4 pool's hook cannot simply be replaced with an oracle hook: changing its hook means creating another pool. [Uniswap hook documentation](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks).

No production RWI oracle or keeper has been configured or funded. Contracts require transactions to execute; a price crossing alone cannot wake them. A permissionless check and/or funded keeper needs an explicit design.

## Candidate revised economics — not a deployed implementation

Constant-product pricing can be retained while graduation checks current USD conditions. The curve must remain redeemable while waiting for sufficient liquidity and must not stop at the old fixed reserve or inventory floor.

For unchanged RWI price, calibrating $5,000 initial valuation, $50,000 graduation and $2,500 net RWI value gives virtual quote value `2500/(sqrt(10)-1)` and initial curve inventory of about 23.1238% of the billion-token supply. The baseline allocation is approximately 15.8114% sold, 5% pooled and 79.1886% permanently locked outside the pool. These are analytical candidate settings; allocations change with dynamic graduation and require implementation review.

Both conditions must hold with validated prices and actual usable reserves:

```text
current token curve price in RWI × verified RWI USD × total supply >= $50,000
2 × real RWI reserve × verified RWI USD >= $5,000
```

Use the current curve price when seeding. Exclude virtual reserves, accrued fees and unsolicited donations from funding. Check the actual minted position after rounding. Do not fall back to stale or manipulable prices to force graduation. Define safe redemption, quote-expiry and retry behavior during oracle or pool failures.

The two-condition candidate illustrates a material consequence: if RWI rises 10× after creation before any buys, the displayed valuation can reach $50,000 with zero funds. Funding the $5,000 pool minimum then produces approximately $73,960 graduation valuation. This satisfies the user's chosen minimum conditions, not an exact $50,000 execution promise.

## Evidence and deployment gates

Run `node contracts/launch-v3/audit-market-scenarios.cjs` to reproduce the findings, varied launch-time prices, the revised two-condition candidate, and 4,000 round trips. Results are recorded in `economic-review.json`. Prior local execution checks remain historical evidence; `validation.json` now explicitly marks economic acceptance false.

Before any replacement deployment: select and verify the RWI oracle and its trust/operating model; implement live USD graduation; replace conflicting fixed-floor/cap rules; enforce $5,000 actual pool funding; test rising/falling prices, zero reserves, thin markets, stale/manipulated prices, fees, transaction-time changes and graduation failures. The current setup is blocked in both its button state and transaction handler. No deployment address has been added to the website.
