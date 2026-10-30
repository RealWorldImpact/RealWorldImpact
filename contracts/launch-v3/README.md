# RWI launches — bounded-reserve curve (V3)

**Prepared replacement; not activated.** The deployed V2 contracts are immutable. `scripts/lp/launch-v3-config.js` intentionally has no address until a human deploys this build and its receipt, creation input, runtime code and dependencies are independently verified. V1/V2 sources, deployment records and registry API versions remain available. Check their launch counts again before activating V3; any existing launches must retain trading, rewards and public-profile access.

## Targets and distribution

The launch form targets a **$5,000 opening fully diluted valuation** and a **$50,000 graduation fully diluted valuation** at the RWI dollar quote checked at launch. Fully diluted valuation is token price multiplied by the entire fixed billion-token supply, including permanently locked supply. It is not circulating market capitalization, money raised, or pool liquidity.

The contract measures prices in RWI. It does not contain a USD oracle. A later RWI/USD change changes the actual dollar valuations, so graduation is a fixed tenfold price target in RWI, not an automatic live $50,000 USD trigger. Direct contract callers can choose any supported opening valuation in RWI; the website constructs the $5,000 reference and checks a fresh quote before signing.

Each launch captures a **net RWI reserve ceiling of 1% of RWI's total supply**, read onchain. Trading fees are separate. The contract reduces how much of the new token's supply is offered on its curve to fit that ceiling. All remaining tokens stay permanently in launch custody with no withdrawal method, including any excess after graduation. There is no creator premine. The launch calldata binds the reviewed reserve ceiling: if RWI burns change it while a launch transaction is pending, the transaction reverts instead of silently changing the allocation.

Example only, using RWI price **$0.00002728163605** and total supply **999,925,641.741752859464605861 RWI**:

- Maximum net reserve: approximately **9,999,256 RWI**, worth approximately **$272.80** at that reference price.
- Approximately **1.73%** of the new token's billion-token supply sold before graduation.
- Approximately **0.55%** placed into permanently locked liquidity.
- Approximately **97.73%** permanently locked outside the pool.
- Approximately **$545.59** total pool value at the same reference price. This is a shallow pool despite its $50,000 fully diluted valuation; neither number guarantees demand or returns.

Every launch displays its current allocation and estimated pool value before confirmation. Figures vary with RWI price and supply. The ceiling is per launch, not an aggregate limit across all launches.

## Curve math

The constant-product pricing and price-preserving graduation math derive from the verified Pons V2 implementation, with the original MIT notices retained in `vendor/`. See [Pons V2 documentation](https://docs.ponsfamily.com/v2) and [verified factory source](https://repo.sourcify.dev/4663/0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e). V3 changes the inventory and graduation ratio; it does not claim Pons' original token distribution.

Let `S = 10^27` token base units, `F = $5,000 / RWI_USD` in RWI base units, `C = RWI.totalSupply()/100`, `T0` initial curve inventory, `P` virtual RWI reserves, `Q` collected net RWI, and `T` remaining curve inventory.

1. Try `T0 = S`. Set `P = ceil(F*T0/S)`, `Tfloor = floor(T0/sqrt(10))`, and `Qtarget = floor((T0-Tfloor)*P/Tfloor)+1`.
2. If the target exceeds `C`, choose a smaller `T0` using `Pmax = floor((sqrt(10*C*C)+C)/9)`, subtract a conservative integer rounding margin, and recompute. The library explicitly checks that `Qtarget+10 <= C`.
3. Pricing uses reserves `(P+Q,T)`. Buy fees are removed from input; sell fees are removed from gross output. Donated balances and accrued fees do not change tracked reserves.
4. The final fill is bounded by the remaining net reserve target as well as the inventory floor. This prevents rounding from repeated trades from pushing the required reserve above the ceiling. Oversized ETH input is refunded directly. Final fee rounding is a few base units; a separate hard guard rejects any `Q > C`.
5. At graduation, all tracked `Q` and `floor(T*Q/(P+Q))` tokens seed a full-range Uniswap V4 position at the final curve price. The virtual RWI reserve is removed without a price discontinuity. Integer truncation produces negligible deviations from the 10x target at normal values. Unused tokens and the liquidity NFT cannot be withdrawn.

`LaunchTermsV3.sol` and `scripts/lp/launch-v3-model.js` implement the same integer arithmetic. The UI compares its calculated terms against the factory's `previewTerms` both at review and immediately before constructing launch calldata.

## Preserved behavior and protections

- Gas-only launches: zero launch fee, zero creator RWI deposit.
- Fixed 1 billion supply, 18 decimals; no owner, upgrade, further minting, transfer tax, blacklist or arbitrary-call interface.
- Native ETH buys and sells routed through RWI before and after graduation. Third parties can create other markets for a standard ERC-20; these contracts cannot prohibit that.
- 1% base trading fee plus immutable optional 0%, 1%, 2% or 3% creator tax. These accrued launch fees belong to the creator, as in V2. ETH/RWI routing fees also apply.
- Creator rewards can only be claimed by the creator, only in ETH, after converting accrued RWI fees. There is no claim path for liquidity principal, unsold supply or another creator's fees. Failed minimum-output checks or ETH payouts roll back fee accounting.
- Deadline and absolute output protections; exact temporary approvals cleared after trading, graduation and reward conversion.
- Graduation uses an external self-call, so a temporary PositionManager failure leaves reserves intact in a closed, retryable state. Anyone can retry. There is no administrative withdrawal path if a dependency permanently fails.
- The hook permits pool initialization only by its bound factory, preventing a third party from initializing the intended pool at a different price first.

## Validation

Dependencies are pinned in `../launch/package-lock.json`. Solidity 0.8.26, optimizer 200, via IR, Cancun. Compiler inputs normalize line endings and enforce contract size limits. Generated public deployment files contain only the factory, hook and router, never the local test harnesses.

From the repository root:

```text
node contracts/launch-v3/compile.cjs --test
node contracts/launch-v3/build-setup.cjs
npm --prefix scripts/lp test
node scripts/lp/build.cjs
```

Run a Hardhat node bound to localhost port 8899 using `contracts/launch/hardhat.config.cjs`, then run sequentially:

```text
node contracts/launch-v3/test.cjs
node contracts/launch-v3/test-edge.cjs
node contracts/launch-v3/test-terms.cjs
```

The tests hardcode localhost for writes. Mainnet calls only provide the fork's read-only state. Tests cover all fee options, both currency orderings, full and realistically capped inventories, ETH routing, sell accounting, reward isolation, final fills/refunds, 10x graduation, locked Uniswap liquidity, post-graduation trading, access controls, exact-output hook swaps, failed claim rollback, failed graduation/retry, donation isolation, math boundaries and Solidity/JavaScript differential checks. Test evidence is in the ignored local `artifacts` folder. These checks are not an independent security audit.

## Deployment handoff

1. The human wallet owner opens the local `contracts/launch-v3/setup.html`, reviews the terms and connects on Robinhood Chain (4663).
2. The helper predicts the factory address, mines hook flags `0x20cc`, verifies creation-code hashes and estimates gas. A single human-approved transaction deploys all three contracts with **0 ETH value**. No token is launched.
3. The helper saves pending details before sending, checks wallet/network/nonce, prevents duplicate attempts and offers **Check deployment status** after an interruption. V3 has separate browser storage keys from V2.
4. Independently check the receipt and creation data, exact runtime hashes, all fixed dependencies, hook/router factory bindings and empty registry. Recheck legacy launch counts before activation.
5. Only after verification, save `deployment.json`, populate `LAUNCH_V3_FACTORY`, rebuild, rerun relevant checks, and publish the website. No private key or signing service is stored by this project.
