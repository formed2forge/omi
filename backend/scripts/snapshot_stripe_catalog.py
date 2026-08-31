#!/usr/bin/env python3
"""Snapshot the Stripe catalog (Products + Prices) into a hermetic test fixture.

Why this exists
---------------
`routers/payment.py::get_available_plans_endpoint` and
`routers/users.py`'s subscription `available_plans` builder both call
`stripe.Price.retrieve(price_id)` at request time and silently drop any plan
whose lookup fails. With no Stripe key (the hermetic harness, CI, or a laptop
without credentials) `available_plans` therefore comes back **empty**, which
blocks any client-side plan-card / disambiguation work from being exercised
end to end.

This script captures the Price/Product objects **once** (test mode) and writes a
scrubbed JSON fixture. The fixture then drives an offline `stripe.Price.retrieve`
stub + the `stripe_price:{id}` cache in the test harness (see
`backend/testing/e2e/fakes/stripe_catalog.py`), so plan rendering works
hermetically with the real price IDs and shapes — no live Stripe at request time.

Two modes
---------
* ``--synthetic`` (default when no key): build a placeholder fixture purely from
  ``config/plan_catalog.json`` (real price IDs from the recognition ledger,
  **placeholder** dollar amounts). Use this to seed the committed fixture until
  real test-mode access lands. Requires no network and no credentials.
* real snapshot (``--from-stripe``): read ``STRIPE_API_KEY`` (test mode only —
  fails closed on any ``*_live_*`` key), resolve each plan's current price IDs,
  ``stripe.Price.retrieve`` them, scrub, and write the same schema. Overwrites
  the synthetic amounts with the real ones.

The fixture never contains customer/subscription data — only Product/Price
catalog objects, and only a field whitelist. `livemode: true` objects are
rejected so a live snapshot can never be committed.

Usage
-----
    # seed / refresh the committed placeholder fixture (no key needed)
    python backend/scripts/snapshot_stripe_catalog.py --synthetic

    # once a TEST-MODE key is in the environment, capture real amounts
    STRIPE_API_KEY=sk_test_... python backend/scripts/snapshot_stripe_catalog.py --from-stripe
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

BACKEND_DIR = Path(__file__).resolve().parents[1]
CATALOG_PATH = BACKEND_DIR / "config" / "plan_catalog.json"
FIXTURE_PATH = BACKEND_DIR / "testing" / "fixtures" / "stripe_catalog_snapshot.json"

# Placeholder monthly/annual amounts (USD cents) per plan id, used ONLY by
# --synthetic mode. These are deliberately NOT authoritative prices — the real
# amounts come from a --from-stripe snapshot. Tests read amounts from the
# fixture rather than hardcoding them, so these values are never asserted as
# "the price of X".
SYNTHETIC_AMOUNTS_USD_CENTS: Dict[str, Dict[str, int]] = {
    "unlimited": {"month": 999, "year": 9990},
    "operator": {"month": 1900, "year": 18000},
    "architect": {"month": 19900, "year": 199000},
    "plus": {"month": 1499, "year": 14990},
    "unlimited_v2": {"month": 2999, "year": 29990},
}
_DEFAULT_SYNTHETIC = {"month": 1900, "year": 18000}

# Fields we keep from a real Stripe Price object. Everything else (metadata,
# custom_unit_amount, tiers, etc.) is dropped so nothing sensitive is committed.
_PRICE_FIELD_WHITELIST = {
    "id",
    "object",
    "active",
    "currency",
    "unit_amount",
    "unit_amount_decimal",
    "nickname",
    "recurring",
    "type",
    "livemode",
    "product",
}
_RECURRING_FIELD_WHITELIST = {"interval", "interval_count", "usage_type"}


def _load_catalog() -> Dict[str, Any]:
    return json.loads(CATALOG_PATH.read_text())


def _resolve_price_id_for(plan_id: str, interval: str, catalog: Dict[str, Any]) -> Optional[str]:
    """Pick a representative price id for (plan, interval) from the ledger.

    Prefers a ``dev`` (test-adjacent) entry, then any environment, taking the
    most recently appended one so the fixture tracks the current price. Returns
    ``None`` when the append-only ledger has no entry for this plan/interval.
    """
    matches: List[Dict[str, Any]] = [
        rec
        for rec in catalog.get("recognized_stripe_prices", [])
        if rec.get("plan_id") == plan_id and rec.get("interval") == interval
    ]
    if not matches:
        return None
    dev = [rec for rec in matches if rec.get("environment") == "dev"]
    chosen = (dev or matches)[-1]
    return chosen.get("price_id")


def _plan_billing_intervals(plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    return plan.get("billing", {}).get("prices", []) or []


def build_synthetic_fixture(catalog: Dict[str, Any]) -> Dict[str, Any]:
    env: Dict[str, str] = {}
    prices: Dict[str, Any] = {}
    plan_to_price: Dict[str, Dict[str, str]] = {}

    for plan in catalog.get("plans", []):
        plan_id = plan.get("id")
        if not plan.get("is_paid"):
            continue
        for price_entry in _plan_billing_intervals(plan):
            interval = price_entry.get("interval")
            primary_env_var = price_entry.get("primary_env_var")
            currency = price_entry.get("currency", "usd")
            price_id = _resolve_price_id_for(plan_id, interval, catalog) or f"price_synthetic_{plan_id}_{interval}"
            amount = SYNTHETIC_AMOUNTS_USD_CENTS.get(plan_id, _DEFAULT_SYNTHETIC).get(interval, 1900)

            prices[price_id] = {
                "id": price_id,
                "object": "price",
                "active": True,
                "currency": currency,
                "unit_amount": amount,
                "unit_amount_decimal": str(amount),
                "nickname": f"{plan.get('display_name', plan_id)} {interval}",
                "recurring": {"interval": interval, "interval_count": 1, "usage_type": "licensed"},
                "type": "recurring",
                "livemode": False,
                "product": f"prod_synthetic_{plan_id}",
            }
            if primary_env_var:
                env[primary_env_var] = price_id
            plan_to_price.setdefault(plan_id, {})[interval] = price_id

    return {
        "_meta": {
            "synthetic": True,
            "generated_from": "config/plan_catalog.json",
            "catalog_revision": catalog.get("catalog_revision"),
            "note": (
                "Placeholder amounts. Real price IDs come from the recognition ledger; "
                "run this script with --from-stripe (TEST-MODE key) to capture real amounts."
            ),
        },
        "env": dict(sorted(env.items())),
        "plan_to_price": plan_to_price,
        "prices": prices,
    }


def _scrub_price(raw: Dict[str, Any]) -> Dict[str, Any]:
    if raw.get("livemode") is True:
        raise SystemExit(f"Refusing to snapshot live-mode price {raw.get('id')!r}. Use a TEST-MODE key only.")
    scrubbed: Dict[str, Any] = {k: raw[k] for k in _PRICE_FIELD_WHITELIST if k in raw}
    recurring = raw.get("recurring") or {}
    if recurring:
        scrubbed["recurring"] = {k: recurring[k] for k in _RECURRING_FIELD_WHITELIST if k in recurring}
    product = raw.get("product")
    # Expanded product -> keep id + name only; unexpanded product is just an id string.
    if isinstance(product, dict):
        scrubbed["product"] = {"id": product.get("id"), "name": product.get("name")}
    return scrubbed


def build_stripe_fixture(catalog: Dict[str, Any]) -> Dict[str, Any]:
    import stripe  # imported lazily so --synthetic never needs the SDK configured

    api_key = os.getenv("STRIPE_API_KEY", "")
    if not api_key:
        raise SystemExit("STRIPE_API_KEY is required for --from-stripe (use a TEST-MODE key).")
    lowered = api_key.lower()
    if any(marker in lowered for marker in ("sk_live_", "rk_live_", "pk_live_", "_live_")):
        raise SystemExit("Refusing to run against a LIVE Stripe key. Use a test-mode key (sk_test_/rk_test_).")
    stripe.api_key = api_key

    env: Dict[str, str] = {}
    prices: Dict[str, Any] = {}
    plan_to_price: Dict[str, Dict[str, str]] = {}

    for plan in catalog.get("plans", []):
        plan_id = plan.get("id")
        if not plan.get("is_paid"):
            continue
        for price_entry in _plan_billing_intervals(plan):
            interval = price_entry.get("interval")
            primary_env_var = price_entry.get("primary_env_var")
            # Prefer the operator-provided env var (the true current price), then
            # fall back to the recognition ledger's representative id.
            price_id = ""
            for candidate_env in price_entry.get("accepted_env_vars", []) or []:
                if os.getenv(candidate_env):
                    price_id = os.environ[candidate_env]
                    break
            if not price_id:
                price_id = _resolve_price_id_for(plan_id, interval, catalog) or ""
            if not price_id:
                print(f"  skip {plan_id}/{interval}: no price id configured or in ledger", file=sys.stderr)
                continue
            try:
                raw = stripe.Price.retrieve(price_id, expand=["product"]).to_dict_recursive()
            except Exception as exc:  # noqa: BLE001 - report and continue per price
                print(f"  skip {plan_id}/{interval} ({price_id}): {exc}", file=sys.stderr)
                continue
            prices[price_id] = _scrub_price(raw)
            if primary_env_var:
                env[primary_env_var] = price_id
            plan_to_price.setdefault(plan_id, {})[interval] = price_id
            print(f"  captured {plan_id}/{interval}: {price_id}")

    if not prices:
        raise SystemExit("No prices captured. Check the test-mode key and that price IDs exist in test mode.")

    return {
        "_meta": {
            "synthetic": False,
            "generated_from": "stripe test-mode API",
            "catalog_revision": catalog.get("catalog_revision"),
            "note": "Captured from Stripe test mode. Catalog objects only; no customer/subscription data.",
        },
        "env": dict(sorted(env.items())),
        "plan_to_price": plan_to_price,
        "prices": prices,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--synthetic", action="store_true", help="Build a placeholder fixture from the catalog (no Stripe)."
    )
    mode.add_argument("--from-stripe", action="store_true", help="Capture real prices from Stripe test mode.")
    parser.add_argument("--output", type=Path, default=FIXTURE_PATH, help=f"Fixture path (default: {FIXTURE_PATH}).")
    args = parser.parse_args()

    catalog = _load_catalog()
    if args.from_stripe:
        fixture = build_stripe_fixture(catalog)
    else:
        fixture = build_synthetic_fixture(catalog)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(fixture, indent=2, sort_keys=False) + "\n")
    kind = "synthetic" if fixture["_meta"]["synthetic"] else "stripe test-mode"
    print(f"Wrote {kind} fixture with {len(fixture['prices'])} prices to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
