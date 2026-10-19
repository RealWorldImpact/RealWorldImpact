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

The write-in fee remains quoted in USD and paid in RWI. Its existing verification uses the live token price with the existing 20% price-movement tolerance; it is not a historical USD-price oracle.
