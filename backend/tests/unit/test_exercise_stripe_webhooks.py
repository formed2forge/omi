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
    assert "exercise_stripe_webhooks_backend.py" in out


def test_dry_run_refuses_live_key(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_live_should_never_run")
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        wh.main([])


def test_parse_listen_secret():
    text = "Ready! Your webhook signing secret is whsec_abc123TEST (^C to quit)"
    assert wh.parse_listen_secret(text) == "whsec_abc123TEST"
    assert wh.parse_listen_secret("no secret here") is None


def test_parse_listen_secret_keeps_base64_chars():
    secret = "whsec_ab+c/d=="
    text = f"Ready! Your webhook signing secret is {secret} (^C to quit)"
    assert wh.parse_listen_secret(text) == secret
    assert wh.parse_listen_secret(text) != "whsec_ab"


def test_parse_listen_secret_strips_ansi_bold():
    secret = "whsec_ab+c/d=="
    text = f"Ready! Your webhook signing secret is \x1b[1m{secret}\x1b[0m (^C to quit)"
    assert wh.parse_listen_secret(text) == secret


def test_parsed_base64_secret_verifies_stripe_signature():
    import hashlib
    import hmac
    import time

    stripe = pytest.importorskip("stripe")
    secret = "whsec_ab+c/d=="
    ready = f"Ready! Your webhook signing secret is \x1b[1m{secret}\x1b[0m (^C to quit)"
    parsed = wh.parse_listen_secret(ready)
    assert parsed == secret
    payload = b'{"id":"evt_test","object":"event","type":"customer.subscription.created"}'
    timestamp = str(int(time.time()))
    digest = hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("utf-8") + payload, hashlib.sha256).hexdigest()
    header = f"t={timestamp},v1={digest}"
    event = stripe.Webhook.construct_event(payload, header, parsed)
    assert event["type"] == "customer.subscription.created"
    with pytest.raises(Exception):
        stripe.Webhook.construct_event(payload, header, "whsec_ab")


def test_listen_cli_env_disables_forced_color(monkeypatch):
    monkeypatch.setenv("CLICOLOR_FORCE", "1")
    monkeypatch.setenv("CLICOLOR", "1")
    env = wh.listen_cli_env()
    assert env["CLICOLOR_FORCE"] == "0"
    assert env["CLICOLOR"] == "0"
    assert env["NO_COLOR"] == "1"


def test_require_stripe_sdk_imports():
    stripe = wh.require_stripe_sdk()
    assert hasattr(stripe.Webhook, "construct_event")


def test_require_stripe_sdk_fails_closed_when_missing(monkeypatch):
    monkeypatch.setitem(__import__("sys").modules, "stripe", None)
    with pytest.raises(SystemExit, match="backend/.venv"):
        wh.require_stripe_sdk()


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


def test_checkout_write_denied_is_detected():
    msg = "Enabling Checkout Sessions Write ('checkout_session_write') permissions"
    assert wh._is_checkout_write_denied(msg) is True
    assert wh._is_checkout_write_denied("customer_write missing") is False


def test_cli_session_denied_is_detected():
    msg = "Enabling Debugging Tools Write ('stripecli_session_write') permissions"
    assert wh._is_cli_session_denied(msg) is True
    assert wh._is_cli_session_denied("customer_write missing") is False


def test_stripe_cli_archive_matches_host():
    assert wh._stripe_cli_archive_name("linux", "x86_64") == f"stripe_{wh.STRIPE_CLI_VERSION}_linux_x86_64.tar.gz"
    assert wh._stripe_cli_archive_name("linux", "aarch64") == f"stripe_{wh.STRIPE_CLI_VERSION}_linux_arm64.tar.gz"
    assert wh._stripe_cli_archive_name("darwin", "arm64") == f"stripe_{wh.STRIPE_CLI_VERSION}_mac-os_arm64.tar.gz"
    assert wh._stripe_cli_archive_name("darwin", "x86_64") == f"stripe_{wh.STRIPE_CLI_VERSION}_mac-os_x86_64.tar.gz"


def test_stripe_cli_archive_refuses_windows():
    with pytest.raises(SystemExit, match="Unsupported OS"):
        wh._stripe_cli_archive_name("win32", "x86_64")


def test_cli_is_runnable_false_on_exec_format_error(monkeypatch):
    def _boom(_cmd, **_kwargs):
        raise OSError(8, "Exec format error")

    monkeypatch.setattr(wh.subprocess, "run", _boom)
    assert wh._cli_is_runnable("/Users/tim/tempdev/omi/backend/.cache/stripe-cli/stripe") is False


def test_cli_bin_skips_unrunnable_cache(monkeypatch, tmp_path):
    cached_dir = tmp_path / ".cache" / "stripe-cli"
    cached_dir.mkdir(parents=True)
    (cached_dir / "stripe").write_bytes(b"\x7fELF")
    (cached_dir / "stripe").chmod(0o755)
    monkeypatch.setattr(wh.shutil, "which", lambda _name: str(cached_dir / "stripe"))
    monkeypatch.setattr(wh, "BACKEND_DIR", tmp_path)
    monkeypatch.setattr(wh, "_cli_is_runnable", lambda _path: False)
    assert wh._cli_bin() is None


def test_ensure_stripe_cli_downloads_host_archive_when_cache_unrunnable(monkeypatch, tmp_path, capsys):
    cached_dir = tmp_path / ".cache" / "stripe-cli"
    cached_dir.mkdir(parents=True)
    bad = cached_dir / "stripe"
    bad.write_bytes(b"\x7fELF")
    bad.chmod(0o755)
    monkeypatch.setattr(wh, "BACKEND_DIR", tmp_path)
    monkeypatch.setattr(wh, "_cli_bin", lambda: None)
    monkeypatch.setattr(wh, "_stripe_cli_archive_name", lambda: "stripe_1.31.0_mac-os_arm64.tar.gz")
    calls: list[list[str]] = []

    def _run(cmd, **_kwargs):
        calls.append(list(cmd))
        if cmd[0] == "tar":
            (cached_dir / "stripe").write_text("#!/bin/sh\necho stripe-cli\n")
            (cached_dir / "stripe").chmod(0o755)
        return type("R", (), {"returncode": 0})()

    monkeypatch.setattr(wh.subprocess, "run", _run)
    monkeypatch.setattr(wh, "_cli_is_runnable", lambda path: path.endswith("/stripe") and (tmp_path / ".cache/stripe-cli/stripe").is_file())
    got = wh.ensure_stripe_cli()
    assert got.endswith("/.cache/stripe-cli/stripe")
    urls = [c for c in calls if c[0] == "curl"]
    assert any("mac-os_arm64.tar.gz" in " ".join(c) for c in urls)
    err = capsys.readouterr().err
    assert "mac-os_arm64" in err
