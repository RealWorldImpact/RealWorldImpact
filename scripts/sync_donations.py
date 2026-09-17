"""Render the public HTML ledger from data/donations.json.

Run `python scripts/sync_donations.py` after adding a donation. Use --check in
review or CI to ensure the readable pages match the machine-readable ledger.
"""

from __future__ import annotations

import argparse
from datetime import date
from decimal import Decimal
from html import escape
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "donations.json"


def money(amount: Decimal) -> str:
    return f"${amount:,.2f}"


def load_rows() -> list[dict]:
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    assert payload["currency"] == "USD"
    rows = payload["donations"]
    assert rows and isinstance(rows, list)
    seen = set()
    for row in rows:
        assert set(row) == {"recipient", "amountUsd", "date", "transactionUrl", "announcementUrl"}
        assert row["recipient"].strip()
        assert Decimal(str(row["amountUsd"])) > 0
        assert date.fromisoformat(row["date"])
        assert row["transactionUrl"].startswith("https://")
        assert row["announcementUrl"].startswith("https://")
        assert row["transactionUrl"] not in seen
        seen.add(row["transactionUrl"])
    assert payload["updatedThrough"] == max(row["date"] for row in rows)
    return sorted(rows, key=lambda row: (row["date"], Decimal(str(row["amountUsd"]))), reverse=True)


def render_home(rows: list[dict]) -> str:
    result = []
    for row in rows:
        name = escape(row["recipient"])
        day = escape(row["date"])
        tx = escape(row["transactionUrl"], quote=True)
        post = escape(row["announcementUrl"], quote=True)
        amount = money(Decimal(str(row["amountUsd"])))
        result.append(
            f'        <div class="receipt"><span class="r-name">{name}</span>'
            f'<time class="r-date" datetime="{day}">{day}</time>'
            f'<span class="r-amt">{amount}</span><span class="r-links">'
            f'<a href="{tx}" target="_blank" rel="noopener" data-i18n="index.receipt.tx">Transaction ↗</a>'
            f'<a href="{post}" target="_blank" rel="noopener" data-i18n="index.receipt.announce">Announcement ↗</a>'
            '</span></div>'
        )
    return "\n".join(result)


def render_docs(rows: list[dict]) -> str:
    result = []
    for row in rows:
        name = escape(row["recipient"])
        day = escape(row["date"])
        amount = money(Decimal(str(row["amountUsd"])))
        result.append(
            f'        <div class="row"><div class="name">{name}</div>'
            f'<time class="date mono" datetime="{day}">{day}</time>'
            f'<div class="amt mono">{amount}</div></div>'
        )
    return "\n".join(result)


def replace_one(value: str, pattern: str, replacement: str, label: str) -> str:
    value, count = re.subn(pattern, lambda match: match.expand(replacement), value, count=1, flags=re.S)
    assert count == 1, label
    return value


def synced(name: str, rows: list[dict]) -> tuple[Path, str, str]:
    path = ROOT / name
    before = path.read_bytes().decode("utf-8")
    after = before
    line_end = "\r\n" if before.count("\r\n") > before.count("\n") / 2 else "\n"
    body = render_home(rows) if name == "index.html" else render_docs(rows)
    after = replace_one(
        after,
        r"<!-- DONATIONS:START -->.*?<!-- DONATIONS:END -->",
        "<!-- DONATIONS:START -->" + line_end + body.replace("\n", line_end)
        + line_end + "<!-- DONATIONS:END -->",
        f"{name} ledger markers",
    )
    total = money(sum((Decimal(str(row["amountUsd"])) for row in rows), Decimal("0")))
    if name == "index.html":
        for item_id, text in [
            ("heroDonationTotal", total),
            ("ledgerTotal", total),
            ("ledgerCount", str(len(rows))),
            ("ledgerCharities", str(len({row["recipient"] for row in rows}))),
        ]:
            after = replace_one(
                after,
                rf'(<[^>]+id="{item_id}"[^>]*>).*?(</[^>]+>)',
                rf'\g<1>{text}\g<2>',
                item_id,
            )
    else:
        after = replace_one(
            after,
            r'(<[^>]+id="wpLedgerTotal"[^>]*>).*?(</[^>]+>)',
            rf'\g<1>{total}\g<2>',
            "wpLedgerTotal",
        )
    return path, before, after


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rows = load_rows()
    for name in ("index.html", "docs.html"):
        path, before, after = synced(name, rows)
        if args.check and before != after:
            raise SystemExit(f"{name} differs from data/donations.json; run this script")
        if not args.check and before != after:
            path.write_bytes(after.encode("utf-8"))
    print(f"Ledger synchronized: {len(rows)} donations, "
          f"{money(sum((Decimal(str(row['amountUsd'])) for row in rows), Decimal('0')))}")


if __name__ == "__main__":
    main()
