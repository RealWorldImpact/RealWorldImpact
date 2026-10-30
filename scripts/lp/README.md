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

Connecting a wallet loads indexed ERC-20 candidates and USD prices from the public pons portfolio API through `/api/lp-wallet-tokens?address=...`. The connected public address is shared with `balancesapi.ponsfamily.com`; the wallet connection dialog discloses this. No private key, signature, or signing request is involved in discovery. The proxy validates the address, verifies the response wallet, limits Pons candidates to 200, and returns private/no-store responses. Public Uniswap v4 market candidates supplement the feed through read-only Multicall3 balance checks on Robinhood RPC. Only held tokens receive address-matched GeckoTerminal prices; that provider receives token addresses, never the wallet address. The checked-in market catalog includes weallmfers and is a bounded snapshot, not a complete chain index, so the API explicitly reports partial coverage. Either source can still return holdings if the other fails. Native ETH and RWI itself are excluded from the other-side picker.

The browser reads each candidate's current balance and decimals directly from Robinhood Chain. It sorts by **balance × USD unit price**, using integer arithmetic with 36 decimal places, never by unit price. Zero balances are hidden; missing or stale USD prices sort last and say unavailable. Partial discovery, balance failures, empty lists, and source errors remain distinct, with manual address entry always available. Account/network changes and new refreshes invalidate previous requests. Holdings are refreshed after confirmed LP actions and can be refreshed manually from the picker. No wallet token list is persisted in browser storage.

`test-tokens.cjs` checks holdings-value ordering, decimals, values beyond JS safe integers, dust, missing and stale prices, filtering, API validation and error paths. `test-wallet.cjs` also covers stale portfolio responses after account changes and overlapping refresh requests.

## Token logos

The selected token tries wallet-provided artwork, address-specific Dexscreener and Robinhood CDN images, plus `/api/lp-token-logo` results. The resolver matches Robinhood's official `/rhj/assets` registry by chain 4663 and contract address, reads `logo()`, `getTokenInfo()`, and `tokenURI()` through read-only RPC calls, parses IPFS or inline JSON metadata, and checks GeckoTerminal's address-matched image. Image failures and timeouts advance to the next URL. IPFS images have multiple gateway candidates. The fallback remains initials if no usable artwork has been published.

The backend never fetches an arbitrary token-provided HTTP URL: metadata retrieval is restricted to a validated IPFS path on a fixed gateway, with timeouts and size limits. Logos from another token in the same trading pair are never used. `test-logos.cjs` covers source matching, ABI bounds, IPFS path validation, unavailable sources and caching, including the weallmfers address-specific fallback.

Logo candidates prefer high-resolution Dexscreener images (`size=xl`, verified 800px) and large CoinGecko artwork, retaining original URLs as fallbacks. RWI uses the exact 800px logo already embedded in the homepage, saved as a shared local asset. LP badges, sidebar and favicons use that brand artwork rather than letter placeholders.

## Logo loading performance

Logo loading starts as soon as a token address is selected, independently of contract verification and pool reads. Sources race with bounded concurrency; high-resolution successes are cached in page memory, and updating token details does not restart or replace an already-sharp image. Background metadata can add missing sources without delaying the initial image. The default WETH identity is rendered in HTML and its small local artwork is preloaded, so it does not wait for JavaScript, RPC, IPFS, or metadata APIs.

The bundled WETH icon is the sharp asset from [Uniswap's WETH asset entry](https://raw.githubusercontent.com/Uniswap/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png). The Robinhood-specific market-data thumbnail was visibly blurry at its source; requesting a larger derivative did not recover its detail.

`test-logo-loader.cjs` verifies parallel sources, cached results, sharp-image preference, cancellation and failed sources. The wallet harness verifies that the initial logo starts while pool/metadata promises are still pending.

The token picker uses the same thin lime scrollbar styling as the homepage receipts and dark Vote dialogs. List rows use the shared high-resolution logo loader and cache. IntersectionObserver starts images only for visible/nearby rows; missing initial sources can use the shared address-matched metadata resolver. Closing, searching, refreshing or changing wallets cancels detached row updates. The list flexes to fit the dialog before an outer scrollbar is needed.

The add-liquidity form applies full-range positions and 50 bps (0.5%) slippage automatically, matching the Uniswap v4 SDK liquidity example at https://developers.uniswap.org/docs/liquidity/overview. There are no slippage or range controls in the form. Deposit and withdrawal previews still show the protection and spending limits before signing.

Wallet selection prefers EIP-6963 announcements and uses legacy injection only when no announced wallet is available. Provider references are deduplicated. Holdings balances and decimals are verified together through read-only Multicall3 batches (100 tokens per call); reverted token reads remain isolated. Refreshes retain the current wallet list while updating, and session guards discard stale responses. Market pricing reuses portfolio prices before requesting missing quotes. test-wallet-loading.cjs verifies provider deduplication and a 53-token list with one RPC call.
