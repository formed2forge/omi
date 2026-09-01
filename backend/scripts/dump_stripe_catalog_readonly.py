#!/usr/bin/env python3
"""Dump Stripe catalog IDs for replication onto another Stripe account.

Stripe price/product IDs are account-scoped. You cannot paste these ids into
another account; replicate by creating matching Products + Prices there and
keeping the new ids. This dump is the inventory of *what* to copy.

Two sources
-----------
* ``--from-ledger`` (default, no key): print every recognized price/product id
  from ``config/plan_catalog.json``. Price *identity* lives in this ledger;
  amounts do not (authority is Stripe live).
* ``--from-stripe``: GET-only ``Price.retrieve`` / ``Product.list`` / ``Price.list``.
  Test-mode keys work as usual. A live key (``rk_live_`` / ``sk_live_``) is
  accepted **only** with ``--live-readonly`` and never creates, updates, or
  deletes. It never writes ``recognized_stripe_prices`` or the hermetic fixture.

    python backend/scripts/dump_stripe_catalog_readonly.py
    python backend/scripts/dump_stripe_catalog_readonly.py --from-stripe --live-readonly

Do not use ``snapshot_stripe_catalog.py --create-test-prices`` or ``--from-stripe``
with a live key — those stay fail-closed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.snapshot_stripe_catalog import (  # noqa: E402
    CATALOG_PATH,
    FIXTURE_PATH,
    _load_catalog,
    _plan_billing_intervals,
    classify_key_kind,
)

LIVE_READONLY_BANNER = (
    "LIVE READ-ONLY dump. GET only (retrieve/list). No create/update/delete. "
    "Not writing the hermetic fixture or recognized_stripe_prices."
)


def current_ledger_price_id(catalog: Dict[str, Any], plan_id: str, interval: str, environment: str) -> Optional[str]:
    """Most recently appended ledger row for (plan, interval, environment)."""
    matches = [
        rec
        for rec in catalog.get("recognized_stripe_prices", [])
        if rec.get("plan_id") == plan_id and rec.get("interval") == interval and rec.get("environment") == environment
    ]
    if not matches:
        return None
    return matches[-1].get("price_id")


def build_ledger_dump(catalog: Dict[str, Any]) -> Dict[str, Any]:
    current: List[Dict[str, Any]] = []
    for plan in catalog.get("plans", []):
        if not plan.get("is_paid"):
            continue
        plan_id = plan["id"]
        product_ids = [
            rec["product_id"] for rec in catalog.get("recognized_stripe_products", []) if rec.get("plan_id") == plan_id
        ]
        for price_entry in _plan_billing_intervals(plan):
            interval = price_entry.get("interval")
            current.append(
                {
                    "plan_id": plan_id,
                    "display_name": plan.get("display_name", plan_id),
                    "interval": interval,
                    "currency": price_entry.get("currency", "usd"),
                    "primary_env_var": price_entry.get("primary_env_var"),
                    "prod_price_id": current_ledger_price_id(catalog, plan_id, interval, "prod"),
                    "dev_price_id": current_ledger_price_id(catalog, plan_id, interval, "dev"),
                    "product_ids": product_ids,
                    "unit_amount": None,
                    "unit_amount_note": "not in ledger; retrieve live to copy the billed amount",
                }
            )
    return {
        "_meta": {
            "source": "config/plan_catalog.json recognized_stripe_prices",
            "catalog_revision": catalog.get("catalog_revision"),
            "price_identity": "repository_ledger",
            "price_amount": "stripe_live",
            "wrote_fixture": False,
            "wrote_ledger": False,
        },
        "current_by_plan_interval": current,
        "all_recognized_prices": list(catalog.get("recognized_stripe_prices", [])),
        "all_recognized_products": list(catalog.get("recognized_stripe_products", [])),
    }


def print_ledger_dump(dump: Dict[str, Any]) -> None:
    print("Current recognized Stripe IDs (ledger). Amounts are NOT in-repo.")
    print(f"catalog_revision={dump['_meta']['catalog_revision']}")
    print("")
    print(f"{'plan':<14} {'name':<12} {'int':<6} {'env var':<38} {'prod price_id':<32} {'dev price_id'}")
    for row in dump["current_by_plan_interval"]:
        print(
            f"{row['plan_id']:<14} {row['display_name']:<12} {row['interval']:<6} "
            f"{(row['primary_env_var'] or ''):<38} {(row['prod_price_id'] or '—'):<32} "
            f"{row['dev_price_id'] or '—'}"
        )
    print("")
    print("Products:")
    for rec in dump["all_recognized_products"]:
        print(f"  {rec['product_id']}  plan={rec['plan_id']}")


def _require_readonly_key(*, allow_live: bool):
    import stripe  # imported lazily so --from-ledger never needs the SDK

    api_key = os.getenv("STRIPE_API_KEY", "")
    if not api_key:
        raise SystemExit("STRIPE_API_KEY is required for --from-stripe.")
    kind = classify_key_kind(api_key)
    is_live = kind == "live" or any(
        marker in api_key.lower() for marker in ("sk_live_", "rk_live_", "pk_live_", "_live_")
    )
    if is_live and not allow_live:
        raise SystemExit(
            "Refusing a LIVE Stripe key. Pass --live-readonly for GET-only "
            "(Price.retrieve / Product.list / Price.list). Never used by --create-test-prices."
        )
    if is_live and allow_live:
        print(LIVE_READONLY_BANNER, file=sys.stderr)
    elif kind not in ("sk_test", "rk_test"):
        raise SystemExit("STRIPE_API_KEY is not a usable secret/restricted key (sk_test_/rk_test_/sk_live_/rk_live_).")
    stripe.api_key = api_key
    return stripe, ("live" if is_live else kind)


def retrieve_live_readonly(catalog: Dict[str, Any], *, allow_live: bool) -> Dict[str, Any]:
    stripe, key_kind = _require_readonly_key(allow_live=allow_live)
    dump = build_ledger_dump(catalog)
    retrieved: List[Dict[str, Any]] = []
    for row in dump["current_by_plan_interval"]:
        for label, price_id in (("prod", row["prod_price_id"]), ("dev", row["dev_price_id"])):
            if not price_id:
                continue
            try:
                raw = stripe.Price.retrieve(price_id, expand=["product"])
                data = raw.to_dict_recursive() if hasattr(raw, "to_dict_recursive") else dict(raw)
            except Exception as exc:  # noqa: BLE001 - report per id, keep going
                retrieved.append(
                    {
                        "price_id": price_id,
                        "ledger_environment": label,
                        "plan_id": row["plan_id"],
                        "interval": row["interval"],
                        "error": str(exc),
                    }
                )
                continue
            product = data.get("product")
            product_id = product.get("id") if isinstance(product, dict) else product
            product_name = product.get("name") if isinstance(product, dict) else None
            retrieved.append(
                {
                    "price_id": data.get("id"),
                    "ledger_environment": label,
                    "plan_id": row["plan_id"],
                    "interval": row["interval"],
                    "livemode": data.get("livemode"),
                    "active": data.get("active"),
                    "currency": data.get("currency"),
                    "unit_amount": data.get("unit_amount"),
                    "nickname": data.get("nickname"),
                    "product_id": product_id,
                    "product_name": product_name,
                }
            )
            if label == "prod":
                row["unit_amount"] = data.get("unit_amount")
                row["unit_amount_note"] = "retrieved"
                row["livemode"] = data.get("livemode")
                row["product_name"] = product_name

    listed_products: List[Dict[str, Any]] = []
    listed_prices: List[Dict[str, Any]] = []
    try:
        for prod in stripe.Product.list(limit=100, active=True).auto_paging_iter():
            listed_products.append({"id": prod.id, "name": getattr(prod, "name", None)})
            if len(listed_products) >= 200:
                break
        for price in stripe.Price.list(limit=100, active=True).auto_paging_iter():
            rec = getattr(price, "recurring", None) or {}
            interval = rec.get("interval") if isinstance(rec, dict) else getattr(rec, "interval", None)
            listed_prices.append(
                {
                    "id": price.id,
                    "product": getattr(price, "product", None),
                    "interval": interval,
                    "currency": getattr(price, "currency", None),
                    "unit_amount": getattr(price, "unit_amount", None),
                    "livemode": getattr(price, "livemode", None),
                }
            )
            if len(listed_prices) >= 200:
                break
    except Exception as exc:  # noqa: BLE001 - list is best-effort on a restricted key
        dump["_meta"]["list_error"] = str(exc)

    dump["_meta"]["source"] = "stripe GET (readonly)"
    dump["_meta"]["key_kind"] = key_kind
    dump["_meta"]["live_readonly"] = bool(allow_live and key_kind == "live")
    dump["retrieved"] = retrieved
    dump["listed_active_products"] = listed_products
    dump["listed_active_prices"] = listed_prices
    return dump


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from-ledger", action="store_true", help="Dump recognized IDs from the catalog (default).")
    parser.add_argument("--from-stripe", action="store_true", help="GET-only retrieve/list against Stripe.")
    parser.add_argument(
        "--live-readonly",
        action="store_true",
        help="With --from-stripe: allow a live key for GET only. Refused without this flag.",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON instead of the table.")
    parser.add_argument("--output", type=Path, help="Write JSON to this path (never the hermetic fixture).")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.live_readonly and not args.from_stripe:
        parser.error("--live-readonly is only valid with --from-stripe")
    if args.from_ledger and args.from_stripe:
        parser.error("choose --from-ledger or --from-stripe")

    catalog = _load_catalog()
    if args.from_stripe:
        dump = retrieve_live_readonly(catalog, allow_live=args.live_readonly)
    else:
        dump = build_ledger_dump(catalog)

    if args.output:
        if args.output.resolve() == Path(FIXTURE_PATH).resolve():
            raise SystemExit(f"Refusing to write the hermetic fixture at {FIXTURE_PATH}")
        if args.output.resolve() == Path(CATALOG_PATH).resolve():
            raise SystemExit(f"Refusing to write the catalog/ledger at {CATALOG_PATH}")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(dump, indent=2) + "\n")
        print(f"Wrote {args.output}", file=sys.stderr)

    if args.json or args.from_stripe:
        print(json.dumps(dump, indent=2))
    else:
        print_ledger_dump(dump)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
