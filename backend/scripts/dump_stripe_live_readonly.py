#!/usr/bin/env python3
"""GET-only dump of a Stripe account catalog. Stdlib only — download and run.

Use this on a machine that actually has the live restricted key. Cloud Agent
runtime secrets do not inject into an already-running VM.

The key needs Products Read + Prices Read. It must never have write.

    export STRIPE_API_KEY='rk_live_…'          # do not commit; do not put on argv
    python3 dump_stripe_live_readonly.py --live-readonly --output stripe-prod-catalog.json

    python3 dump_stripe_live_readonly.py --live-readonly \\
        --api-key-file ~/.stripe-rk-live --output stripe-prod-catalog.json

This script only issues HTTP GET to /v1/products and /v1/prices. It never
creates, updates, or deletes. It never writes recognized_stripe_prices.

Stripe ids are account-scoped. Recreate matching Products + Prices on the
destination account; do not paste these ids there.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

STRIPE_API_BASE = "https://api.stripe.com"
MAX_PAGES = 50
PAGE_SIZE = 100
HTTP_TIMEOUT_SECONDS = 30

# Latest recognized prod rows from config/plan_catalog.json. Used when the
# restricted key cannot list the whole account, and to label the dump.
KNOWN_PROD_PRICES: Tuple[Dict[str, str], ...] = (
    {
        "plan_id": "unlimited",
        "display_name": "Neo",
        "interval": "month",
        "env_var": "STRIPE_UNLIMITED_MONTHLY_PRICE_ID",
        "price_id": "price_1TNIHd1F8wnoWYvwkIrekcQZ",
    },
    {
        "plan_id": "unlimited",
        "display_name": "Neo",
        "interval": "year",
        "env_var": "STRIPE_UNLIMITED_ANNUAL_PRICE_ID",
        "price_id": "price_1TNIHd1F8wnoWYvwlKywJ8TO",
    },
    {
        "plan_id": "architect",
        "display_name": "Architect",
        "interval": "month",
        "env_var": "STRIPE_ARCHITECT_MONTHLY_PRICE_ID",
        "price_id": "price_1TAfBB1F8wnoWYvw8XBFM1dX",
    },
    {
        "plan_id": "architect",
        "display_name": "Architect",
        "interval": "year",
        "env_var": "STRIPE_ARCHITECT_ANNUAL_PRICE_ID",
        "price_id": "price_1TLFac1F8wnoWYvwtPxZhtzE",
    },
    {
        "plan_id": "operator",
        "display_name": "Operator",
        "interval": "month",
        "env_var": "STRIPE_OPERATOR_MONTHLY_PRICE_ID",
        "price_id": "price_1TMxVM1F8wnoWYvw9uaoYX7V",
    },
    {
        "plan_id": "operator",
        "display_name": "Operator",
        "interval": "year",
        "env_var": "STRIPE_OPERATOR_ANNUAL_PRICE_ID",
        "price_id": "price_1TMxVM1F8wnoWYvwNfXdF6LW",
    },
    {
        "plan_id": "plus",
        "display_name": "Plus",
        "interval": "month",
        "env_var": "STRIPE_PLUS_MONTHLY_PRICE_ID",
        "price_id": "price_1TuH6z1F8wnoWYvw7Siv61SX",
    },
    {
        "plan_id": "plus",
        "display_name": "Plus",
        "interval": "year",
        "env_var": "STRIPE_PLUS_ANNUAL_PRICE_ID",
        "price_id": "price_1TuHCw1F8wnoWYvwZvKu86sI",
    },
    {
        "plan_id": "unlimited_v2",
        "display_name": "Unlimited",
        "interval": "month",
        "env_var": "STRIPE_UNLIMITED_V2_MONTHLY_PRICE_ID",
        "price_id": "price_1TuIa81F8wnoWYvw0iX0j5M8",
    },
    {
        "plan_id": "unlimited_v2",
        "display_name": "Unlimited",
        "interval": "year",
        "env_var": "STRIPE_UNLIMITED_V2_ANNUAL_PRICE_ID",
        "price_id": "price_1TuIap1F8wnoWYvwHWq0EvNU",
    },
)

KNOWN_PRODUCTS: Tuple[Dict[str, str], ...] = (
    {"plan_id": "unlimited", "product_id": "prod_SmpevIU38nIEUO"},
    {"plan_id": "unlimited", "product_id": "prod_UM0IIpZ4iOgfk5"},
    {"plan_id": "architect", "product_id": "prod_U8x5HNGnTF50X1"},
    {"plan_id": "operator", "product_id": "prod_ULep5SEo0pSdaM"},
    {"plan_id": "plus", "product_id": "prod_Uu5HDt3sygCK8N"},
    {"plan_id": "unlimited_v2", "product_id": "prod_Uu6nrHIKWnnTWL"},
)

SUPERSEDED_PROD_PRICES: Tuple[Dict[str, str], ...] = (
    {"plan_id": "unlimited", "interval": "month", "price_id": "price_1RtJPm1F8wnoWYvwhVJ38kLb"},
    {"plan_id": "unlimited", "interval": "year", "price_id": "price_1RtJQ71F8wnoWYvwKMPaGlGY"},
)

FORBIDDEN_OUTPUT_NAMES = frozenset(
    {
        "plan_catalog.json",
        "plan_catalog_generated.py",
        "stripe_catalog_snapshot.json",
        "recognized_stripe_prices",
    }
)

LIVE_READONLY_BANNER = (
    "LIVE READ-ONLY dump. HTTP GET only. No create/update/delete. " "Not writing recognized_stripe_prices."
)

PRODUCT_FIELDS = (
    "id",
    "name",
    "active",
    "description",
    "metadata",
    "livemode",
    "type",
    "default_price",
    "unit_label",
    "statement_descriptor",
)
PRICE_FIELDS = (
    "id",
    "nickname",
    "active",
    "currency",
    "unit_amount",
    "unit_amount_decimal",
    "type",
    "recurring",
    "metadata",
    "livemode",
    "tax_behavior",
    "billing_scheme",
    "lookup_key",
    "transform_quantity",
    "tiers_mode",
)


def redact(text: str, api_key: str = "") -> str:
    """Strip a secret from error text. Never print the key."""
    out = text
    if api_key:
        out = out.replace(api_key, "[redacted]")
    for marker in ("sk_live_", "rk_live_", "sk_test_", "rk_test_", "pk_live_", "pk_test_"):
        while True:
            idx = out.find(marker)
            if idx < 0:
                break
            end = idx
            while end < len(out) and (out[end].isalnum() or out[end] in "_-"):
                end += 1
            out = out[:idx] + marker + "[redacted]" + out[end:]
    return out


def classify_key_kind(api_key: str) -> str:
    if api_key.startswith("sk_test_"):
        return "sk_test"
    if api_key.startswith("rk_test_"):
        return "rk_test"
    if api_key.startswith("pk_test_"):
        return "pk_test"
    if any(marker in api_key.lower() for marker in ("sk_live_", "rk_live_", "pk_live_", "_live_")):
        return "live"
    return "unknown"


def load_api_key(api_key_file: Optional[str]) -> str:
    if api_key_file:
        with open(api_key_file, encoding="utf-8") as fh:
            raw = fh.read().strip()
        if not raw:
            raise SystemExit(f"--api-key-file {api_key_file} is empty.")
        return raw.splitlines()[0].strip()
    api_key = os.getenv("STRIPE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set STRIPE_API_KEY or pass --api-key-file. Do not put the key on argv.")
    return api_key


def require_readonly_key(api_key: str, *, live_readonly: bool) -> str:
    kind = classify_key_kind(api_key)
    if kind == "live" and not live_readonly:
        raise SystemExit(
            "Refusing a LIVE Stripe key. Pass --live-readonly for GET-only "
            "(GET /v1/products and GET /v1/prices). This script never writes."
        )
    if kind not in ("sk_test", "rk_test", "live"):
        raise SystemExit("STRIPE_API_KEY is not a usable secret/restricted key (sk_/rk_ test or live).")
    return kind


def pick_fields(obj: Dict[str, Any], fields: Sequence[str]) -> Dict[str, Any]:
    return {key: obj.get(key) for key in fields if key in obj}


def product_id_and_name(product: Any) -> Tuple[Optional[str], Optional[str]]:
    if isinstance(product, dict):
        return product.get("id"), product.get("name")
    if isinstance(product, str):
        return product, None
    return None, None


def summarize_price(raw: Dict[str, Any]) -> Dict[str, Any]:
    recurring = raw.get("recurring") or {}
    product_id, product_name = product_id_and_name(raw.get("product"))
    out = pick_fields(raw, PRICE_FIELDS)
    out["product_id"] = product_id
    out["product_name"] = product_name
    out["interval"] = recurring.get("interval") if isinstance(recurring, dict) else None
    out["interval_count"] = recurring.get("interval_count") if isinstance(recurring, dict) else None
    return out


def summarize_product(raw: Dict[str, Any]) -> Dict[str, Any]:
    return pick_fields(raw, PRODUCT_FIELDS)


class StripeReadonlyClient:
    """HTTP GET client. Setting a request body is a hard error."""

    def __init__(self, api_key: str, *, opener: Any = None):
        self.api_key = api_key
        self._opener = opener or urllib.request.urlopen
        self.calls: List[Tuple[str, str]] = []

    def get(self, path: str, params: Optional[Sequence[Tuple[str, str]]] = None) -> Dict[str, Any]:
        if not path.startswith("/v1/"):
            raise SystemExit("Refusing a non-/v1/ Stripe path.")
        if not path.startswith("/v1/products") and not path.startswith("/v1/prices"):
            raise SystemExit(f"Refusing GET {path}. This script only reads products and prices.")
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
            raise SystemExit(redact(f"Stripe GET {path} failed HTTP {exc.code}: {err_body}", self.api_key)) from None
        except Exception as exc:  # noqa: BLE001 - surface transport errors without the key
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


def dump_catalog(client: StripeReadonlyClient, *, known_ids_only: bool, include_inactive: bool) -> Dict[str, Any]:
    list_errors: List[str] = []
    products: List[Dict[str, Any]] = []
    prices: List[Dict[str, Any]] = []

    if not known_ids_only:
        extra: List[Tuple[str, str]] = []
        if not include_inactive:
            extra.append(("active", "true"))
        try:
            products = [summarize_product(obj) for obj in client.list_all("/v1/products", extra)]
        except SystemExit as exc:
            list_errors.append(str(exc))
        price_extra = list(extra)
        price_extra.append(("expand[]", "data.product"))
        try:
            prices = [summarize_price(obj) for obj in client.list_all("/v1/prices", price_extra)]
        except SystemExit as exc:
            list_errors.append(str(exc))

    seen_prices = {row.get("id") for row in prices}
    seen_products = {row.get("id") for row in products}
    retrieved: List[Dict[str, Any]] = []
    retrieve_errors: List[Dict[str, str]] = []

    known_price_ids = [row["price_id"] for row in KNOWN_PROD_PRICES] + [
        row["price_id"] for row in SUPERSEDED_PROD_PRICES
    ]
    for price_id in known_price_ids:
        if price_id in seen_prices:
            continue
        try:
            raw = client.get(f"/v1/prices/{price_id}", [("expand[]", "product")])
            summary = summarize_price(raw)
            prices.append(summary)
            retrieved.append(summary)
            seen_prices.add(price_id)
        except SystemExit as exc:
            retrieve_errors.append({"price_id": price_id, "error": str(exc)})

    for rec in KNOWN_PRODUCTS:
        product_id = rec["product_id"]
        if product_id in seen_products:
            continue
        try:
            raw = client.get(f"/v1/products/{product_id}")
            summary = summarize_product(raw)
            products.append(summary)
            seen_products.add(product_id)
        except SystemExit as exc:
            retrieve_errors.append({"product_id": product_id, "error": str(exc)})

    labeled = []
    by_id = {row.get("id"): row for row in prices}
    for known in KNOWN_PROD_PRICES:
        row = dict(known)
        found = by_id.get(known["price_id"]) or {}
        row["unit_amount"] = found.get("unit_amount")
        row["currency"] = found.get("currency")
        row["nickname"] = found.get("nickname")
        row["active"] = found.get("active")
        row["livemode"] = found.get("livemode")
        row["product_id"] = found.get("product_id")
        row["product_name"] = found.get("product_name")
        row["source_account_id_do_not_paste"] = known["price_id"]
        labeled.append(row)

    return {
        "_meta": {
            "source": "stripe GET readonly",
            "wrote_ledger": False,
            "wrote_fixture": False,
            "http_methods": sorted({method for method, _path in client.calls}),
            "known_ids_only": known_ids_only,
            "list_errors": list_errors,
            "retrieve_errors": retrieve_errors,
        },
        "current_prod_prices": labeled,
        "products": products,
        "prices": prices,
        "retrieved_known_missing_from_list": retrieved,
        "known_products": [dict(row) for row in KNOWN_PRODUCTS],
        "superseded_prod_price_ids": [row["price_id"] for row in SUPERSEDED_PROD_PRICES],
    }


def print_table(dump: Dict[str, Any]) -> None:
    print("Current prod prices (ledger labels + retrieved Stripe fields).")
    print("Ids are source-account only — do not paste them into another Stripe account.")
    print("")
    print(f"{'plan':<14} {'name':<12} {'int':<6} {'amount':<10} {'ccy':<4} {'active':<7} {'livemode':<9} {'price_id'}")
    for row in dump["current_prod_prices"]:
        amount = row.get("unit_amount")
        amount_s = "—" if amount is None else str(amount)
        print(
            f"{row['plan_id']:<14} {row['display_name']:<12} {row['interval']:<6} "
            f"{amount_s:<10} {(row.get('currency') or '—'):<4} "
            f"{str(row.get('active')):<7} {str(row.get('livemode')):<9} {row['price_id']}"
        )
    meta = dump["_meta"]
    if meta.get("list_errors"):
        print("\nList warnings (restricted key may lack list; known ids were still retrieved):")
        for err in meta["list_errors"]:
            print(f"  {err}")
    if meta.get("retrieve_errors"):
        print("\nRetrieve errors:")
        for err in meta["retrieve_errors"]:
            print(f"  {err}")
    print(f"\nListed/retrieved products: {len(dump['products'])}  prices: {len(dump['prices'])}")


def assert_output_path_ok(path: str) -> None:
    name = os.path.basename(path)
    if name in FORBIDDEN_OUTPUT_NAMES:
        raise SystemExit(f"Refusing to write {path} (catalog/fixture/ledger).")


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--live-readonly",
        action="store_true",
        help="Required when STRIPE_API_KEY is live (rk_live_ / sk_live_). GET only.",
    )
    parser.add_argument("--api-key-file", help="Read the key from this file (first line). Prefer over argv.")
    parser.add_argument("--output", default="stripe-prod-catalog.json", help="Write JSON here (never the repo ledger).")
    parser.add_argument(
        "--known-ids-only", action="store_true", help="Skip list; only GET the known prod price/product ids."
    )
    parser.add_argument("--include-inactive", action="store_true", help="When listing, include inactive objects.")
    parser.add_argument("--json", action="store_true", help="Also print the JSON dump to stdout.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    assert_output_path_ok(args.output)
    api_key = load_api_key(args.api_key_file)
    kind = require_readonly_key(api_key, live_readonly=args.live_readonly)
    if kind == "live":
        print(LIVE_READONLY_BANNER, file=sys.stderr)

    client = StripeReadonlyClient(api_key)
    dump = dump_catalog(client, known_ids_only=args.known_ids_only, include_inactive=args.include_inactive)
    dump["_meta"]["key_kind"] = kind
    dump["_meta"]["live_readonly"] = bool(args.live_readonly and kind == "live")

    methods = dump["_meta"]["http_methods"]
    if methods != ["GET"]:
        raise SystemExit(f"Refusing to finish: HTTP methods were {methods}, expected GET only.")

    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(dump, fh, indent=2)
        fh.write("\n")
    print(f"Wrote {args.output}", file=sys.stderr)
    if args.json:
        print(json.dumps(dump, indent=2))
    else:
        print_table(dump)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
