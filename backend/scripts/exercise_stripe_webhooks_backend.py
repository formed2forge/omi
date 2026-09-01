#!/usr/bin/env python3
"""Non-hermetic Stripe TEST-MODE live-backend webhook persist pass.

NOT part of the hermetic CI suite. Points ``stripe listen`` at a running
``uvicorn`` ``POST /v1/stripe/webhook`` (``routers/payment.py``) so
``checkout.session.completed`` and ``customer.subscription.created|deleted``
persist plan changes in the Firestore emulator. Never touches live/prod and
never writes ``recognized_stripe_prices``.

Checkout persist seeds the never-subscribed harness user ``pricing_basic``
(uid/email convention from ``feat/dev-harness-pricing-scenarios`` / handoff
§43 ``plan_catalog_matrix``) and completes a real subscription Checkout via
the Stripe CLI payment-page fixture used by ``stripe trigger``.

Default is dry-run. ``--apply`` requires a TEST-MODE ``STRIPE_API_KEY``,
``STRIPE_PLUS_MONTHLY_PRICE_ID`` (env mapping, not the production ledger),
the Stripe CLI, Redis, and the Firestore emulator.

``STRIPE_WEBHOOK_SECRET`` is taken from ``stripe listen`` (``whsec_``) and
injected into the uvicorn process **before** import — ``utils.stripe.parse_event``
reads it at module import.

    python backend/scripts/exercise_stripe_webhooks_backend.py
    STRIPE_API_KEY=sk_test_... python backend/scripts/exercise_stripe_webhooks_backend.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from google.cloud import firestore  # noqa: E402

from scripts.exercise_stripe_subscription_changes import _attach_test_card  # noqa: E402
from scripts.exercise_stripe_webhooks import (  # noqa: E402
    CHECKOUT_EVENT,
    FORWARD_PATH,
    _is_cli_session_denied,
    _refuse_live,
    _sanitize,
    ensure_stripe_cli,
    parse_listen_secret,
)
from scripts.snapshot_stripe_catalog import TEST_FIXTURE_MARKER, classify_key_kind  # noqa: E402

DEFAULT_PORT = 8080
SUBSCRIBE_EVENTS = (
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
)
LISTEN_EVENTS: tuple[str, ...] = (CHECKOUT_EVENT,) + SUBSCRIBE_EVENTS
PLUS_PRICE_ENV = "STRIPE_PLUS_MONTHLY_PRICE_ID"
EXPECTED_PAID_PLAN = "plus"
EXPECTED_BASIC_PLAN = "basic"
PROJECT_ID = "demo-omi"
# Never-subscribed user from feat/dev-harness-pricing-scenarios plan_catalog_matrix (handoff §43).
PRICING_BASIC_UID = "pricing_basic"
HARNESS_EMAIL_DOMAIN = "local.omi.invalid"


def firestore_port(repo_root: Path = REPO_ROOT) -> int:
    cfg = json.loads((repo_root / "firebase.json").read_text())
    return int(cfg.get("emulators", {}).get("firestore", {}).get("port", 8085))


def firestore_emulator_host(repo_root: Path = REPO_ROOT) -> str:
    return f"127.0.0.1:{firestore_port(repo_root)}"


def forward_url(port: int) -> str:
    return f"http://127.0.0.1:{port}{FORWARD_PATH}"


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def pick_forward_port(preferred: int = DEFAULT_PORT) -> int:
    if port_free(preferred):
        return preferred
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def harness_user_email(uid: str) -> str:
    return f"{uid}@{HARNESS_EMAIL_DOMAIN}"


def seed_user_payload(uid: str) -> Dict[str, Any]:
    return {
        "uid": uid,
        "email": harness_user_email(uid) if uid == PRICING_BASIC_UID else f"{uid}@example.test",
        "display_name": uid,
        "synthetic": True,
        "local_harness": uid == PRICING_BASIC_UID,
        "omi_webhook_backend_fixture": True,
        "subscription": {
            "plan": EXPECTED_BASIC_PLAN,
            "status": "active",
            "stripe_subscription_id": None,
            "cancel_at_period_end": False,
        },
    }


def checkout_subscription_fixture(uid: str, price_id: str, expected_amount: int) -> Dict[str, Any]:
    """Stripe CLI fixture: create + confirm a subscription Checkout (same shape as trigger)."""
    metadata = {**TEST_FIXTURE_MARKER, "uid": uid, "sub_type": EXPECTED_PAID_PLAN}
    confirm_params: Dict[str, Any] = {"payment_method": "${payment_method:id}"}
    if expected_amount:
        confirm_params["expected_amount"] = expected_amount
    return {
        "_meta": {"template_version": 0},
        "fixtures": [
            {
                "name": "checkout_session",
                "path": "/v1/checkout/sessions",
                "method": "post",
                "params": {
                    "success_url": "https://example.test/success",
                    "cancel_url": "https://example.test/cancel",
                    "mode": "subscription",
                    "client_reference_id": uid,
                    "customer_email": harness_user_email(uid),
                    "line_items": [{"price": price_id, "quantity": 1}],
                    "metadata": metadata,
                    "subscription_data": {"metadata": metadata},
                },
            },
            {
                "name": "payment_page",
                "path": "/v1/payment_pages/${checkout_session:id}",
                "method": "get",
            },
            {
                "name": "payment_method",
                "path": "/v1/payment_methods",
                "method": "post",
                "params": {
                    "type": "card",
                    "card": {"token": "tok_visa"},
                    "billing_details": {
                        "email": harness_user_email(uid),
                        "name": uid,
                        # Same address shape as stripe-cli checkout.session.completed.json.
                        "address": {
                            "line1": "354 Oyster Point Blvd",
                            "postal_code": "94080",
                            "city": "South San Francisco",
                            "state": "CA",
                            "country": "US",
                        },
                    },
                },
            },
            {
                "name": "payment_page_confirm",
                "path": "/v1/payment_pages/${checkout_session:id}/confirm",
                "method": "post",
                "params": confirm_params,
            },
        ],
    }


def stored_plan(user_data: Optional[Dict[str, Any]]) -> Optional[str]:
    if not user_data:
        return None
    sub = user_data.get("subscription") or {}
    plan = sub.get("plan")
    if plan is None:
        return None
    value = getattr(plan, "value", plan)
    return str(value)


def require_apply_env() -> tuple[str, str]:
    api_key = os.getenv("STRIPE_API_KEY", "")
    if not api_key:
        raise SystemExit("STRIPE_API_KEY is required for --apply (use a TEST-MODE key).")
    _refuse_live(api_key)
    kind = classify_key_kind(api_key)
    if kind not in ("sk_test", "rk_test"):
        raise SystemExit(
            "Refusing to run: STRIPE_API_KEY is not a test-mode secret/restricted key (sk_test_/rk_test_)."
        )
    plus_price_id = os.getenv(PLUS_PRICE_ENV, "").strip()
    if not plus_price_id:
        raise SystemExit(
            f"{PLUS_PRICE_ENV} is required for --apply so payment.py can resolve the destination Plus price."
        )
    if plus_price_id.startswith(("price_live_", "price_1")) and "_live_" in plus_price_id.lower():
        raise SystemExit(f"Refusing live-looking {PLUS_PRICE_ENV}.")
    return api_key, plus_price_id


def _print_dry_run(cli: Optional[str], port: int) -> None:
    host = firestore_emulator_host()
    print("Live-backend Stripe webhook persist pass (forward to uvicorn payment.py)")
    print(f"  forward: {forward_url(port)}")
    print(f"  events: {', '.join(LISTEN_EVENTS)}")
    print(f"  firestore emulator: {host} (project {PROJECT_ID})")
    print(f"  Stripe CLI on PATH: {'yes (' + cli + ')' if cli else 'no'}")
    print(f"  {PLUS_PRICE_ENV} set: {'yes' if os.getenv(PLUS_PRICE_ENV) else 'no'}")
    print(f"  checkout user: {PRICING_BASIC_UID} ({harness_user_email(PRICING_BASIC_UID)})")
    print("Restricted keys need Debugging Tools Write (stripecli_session_write) for listen.")
    print("Checkout persist: complete a subscription Checkout for pricing_basic, assert emulator plus.")
    print("Also creates an ephemeral Plus subscription with metadata.uid, asserts plus then basic.")
    print("Dry-run only. Pass --apply with a TEST-MODE STRIPE_API_KEY to listen + persist.")


def _run_log_dir() -> Path:
    path = REPO_ROOT / ".cursor" / "run"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _ensure_redis() -> None:
    ping = subprocess.run(["redis-cli", "ping"], capture_output=True, text=True)
    if ping.returncode == 0 and (ping.stdout or "").strip() == "PONG":
        print("redis ready", file=sys.stderr)
        return
    subprocess.run(
        ["redis-server", "--daemonize", "yes", "--save", "", "--appendonly", "no"],
        check=True,
    )
    deadline = time.time() + 10
    while time.time() < deadline:
        ping = subprocess.run(["redis-cli", "ping"], capture_output=True, text=True)
        if ping.returncode == 0 and (ping.stdout or "").strip() == "PONG":
            print("redis ready", file=sys.stderr)
            return
        time.sleep(0.2)
    raise SystemExit("redis-server failed to become ready")


def _ensure_firestore_emulator() -> str:
    host = firestore_emulator_host()
    port = firestore_port()
    if _http_up(f"http://127.0.0.1:{port}/"):
        print(f"firestore emulator ready on {host}", file=sys.stderr)
        return host
    firebase = REPO_ROOT / "node_modules" / ".bin" / "firebase"
    if not firebase.is_file():
        found = subprocess.run(["which", "firebase"], capture_output=True, text=True)
        if found.returncode != 0:
            raise SystemExit("firebase CLI missing; cannot start the Firestore emulator")
        firebase_bin = found.stdout.strip()
    else:
        firebase_bin = str(firebase)
    log_path = _run_log_dir() / "firestore-emulator.log"
    log_file = open(log_path, "ab")
    subprocess.Popen(
        [firebase_bin, "emulators:start", "--only", "firestore", "--project", PROJECT_ID],
        cwd=str(REPO_ROOT),
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    deadline = time.time() + 90
    while time.time() < deadline:
        if _http_up(f"http://127.0.0.1:{port}/"):
            print(f"firestore emulator ready on {host}", file=sys.stderr)
            return host
        time.sleep(1)
    raise SystemExit(f"firestore emulator failed; see {log_path}")


def _seed_backend_env() -> None:
    script = REPO_ROOT / ".cursor" / "seed-backend-env.sh"
    if not script.is_file():
        raise SystemExit(f"missing {script}")
    subprocess.run(["bash", str(script)], check=True, cwd=str(REPO_ROOT))


def _http_up(url: str) -> bool:
    try:
        urlopen(url, timeout=1)
        return True
    except HTTPError:
        return True
    except (URLError, TimeoutError, OSError):
        return False


def _wait_http(url: str, timeout: float) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _http_up(url):
            return
        time.sleep(0.4)
    raise SystemExit(f"timed out waiting for {url}")


def _wait_listen_secret(log_path: Path, proc: subprocess.Popen[str], timeout: float = 25) -> str:
    deadline = time.time() + timeout
    buf = ""
    while time.time() < deadline:
        if log_path.is_file():
            buf = log_path.read_text(errors="replace")
            secret = parse_listen_secret(buf)
            if secret:
                return secret
        if proc.poll() is not None:
            text = _sanitize(buf)
            if _is_cli_session_denied(text):
                raise SystemExit(
                    "Stripe CLI listen needs Debugging Tools Write (stripecli_session_write) "
                    "on the TEST-MODE restricted key, or replace STRIPE_API_KEY with sk_test_. " + text
                )
            raise SystemExit(f"stripe listen exited before a signing secret was printed.\n{text}")
        time.sleep(0.1)
    raise SystemExit("Timed out waiting for stripe listen webhook signing secret.")


def _uvicorn_env(webhook_secret: str, emulator_host: str) -> Dict[str, str]:
    env = os.environ.copy()
    creds = BACKEND_DIR / "google-credentials.json"
    env["STRIPE_WEBHOOK_SECRET"] = webhook_secret
    env["FIRESTORE_EMULATOR_HOST"] = emulator_host
    env["GOOGLE_CLOUD_PROJECT"] = PROJECT_ID
    env["FIREBASE_PROJECT_ID"] = PROJECT_ID
    env["FIREBASE_AUTH_PROJECT_ID"] = PROJECT_ID
    env["LOCAL_DEVELOPMENT"] = "true"
    env["ADMIN_KEY"] = env.get("ADMIN_KEY") or "local_dev_admin_key"
    env["ADMIN_KEY_AUTH_ENABLED"] = "true"
    if creds.is_file():
        env["GOOGLE_APPLICATION_CREDENTIALS"] = str(creds)
    env.pop("PINECONE_API_KEY", None)
    env.pop("SERVICE_ACCOUNT_JSON", None)
    return env


def _start_listen(cli: str, port: int) -> tuple[subprocess.Popen[str], Path]:
    log_path = _run_log_dir() / "stripe-listen-backend.log"
    log_file = open(log_path, "w", encoding="utf-8")
    cmd = [
        cli,
        "listen",
        "--forward-to",
        forward_url(port),
        "--events",
        ",".join(LISTEN_EVENTS),
        "--skip-update",
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
        env=os.environ.copy(),
        start_new_session=True,
    )
    return proc, log_path


def _start_uvicorn(port: int, webhook_secret: str, emulator_host: str) -> tuple[subprocess.Popen[str], Path]:
    log_path = _run_log_dir() / "uvicorn-webhook-backend.log"
    log_file = open(log_path, "w", encoding="utf-8")
    python = BACKEND_DIR / ".venv" / "bin" / "python"
    if not python.is_file():
        raise SystemExit(f"missing {python}; run backend/scripts/sync-python-deps.sh")
    env = _uvicorn_env(webhook_secret, emulator_host)
    proc = subprocess.Popen(
        [str(python), "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=str(BACKEND_DIR),
        stdout=log_file,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )
    return proc, log_path


def _firestore_client(emulator_host: str) -> firestore.Client:
    os.environ["FIRESTORE_EMULATOR_HOST"] = emulator_host
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", PROJECT_ID)
    return firestore.Client(project=PROJECT_ID)


def _poll_plan(client: firestore.Client, uid: str, expected: str, timeout: float) -> str:
    deadline = time.time() + timeout
    last: Optional[str] = None
    while time.time() < deadline:
        snap = client.collection("users").document(uid).get()
        data = snap.to_dict() if snap.exists else None
        last = stored_plan(data)
        if last == expected:
            return last
        time.sleep(0.4)
    raise SystemExit(f"timed out waiting for users/{uid}.subscription.plan == {expected} (last={last})")


def _tail_sanitized(path: Path, lines: int = 40) -> str:
    if not path.is_file():
        return ""
    text = path.read_text(errors="replace")
    tail = "\n".join(text.splitlines()[-lines:])
    return _sanitize(tail)


def _log_mentions_checkout_client_reference(log_path: Path, uid: str) -> bool:
    if not log_path.is_file():
        return False
    text = log_path.read_text(errors="replace")
    return uid in text and "client_reference_id" in text


def _wait_log_mentions_checkout_client_reference(log_path: Path, uid: str, timeout: float) -> bool:
    """subscription.created can write plus before checkout.session.completed is logged."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _log_mentions_checkout_client_reference(log_path, uid):
            return True
        time.sleep(0.2)
    return False


def apply_backend_persist(port: Optional[int] = None, timeout: float = 60) -> Dict[str, Any]:
    api_key, plus_price_id = require_apply_env()
    _ensure_redis()
    emulator_host = _ensure_firestore_emulator()
    _seed_backend_env()
    cli = ensure_stripe_cli()
    chosen_port = port if port is not None else pick_forward_port(DEFAULT_PORT)
    listen_proc, listen_log = _start_listen(cli, chosen_port)
    stripe_customer_id = None
    stripe_sub_id = None
    try:
        secret = _wait_listen_secret(listen_log, listen_proc)
        print("stripe listen ready; starting uvicorn…", file=sys.stderr)
        uvicorn_proc, uvicorn_log = _start_uvicorn(chosen_port, secret, emulator_host)
        try:
            _wait_http(f"http://127.0.0.1:{chosen_port}/docs", timeout=90)
        except SystemExit:
            print(_tail_sanitized(uvicorn_log), file=sys.stderr)
            raise SystemExit(f"uvicorn failed to start; see {uvicorn_log}")
        if uvicorn_proc.poll() is not None:
            print(_tail_sanitized(uvicorn_log), file=sys.stderr)
            raise SystemExit(f"uvicorn exited during startup; see {uvicorn_log}")
        print(f"uvicorn ready on :{chosen_port}", file=sys.stderr)

        import stripe

        stripe.api_key = api_key
        client = _firestore_client(emulator_host)

        checkout_uid = PRICING_BASIC_UID
        client.collection("users").document(checkout_uid).set(seed_user_payload(checkout_uid))
        if stored_plan(client.collection("users").document(checkout_uid).get().to_dict()) != EXPECTED_BASIC_PLAN:
            raise SystemExit("failed to seed pricing_basic as never-subscribed basic")

        price = stripe.Price.retrieve(plus_price_id)
        expected_amount = int(price.get("unit_amount") or 0)
        fixture_path = _run_log_dir() / "checkout_subscription.fixture.json"
        fixture_path.write_text(json.dumps(checkout_subscription_fixture(checkout_uid, plus_price_id, expected_amount)))
        print(f"completing subscription Checkout for {checkout_uid}…", file=sys.stderr)
        fixtures_run = subprocess.run(
            [cli, "fixtures", str(fixture_path)],
            capture_output=True,
            text=True,
            env=os.environ.copy(),
            timeout=90,
        )
        fixture_out = _sanitize((fixtures_run.stdout or "") + (fixtures_run.stderr or ""))
        if fixtures_run.returncode != 0:
            print(fixture_out, file=sys.stderr)
            print("uvicorn log tail:\n" + _tail_sanitized(uvicorn_log), file=sys.stderr)
            raise SystemExit("stripe fixtures failed to complete subscription Checkout.")
        try:
            checkout_plan = _poll_plan(client, checkout_uid, EXPECTED_PAID_PLAN, timeout)
        except SystemExit:
            print(fixture_out, file=sys.stderr)
            print("uvicorn log tail:\n" + _tail_sanitized(uvicorn_log), file=sys.stderr)
            print("listen log tail:\n" + _tail_sanitized(listen_log), file=sys.stderr)
            raise
        checkout_via_client_reference = _wait_log_mentions_checkout_client_reference(
            uvicorn_log, checkout_uid, timeout=min(20.0, timeout)
        )
        if not checkout_via_client_reference:
            print(fixture_out, file=sys.stderr)
            print("uvicorn log tail:\n" + _tail_sanitized(uvicorn_log), file=sys.stderr)
            print("listen log tail:\n" + _tail_sanitized(listen_log), file=sys.stderr)
            raise SystemExit(
                "checkout.session.completed did not log client_reference_id after plan became plus "
                "(subscription.created can race ahead of the checkout handler)."
            )
        print(
            f"checkout persist: {checkout_uid} plan={checkout_plan} "
            f"client_reference_id={'yes' if checkout_via_client_reference else 'not in logs'}",
            file=sys.stderr,
        )

        uid = f"whbe_{uuid.uuid4().hex[:12]}"
        client.collection("users").document(uid).set(seed_user_payload(uid))
        if stored_plan(client.collection("users").document(uid).get().to_dict()) != EXPECTED_BASIC_PLAN:
            raise SystemExit("failed to seed emulator user as basic")

        customer = stripe.Customer.create(
            email=f"{uid}@example.test",
            metadata={**TEST_FIXTURE_MARKER, "omi_webhook_backend": "1", "uid": uid},
        )
        stripe_customer_id = customer.id
        _attach_test_card(stripe, customer.id)
        sub = stripe.Subscription.create(
            customer=customer.id,
            items=[{"price": plus_price_id}],
            metadata={**TEST_FIXTURE_MARKER, "omi_webhook_backend": "1", "uid": uid},
            payment_behavior="error_if_incomplete",
            collection_method="charge_automatically",
        )
        stripe_sub_id = sub.id
        if sub["status"] not in ("active", "trialing"):
            raise SystemExit(f"expected active Plus subscription, got {sub['status']}")
        print(f"created test subscription for {uid}; waiting for Firestore plus…", file=sys.stderr)
        try:
            plan_after_create = _poll_plan(client, uid, EXPECTED_PAID_PLAN, timeout)
        except SystemExit:
            print("uvicorn log tail:\n" + _tail_sanitized(uvicorn_log), file=sys.stderr)
            print("listen log tail:\n" + _tail_sanitized(listen_log), file=sys.stderr)
            raise
        stripe.Subscription.cancel(sub.id, invoice_now=False, prorate=False)
        print("canceled subscription; waiting for Firestore basic…", file=sys.stderr)
        try:
            plan_after_cancel = _poll_plan(client, uid, EXPECTED_BASIC_PLAN, timeout)
        except SystemExit:
            print("uvicorn log tail:\n" + _tail_sanitized(uvicorn_log), file=sys.stderr)
            print("listen log tail:\n" + _tail_sanitized(listen_log), file=sys.stderr)
            raise
        result = {
            "uid": uid,
            "checkout_uid": checkout_uid,
            "checkout_plan": checkout_plan,
            "checkout_via_client_reference_id": checkout_via_client_reference,
            "forward": forward_url(chosen_port),
            "plan_after_create": plan_after_create,
            "plan_after_cancel": plan_after_cancel,
            "stripe_subscription_id": stripe_sub_id,
            "wrote_ledger": False,
            "livemode": False,
        }
        return result
    finally:
        import stripe as stripe_mod

        if getattr(stripe_mod, "api_key", None) and stripe_customer_id:
            try:
                if stripe_sub_id:
                    try:
                        stripe_mod.Subscription.cancel(stripe_sub_id, invoice_now=False, prorate=False)
                    except Exception:  # noqa: BLE001 - cleanup best-effort
                        pass
                stripe_mod.Customer.delete(stripe_customer_id)
            except Exception as exc:  # noqa: BLE001 - cleanup best-effort
                print(f"stripe cleanup warning: {_sanitize(str(exc))}", file=sys.stderr)
        # Leave uvicorn / listen / emulator / redis running for follow-up testing.


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Listen + uvicorn payment.py + persist Plus then Basic in the Firestore emulator (default dry-run).",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="uvicorn / listen forward port (default 8080).")
    parser.add_argument("--timeout", type=float, default=60, help="Seconds to wait for each Firestore plan write.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    present = os.getenv("STRIPE_API_KEY", "")
    _refuse_live(present)

    from scripts.exercise_stripe_webhooks import _cli_bin

    _print_dry_run(_cli_bin(), args.port)
    sys.stdout.flush()
    if not args.apply:
        return 0

    result = apply_backend_persist(port=pick_forward_port(args.port), timeout=args.timeout)
    print(json.dumps(result, indent=2))
    print(
        f"payment.py checkout persist {result['checkout_uid']}→{result['checkout_plan']} "
        f"(client_reference_id={result['checkout_via_client_reference_id']}); "
        f"subscription persist {result['plan_after_create']} then {result['plan_after_cancel']} "
        f"for {result['uid']} via stripe listen → {result['forward']}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
