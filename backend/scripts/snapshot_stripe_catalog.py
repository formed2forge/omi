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

Three modes
-----------
* ``--synthetic`` (default when no key): build a placeholder fixture purely from
  ``config/plan_catalog.json`` (real price IDs from the recognition ledger,
  **placeholder** dollar amounts). Use this to seed the committed fixture until
  real test-mode access lands. Requires no network and no credentials.
* ``--from-stripe``: read ``STRIPE_API_KEY`` (test mode only — fails closed on
  any ``*_live_*`` key), resolve each plan's current price IDs,
  ``stripe.Price.retrieve`` them, scrub, and write the same schema. Overwrites
  the synthetic amounts with the real ones. Use when the test-mode Price objects
  already exist (created in the Dashboard or by ``--create-test-prices``).
* ``--create-test-prices``: idempotently create one Product per paid plan plus a
  monthly + annual Price each in Stripe **test mode** (needs a WRITE-scoped test
  key), then capture them into the fixture and print the resulting
  ``STRIPE_*_PRICE_ID`` values to set as secrets. Re-runs reuse existing objects
  (matched by ``omi_test_fixture`` / ``omi_plan_id`` metadata). Add ``--dry-run``
  to print exactly what it would create without calling Stripe (no key needed).
  It follows the catalog on the current branch, so it creates whatever plan set
  is checked out (main's 5 today, Core/Plus/Max once that merges).

The fixture never contains customer/subscription data — only Product/Price
catalog objects, and only a field whitelist. `livemode: true` objects are
rejected so a live snapshot can never be committed.

Usage
-----
    # seed / refresh the committed placeholder fixture (no key needed)
    python backend/scripts/snapshot_stripe_catalog.py --synthetic

    # preview what --create-test-prices would create (no key needed)
    python backend/scripts/snapshot_stripe_catalog.py --create-test-prices --dry-run

    # in a keyed run: create the test-mode products/prices, then capture them
    STRIPE_API_KEY=sk_test_... python backend/scripts/snapshot_stripe_catalog.py --create-test-prices

    # once the test-mode Price objects exist, (re)capture real amounts
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

# Metadata stamped on products/prices created by --create-test-prices so re-runs
# find and reuse them (idempotent) rather than creating duplicates, and so they
# are unambiguously identifiable as Omi test-fixture objects in the dashboard.
TEST_FIXTURE_MARKER = {"omi_test_fixture": "1"}


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


def _require_test_mode_key(purpose: str):
    """Import stripe, require a TEST-MODE key (fail closed on live), configure it, return the module."""
    import stripe  # imported lazily so --synthetic / --dry-run never need the SDK configured

    api_key = os.getenv("STRIPE_API_KEY", "")
    if not api_key:
        raise SystemExit(f"STRIPE_API_KEY is required for {purpose} (use a TEST-MODE key).")
    if any(marker in api_key.lower() for marker in ("sk_live_", "rk_live_", "pk_live_", "_live_")):
        raise SystemExit("Refusing to run against a LIVE Stripe key. Use a test-mode key (sk_test_/rk_test_).")
    stripe.api_key = api_key
    return stripe


def build_stripe_fixture(catalog: Dict[str, Any]) -> Dict[str, Any]:
    stripe = _require_test_mode_key("--from-stripe")

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


def build_creation_plan(catalog: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One entry per paid plan: its display name + the (interval, currency, env, amount) to create."""
    plan: List[Dict[str, Any]] = []
    for p in catalog.get("plans", []):
        if not p.get("is_paid"):
            continue
        entries: List[Dict[str, Any]] = []
        for pr in _plan_billing_intervals(p):
            interval = pr.get("interval")
            entries.append(
                {
                    "interval": interval,
                    "currency": pr.get("currency", "usd"),
                    "primary_env_var": pr.get("primary_env_var"),
                    "amount": SYNTHETIC_AMOUNTS_USD_CENTS.get(p["id"], _DEFAULT_SYNTHETIC).get(interval, 1900),
                }
            )
        plan.append({"plan_id": p["id"], "display_name": p.get("display_name", p["id"]), "prices": entries})
    return plan


def _print_creation_plan(plan: List[Dict[str, Any]]) -> None:
    total = sum(len(x["prices"]) for x in plan)
    print(f"Would create {len(plan)} products and {total} prices (Stripe TEST mode, USD, placeholder amounts):")
    for prod in plan:
        print(
            f"- Product '[omi-test] {prod['display_name']}' (metadata omi_plan_id={prod['plan_id']}, omi_test_fixture=1)"
        )
        for pr in prod["prices"]:
            print(f"    {pr['interval']:5} {pr['currency']}  ${pr['amount'] / 100:.2f}  -> {pr['primary_env_var']}")


def _find_existing_product(stripe: Any, plan_id: str) -> Optional[Any]:
    """Reuse a prior test-fixture product for this plan if one exists (idempotent re-runs)."""
    query = f"active:'true' AND metadata['omi_test_fixture']:'1' AND metadata['omi_plan_id']:'{plan_id}'"
    try:
        res = stripe.Product.search(query=query)
        if res.data:
            return res.data[0]
        return None
    except Exception:
        # Search API unavailable on some keys — fall back to a metadata scan.
        try:
            for prod in stripe.Product.list(active=True, limit=100).auto_paging_iter():
                md = prod.get("metadata") or {}
                if md.get("omi_test_fixture") == "1" and md.get("omi_plan_id") == plan_id:
                    return prod
        except Exception:
            return None
    return None


def _find_existing_price(stripe: Any, product_id: str, interval: str, currency: str) -> Optional[Any]:
    """Reuse an active recurring price on the product for this interval/currency (prices are immutable)."""
    try:
        for price in stripe.Price.list(product=product_id, active=True, limit=100).auto_paging_iter():
            rec = price.get("recurring") or {}
            if (
                price.get("type") == "recurring"
                and rec.get("interval") == interval
                and price.get("currency") == currency
            ):
                return price
    except Exception:
        return None
    return None


def create_test_prices(catalog: Dict[str, Any], *, dry_run: bool = False) -> Optional[Dict[str, Any]]:
    """Idempotently create test-mode Products+Prices for every paid plan, then capture them.

    Reuses existing objects tagged with the fixture metadata so re-runs never
    duplicate. Returns the fixture dict, or ``None`` for a dry run.
    """
    plan = build_creation_plan(catalog)
    if not plan:
        raise SystemExit("No paid plans in the catalog to create test prices for.")
    if dry_run:
        _print_creation_plan(plan)
        return None

    stripe = _require_test_mode_key("--create-test-prices")

    env: Dict[str, str] = {}
    prices: Dict[str, Any] = {}
    plan_to_price: Dict[str, Dict[str, str]] = {}

    for prod_spec in plan:
        plan_id = prod_spec["plan_id"]
        product = _find_existing_product(stripe, plan_id)
        if product is None:
            product = stripe.Product.create(
                name=f"[omi-test] {prod_spec['display_name']}",
                metadata={**TEST_FIXTURE_MARKER, "omi_plan_id": plan_id},
            )
            print(f"created product {product.id} for {plan_id}")
        else:
            print(f"reusing product {product.id} for {plan_id}")

        for pr in prod_spec["prices"]:
            interval = pr["interval"]
            currency = pr["currency"]
            existing = _find_existing_price(stripe, product.id, interval, currency)
            if existing is not None:
                price = existing
                print(f"  reusing {interval} price {price.id}")
            else:
                price = stripe.Price.create(
                    product=product.id,
                    currency=currency,
                    unit_amount=pr["amount"],
                    recurring={"interval": interval},
                    nickname=f"{prod_spec['display_name']} {interval}",
                    metadata={**TEST_FIXTURE_MARKER, "omi_plan_id": plan_id, "omi_interval": interval},
                )
                print(f"  created {interval} price {price.id}")
            raw = stripe.Price.retrieve(price.id, expand=["product"]).to_dict_recursive()
            prices[price.id] = _scrub_price(raw)
            if pr["primary_env_var"]:
                env[pr["primary_env_var"]] = price.id
            plan_to_price.setdefault(plan_id, {})[interval] = price.id

    return {
        "_meta": {
            "synthetic": False,
            "generated_from": "stripe test-mode API (--create-test-prices)",
            "catalog_revision": catalog.get("catalog_revision"),
            "note": "Created + captured in Stripe test mode. Catalog objects only; no customer/subscription data.",
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
    mode.add_argument(
        "--create-test-prices",
        action="store_true",
        help="Idempotently create test-mode products/prices for each paid plan, then capture them.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --create-test-prices: print the creation plan without calling Stripe (no key needed).",
    )
    parser.add_argument("--output", type=Path, default=FIXTURE_PATH, help=f"Fixture path (default: {FIXTURE_PATH}).")
    args = parser.parse_args()

    if args.dry_run and not args.create_test_prices:
        parser.error("--dry-run is only valid with --create-test-prices")

    catalog = _load_catalog()
    if args.create_test_prices:
        fixture = create_test_prices(catalog, dry_run=args.dry_run)
        if fixture is None:  # dry run already printed the plan
            return 0
    elif args.from_stripe:
        fixture = build_stripe_fixture(catalog)
    else:
        fixture = build_synthetic_fixture(catalog)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(fixture, indent=2, sort_keys=False) + "\n")
    kind = "synthetic" if fixture["_meta"]["synthetic"] else "stripe test-mode"
    print(f"Wrote {kind} fixture with {len(fixture['prices'])} prices to {args.output}")
    if args.create_test_prices:
        print("\nSet these as backend STRIPE_*_PRICE_ID secrets/env:")
        for env_var, price_id in fixture["env"].items():
            print(f"{env_var}={price_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
