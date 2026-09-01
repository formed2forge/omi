"""Catalog-driven + fail-closed tests for the Phase 3 subscription-change runner.

The live Stripe path (--apply) is not exercised here. Core path: scenario table
follows the checked-out catalog (Max skipped on main). Main error path: a live
key is refused even on dry-run.
"""

import pytest

from config.plan_catalog import DESKTOP_ENTITLED_PLAN_TYPES
from scripts import exercise_stripe_subscription_changes as ex


def test_scenario_table_skips_max_on_current_catalog():
    rows = {row["id"]: row for row in ex.list_scenarios()}
    assert rows["plus_month_to_unlimited_v2_month"]["status"] == "ready"
    assert rows["operator_month_to_plus_month_blocked"]["status"] == "ready"
    assert rows["plus_month_to_max_month"]["status"] == "skip"
    assert "max" in rows["plus_month_to_max_month"]["skip_reason"]


def test_scenario_table_includes_max_when_catalog_has_it():
    paid = {"plus", "unlimited_v2", "operator", "architect", "unlimited", "max"}
    rows = {row["id"]: row for row in ex.list_scenarios(paid)}
    assert rows["plus_month_to_max_month"]["status"] == "ready"


def test_desktop_to_consumer_block_matches_catalog_entitlement():
    entitled = {p.value for p in DESKTOP_ENTITLED_PLAN_TYPES}
    assert entitled == {"operator", "architect"}
    assert ex.desktop_to_consumer_blocked("operator", "plus") is True
    assert ex.desktop_to_consumer_blocked("architect", "unlimited_v2") is True
    assert ex.desktop_to_consumer_blocked("operator", "architect") is False
    assert ex.desktop_to_consumer_blocked("plus", "unlimited_v2") is False
    assert ex.desktop_to_consumer_blocked("plus", "operator") is False


def test_inactive_stripe_status_resolves_basic():
    assert ex.resolve_stripe_status_to_plan("canceled", "plus") == "basic"
    assert ex.resolve_stripe_status_to_plan("unpaid", "plus") == "basic"
    assert ex.resolve_stripe_status_to_plan("past_due", "plus") == "basic"
    assert ex.resolve_stripe_status_to_plan("active", "plus") == "plus"
    assert ex.resolve_stripe_status_to_plan("trialing", "architect") == "architect"


def test_scheduled_interval_marks_current_and_target_active():
    assert ex.expected_is_active_price_ids("price_month", "price_year") == {"price_month", "price_year"}
    assert ex.expected_is_active_price_ids("price_month", None) == {"price_month"}


def test_dry_run_main_does_not_need_a_key(monkeypatch, capsys):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    assert ex.main([]) == 0
    out = capsys.readouterr().out
    assert "plus_month_to_unlimited_v2_month" in out
    assert "Dry-run only" in out


def test_dry_run_refuses_live_key(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_live_should_never_run")
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        ex.main([])


def test_price_map_from_probe_uses_fixture_metadata_only():
    report = {
        "fixture_prices": [
            {"id": "price_plus_m", "omi_plan_id": "plus", "interval": "month"},
            {"id": "price_plus_y", "omi_plan_id": "plus", "interval": "year"},
        ],
        "other_prices": [{"id": "price_unrelated", "omi_plan_id": "plus", "interval": "month"}],
    }
    mapping = ex._price_map_from_probe(report)
    assert mapping[("plus", "month")] == "price_plus_m"
    assert mapping[("plus", "year")] == "price_plus_y"
    assert len(mapping) == 2
