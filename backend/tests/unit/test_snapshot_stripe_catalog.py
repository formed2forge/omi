"""Fail-closed + catalog-driven tests for snapshot_stripe_catalog.py.

Live Stripe is never called. The core path is --dry-run / --synthetic / the
probe summarizer; the main error path is a missing or live key.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scripts import snapshot_stripe_catalog as snap


def test_classify_key_kind_does_not_echo_secret():
    assert snap.classify_key_kind("sk_test_" + "x" * 20) == "sk_test"
    assert snap.classify_key_kind("rk_test_" + "x" * 20) == "rk_test"
    assert snap.classify_key_kind("pk_test_" + "x" * 20) == "pk_test"
    assert snap.classify_key_kind("sk_live_" + "x" * 20) == "live"
    assert snap.classify_key_kind("rk_live_" + "x" * 20) == "live"
    assert snap.classify_key_kind("not-a-key") == "unknown"


def test_require_test_mode_key_fails_closed_without_key(monkeypatch):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    with pytest.raises(SystemExit, match="STRIPE_API_KEY is required"):
        snap._require_test_mode_key("--probe")


@pytest.mark.parametrize("live", ["sk_live_fake", "rk_live_fake", "pk_live_fake", "sk_test_then_sk_live_embedded"])
def test_require_test_mode_key_refuses_live(monkeypatch, live):
    monkeypatch.setenv("STRIPE_API_KEY", live)
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        snap._require_test_mode_key("--probe")


def test_require_test_mode_key_refuses_non_secret_test_prefix(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "pk_test_publishable")
    with pytest.raises(SystemExit, match="not a test-mode"):
        snap._require_test_mode_key("--probe")


def test_create_test_prices_dry_run_prints_current_catalog_matrix(capsys):
    catalog = snap._load_catalog()
    assert snap.create_test_prices(catalog, dry_run=True) is None
    out = capsys.readouterr().out
    assert "5 products" in out
    assert "10 prices" in out
    for name in ("Neo", "Architect", "Operator", "Plus", "Unlimited"):
        assert f"[omi-test] {name}" in out
    assert "STRIPE_PLUS_MONTHLY_PRICE_ID" in out
    assert "STRIPE_UNLIMITED_V2_ANNUAL_PRICE_ID" in out


def test_build_creation_plan_follows_catalog_paid_plans():
    catalog = {
        "plans": [
            {"id": "basic", "display_name": "Core", "is_paid": False, "billing": {"prices": []}},
            {
                "id": "plus",
                "display_name": "Plus",
                "is_paid": True,
                "billing": {
                    "prices": [
                        {"interval": "month", "currency": "usd", "primary_env_var": "STRIPE_PLUS_MONTHLY_PRICE_ID"},
                        {"interval": "year", "currency": "usd", "primary_env_var": "STRIPE_PLUS_ANNUAL_PRICE_ID"},
                    ]
                },
            },
            {
                "id": "max",
                "display_name": "Max",
                "is_paid": True,
                "billing": {
                    "prices": [
                        {"interval": "month", "currency": "usd", "primary_env_var": "STRIPE_MAX_MONTHLY_PRICE_ID"},
                        {"interval": "year", "currency": "usd", "primary_env_var": "STRIPE_MAX_ANNUAL_PRICE_ID"},
                    ]
                },
            },
        ]
    }
    plan = snap.build_creation_plan(catalog)
    assert [p["plan_id"] for p in plan] == ["plus", "max"]
    assert sum(len(p["prices"]) for p in plan) == 4


def _pager(items):
    pager = MagicMock()
    pager.auto_paging_iter.return_value = iter(items)
    return pager


def test_probe_test_catalog_separates_fixture_objects(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_notreal")
    fixture_product = SimpleNamespace(
        id="prod_fixture",
        name="[omi-test] Plus",
        metadata={"omi_test_fixture": "1", "omi_plan_id": "plus"},
    )
    other_product = SimpleNamespace(id="prod_other", name="Legacy", metadata={})
    fixture_price = SimpleNamespace(
        id="price_fixture",
        product="prod_fixture",
        currency="usd",
        unit_amount=1499,
        recurring={"interval": "month"},
        metadata={"omi_test_fixture": "1", "omi_plan_id": "plus"},
    )
    other_price = SimpleNamespace(
        id="price_other",
        product="prod_other",
        currency="usd",
        unit_amount=999,
        recurring={"interval": "month"},
        metadata={},
    )
    stripe = MagicMock()
    stripe.Product.list.return_value = _pager([fixture_product, other_product])
    stripe.Price.list.return_value = _pager([fixture_price, other_price])

    report = snap.probe_test_catalog(stripe_client=stripe)
    assert report["key_kind"] == "sk_test"
    assert report["livemode"] is False
    assert [p["id"] for p in report["fixture_products"]] == ["prod_fixture"]
    assert [p["id"] for p in report["other_products"]] == ["prod_other"]
    assert [p["id"] for p in report["fixture_prices"]] == ["price_fixture"]
    assert report["fixture_prices"][0]["omi_plan_id"] == "plus"
    assert report["fixture_prices"][0]["unit_amount"] == 1499
    assert [p["id"] for p in report["other_prices"]] == ["price_other"]
    stripe.Product.create.assert_not_called()
    stripe.Price.create.assert_not_called()


def test_print_probe_report_mentions_create_when_empty(capsys):
    snap.print_probe_report(
        {
            "key_kind": "sk_test",
            "livemode": False,
            "write_hint": "secret key",
            "products_listed": 0,
            "prices_listed": 0,
            "capped_at": 200,
            "fixture_products": [],
            "other_products": [],
            "fixture_prices": [],
            "other_prices": [],
        }
    )
    out = capsys.readouterr().out
    assert "sk_test" in out
    assert "No omi_test_fixture prices yet" in out
    assert "LIVE" not in out
