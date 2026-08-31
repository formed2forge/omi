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

WEB_HEADERS = {"X-App-Platform": "web"}


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


# NOTE: the parallel `routers/users.py` subscription `available_plans` builder is
# also served by this fixture (its `stripe_price:{id}` cache is pre-seeded and its
# `stripe.Price.retrieve` calls are stubbed). It is intentionally not asserted via
# `/v1/users/me/subscription` here: that endpoint reaches a `register_script`-bound
# Redis path that isn't repointed to the harness fake (scripts bind to the real
# client at import), making it order-dependent under the redis-less hermetic job.
# The payment endpoint above is the canonical `available_plans` surface and fully
# proves offline rendering from the snapshot.
