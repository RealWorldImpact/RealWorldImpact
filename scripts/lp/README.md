# RWI LP

Browser-only Uniswap v4 liquidity interface at `/LP`, chain 4663. Every supported pool includes RWI (`0xda2598c976e62e7e15dcca75169b404712e48b04`). Transactions are sent only by a connected wallet. No private keys, custody, server signing, or automatic transactions.

## Build and checks

From this directory run `npm ci`, `npm test`, then `npm run build`. The checked-in `assets/lp.js` bundle is served directly by Vercel. Keep JSBI at 3.2.5 so the Uniswap SDKs share one integer implementation.

Addresses come from [Uniswap deployments](https://developers.uniswap.org/docs/protocols/v4/deployments). PositionManager's PoolManager and Permit2 references were checked onchain. The official v4 SDK constructs calldata. Tests decode initialization and mint calldata, verify spending limits, exercise different decimals and fee tiers, and mock wallet/receipt failures without broadcasting transactions.

## Supported operations

- Initialize a new pool and mint full-range liquidity atomically; add another position to an existing pool.
- Read the current pool state through StateView.
- Import owned positions by ID, with optional Blockscout discovery and locally saved receipt IDs for positions created here.
- Withdraw liquidity or collect fees for owned RWI positions without hooks. A 100% withdrawal retains the empty position receipt.
- Approve tokens to Permit2, then authorize PositionManager with expiring, capped limits. Existing larger allowances are not reduced; some existing allowances require a reset transaction.

## Scope

Pools here have no hooks and are independent of the existing Pons launch pool. This does not copy its creator-tax or donation logic. Each token/RWI pool has its own reserves and fees. Native ETH is represented by WETH. Concentrated-range setup, swaps, transfer-tax/rebasing tokens, custom hooks, and liquidity locking are not implemented. Uniswap position receipts are ERC-721 ownership records, not collectible launches.

Writes check the connected wallet and chain before each request, explicitly pin chain ID, simulate calls and estimate gas, require successful receipts, and invalidate reviews on wallet changes. Spending maxima and withdrawal minima use SDK slippage math. No real transactions were broadcast during development verification. Indexer failure is shown; manual import remains available. Refresh positions rechecks pending transaction receipts; explorer links also show final status.

## Wallet token picker

Connecting a wallet loads indexed ERC-20 candidates and USD prices from the public pons portfolio API through `/api/lp-wallet-tokens?address=...`. The connected public address is shared with `balancesapi.ponsfamily.com`; the wallet connection dialog discloses this. No private key, signature, or signing request is involved in discovery. The proxy validates the address, verifies the response wallet, limits candidates to 200, and returns private/no-store responses. Native ETH and RWI itself are excluded from the other-side picker.

The browser reads each candidate's current balance and decimals directly from Robinhood Chain. It sorts by **balance × USD unit price**, using integer arithmetic with 36 decimal places, never by unit price. Zero balances are hidden; missing or stale USD prices sort last and say unavailable. Partial discovery, balance failures, empty lists, and source errors remain distinct, with manual address entry always available. Account/network changes and new refreshes invalidate previous requests. Holdings are refreshed after confirmed LP actions and can be refreshed manually from the picker. No wallet token list is persisted in browser storage.

`test-tokens.cjs` checks holdings-value ordering, decimals, values beyond JS safe integers, dust, missing and stale prices, filtering, API validation and error paths. `test-wallet.cjs` also covers stale portfolio responses after account changes and overlapping refresh requests.
