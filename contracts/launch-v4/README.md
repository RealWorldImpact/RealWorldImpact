# RWI bonding curve V4 — engineering review and local candidate

Status: **local research build; not deployed, not connected to LP, not production approved.** V3 deployment remains disabled. Live V1/V2 contracts and the website are unchanged. The review fixes specific defects and adds tests; it is not an independent security audit or a claim that the system is perfect.

## Requirements preserved

| Requirement | Candidate behavior |
| --- | --- |
| Initial valuation | $5,000 price × full billion-token supply, calculated onchain from a verified RWI/USD reference |
| Graduation valuation | At least $50,000, using a conservative current oracle valuation |
| Minimum pool | At least $5,000 actually deposited; approximately $2,500 of real RWI and $2,500 of launched tokens |
| Creator funding | No RWI deposit and no launch fee; network gas remains payable |
| Pricing | Pons-style constant product with a virtual RWI reserve |
| Official trading route | ETH → RWI → launched token; sells reverse this route |
| Creator fees | Preserve the published V2/V3 policy: 1% base plus 0%, 1%, 2%, or 3% additional fee; all launch trading fees belong to the creator |
| Claims | Creator only, ETH only, protected by minimum output and deadline |
| Liquidity and surplus supply | Permanently held by a contract with no withdrawal, rescue, ownership, or upgrade method |

The existing ETH/RWI pool charges its own routing fees. Selecting 0% **additional** creator fee does not mean zero total trading fees. This review does not change the existing beneficiaries or percentages. Combining the fee rounding can change the charge by at most one RWI wei per trade.

## Defects corrected in the local implementation

| Finding | Change | Verification |
| --- | --- | --- |
| Fixed RWI target could graduate at $5k or $500k instead of the live $50k target | Evaluate current USD conditions independently from constant-product pricing | Price-rise/drop scenarios, execution-time rechecks |
| The old 1% RWI supply ceiling cannot fund the selected $5k pool at the reference price | Remove the conflicting per-launch ceiling and fixed inventory floor | Final-fill and actual-funded-pool tests |
| A failed graduation could leave buyers unable to redeem | Keep the curve open for sells until pool creation succeeds atomically | Actual sell during a deliberately broken PositionManager |
| Stale or unavailable pricing could either force unsafe graduation or freeze exits | Reject new launches/buys/graduation; keep reserve-based sells independent of oracle availability | Ten malformed, stale, reverting, or gas-consuming feed cases |
| Client-provided opening price was trusted | Derive it onchain; caller specifies only acceptable reference-price bounds | Invalid price-range rejection |
| A single observation could immediately authorize irreversible graduation | Require a five-minute delay and a qualifying observation made after that delay | Early, stale, and pre-delay report rejection |
| Proposed amounts did not prove the pool was actually funded | Check balance changes, minted liquidity, ownership, and the USD value actually deposited | Real local-fork PositionManager, both currency orderings |
| Two separately rounded fee components can make net input non-monotonic by one wei, invalidating a binary search | Combine the same total fee rate into a single floor on the curve and hook | Exhaustive fee boundaries and minimal-fill checks |
| Approximate final-fill inverse fees can overcollect or leave rounding gaps | Find the smallest fee-aware gross input meeting both thresholds | Integer model, one-wei-less rejection, Solidity comparisons |
| Extreme arithmetic could overflow Pons' multiplication sequence | Use full-precision `Math.mulDiv` for swaps and valuation | Wide-range integer comparisons and randomized accounting |
| A price collapse could make graduation mathematically impossible | Reject new deposits if even the entire current RWI supply could not satisfy the two conditions | Unfundable-launch/buy rejection with sells still available |

The total-supply check is only an impossibility bound. It does not claim holders will sell their RWI, that its free float is sufficient, or that acquiring the reserve is economical.

## Mathematics and accounting

Let `P` be virtual RWI, `Q` real net RWI reserves, and `T` remaining curve tokens. Pricing uses `(P + Q) × T` and never rebases reserves when RWI's USD price changes. Changing reserves to force a dollar price would change holders' redemption economics.

- Buy output: `floor(net RWI × T / (P + Q + net RWI))`.
- Gross sell redemption: `floor(tokens in × (P + Q) / (T + tokens in))`, constrained to actual `Q`.
- Fees are recorded separately from principal. Donations are not included in either ledger.
- Price in RWI: `(P + Q) / T`.
- Full-supply USD valuation: `price in RWI × 1 billion × conservative RWI/USD`.
- Graduation requires valuation ≥ $50,000 and net quote value ≥ $2,500.01. The extra cent is rounding headroom, not an additional fee.
- Pool token seed: `floor(T × Q / (P + Q))`. This preserves the terminal curve price to integer precision when initializing the v4 pool.
- After minting, the contract checks at least $5,000 of **actual** deposited value. The unused rounding dust remains locked.

For unchanged RWI price, calibrating the reserve uses `virtual quote USD = 2500.01 / (sqrt(10) - 1)`. Approximately 23.1239% of supply starts in curve inventory. At baseline graduation approximately 15.8115% has been bought, 5.0000% enters the pool, and 79.1885% stays permanently locked outside the pool. There is no creator premine.

Rounding favors reserve solvency. Product never decreases in the tested integer trades. Token supply remains one billion. ETH reward claims cannot withdraw curve principal, the liquidity position, or locked surplus tokens.

## Price and liquidity sensitivity

Reference used for reproducible scenarios: RWI = $0.00002728163605. These are assumptions for sensitivity testing, not current executable prices or predictions. RWI price changes below happen **after** the token launches. Net reserves exclude trading fees and route price impact.

| RWI price after launch | Net RWI at both thresholds | Graduation valuation | Pool value |
| --- | ---: | ---: | ---: |
| 0.1× | 916.37 million | $255,895 | $5,000.02 |
| 0.5× | 183.27 million | $70,877 | $5,000.02 |
| 1× | 91.64 million | $50,000 | $5,000.02 |
| 2× | 52.38 million | $50,000 | $5,716.53 |
| 10× | 9.16 million | $73,960 | $5,000.02 |
| 100× | 916,371 | $521,857 | $5,000.02 |

At 0.01× the reference, the mathematical funding requirement exceeds nine billion RWI, more than total supply. The candidate refuses new deposits under that condition and retains redemption. At 0.1×, the requirement is mathematically below supply but economically implausible for most markets. No implementation can guarantee sufficient available RWI under every price scenario.

A token created *after* RWI has risen receives newly calibrated $5,000 opening terms. That differs from a token already trading when RWI rises. Waiting for real liquidity, oracle smoothing, price gaps, and transaction timing mean graduation can happen above $50,000. Exact execution at $50,000 cannot be promised.

At the reference price, each baseline pool locks approximately 9.16% of the observed RWI total supply. Multiple launches compete for the same quote asset. Future appreciation may reduce token quantities, but the design must not rely on appreciation to remain solvent.

## What the liquidity minimum does and does not provide

The $5,000 is marked pool value, not $5,000 of cash available to sellers. Only approximately $2,500 is the RWI side, and RWI itself has price and execution risk.

At unchanged RWI price, selling all tokens purchased on the curve into the newly graduated pool would move its full-supply valuation from $50,000 to approximately **$2,886**, before fees and other market activity. That is an extreme stress case, not a forecast. A $500 net RWI buy into a $2,500 quote reserve moves the pool's marginal token price up roughly 44%, even before the external ETH/RWI route and fees. The selected minimum gives substantial price impact.

Permanently locking roughly 79% of supply also means a $50,000 **fully diluted valuation** is not a $50,000 circulating-supply market capitalization. Counting purchased tokens plus pool tokens gives approximately $10,406 at baseline graduation; data providers may classify circulating supply differently. LP must label this clearly before release.

The minimum was kept at the user's selected $5,000. Increasing it would improve depth but require more RWI. Reducing it would reduce required RWI but increase fragility. A curve cannot remove this tradeoff.

## Oracle design boundary — release blocker

`IRwiUsdOracle` specifies the required data shape; **it is not an oracle implementation**. `MockRwiOracle` is deliberately attacker-controlled test code and must never be used in production.

The candidate uses an immutable adapter address and checks:

- Correct RWI asset and 18-decimal USD values by interface contract.
- Positive, ordered price bounds within the supported $0.000000001–$1,000,000 range.
- Maximum 2% width between lower and upper valuation bounds.
- A source observation no more than five minutes old, never future-dated.
- At least 30 minutes of underlying observation history.
- A conservative lower value for both graduation conditions.
- A new underlying observation made after the five-minute eligibility delay.

These are candidate policy parameters. They are not proof that supplied prices are honest, manipulated prices are impossible, or a particular 30-minute window is economically secure. The two checks do not prove continuous eligibility between transactions. Price smoothing also lags rapid market moves. The production source's method, observation updates, liquidity checks, sequencer handling, deviation bounds, upgrade authority, failure behavior, and manipulation cost still need verification.

Do not wrap the current pool's spot price and fill in these metadata fields. Ordinary periodic spot samples are not a true cumulative swap-aware TWAP. Multiple APIs quoting the same pool are not independent sources. Never substitute the launch-time quote when a live source fails.

The earlier read-only review found an ETH/USD feed but no RWI feed in the inspected [Chainlink Robinhood directory](https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json). This does not establish that no suitable provider exists. [Chainlink's feed-selection guidance](https://docs.chain.link/data-feeds/selecting-data-feeds) describes liquidity and market-quality considerations. [Its API reference](https://docs.chain.link/data-feeds/api-reference) distinguishes underlying update timestamps from reads; an adapter must preserve this distinction.

The existing v4 pool's hook cannot be retrofitted with an observation hook; the hook is part of its immutable pool identity. See [Uniswap hooks](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks). No production adapter, oracle operators, signer set, or keeper service was silently chosen or funded in this work.

## Lifecycle, routing, and remaining risks

The contract has a redeemable curve phase and a graduated phase. Qualifying buys or permissionless checkpoints record readiness. Buys pause while both conditions qualify; sells remain available and cancel readiness if they take the curve below a threshold. After the waiting period, anyone can submit graduation. The transaction rechecks current conditions and creates the pool atomically. Failure leaves funds and token reserves in the curve, with sells still available subject to the ETH/RWI route functioning.

A permissionless function does not execute itself. The application must submit/check graduation, or a funded automation service must do so. That operating mechanism and its UI are not integrated in this research build.

The official router guarantees ETH/RWI routing and minimum output. A permissionless ERC-20 can still be transferred or traded in pools created elsewhere; hook fees apply to this official pool, not every possible transaction. Enforcing universal routing would require a materially different restricted token design. There is no guarantee that Uniswap's own UI will discover this hook pool automatically.

Other remaining risks include MEV/sandwiching within users' slippage limits; route liquidity exhaustion; RWI or ETH price collapses; upstream contract or RPC failures; external oracle governance or compromise; stale application quotes; and creators whose accounts cannot receive ETH. Failed payouts preserve claims, but the current immutable-creator policy offers no alternate payout recipient. No arbitrary asset recovery method was added.

The hook pool has zero additional LP fee; its hook trading fees accrue to the creator. Locked liquidity is not a yield guarantee for other liquidity providers.

## Reproducible verification

Dependencies reuse the pinned packages already installed in `contracts/launch`: Solidity 0.8.26, OpenZeppelin 5.4.0, v4-core 1.0.2, v4-periphery 1.0.3. Compilation uses Cancun, optimizer 200, and viaIR. It checks bytecode size limits and writes only local artifacts; it does not write site bundles or deployment configuration.

From the repository:

```text
node contracts/launch-v4/compile.cjs --test
node contracts/launch-v4/test-economics.cjs
```

Start the isolated chain from `contracts/launch`:

```text
node node_modules/hardhat/internal/cli/cli.js node --config ../launch-v4/hardhat.config.cjs --hostname 127.0.0.1 --port 8901
```

Then, from the repository, run sequentially:

```text
node contracts/launch-v4/test-fork.cjs
node contracts/launch-v4/test-solidity-math.cjs
```

The tests require a local Hardhat endpoint and check its metadata before mutations. They never use a user wallet. The public RPC did not retain the older pinned state; each test run records the actual fork block/hash. The ETH/RWI route, PoolManager, PositionManager, Permit2 and hooked swaps are real forked contracts. The RWI/USD source is explicitly mocked, so these tests do **not** validate a production price feed.

Final validation passed: **57,888 randomized trades**, **41,600 fee-boundary checks**, **196 economic final-fill scenarios**, and **792 Solidity/model comparisons**. Fork tests covered all eight creator-fee/currency-order combinations plus graduation at the reference RWI price, sixteen exact-output swaps, ten oracle failure cases, malicious ETH callbacks, rejected payout rollback, donation isolation, and two concurrent launches. No real transactions were submitted.

Results and exact tested hashes are recorded in `validation.json`. After a full run, regenerate the record with `node contracts/launch-v4/record-validation.cjs`. The factory has an immutable oracle address: its deployed runtime hash depends on that address; the compiler's runtime template hash alone must not be used as a deployed-code match.

Before release, the missing production oracle must be reviewed and configured, frontend/API integration must use these exact terms and lifecycle, transaction previews must disclose fees and fully diluted valuation, and the complete final deployment must receive independent smart-contract review. V3 must stay blocked throughout that work.
