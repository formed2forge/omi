"""Fail-closed tests for the live-backend Stripe webhook persist runner.

The live listen/uvicorn/emulator path (--apply) is not exercised here. Core path:
seed payload + plan extraction. Main error path: a live key is refused even on dry-run.
"""

import pytest

from scripts import exercise_stripe_webhooks_backend as whb


def test_forward_url_matches_payment_webhook():
    assert whb.FORWARD_PATH == "/v1/stripe/webhook"
    assert whb.forward_url(8080) == "http://127.0.0.1:8080/v1/stripe/webhook"
    assert "customer.subscription.created" in whb.SUBSCRIBE_EVENTS
    assert "customer.subscription.deleted" in whb.SUBSCRIBE_EVENTS


def test_seed_user_payload_is_truthy_basic():
    payload = whb.seed_user_payload("whbe_abc")
    assert payload["email"]
    assert payload["omi_webhook_backend_fixture"] is True
    assert whb.stored_plan(payload) == "basic"


def test_stored_plan_reads_enum_value():
    class FakePlan:
        value = "plus"

    assert whb.stored_plan({"subscription": {"plan": FakePlan()}}) == "plus"
    assert whb.stored_plan({}) is None
    assert whb.stored_plan(None) is None


def test_dry_run_does_not_need_a_key(monkeypatch, capsys):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    monkeypatch.delenv("STRIPE_PLUS_MONTHLY_PRICE_ID", raising=False)
    assert whb.main([]) == 0
    out = capsys.readouterr().out
    assert "payment.py" in out
    assert "Dry-run only" in out
    assert "customer.subscription.created" in out


def test_dry_run_refuses_live_key(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_live_should_never_run")
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        whb.main([])


def test_apply_requires_plus_monthly_price_id(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_test_notarealkey")
    monkeypatch.delenv("STRIPE_PLUS_MONTHLY_PRICE_ID", raising=False)
    with pytest.raises(SystemExit, match="STRIPE_PLUS_MONTHLY_PRICE_ID"):
        whb.require_apply_env()


def test_apply_requires_test_mode_key(monkeypatch):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    with pytest.raises(SystemExit, match="STRIPE_API_KEY is required"):
        whb.require_apply_env()
