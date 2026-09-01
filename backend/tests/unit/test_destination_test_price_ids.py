"""Destination test-mode price IDs resolve via env, without writing the ledger."""

import json
from pathlib import Path

from config.plan_catalog import (
    PRIMARY_BILLING_ENV_VARS,
    PlanType,
    RECOGNIZED_STRIPE_PRICE_PLAN_TYPES,
    resolve_stripe_price_plan,
)

IDS_PATH = Path(__file__).resolve().parents[2] / "testing" / "fixtures" / "stripe_destination_test_price_ids.json"
SNAPSHOT_PATH = Path(__file__).resolve().parents[2] / "testing" / "fixtures" / "stripe_catalog_snapshot.json"


def test_destination_ids_are_not_in_the_production_ledger():
    env = json.loads(IDS_PATH.read_text())["env"]
    assert len(env) == 10
    for price_id in env.values():
        assert price_id not in RECOGNIZED_STRIPE_PRICE_PLAN_TYPES


def test_destination_ids_resolve_via_env(monkeypatch):
    env = json.loads(IDS_PATH.read_text())["env"]
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    assert resolve_stripe_price_plan(env["STRIPE_PLUS_MONTHLY_PRICE_ID"]) is PlanType.plus
    assert resolve_stripe_price_plan(env["STRIPE_UNLIMITED_MONTHLY_PRICE_ID"]) is PlanType.unlimited
    assert resolve_stripe_price_plan(env["STRIPE_UNLIMITED_V2_MONTHLY_PRICE_ID"]) is PlanType.unlimited_v2
    assert resolve_stripe_price_plan(env["STRIPE_OPERATOR_ANNUAL_PRICE_ID"]) is PlanType.operator
    assert resolve_stripe_price_plan(env["STRIPE_ARCHITECT_ANNUAL_PRICE_ID"]) is PlanType.architect


def test_snapshot_env_matches_destination_ids_and_live_cents():
    snapshot = json.loads(SNAPSHOT_PATH.read_text())
    ids = json.loads(IDS_PATH.read_text())["env"]
    assert snapshot["_meta"]["wrote_ledger"] is False
    assert snapshot["_meta"]["synthetic"] is False
    assert snapshot["env"] == ids
    expected_cents = {
        "STRIPE_UNLIMITED_MONTHLY_PRICE_ID": 2000,
        "STRIPE_UNLIMITED_ANNUAL_PRICE_ID": 20000,
        "STRIPE_ARCHITECT_MONTHLY_PRICE_ID": 19900,
        "STRIPE_ARCHITECT_ANNUAL_PRICE_ID": 199900,
        "STRIPE_OPERATOR_MONTHLY_PRICE_ID": 4900,
        "STRIPE_OPERATOR_ANNUAL_PRICE_ID": 49000,
        "STRIPE_PLUS_MONTHLY_PRICE_ID": 1799,
        "STRIPE_PLUS_ANNUAL_PRICE_ID": 16191,
        "STRIPE_UNLIMITED_V2_MONTHLY_PRICE_ID": 2999,
        "STRIPE_UNLIMITED_V2_ANNUAL_PRICE_ID": 26991,
    }
    for env_var, cents in expected_cents.items():
        price_id = ids[env_var]
        assert snapshot["prices"][price_id]["unit_amount"] == cents
        assert snapshot["prices"][price_id]["livemode"] is False
    # Every primary billing env var for paid plans is present.
    for _plan, intervals in PRIMARY_BILLING_ENV_VARS.items():
        for env_var in intervals.values():
            assert env_var in ids
