"""Fail-closed tests for the Stripe webhook CLI runner.

The live listen/trigger path (--apply) is not exercised here. Core path: event
list matches payment.py. Main error path: a live key is refused even on dry-run.
"""

import pytest

from scripts import exercise_stripe_webhooks as wh


def test_webhook_events_match_payment_handler():
    assert "checkout.session.completed" in wh.WEBHOOK_EVENTS
    assert "customer.subscription.created" in wh.WEBHOOK_EVENTS
    assert "customer.subscription.updated" in wh.WEBHOOK_EVENTS
    assert "customer.subscription.deleted" in wh.WEBHOOK_EVENTS
    assert wh.FORWARD_PATH == "/v1/stripe/webhook"


def test_dry_run_does_not_need_a_key(monkeypatch, capsys):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    assert wh.main([]) == 0
    out = capsys.readouterr().out
    assert "customer.subscription.updated" in out
    assert "Dry-run only" in out


def test_dry_run_refuses_live_key(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_live_should_never_run")
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        wh.main([])


def test_parse_listen_secret():
    text = "Ready! Your webhook signing secret is whsec_abc123TEST (^C to quit)"
    assert wh.parse_listen_secret(text) == "whsec_abc123TEST"
    assert wh.parse_listen_secret("no secret here") is None


def test_sanitize_redacts_webhook_secret():
    text = wh._sanitize("secret whsec_SHOULDNOTLEAK and rk_test_ALSONOT")
    assert "SHOULDNOTLEAK" not in text
    assert "ALSONOT" not in text
    assert "whsec_<redacted>" in text
    assert "rk_test_<redacted>" in text


def test_trigger_argv_omits_skip_update():
    argv = wh.trigger_argv("/usr/bin/stripe", "customer.subscription.updated")
    assert argv == ["/usr/bin/stripe", "trigger", "customer.subscription.updated"]
    assert "--skip-update" not in argv


def test_cli_session_denied_is_detected():
    msg = "Enabling Debugging Tools Write ('stripecli_session_write') permissions"
    assert wh._is_cli_session_denied(msg) is True
    assert wh._is_cli_session_denied("customer_write missing") is False
