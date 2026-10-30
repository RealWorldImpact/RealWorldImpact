# RWI curve launches — replacement deployment

This build is prepared for a new deployment. `scripts/lp/launch-v2-config.js` deliberately has no live address until the human wallet owner deploys and the resulting contracts are independently verified. The original factory remains immutable at `0xdBfabE02ab31A4Ed0c8A77c375EaF597ce7619a8`. Do not substitute a localhost-fork address in live configuration.

## Pons curve provenance

The curve and graduation calculations are derived from the verified Pons v2 implementation, not inferred from its interface:

- [Official v2 documentation](https://docs.ponsfamily.com/v2)
- [Verified Pons factory and sources on Robinhood Chain](https://repo.sourcify.dev/4663/0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e)
- Original source paths: `contracts/src/v2/libraries/PonsV2BondingCurveMath.sol`, `contracts/src/v2/libraries/PonsV2GraduationMath.sol`, `contracts/src/v2/PonsV2BondingCurve.sol`, and `contracts/src/v2/PonsV2LaunchFactory.sol`.
- The two mathematical libraries in `vendor/` retain their original MIT SPDX notice and source comments. The curve library acknowledges its BootstrapPool / code-423n4/2025-01-iq-ai reference.
- Pons `getLaunchConfig(0)` was read at block **101470492**: supply `1000000000000000000000000000`, curve fee 100 bps, phantom quote `1680000000000000000`, graduation threshold `4200000000000000000`, pool fee 0, tick spacing 200, enabled. Thus the threshold is **2.5 × phantom**. RWI was not approved as a Pons pairing asset at that block, so this build uses an independent factory.

Let `S` be supply, `P` the virtual RWI reserve, `Q` real RWI reserves net of fees, and `T` remaining curve inventory. The pricing reserves are `(P + Q, T)`; fees and donated balances are excluded. Exact-input output is `input × reserveOut / (reserveIn + input)` with integer truncation. The inverse uses Pons' `output × reserveIn / (reserveOut - output) + 1` rounding. Buy fees come off RWI input first; sell fees come off gross RWI output.

The reserved floor is `S × P / (P + 2.5P)`, or approximately **2/7 of supply**. The curve sells about **5/7**. At graduation all net RWI raised seeds a full-range v4 position with `remainingTokens × Q / (P + Q)` tokens. This removes the virtual quote without changing the final curve price. Approximately **10/49** of supply enters the pool and **4/49** remains permanently locked outside the position. Integer rounding applies; no actor can withdraw either allocation.

## RWI-specific terms

- Fixed one-billion-token supply, 18 decimals, minted entirely into launch custody; no creator allocation, owner, further minting, transfer tax, blacklist or upgrade.
- Native ETH buys and sells through the existing ETH/RWI pool. Each launch's curve and graduated pool are RWI-denominated.
- No launch fee and no creator RWI deposit. The wallet pays gas.
- The website derives `P = $5,000 / current RWI USD price`, using an 18-decimal RWI amount and a fresh price review that expires after two minutes. A changed reserve quote requires a new review. The initial dollar target is enforced by the website's construction of launch calldata, **not by a contract USD oracle**. Direct contract callers can choose a supported virtual reserve. Dollar prices can change before inclusion and afterwards. Do not describe the target as an immutable onchain USD price.
- The RWI graduation target is fixed when the token launches. At an unchanged RWI dollar price it represents about $12,500 net RWI collected and a $61,250 fully diluted market cap (12.25 times the opening price). This is arithmetic, not an asset valuation or a promise of demand.
- 1% base trading fee plus a fixed optional creator tax of 0%, 1%, 2% or 3%, charged on both buys and sells. All of these fees belong to the creator, consistent with RWI's prior creator-fee design. There is no additional v4 LP fee after graduation; the hook charges the RWI-side fee. The existing ETH/RWI pool has its own fees.
- This matches Pons' curve formula, ratio, fee ordering and price-preserving graduation. It does not adopt Pons' launch fee, protocol revenue split, buybacks, opening snipe tax, mutable creator controls or administrative recovery powers.

## Routing and refunds

Before graduation, the router purchases an exact, bounded RWI amount using at most the ETH the user supplied. The curve caps that RWI amount to the remaining sellable allocation. Unspent ETH is returned directly; it is never unnecessarily swapped into RWI and back. The page reserves 0.5% input-price headroom when sizing the RWI leg and enforces a separate 0.5% minimum-token-output tolerance against its displayed quote. Both limits are visible as maximum ETH and minimum tokens on review. A changed phase causes an outdated curve buy to revert, requiring a new quote.

Curve sells exchange the launch token for RWI and then ETH. Graduated trades use v4's ETH/RWI and token/RWI pools in one unlock. Every call has a deadline and absolute minimum output; smaller-than-reviewed partial fills revert rather than silently weakening that minimum. The router clears temporary approvals, has no arbitrary routing/recipient capability, and preserves zero trade residual balances. Standard ERC-20 tokens can be traded elsewhere; this launch router cannot prohibit third parties from creating other markets.

## Creator rewards and custody

Curve fees are recorded separately from the reserves. The creator hook charges only the RWI leg, supporting all four swap cases (each direction, exact input or exact output), and stores accrued amounts as v4 ERC-6909 claims. Only the factory can redeem those claims. A creator claim combines that launch's curve and hook fees, converts only those fees through the ETH/RWI pool, and pays ETH to the immutable creator. There is no RWI or launch-token payout method and no caller-specified recipient. A failed conversion, minimum-output check, or ETH payment rolls back the entire claim, including fee accounting.

The factory owns each graduated NFT permanently. No function transfers it, decreases liquidity, releases excess token supply, rescues reserves or makes arbitrary calls. The token and RWI approvals used for graduation are exact and cleared afterwards. Separate accounting prevents unsolicited transfers or another launch's rewards from changing a curve's price or claimable amount.

The final buy attempts graduation immediately. If it fails, the launch remains in phase 1 with both curve directions closed and reserves intact. Anyone can call `graduate(token)` to retry. Phase 2 means the v4 pool has been created. The UI provides a completion action for phase 1. No administrative escape path is provided if an external dependency permanently fails.

## Build and test

Dependencies are pinned in `../launch/package-lock.json`. Use Node 22 and Solidity 0.8.26, optimizer 200, via IR, Cancun. Builds normalize source line endings. `compile.cjs` enforces EIP-170 runtime and EIP-3860 creation size bounds and writes a complete compiler input for verification.

From the repository root:

```text
node contracts/launch-v2/compile.cjs --test
node contracts/launch-v2/build-setup.cjs
npm --prefix scripts/lp test
node scripts/lp/build.cjs
```

Start the existing Hardhat node from `contracts/launch` with `RWI_LAUNCH_FORK=1`, bound to `127.0.0.1:8899`, then run these in sequence:

```text
node contracts/launch-v2/test.cjs
node contracts/launch-v2/test-edge.cjs
```

These tests hardcode localhost for writes. They deploy test contracts and exercise the actual forked Uniswap contracts. Main tests cover all four creator tax choices, both currency orderings, initial no-RWI/no-premine conditions, differential curve math, buys/sells, protected claims, clamped final buys, ETH refunds, full-range locked graduation, post-graduation trading and zero residual approvals/balances. Edge tests cover exact-output swaps, actual reverted-claim rollback, a simulated failed graduation, permissionless retry and donation isolation. Evidence is saved in local `artifacts/fork-test.json` and `artifacts/edge-test.json`. The swap harness is not included in public deployment artifacts. Local tests are not an independent security audit.

## Deployment and activation

1. Open `contracts/launch-v2/setup.html` from the local preview. The intended human wallet owner connects on chain 4663.
2. The helper predicts the new factory from the wallet nonce, mines the required hook-address flags (`0x20cc`), verifies creation-code hashes, estimates gas, and checks wallet/network/nonce again. A single human-approved transaction deploys factory, hook and router with zero ETH value. It does not launch a token.
3. Pending details are saved before submission. On interruption use **Check deployment status** instead of deploying again. The helper verifies all three runtimes and their factory bindings.
4. Independently verify the successful receipt, addresses, runtime hashes, fixed dependencies and empty initial registry. Save the public deployment record. Recheck the old factory's launch count before activation; if any legacy launches exist, preserve their registry and v1 trading/fee actions before switching the page.
5. Only then populate `scripts/lp/launch-v2-config.js`, rebuild LP and setup, run the checks and publish. Keep v1 source, ABI, deployment record, configuration and registry API available. No live address is fabricated or inferred from a test deployment.

No private key or signing service is stored by this project. The setup page is for the human wallet owner; automated tooling does not sign or submit a live deployment.
