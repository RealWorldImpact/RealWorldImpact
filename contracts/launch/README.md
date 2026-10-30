# RWI Launch

Gas-only token creation on Robinhood Chain (4663), with ETH-facing trades routed through RWI. This is a new, independently implemented Uniswap v4 launch factory, not the Pons launch factory. It is not active until a deployment is verified and `scripts/lp/launch-config.js` is set to its address.

## Economics and custody

- Each launch creates a standard, fixed-supply ERC-20: 1 billion tokens with 18 decimals. There is no owner, further mint, blacklist, transfer tax, or creator premine in this token implementation.
- The creator supplies no RWI and pays no launch fee. Deployment, launches, trades, approvals, and fee collection require network gas.
- Token-only liquidity starts at a range boundary in a 1% Uniswap v4 token/RWI pool, tick spacing 200 and range width 46,000 ticks. The creator chooses the initial RWI-per-token price; the interface rounds it to an allowed boundary. The range spans roughly a 100× price change. If its token inventory is exhausted, additional liquidity is required for further purchases; it does not expand automatically.
- The factory permanently holds the position NFT and any token rounding dust. There is no transfer, liquidity withdrawal, upgrade, arbitrary call, or administrator function. `claimFees` decreases liquidity by zero and sends earned pool fees directly to the immutable creator. Anyone may trigger collection; they cannot change its recipient.
- These are separate RWI-paired pools, not one shared reserve. Pons uses a bonding curve and later graduation; this design starts directly on v4.

## ETH routing

The factory creates its router in the same deployment transaction. LP buys use native ETH → RWI → launched token. LP sells use launched token → RWI → native ETH. Wallets need no intermediate RWI balance or RWI approval. A sale may require an exact-amount approval for the launched token.

The router accepts only tokens registered by its factory. Pool keys, recipients, and the ETH/RWI route cannot be changed by callers. Both swaps occur in one PoolManager unlock, with exact input-consumption checks and a final minimum output. Failed swaps revert the whole trade. The router has no administrator, withdrawal function, arbitrary-call surface, or additional trading fee.

The existing native ETH/RWI pool is `0xa72a9de2c6e3db34308a8ae61e927ceffea630218ca1e712b70b61341c3e99a1`: native ETH/RWI, fee 0, spacing 200, hook `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`. Its hook fees apply in addition to the new token pool's 1% fee. Route availability depends on this existing pool and hook.

The interface quotes both hops through the deployed v4 Quoter and applies a 0.5% output tolerance. Every review displays the route, exact input, minimum output, recipient, router, and approval limit. Quotes expire, and transactions retain the LP interface's wallet, chain, simulation, and receipt checks.

The mandatory route applies to trades made through this router. These are unrestricted ERC-20 tokens: third parties can create other markets or use other routers. The contracts do not promise to control trading elsewhere.

## Build and verification

From `contracts/launch`, run `npm ci --ignore-scripts` and `npm run compile`. Solidity is pinned to 0.8.26, optimizer 200 runs, via-IR, Cancun. `compile.cjs` normalizes source line endings, checks runtime/initcode size limits, produces reproducible public bytecode in `assets/launch-contract.json`, and generates the ABI and code hashes in `scripts/lp/launch-contract.js`. The complete normalized compiler input is saved as `artifacts/standard-input.json` for explorer source verification.

Run a **local fork**, never a live network writer:

```powershell
$env:RWI_LAUNCH_FORK='1'
node node_modules/hardhat/internal/cli/cli.js node --hostname 127.0.0.1 --port 8899
```

In another terminal in this directory, run `npm test`. The test explicitly resets `http://127.0.0.1:8899` to a fresh Robinhood fork, deploys with local test accounts, and writes only to that local fork. The public RPC prunes old state, so reset before each run. It checks both token address orderings; native ETH buys and sells; exact Quoter/output agreement; two expected Swap events; zero trader RWI and zero router residual balances; locked principal; immutable creator fees; cleared launch approvals; capped sell approval consumption; invalid metadata, prices, deadlines, slippage, unknown tokens, and callback rejection.

From the repository root, run `npm --prefix scripts/lp test`, `node scripts/lp/build.cjs`, and `node contracts/launch/build-setup.cjs`. The browser/API tests cover metadata bounds, price rounding, inactive configuration, registry paging, and existing LP behavior. Local-fork testing is not an independent security audit.

## One-time activation

1. Serve the checkout locally and open `/contracts/launch/setup.html` in a browser with the deployment wallet. The helper uses the real Robinhood network. Connect the intended wallet on chain 4663.
2. The human wallet owner reviews and submits **Deploy launch factory and ETH router**. This sends 0 ETH to the constructor but spends network gas. Do not deploy a token or fund RWI as part of setup.
3. The helper compares creation bytecode to the compiled hash before sending and verifies the resulting runtime. Pending nonce/address/hash are saved before submission to prevent accidental duplicate deployment. Use **Check deployment status** after an interrupted or replaced transaction.
4. Independently check the receipt, deployed code hash, chain, `router()`, router's `factory()`, and the fixed Uniswap/RWI addresses. Check `launchCount()` and do not reuse a local fork address.
5. Set the verified live address in `scripts/lp/launch-config.js`, rebuild LP, run checks, and deploy the website. The browser and `/api/lp-launches` share this canonical address. The Launch tab lists the onchain registry, newest first, for every visitor; it does not depend on browser storage.

No private key or signing service is used by this project. Do not activate with an unverified address. The factory is immutable: changes require a reviewed new deployment and a deliberate registry migration.
