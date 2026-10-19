# Real World Impact website

This repository publishes [rwihood.org](https://www.rwihood.org/), a public informational site for $RWI. It uses static HTML with a few read-only data proxies. The site does not accept agent tasks or HTTP transaction requests.

## Public machine-readable files

- [`llms.txt`](llms.txt) describes the pages, verification sources, and limits for AI agents.
- [`data/site.json`](data/site.json) contains stable project facts and source links.
- [`data/donations.json`](data/donations.json) contains the published donation ledger. Each record has its transaction or receipt link and announcement link.
- [`robots.txt`](robots.txt) allows crawling; [`sitemap.xml`](sitemap.xml) lists canonical public pages.

The homepage and docs include the donation records directly in HTML, so basic crawlers can read them without JavaScript. Burn and holder reward figures come from live external sources and should be checked at those sources.

## Publishing a donation

1. Add the recipient, reported USD amount, UTC date, transaction or receipt URL, and announcement URL to `data/donations.json`. Update `updatedThrough` to the latest date.
2. Run `python scripts/sync_donations.py` to update the static homepage and docs ledger rows and totals.
3. Run `python scripts/sync_donations.py --check` before publishing.

This keeps the human-readable ledger and JSON feed synchronized. Wallet transactions are made through the wallet owner’s own signing flow, outside this website’s HTTP interface.

## Voting charity sources

`/vote` supports the existing Giving Block directory and active, onboarded Donate.gg charities. `/api/donate-charities` reads Donate.gg's public API with `publicOnly=true` and `directDonationOnly=true`, follows pagination, and additionally requires `status=ACTIVE_ONBOARDED` and `isEnabled=true`. Results are cached for five minutes; no API key is required. Unclaimed, disabled, and reviewing-terms records are excluded.

Donate.gg onchain choices use `gg-<charity-id>` rather than profile slugs, so renames and cross-platform slug collisions do not change ballot identities. The bundled `data/donate-gg-charities.json` snapshot (also embedded in the voting page) resolves known ballot records immediately. Live verification is required before a new Donate.gg write-in or automatic selection. A failed refresh leaves Giving Block choices available. New automatic slates rotate one eligible Donate.gg charity into an automatic slot; already declared slates are not rewritten. The full $5 write-in fee remains a burn.

Run `node scripts/test_donate_charities.mjs` to check claimed-only filtering, pagination, failure handling, mixed-source choices, and automatic rotation.

## Voting reliability checks

Run `node scripts/test_vote_safety.mjs` for pending/reverted receipts, wallet/network changes, duplicate submission prevention, live-balance cache expiry, manual refresh, and visible refresh failures. These checks use mocked wallets and do not submit transactions. Indexed votes require a confirmed successful status. Write-in verification queries only RWI burns and matches burns after each nomination, including transaction order for same-block payments. Balance weights cache for at most 30 seconds; manual refresh bypasses that cache.

The write-in fee is quoted once in USD and burned in RWI. `/api/write-in-quote` uses a completed historical USD candle from the active RWI/WETH pool, with a two-minute indexing buffer. New nominations record `RWIWRITEIN:<round>:<charity-key>:<quoteAt>`. The quote must be within 15 minutes before the mined nomination; both payment and verification use the same exact token units. A quote that expires before confirmation is stopped before any burn. No later token price participates in eligibility. Legacy nominations without a quote timestamp use a historical quote anchored to their onchain timestamp, retaining the old 20% tolerance only for those older records. The historical price provider must be reachable for an uncached verification; there is no fallback to current prices.

Run `node scripts/test_write_in_quote.mjs` to verify exact token arithmetic, completed-candle selection, and rejection of later market prices.

## Current-round participants

The voter list beneath the ballot uses the tally's latest successful vote per wallet and its live-balance weights; it makes no extra chain requests. Rows include the explorer-linked wallet, current charity choice, voting weight, and share of the counted total. Zero balances and unavailable balances remain distinct. Refreshing the tally updates the list; a round change clears old participants. Run `node scripts/test_vote_participants.mjs` for participant filtering, sorting, escaping, and empty/loading states.
