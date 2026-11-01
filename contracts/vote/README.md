# Dedicated RWI voting contract

Status: built and locally tested; not deployed or activated.

Bankr rejects the old ERC-20 transfer selector even when the amount is zero.
RWICommunityVote replaces that operation with standard `vote(uint64,string)`.
It emits `VoteCast(msg.sender,round,charity)` and performs no external call,
token operation, native payment, approval, storage write, proxy call or admin
operation. ETH attached to a vote is rejected. Only the deployment constructor
checks chain 4663; the deployment is pinned by address and exact runtime hash.

The contract validates syntax, not ballot membership or holdings. Anyone can
record a syntactically valid choice, but the advisory website tally accepts only
the current ballot and weights each wallet's latest choice by its live RWI
balance. These existing rules and old votes are preserved. Direct transactions
only are supported. Relayers and batched account calls need a separate design.

## Reproduce and test

From the repository root:

```
node contracts/vote/compile.cjs
node contracts/vote/build-setup.cjs
node scripts/test_vote_native.mjs
node scripts/test_vote_contract.mjs
node scripts/test_bankr_ballot.mjs
node scripts/test_vote_safety.mjs
node scripts/test_vote_setup.mjs
```

Native tests run an in-process Hardhat chain, with no mainnet writes. Review the
public report at `/integrations/bankr-voting-v3-verification.json`. Passing local
tests does not establish Bankr acceptance or eliminate every possible issue.

Deployment recovery uses IndexedDB, so a full localStorage cache cannot block
the setup. Existing v3 recovery keys are migrated without clearing site data.
An atomic durable claim must succeed before the wallet is asked to sign. Later
storage failures do not hide transaction hashes or confirmed results. The
browser harness `scripts/test_vote_storage_browser.js` checks real IndexedDB in
isolated, automatically cleaned-up databases on localhost; no wallet is used.

## Deployment and activation

1. Project owner opens `/contracts/vote/setup`, connects a wallet on Robinhood
   Chain, reviews gas, then explicitly signs the single deployment. Connection
   only estimates gas. No RWI is required and no approval is requested.
2. Run `node contracts/vote/verify-deployment.cjs <transaction-hash>` to compare
   transaction, receipt, canonical chain, creation bytecode and deployed runtime.
3. Verify source on the chain explorer using `standard-input.json`, contract
   `RWICommunityVote.sol:RWICommunityVote`, Solidity `0.8.26+commit.8a97fa7a`,
   optimizer 200 runs, Cancun EVM, no constructor arguments.
4. Independently confirm explorer verification. Only then update deployment.json
   with verified address/block/transaction, `status: active`, `sourceVerified:
   true`, and source-verification URL. Update the public transport manifest and
   guide status, publish, and verify the live v3 feed's target and calldata.
5. User updates the saved Bankr skill and submits one explicitly authorized vote.
   Verify its successful receipt and appearance in the live tally before
   describing Bankr integration as end-to-end verified.

Until activation the Bankr feed returns 503 with `ready:false`; it never suggests
the rejected transfer method. Self-custody website voting continues through the
existing path. Deployment cannot and does not change a user's Bankr security
settings. Do not retry a rejected request by disguising a token transfer.
