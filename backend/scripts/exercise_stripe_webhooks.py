#!/usr/bin/env python3
"""Non-hermetic Stripe TEST-MODE webhook CLI pass.

NOT part of the hermetic CI suite. Forwards ``stripe listen`` events to a local
``POST /v1/stripe/webhook`` receiver that verifies the Stripe-Signature header
the same way ``utils.stripe.parse_event`` does. Never touches live/prod and
never writes ``recognized_stripe_prices``.

Default is dry-run (prints the event list and CLI status). ``--apply`` requires
a TEST-MODE ``STRIPE_API_KEY`` and the Stripe CLI. Restricted keys need
Debugging Tools Write (``stripecli_session_write``) for ``listen`` / ``trigger``.

    python backend/scripts/exercise_stripe_webhooks.py
    STRIPE_API_KEY=sk_test_... python backend/scripts/exercise_stripe_webhooks.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Sequence
from urllib.parse import urlparse

BACKEND_DIR = __import__("pathlib").Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.snapshot_stripe_catalog import classify_key_kind  # noqa: E402

# Mirrors routers/payment.py stripe_webhook event types that mutate subscriptions.
WEBHOOK_EVENTS: tuple[str, ...] = (
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
)
FORWARD_PATH = "/v1/stripe/webhook"
STRIPE_CLI_VERSION = "1.31.0"
_SECRET_PREFIXES = ("sk_test_", "rk_test_", "pk_test_", "sk_live_", "rk_live_", "pk_live_", "whsec_")


def _sanitize(text: str) -> str:
    for prefix in _SECRET_PREFIXES:
        start = 0
        while True:
            idx = text.find(prefix, start)
            if idx < 0:
                break
            end = idx + len(prefix)
            while end < len(text) and text[end] not in " \t\r\n'\"":
                end += 1
            text = text[:idx] + prefix + "<redacted>" + text[end:]
            start = idx + len(prefix) + len("<redacted>")
    return text


def _is_live_key(api_key: str) -> bool:
    return classify_key_kind(api_key) == "live" or any(
        marker in api_key.lower() for marker in ("sk_live_", "rk_live_", "pk_live_", "_live_")
    )


def _refuse_live(api_key: str) -> None:
    if api_key and _is_live_key(api_key):
        raise SystemExit("Refusing to run against a LIVE Stripe key. Use a test-mode key (sk_test_/rk_test_).")


def _cli_bin() -> Optional[str]:
    found = shutil.which("stripe")
    if found:
        return found
    cached = BACKEND_DIR / ".cache" / "stripe-cli" / "stripe"
    if cached.is_file() and os.access(cached, os.X_OK):
        return str(cached)
    home = os.path.expanduser("~/.local/bin/stripe")
    if os.path.isfile(home) and os.access(home, os.X_OK):
        return home
    return None


def ensure_stripe_cli() -> str:
    existing = _cli_bin()
    if existing:
        return existing
    dest_dir = BACKEND_DIR / ".cache" / "stripe-cli"
    dest_dir.mkdir(parents=True, exist_ok=True)
    tarball = dest_dir / f"stripe_{STRIPE_CLI_VERSION}_linux_x86_64.tar.gz"
    url = (
        "https://github.com/stripe/stripe-cli/releases/download/"
        f"v{STRIPE_CLI_VERSION}/stripe_{STRIPE_CLI_VERSION}_linux_x86_64.tar.gz"
    )
    print(f"Downloading Stripe CLI v{STRIPE_CLI_VERSION}…", file=sys.stderr)
    subprocess.run(["curl", "-fsSL", "-o", str(tarball), url], check=True)
    subprocess.run(["tar", "-xzf", str(tarball), "-C", str(dest_dir)], check=True)
    binary = dest_dir / "stripe"
    binary.chmod(0o755)
    return str(binary)


def trigger_argv(cli: str, event_name: str) -> List[str]:
    # stripe listen accepts --skip-update; stripe trigger on CLI 1.31 does not.
    return [cli, "trigger", event_name]


def parse_listen_secret(text: str) -> Optional[str]:
    match = re.search(r"whsec_[A-Za-z0-9]+", text)
    return match.group(0) if match else None


def _is_cli_session_denied(text: str) -> bool:
    lowered = text.lower()
    return "stripecli_session_write" in lowered or "debugging tools write" in lowered


class _WebhookHandler(BaseHTTPRequestHandler):
    received: List[Dict[str, Any]]
    signing_secret: str = ""

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        sys.stderr.write(_sanitize("webhook: " + (fmt % args)) + "\n")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != FORWARD_PATH:
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        payload = self.rfile.read(length)
        sig = self.headers.get("Stripe-Signature")
        if not self.signing_secret:
            self._respond(503, {"status": "error", "message": "signing secret not ready"})
            return
        try:
            import stripe

            event = stripe.Webhook.construct_event(payload, sig, self.signing_secret)
        except Exception as exc:  # noqa: BLE001 - map verify failures to 400
            self._respond(400, {"status": "error", "message": _sanitize(str(exc))})
            return
        record = {"type": event.get("type"), "id": event.get("id"), "livemode": event.get("livemode")}
        self.received.append(record)
        self._respond(200, {"status": "success", "type": record["type"]})

    def _respond(self, code: int, body: Dict[str, Any]) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def _print_dry_run(cli: Optional[str]) -> None:
    print(f"{len(WEBHOOK_EVENTS)} Stripe webhook events (forward {FORWARD_PATH})")
    for name in WEBHOOK_EVENTS:
        print(f"  [READY] {name}")
    print(f"\nStripe CLI on PATH: {'yes (' + cli + ')' if cli else 'no'}")
    print("Restricted keys need Debugging Tools Write (stripecli_session_write) for listen/trigger.")
    print("Dry-run only. Pass --apply with a TEST-MODE STRIPE_API_KEY to listen + trigger.")


def apply_listen_and_trigger(events: Sequence[str] = WEBHOOK_EVENTS) -> List[Dict[str, Any]]:
    api_key = os.getenv("STRIPE_API_KEY", "")
    if not api_key:
        raise SystemExit("STRIPE_API_KEY is required for --apply (use a TEST-MODE key).")
    _refuse_live(api_key)
    kind = classify_key_kind(api_key)
    if kind not in ("sk_test", "rk_test"):
        raise SystemExit(
            "Refusing to run: STRIPE_API_KEY is not a test-mode secret/restricted key (sk_test_/rk_test_)."
        )

    cli = ensure_stripe_cli()
    handler_cls = type(
        "Handler",
        (_WebhookHandler,),
        {"received": [], "signing_secret": ""},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    forward = f"http://127.0.0.1:{port}{FORWARD_PATH}"
    listen_cmd = [
        cli,
        "listen",
        "--forward-to",
        forward,
        "--events",
        ",".join(events),
        "--skip-update",
    ]
    env = os.environ.copy()
    listen_proc = subprocess.Popen(
        listen_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )
    buf = ""
    secret = None
    deadline = time.time() + 25
    try:
        assert listen_proc.stdout is not None
        while time.time() < deadline and secret is None:
            if listen_proc.poll() is not None:
                rest = listen_proc.stdout.read() or ""
                buf += rest
                break
            line = listen_proc.stdout.readline()
            if not line:
                time.sleep(0.05)
                continue
            buf += line
            secret = parse_listen_secret(buf)
        if listen_proc.poll() is not None and secret is None:
            text = _sanitize(buf)
            if _is_cli_session_denied(text):
                raise SystemExit(
                    "Stripe CLI listen needs Debugging Tools Write (stripecli_session_write) "
                    "on the TEST-MODE restricted key, or replace STRIPE_API_KEY with sk_test_. " + text
                )
            raise SystemExit(f"stripe listen exited before a signing secret was printed.\n{text}")
        if not secret:
            raise SystemExit("Timed out waiting for stripe listen webhook signing secret.")
        handler_cls.signing_secret = secret
        print("stripe listen ready; triggering fixture events…", file=sys.stderr)
        for event_name in events:
            trigger = subprocess.run(
                trigger_argv(cli, event_name),
                capture_output=True,
                text=True,
                env=env,
                timeout=60,
            )
            combined = _sanitize((trigger.stdout or "") + (trigger.stderr or ""))
            if trigger.returncode != 0:
                if _is_cli_session_denied(combined):
                    raise SystemExit(
                        "Stripe CLI trigger needs Debugging Tools Write (stripecli_session_write). " + combined
                    )
                print(f"  FAIL trigger {event_name}: {combined}", file=sys.stderr)
            else:
                print(f"  triggered {event_name}", file=sys.stderr)
        wait_deadline = time.time() + 20
        while time.time() < wait_deadline and len(handler_cls.received) < len(events):
            time.sleep(0.2)
        return list(handler_cls.received)
    finally:
        if listen_proc.poll() is None:
            listen_proc.send_signal(signal.SIGTERM)
            try:
                listen_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                listen_proc.kill()
        server.shutdown()
        server.server_close()


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="stripe listen + stripe trigger against a local /v1/stripe/webhook receiver (default dry-run).",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    present = os.getenv("STRIPE_API_KEY", "")
    _refuse_live(present)

    cli = _cli_bin()
    _print_dry_run(cli)
    if not args.apply:
        return 0

    received = apply_listen_and_trigger()
    types = [item.get("type") for item in received]
    print(f"\nReceived {len(received)} forwarded event(s): {types}")
    livemode = [item.get("livemode") for item in received]
    if any(livemode):
        raise SystemExit("Refusing: a forwarded event had livemode=true.")
    missing = [name for name in WEBHOOK_EVENTS if name not in types]
    if missing:
        print(f"Missing events: {missing}", file=sys.stderr)
        return 1
    print("All expected events arrived livemode=false with a verified Stripe-Signature.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
