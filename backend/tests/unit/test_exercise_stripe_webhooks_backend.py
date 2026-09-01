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
    assert whb.CHECKOUT_EVENT in whb.LISTEN_EVENTS
    assert whb.LISTEN_EVENTS[0] == whb.CHECKOUT_EVENT


def test_seed_user_payload_is_truthy_basic():
    payload = whb.seed_user_payload("whbe_abc")
    assert payload["email"]
    assert payload["omi_webhook_backend_fixture"] is True
    assert whb.stored_plan(payload) == "basic"


def test_pricing_basic_uses_harness_email():
    payload = whb.seed_user_payload(whb.PRICING_BASIC_UID)
    assert payload["email"] == "pricing_basic@local.omi.invalid"
    assert payload["local_harness"] is True
    assert payload["uid"] == "pricing_basic"
    assert whb.harness_user_email("pricing_operator") == "pricing_operator@local.omi.invalid"


def test_checkout_client_reference_log_predicate(tmp_path):
    log_path = tmp_path / "uvicorn.log"
    log_path.write_text("Processing subscription for user pricing_basic (from metadata)\n")
    assert not whb._log_mentions_checkout_client_reference(log_path, "pricing_basic")
    log_path.write_text("Processing subscription for user pricing_basic (from client_reference_id)\n")
    assert whb._log_mentions_checkout_client_reference(log_path, "pricing_basic")
    assert not whb._wait_log_mentions_checkout_client_reference(log_path, "someone_else", timeout=0.01)


def test_checkout_subscription_fixture_is_subscription_mode():
    fixture = whb.checkout_subscription_fixture("pricing_basic", "price_plus_m", 1799)
    session = fixture["fixtures"][0]["params"]
    assert session["mode"] == "subscription"
    assert session["client_reference_id"] == "pricing_basic"
    assert session["customer_email"] == "pricing_basic@local.omi.invalid"
    assert session["line_items"][0]["price"] == "price_plus_m"
    assert session["metadata"]["uid"] == "pricing_basic"
    payment_method = fixture["fixtures"][2]["params"]
    assert payment_method["billing_details"]["email"] == "pricing_basic@local.omi.invalid"
    confirm = fixture["fixtures"][-1]["params"]
    assert confirm["expected_amount"] == 1799


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
    assert "pricing_basic" in out
    assert "checkout.session.completed" in out


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


def test_backend_parse_listen_secret_keeps_base64():
    secret = "whsec_ab+c/d=="
    text = f"Ready! Your webhook signing secret is \x1b[1m{secret}\x1b[0m (^C to quit)"
    assert whb.parse_listen_secret(text) == secret
    env = whb.listen_cli_env({"CLICOLOR_FORCE": "1", "PATH": "/bin"})
    assert env["CLICOLOR_FORCE"] == "0"
