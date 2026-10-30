# RWI LP

Browser-only Uniswap v4 liquidity interface at `/LP`, chain 4663. Every supported pool includes RWI (`0xda2598c976e62e7e15dcca75169b404712e48b04`). Transactions are sent only by a connected wallet. No private keys, custody, server signing, or automatic transactions.

## Build and checks

From this directory run `npm ci`, `npm test`, then `npm run build`. The checked-in `assets/lp.js` bundle is served directly by Vercel. Keep JSBI at 3.2.5 so the Uniswap SDKs share one integer implementation.

Addresses come from [Uniswap deployments](https://developers.uniswap.org/docs/protocols/v4/deployments). PositionManager's PoolManager and Permit2 references were checked onchain. The official v4 SDK constructs calldata. Tests decode initialization and mint calldata, verify spending limits, exercise different decimals and fee tiers, and mock wallet/receipt failures without broadcasting transactions.

## Supported operations

- Initialize a new pool and mint full-range liquidity atomically; add another position to an existing pool.
- Read the current pool state through StateView.
- Import owned positions by ID, with automatic onchain discovery and locally saved receipt IDs for positions created here.
- Withdraw liquidity or collect fees for owned RWI positions without hooks. A 100% withdrawal retains the empty position receipt.
- Approve tokens to Permit2, then authorize PositionManager with expiring, capped limits. Existing larger allowances are not reduced; some existing allowances require a reset transaction.

## Scope

The Add liquidity workflow creates pools with no hooks, independently of the existing Pons launch pool. It does not copy Pons' creator-tax or donation logic. Each token/RWI pool has its own reserves and fees. Native ETH is represented by WETH in that workflow. User-selected concentrated ranges and transfer-tax/rebasing tokens are not supported. Uniswap position receipts are ERC-721 ownership records, not collectible launches. The separate Launch workflow below uses a fixed token-only range and native ETH routing.

## Launch and ETH trading

Launch replaces the Transactions tab and retains the browser's receipt history in an expandable section. The canonical factory is deliberately inactive until its real deployment is verified. Creators pay gas only, supply no RWI, and receive fees from a permanently locked 1% token/RWI position. All factory launches are listed automatically from its public registry, newest first.

Trades on Launch use ETH → RWI → launched token for buys and the reverse for sells, with onchain two-hop quotes and a minimum output. This restriction is enforced by the LP router; unrestricted ERC-20 trading elsewhere cannot be controlled. See `contracts/launch/README.md` for economics, security boundaries, reproducible contract builds, fork tests, and the one-time wallet deployment procedure. These custom contracts have not undergone an independent audit.

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

Deposit amount controls use 0–100% of each selected token’s fresh wallet balance. Raw token units are calculated with integer arithmetic and rounded down; 100% cannot exceed holdings. The form displays estimated USD values rather than token quantities. Prices are fetched by token address through /api/lp-token-prices; missing quotes display USD unavailable. Wallet/network changes reset percentages and balances, changing the paired token resets its slider, and review refreshes balances before applying percentages. Existing spending caps and 0.5% slippage remain in effect.

Featured pools appear above the LP form. /api/lp-featured-pools reads GeckoTerminal’s Robinhood RWI token-pools feed, verifies the exact RWI address, filters for positive reported 24-hour USD volume and liquidity, deduplicates and ranks numerically, and returns up to three pools. The feed covers indexed venues, not just this form’s supported Uniswap configurations; cards link to the original market page. Successful results are cached for 60 seconds, and outages may use a labeled cached result for up to five minutes. The feed paginates up to 100 records and flags capped coverage. The section has loading, empty, unavailable, refresh, and mobile states.

The deposit sliders are linked by USD value in both directions. Moving one computes its raw token amount, matches the other using integer price arithmetic, and caps both to the smaller available USD holding. The calculated raw amounts are retained independently of the rounded percentage labels. Missing/zero USD quotes disable matching. Token/wallet changes reset both selections, and refreshed balances/prices invalidate an outdated deposit review.

Every featured card has an Add liquidity action opening Uniswap’s pool-specific /positions/add/robinhood/{poolIdOrAddress} route. The exact ID is preserved, and Uniswap resolves the pool’s currencies, fee, tick spacing, and hook. The leading Pons pool’s native ETH and V2MemeHook were verified in Uniswap’s deposit route. This avoids substituting the LP form’s WETH/no-hook pool. Wallet approval remains with the user on Uniswap.

Wallet continuity stores only the selected connector name/reverse-DNS identifier in localStorage. On return, the matching provider is restored with eth_accounts; restoration never requests new wallet authorization or switches networks automatically. Late EIP-6963 announcements can restore the saved connector. LP tabs share the active provider, while explicit disconnect clears the saved choice and invalidates pending connection attempts. Uniswap is a separate origin and retains its own wallet session.

My positions loads on connection/restoration and on entering the section, then updates every 30 seconds while open and when the window regains focus. Confirmed LP actions trigger an update. Discovery reads wallet-filtered incoming ERC-721 Transfer logs from the verified PositionManager in bounded RPC ranges, then verifies current ownership and the exact RWI pair. Incremental scans include a 16-block overlap. Failed discovery retries automatically, retains known positions, and cannot overwrite a newer wallet session. The refresh button is removed; receipt-ID lookup remains collapsed as an optional fallback. Native-ETH/custom-hook positions are listed with external-management labels rather than silently skipped. Cards show in-range/out-of-range/empty states.

Position loading batches owner/key/liquidity reads in Multicall3, fetches each token’s metadata once, and reads each distinct funded pool once. Empty positions skip pool snapshots. Known receipt IDs are verified and displayed concurrently with new-history discovery. Successful history checkpoints are persisted per wallet, so return visits only scan the new tail with a reorg overlap. Every action still rechecks ownership and live position data before signing.

Withdrawal percentage is chosen per position: Withdraw opens a 0–100% slider dialog (initially 25%), with zero disabling Review. The selected percentage is passed explicitly into the fresh onchain withdrawal review; the global dropdown is removed. Wallet/session changes close the selection, and position ownership/liquidity are rechecked before review and execution.

Position cards display prominent estimated USD principal, paired artwork, token balances, fee tier and range state, and sort by total USD value descending using integer valuation. Unclaimed fees are explicitly excluded. Market prices load independently from the onchain list and are reused for 60 seconds. If an independent paired-token quote is missing, the pool ratio can value it against a priced RWI amount and is labeled Pool-based estimate; unpriceable positions say USD unavailable and sort last. Empty positions show zero. Tests cover decimal precision, value ordering and unavailable/estimated prices.

My positions hides zero-liquidity receipts and omits the In range badge. Each funded supported position has Add liquidity, which opens the LP form in existing-position mode, locks its pool fee, and preserves the receipt’s tick range. Review and execution recheck ownership and range; SDK calldata uses INCREASE_LIQUIDITY with the existing token ID, rather than minting another receipt. Slippage maxima for narrow ranges are scaled down to stay within both selected spending limits. Changing the token or wallet, or selecting Create a new position instead, clears this mode. Native/custom-hook positions link to their exact Uniswap position page.

Position cards include 24-hour pool volume and uncollected fees. Fees are computed from StateView.getPositionInfo(poolId, PositionManager, ticks, bytes32(tokenId)) and getFeeGrowthInside in the same Multicall3 read, using uint256 modular growth deltas times liquidity / 2^128, per https://developers.uniswap.org/docs/protocols/v4/guides/managing-liquidity/calculate-fees. Fee token quantities and estimated USD value are shown separately from principal. /api/lp-pool-volume finds the first block within the last 24 hours, reads exact-pool Swap events, and sums absolute raw amounts without double counting both token legs. The card converts the RWI leg at the current USD quote and labels that estimate. Pool volume loads separately and caches for 60 seconds; failures say Unavailable. The redundant positions-update sentence is removed.


## LP security review — 2026-10-29

Reviewed wallet connection/session changes, approval planning, atomic/sequential deposits, withdrawals/fee collection, metadata/logo retrieval, API input boundaries, saved activity rendering, pricing, and position discovery. The complete test command now includes batch and security regression checks. Browser verification uses a local read-only wallet fixture; it cannot submit signatures or transactions.

- Atomic deposits require EIP-5792 chain-specific support and atomicRequired=true. Exact approval/reset calls precede SDK deposit calldata. Saved request IDs prevent automatic resubmission after uncertain responses. Status IDs must match, networks must match, and successful atomic receipts must contain valid hashes and logs. Corrupt saved requests block sending rather than being silently discarded. Unsupported wallets retain sequential approvals.
- Activity records from browser storage and wallet receipts are validated and bounded before rendering. Transaction URLs accept only 32-byte hashes, and HTML attributes are escaped. Confirmation after switching wallets stops before updating the new wallet's positions. Disconnect events detach the old provider and invalidate its session.
- /LP and /LP.html enforce a self-only script CSP, restricted RPC connections, no embedding, no objects/base overrides, MIME sniffing protection, and no outgoing referrer. Third-party HTTPS token images and Google font styles remain allowed. These policies are scoped to LP.
- Deposit review is disabled until connected-wallet amounts and pool data are valid; disconnected review opens wallet selection. Review expiry wording now correctly describes preparation time. Native controls and the page scrollbar use the dark theme. Server price caching is bounded to 500 entries.

Dependency review: patched @ethersproject/providers' pinned ws dependency from 8.18.0 to the compatible 8.22.0 release through a scoped override. npm audit still reports 30 transitive dependency findings (18 low, 2 moderate, 10 high). Bundle analysis confirms the flagged Hardhat tooling dependencies (undici, adm-zip, serialize-javascript, tmp, uuid, cookie, diff and busboy) are not shipped in the browser, and ws is absent from the browser bundle. The SDK still brings elliptic into the bundle with an upstream low-severity advisory; LP does not perform private-key signing with it, relying on the user's wallet. No forced major-version upgrades were applied to financial SDKs. Remaining upstream findings require continued monitoring; this review is not an independent contract audit or a guarantee of absence of vulnerabilities.
