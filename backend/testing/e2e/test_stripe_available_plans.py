"""Hermetic e2e: `available_plans` renders offline from the Stripe snapshot fixture.

Regression seam for the "`available_plans` always empty in the harness" gap:
`routers/payment.py::get_available_plans_endpoint` and the `routers/users.py`
subscription builder both call `stripe.Price.retrieve` at request time, so with
no Stripe key every plan is silently dropped. The `stripe_catalog` fixture
(conftest) installs the offline catalog fake — real price IDs + fixture amounts,
no live Stripe — so client plan-card / disambiguation work can be exercised
end to end in CI.

Expected amounts are read from the fixture, never hardcoded, so this test does
not encode placeholder dollar figures as truth.
"""

import json
import pathlib

import pytest

WEB_HEADERS = {"X-App-Platform": "web"}

# Current (catalog_revision 2) storefront matrix for a NON-subscriber, from
# docs/agents/plan-catalog.md + utils/subscription._platform_hidden_plans:
#   mobile  -> Plus + Unlimited(v2)      (Operator/Architect manage-only, Neo hidden)
#   desktop -> Operator + Architect      (consumer tiers hidden, Neo hidden)
#   web     -> all four                  (only deprecated Neo hidden)
# Versions are set above each platform's new-catalog floor so the new shape shows
# (mobile fails closed below its floor; desktop fails open; web is version-agnostic).
CURRENT_STOREFRONT_MATRIX = [
    ("ios", "9.9.9", {"plus", "unlimited_v2"}),
    ("android", "9.9.9", {"plus", "unlimited_v2"}),
    ("macos", "9.9.9", {"operator", "architect"}),
    ("windows", "9.9.9", {"operator", "architect"}),
    ("web", None, {"operator", "architect", "plus", "unlimited_v2"}),
]


def test_available_plans_empty_without_snapshot(client, auth_headers, monkeypatch):
    """Baseline: with no price config / no Stripe key, the endpoint yields no plans.

    This is the exact failure the snapshot fixture fixes. The price-id env vars
    are cleared so the result is deterministic regardless of the host shell.
    """
    for env_var in (
        "STRIPE_PLUS_MONTHLY_PRICE_ID",
        "STRIPE_PLUS_ANNUAL_PRICE_ID",
        "STRIPE_UNLIMITED_V2_MONTHLY_PRICE_ID",
        "STRIPE_UNLIMITED_V2_ANNUAL_PRICE_ID",
        "STRIPE_OPERATOR_MONTHLY_PRICE_ID",
        "STRIPE_OPERATOR_ANNUAL_PRICE_ID",
        "STRIPE_ARCHITECT_MONTHLY_PRICE_ID",
        "STRIPE_ARCHITECT_ANNUAL_PRICE_ID",
    ):
        monkeypatch.delenv(env_var, raising=False)

    resp = client.get("/v1/payments/available-plans", headers={**auth_headers, **WEB_HEADERS})
    # Endpoint raises 500 ("Price configuration not found") when nothing resolves.
    assert resp.status_code == 500


def test_available_plans_render_from_snapshot(client, auth_headers, stripe_catalog):
    """With the offline catalog fake, the web storefront renders real plans."""
    resp = client.get("/v1/payments/available-plans", headers={**auth_headers, **WEB_HEADERS})
    assert resp.status_code == 200, resp.text

    plans = resp.json()["plans"]
    assert plans, "available_plans should be populated from the snapshot fixture"

    by_id = {p["id"]: p for p in plans}
    plan_ids = {p["plan_id"] for p in plans}

    # Web sells Plus + Unlimited + Operator + Architect. Assert the shared
    # sellers (Plus, Unlimited v2) and a desktop-origin seller (Architect) all
    # render, proving both shared and desktop plans resolve offline.
    assert {"plus", "unlimited_v2", "architect"} <= plan_ids

    # Every rendered option matches the fixture amount + interval exactly.
    for option in plans:
        fixture_price = stripe_catalog.prices.get(option["id"])
        assert fixture_price is not None, f"unexpected price id {option['id']}"
        assert option["unit_amount"] == fixture_price["unit_amount"]
        assert option["interval"] == fixture_price["recurring"]["interval"]
        assert option["price_string"].startswith("$")
        # Basic user with no subscription: nothing is the active plan.
        assert option["is_active"] is False

    # Each selling plan exposes both a monthly and an annual option.
    for plan_id in ("plus", "unlimited_v2", "architect"):
        intervals = {p["interval"] for p in plans if p["plan_id"] == plan_id}
        assert {"month", "year"} <= intervals, f"{plan_id} missing an interval: {intervals}"

    # Cross-check against the fixture's plan->price mapping for one plan.
    plus_month_id = stripe_catalog.plan_to_price["plus"]["month"]
    assert plus_month_id in by_id


@pytest.mark.parametrize("platform,version,expected_plan_ids", CURRENT_STOREFRONT_MATRIX)
def test_current_price_matrix_per_storefront(
    client, auth_headers, stripe_catalog, platform, version, expected_plan_ids
):
    """The current price matrix renders correctly per storefront, offline.

    This is the "does the harness work with the current price matrix" check the
    real-test-price / subscription-change work will build on: it exercises the
    per-platform audience filter end to end against the snapshot fixture.
    """
    headers = {**auth_headers, "X-App-Platform": platform}
    if version:
        headers["X-App-Version"] = version

    resp = client.get("/v1/payments/available-plans", headers=headers)
    assert resp.status_code == 200, resp.text
    plans = resp.json()["plans"]

    plan_ids = {p["plan_id"] for p in plans}
    assert plan_ids == expected_plan_ids, f"{platform}: got {plan_ids}, want {expected_plan_ids}"
    # Neo (deprecated) is never sold to a non-subscriber on any surface.
    assert "unlimited" not in plan_ids

    # Each selling plan exposes both intervals; amounts/intervals match the
    # fixture exactly; a fresh (basic) user has no active plan.
    for plan_id in expected_plan_ids:
        intervals = {p["interval"] for p in plans if p["plan_id"] == plan_id}
        assert {"month", "year"} <= intervals, f"{platform}/{plan_id}: intervals {intervals}"
    for option in plans:
        fixture_price = stripe_catalog.prices[option["id"]]
        assert option["unit_amount"] == fixture_price["unit_amount"]
        assert option["interval"] == fixture_price["recurring"]["interval"]
        assert option["is_active"] is False


def test_fixture_covers_current_catalog_matrix():
    """Guard against fixture/catalog drift: every paid plan's month+year price is
    present in the snapshot, keyed by the catalog's primary_env_var, with the
    right interval. Keeps the offline fixture honest before real prices land."""
    from fakes.stripe_catalog import load_snapshot

    backend_dir = pathlib.Path(__file__).resolve().parents[2]
    catalog = json.loads((backend_dir / "config" / "plan_catalog.json").read_text())
    snap = load_snapshot()

    for plan in catalog["plans"]:
        if not plan.get("is_paid"):
            continue
        for price in plan.get("billing", {}).get("prices", []):
            env_var = price["primary_env_var"]
            assert env_var in snap["env"], f"fixture missing env {env_var}"
            price_id = snap["env"][env_var]
            assert price_id in snap["prices"], f"fixture missing price {price_id} for {env_var}"
            assert snap["prices"][price_id]["recurring"]["interval"] == price["interval"]


def test_user_subscription_available_plans_populated(client, auth_headers, stripe_catalog):
    """The users.py subscription builder (cache-backed) also renders offline.

    Exercises the parallel `available_plans` path in `routers/users.py`, which
    reads the ``stripe_price:{id}`` cache (pre-seeded by the fixture) before the
    stubbed ``stripe.Price.retrieve``. Deterministic now that the harness repoints
    both the register_script Lua objects and the `database/cache.py` pub/sub client
    to the fake redis (the endpoint reaches `phone_calls.get_quota_snapshot` ->
    cache init -> `redis_pubsub.start`).
    """
    resp = client.get("/v1/users/me/subscription", headers={**auth_headers, **WEB_HEADERS})
    assert resp.status_code == 200, resp.text

    body = resp.json()
    available = body.get("available_plans")
    assert available, "subscription.available_plans should be populated from the snapshot fixture"
    # Prices come from the fixture, so every option carries a real price id.
    for plan in available:
        for option in plan.get("prices", []):
            assert option["id"] in stripe_catalog.prices
