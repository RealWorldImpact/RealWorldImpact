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
