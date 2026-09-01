#!/usr/bin/env python3
"""GET-only census of Stripe prices that currently have billed subscriptions.

Finds every unique Price ID on subscriptions Stripe is still billing
(active / trialing / past_due / unpaid / paused, including
cancel_at_period_end) and checks each against ``recognized_stripe_prices``
plus configured ``STRIPE_*_PRICE_ID`` env. An active price missing from both
is the hung-out-to-dry shape: ``payment.py`` skips the Firestore write
(``skip_subscription_write``).

GET only. Never writes ``recognized_stripe_prices``. Live keys need
``--live-readonly``. Restricted keys need Subscriptions Read + Prices Read.

    python backend/scripts/census_stripe_billed_prices.py
    STRIPE_API_KEY=rk_live_… python backend/scripts/census_stripe_billed_prices.py \\
        --apply --live-readonly --output stripe-billed-price-census.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.dump_stripe_live_readonly import (  # noqa: E402
    FORBIDDEN_OUTPUT_NAMES,
    HTTP_TIMEOUT_SECONDS,
    KNOWN_PROD_PRICES,
    PAGE_SIZE,
    STRIPE_API_BASE,
    classify_key_kind,
    load_api_key,
    redact,
)

DEFAULT_CATALOG = BACKEND_DIR / "config" / "plan_catalog.json"
MAX_PAGES = 200
BILLED_STATUSES: Tuple[str, ...] = ("active", "trialing", "past_due", "unpaid", "paused")
LIVE_READONLY_BANNER = (
    "LIVE READ-ONLY billed-price census. HTTP GET only. No create/update/delete. "
    "Not writing recognized_stripe_prices."
)


def assert_output_path_ok(path: str) -> None:
    name = os.path.basename(path)
    if name in FORBIDDEN_OUTPUT_NAMES:
        raise SystemExit(f"Refusing to write {path} (catalog/fixture/ledger).")


def require_census_key(api_key: str, *, live_readonly: bool, allow_test_mode: bool) -> str:
    kind = classify_key_kind(api_key)
    if kind == "live" and not live_readonly:
        raise SystemExit(
            "Refusing a LIVE Stripe key. Pass --live-readonly for GET-only "
            "(GET /v1/subscriptions and GET /v1/prices/…). This script never writes."
        )
    if kind in ("sk_test", "rk_test") and not allow_test_mode:
        raise SystemExit(
            "This census is for LIVE billed customers. Refusing a test-mode key. "
            "Pass --allow-test-mode only to smoke GET against the destination test account."
        )
    if kind == "live" and allow_test_mode:
        raise SystemExit("Refusing --allow-test-mode with a LIVE key.")
    if kind not in ("sk_test", "rk_test", "live"):
        raise SystemExit("STRIPE_API_KEY is not a usable secret/restricted key (sk_/rk_ test or live).")
    return kind


def load_ledger(catalog_path: Path) -> Dict[str, Dict[str, str]]:
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    rows = payload.get("recognized_stripe_prices") or []
    ledger: Dict[str, Dict[str, str]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        price_id = row.get("price_id")
        if not isinstance(price_id, str) or not price_id:
            continue
        ledger[price_id] = {
            "plan_id": str(row.get("plan_id") or ""),
            "interval": str(row.get("interval") or ""),
            "environment": str(row.get("environment") or ""),
        }
    return ledger


def configured_env_prices(environ: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    env = os.environ if environ is None else environ
    mapping: Dict[str, str] = {}
    for spec in KNOWN_PROD_PRICES:
        raw = (env.get(spec["env_var"]) or "").strip()
        if not raw:
            continue
        mapping[raw] = spec["plan_id"]
    return mapping


def resolve_price(
    price_id: str,
    ledger: Dict[str, Dict[str, str]],
    configured: Dict[str, str],
) -> Dict[str, Optional[str]]:
    retained = ledger.get(price_id)
    env_plan = configured.get(price_id)
    retained_plan = retained["plan_id"] if retained else None
    if retained_plan and env_plan and retained_plan != env_plan:
        return {
            "resolution": "conflict",
            "resolved_plan_id": None,
            "ledger_plan_id": retained_plan,
            "ledger_environment": retained.get("environment"),
            "ledger_interval": retained.get("interval"),
            "env_plan_id": env_plan,
        }
    if retained_plan:
        return {
            "resolution": "retained",
            "resolved_plan_id": retained_plan,
            "ledger_plan_id": retained_plan,
            "ledger_environment": retained.get("environment"),
            "ledger_interval": retained.get("interval"),
            "env_plan_id": env_plan,
        }
    if env_plan:
        return {
            "resolution": "configured",
            "resolved_plan_id": env_plan,
            "ledger_plan_id": None,
            "ledger_environment": None,
            "ledger_interval": None,
            "env_plan_id": env_plan,
        }
    return {
        "resolution": "unresolved",
        "resolved_plan_id": None,
        "ledger_plan_id": None,
        "ledger_environment": None,
        "ledger_interval": None,
        "env_plan_id": None,
    }


def price_id_from_item(item: Dict[str, Any]) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    price = item.get("price")
    if isinstance(price, str) and price:
        return price, None
    if isinstance(price, dict) and price.get("id"):
        return str(price["id"]), price
    return None, None


class StripeCensusClient:
    """HTTP GET client. Subscriptions list + Price retrieve only. Body is a hard error."""

    def __init__(self, api_key: str, *, opener: Any = None):
        self.api_key = api_key
        self._opener = opener or urllib.request.urlopen
        self.calls: List[Tuple[str, str]] = []

    def _assert_allowed(self, path: str) -> None:
        if not path.startswith("/v1/"):
            raise SystemExit("Refusing a non-/v1/ Stripe path.")
        if path.startswith("/v1/prices/") and path != "/v1/prices/" and not path.startswith("/v1/prices?"):
            return
        if path == "/v1/subscriptions" or path.startswith("/v1/subscriptions?"):
            return
        raise SystemExit(f"Refusing GET {path}. This script only lists subscriptions and retrieves prices.")

    def get(self, path: str, params: Optional[Sequence[Tuple[str, str]]] = None) -> Dict[str, Any]:
        self._assert_allowed(path)
        query = urllib.parse.urlencode(params or [], doseq=True)
        url = f"{STRIPE_API_BASE}{path}"
        if query:
            url = f"{url}?{query}"
        req = urllib.request.Request(url, method="GET")
        req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Accept", "application/json")
        req.data = None
        self.calls.append(("GET", path))
        try:
            with self._opener(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
                body = resp.read()
                status = getattr(resp, "status", 200)
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            hint = ""
            if exc.code == 403 and path.startswith("/v1/subscriptions"):
                hint = (
                    " Grant Subscriptions Read on this LIVE restricted key "
                    "(Dashboard → API keys → restricted key → Subscriptions Read)."
                )
            raise SystemExit(redact(f"Stripe GET {path} failed HTTP {exc.code}: {err_body}.{hint}", self.api_key)) from None
        except Exception as exc:  # noqa: BLE001
            raise SystemExit(redact(f"Stripe GET {path} failed: {exc}", self.api_key)) from None
        if status >= 400:
            raise SystemExit(redact(f"Stripe GET {path} failed HTTP {status}: {body!r}", self.api_key))
        try:
            parsed = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Stripe GET {path} returned non-JSON.") from exc
        if not isinstance(parsed, dict):
            raise SystemExit(f"Stripe GET {path} returned a non-object.")
        return parsed

    def list_all(self, path: str, extra_params: Optional[Sequence[Tuple[str, str]]] = None) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        starting_after = None
        for _ in range(MAX_PAGES):
            params: List[Tuple[str, str]] = [("limit", str(PAGE_SIZE))]
            if extra_params:
                params.extend(extra_params)
            if starting_after:
                params.append(("starting_after", starting_after))
            page = self.get(path, params)
            data = page.get("data") or []
            items.extend(obj for obj in data if isinstance(obj, dict))
            if not page.get("has_more") or not data:
                break
            last_id = data[-1].get("id") if isinstance(data[-1], dict) else None
            if not last_id:
                break
            starting_after = last_id
        else:
            raise SystemExit(f"Stripe {path} pagination exceeded {MAX_PAGES} pages.")
        return items


def summarize_price_blob(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not raw:
        return {}
    recurring = raw.get("recurring") or {}
    product = raw.get("product")
    product_id = product.get("id") if isinstance(product, dict) else product if isinstance(product, str) else None
    return {
        "unit_amount": raw.get("unit_amount"),
        "currency": raw.get("currency"),
        "interval": recurring.get("interval") if isinstance(recurring, dict) else None,
        "nickname": raw.get("nickname"),
        "active": raw.get("active"),
        "livemode": raw.get("livemode"),
        "product_id": product_id,
    }


def collect_billed_prices(client: StripeCensusClient) -> Tuple[Dict[str, Dict[str, Any]], Counter]:
    buckets: Dict[str, Dict[str, Any]] = {}
    status_counts: Counter = Counter()
    expand = [("expand[]", "data.items.data.price")]
    for status in BILLED_STATUSES:
        subs = client.list_all("/v1/subscriptions", [("status", status), *expand])
        status_counts[status] = len(subs)
        for sub in subs:
            items = ((sub.get("items") or {}).get("data")) or []
            cancel_at_period_end = bool(sub.get("cancel_at_period_end"))
            for item in items:
                if not isinstance(item, dict):
                    continue
                price_id, blob = price_id_from_item(item)
                if not price_id:
                    continue
                row = buckets.setdefault(
                    price_id,
                    {
                        "price_id": price_id,
                        "subscription_count": 0,
                        "cancel_at_period_end_count": 0,
                        "statuses": Counter(),
                        "price": summarize_price_blob(blob),
                    },
                )
                row["subscription_count"] += 1
                row["statuses"][status] += 1
                if cancel_at_period_end:
                    row["cancel_at_period_end_count"] += 1
                if blob and not row["price"]:
                    row["price"] = summarize_price_blob(blob)

    missing_blobs = [price_id for price_id, row in buckets.items() if not row.get("price")]
    for price_id in missing_blobs:
        retrieved = client.get(f"/v1/prices/{price_id}")
        buckets[price_id]["price"] = summarize_price_blob(retrieved)
    return buckets, status_counts


def build_census(
    buckets: Dict[str, Dict[str, Any]],
    status_counts: Counter,
    ledger: Dict[str, Dict[str, str]],
    configured: Dict[str, str],
    *,
    key_kind: str,
    live_readonly: bool,
    http_methods: Sequence[str],
) -> Dict[str, Any]:
    prices: List[Dict[str, Any]] = []
    for price_id, row in sorted(buckets.items(), key=lambda item: (-item[1]["subscription_count"], item[0])):
        resolved = resolve_price(price_id, ledger, configured)
        statuses = dict(row["statuses"])
        prices.append(
            {
                "price_id": price_id,
                "subscription_count": row["subscription_count"],
                "cancel_at_period_end_count": row["cancel_at_period_end_count"],
                "statuses": statuses,
                **row["price"],
                **resolved,
            }
        )
    unresolved = [row for row in prices if row["resolution"] == "unresolved"]
    conflicts = [row for row in prices if row["resolution"] == "conflict"]
    return {
        "_meta": {
            "http_methods": sorted(set(http_methods)),
            "wrote_ledger": False,
            "key_kind": key_kind,
            "live_readonly": bool(live_readonly and key_kind == "live"),
            "billed_statuses": list(BILLED_STATUSES),
            "subscription_counts_by_status": dict(status_counts),
            "unique_price_count": len(prices),
            "unresolved_count": len(unresolved),
            "conflict_count": len(conflicts),
            "note": (
                "Counts billed Stripe subscriptions, not Firestore rows. "
                "Unresolved active prices skip payment.py subscription writes."
            ),
        },
        "prices": prices,
        "unresolved": [row["price_id"] for row in unresolved],
        "conflicts": [row["price_id"] for row in conflicts],
    }


def print_table(census: Dict[str, Any]) -> None:
    print("Billed Stripe prices (active/trialing/past_due/unpaid/paused). No customer ids.")
    print("Unresolved = hung-out-to-dry: webhook will not update the stored plan.")
    print("")
    print(
        f"{'res':<12} {'plan':<14} {'int':<6} {'cents':<8} {'subs':<6} "
        f"{'cap':<5} {'livemode':<9} {'price_id'}"
    )
    for row in census["prices"]:
        amount = row.get("unit_amount")
        amount_s = "—" if amount is None else str(amount)
        plan = row.get("resolved_plan_id") or "—"
        interval = row.get("interval") or row.get("ledger_interval") or "—"
        print(
            f"{row['resolution']:<12} {plan:<14} {interval:<6} {amount_s:<8} "
            f"{row['subscription_count']:<6} {row['cancel_at_period_end_count']:<5} "
            f"{str(row.get('livemode')):<9} {row['price_id']}"
        )
    meta = census["_meta"]
    print("")
    print(
        f"unique prices: {meta['unique_price_count']}  "
        f"unresolved: {meta['unresolved_count']}  conflicts: {meta['conflict_count']}"
    )
    print(f"subscriptions by status: {meta['subscription_counts_by_status']}")
    if census["unresolved"]:
        print("UNRESOLVED billed price ids:")
        for price_id in census["unresolved"]:
            print(f"  {price_id}")


def _print_dry_run(catalog_path: Path) -> None:
    ledger = load_ledger(catalog_path)
    print("Live billed-price census (GET /v1/subscriptions + GET /v1/prices/…)")
    print(f"  catalog ledger: {catalog_path} ({len(ledger)} recognized prices)")
    print(f"  billed statuses: {', '.join(BILLED_STATUSES)}")
    print("  cancel_at_period_end still counts (status remains active).")
    print("Restricted live key needs Subscriptions Read + Prices Read. Never write.")
    print("Dry-run only. Pass --apply --live-readonly with rk_live_ (GET only).")
    print("Test-account smoke: --apply --allow-test-mode (not production customers).")


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="GET billed subscriptions and resolve price ids (default dry-run).",
    )
    parser.add_argument(
        "--live-readonly",
        action="store_true",
        help="Required when STRIPE_API_KEY is live (rk_live_ / sk_live_). GET only.",
    )
    parser.add_argument(
        "--allow-test-mode",
        action="store_true",
        help="Allow sk_test_/rk_test_ to smoke GET (destination test account, not live customers).",
    )
    parser.add_argument("--api-key-file", help="Read the key from this file (first line). Prefer over argv.")
    parser.add_argument(
        "--output",
        default="stripe-billed-price-census.json",
        help="Write JSON here (never the repo ledger).",
    )
    parser.add_argument("--catalog", default=str(DEFAULT_CATALOG), help="plan_catalog.json for recognized_stripe_prices.")
    parser.add_argument("--json", action="store_true", help="Also print the JSON census to stdout.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    catalog_path = Path(args.catalog)
    if not args.apply:
        _print_dry_run(catalog_path)
        return 0

    assert_output_path_ok(args.output)
    api_key = load_api_key(args.api_key_file)
    kind = require_census_key(api_key, live_readonly=args.live_readonly, allow_test_mode=args.allow_test_mode)
    if kind == "live":
        print(LIVE_READONLY_BANNER, file=sys.stderr)
    else:
        print("TEST-MODE smoke census (not live billed customers).", file=sys.stderr)

    if not catalog_path.is_file():
        raise SystemExit(f"missing catalog {catalog_path}")
    ledger = load_ledger(catalog_path)
    configured = configured_env_prices()
    client = StripeCensusClient(api_key)
    buckets, status_counts = collect_billed_prices(client)
    methods = [method for method, _path in client.calls]
    if any(method != "GET" for method in methods):
        raise SystemExit(f"Refusing to finish: HTTP methods were {methods}, expected GET only.")
    census = build_census(
        buckets,
        status_counts,
        ledger,
        configured,
        key_kind=kind,
        live_readonly=args.live_readonly,
        http_methods=methods,
    )
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(census, fh, indent=2)
        fh.write("\n")
    print(f"Wrote {args.output}", file=sys.stderr)
    if args.json:
        print(json.dumps(census, indent=2))
    else:
        print_table(census)
    if census["_meta"]["unresolved_count"] or census["_meta"]["conflict_count"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
