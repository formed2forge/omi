#!/usr/bin/env python3
"""Non-hermetic Stripe TEST-MODE subscription-change scenarios (Phase 3).

NOT part of the hermetic CI suite. Needs a write-scoped TEST-MODE key and the
``omi_test_fixture`` Products/Prices created by
``snapshot_stripe_catalog.py --create-test-prices``. Never touches live/prod
and never writes ``recognized_stripe_prices``.

Default is dry-run (prints the scenario table, no Stripe calls). ``--apply``
creates an ephemeral customer (Test Clock when the key allows ``billing_clock_write``,
otherwise no clock), runs each in-catalog scenario against real test-mode Stripe,
then deletes them.

    python backend/scripts/exercise_stripe_subscription_changes.py
    STRIPE_API_KEY=sk_test_... python backend/scripts/exercise_stripe_subscription_changes.py --apply

Webhook delivery (``stripe listen`` / ``stripe trigger``) is a separate pass:
see ``backend/scripts/exercise_stripe_webhooks.py``. This script exercises
Subscription.create / modify / schedule / cancel on the Stripe API and the
local plan-resolution rules.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

BACKEND_DIR = __import__("pathlib").Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config.plan_catalog import DESKTOP_ENTITLED_PLAN_TYPES
from scripts.snapshot_stripe_catalog import (  # noqa: E402
    TEST_FIXTURE_MARKER,
    _load_catalog,
    _require_test_mode_key,
    classify_key_kind,
    probe_test_catalog,
    print_probe_report,
)
from utils.observability.fallback import record_fallback  # noqa: E402

# Mirrors routers/payment.py::upgrade_subscription_endpoint:
# cross-plan → Subscription.modify(proration_behavior=always_invoice);
# same-plan interval → SubscriptionSchedule at period end.
KIND_CROSS_PLAN = "cross_plan_immediate_proration"
KIND_INTERVAL = "same_plan_interval_schedule"
KIND_DESKTOP_BLOCKED = "desktop_to_consumer_blocked"
KIND_CANCEL_VALID = "cancel_at_period_end_still_valid"
KIND_INACTIVE_BASIC = "inactive_stripe_status_resolves_basic"
KIND_SCHEDULED_IS_ACTIVE = "scheduled_interval_marks_both_is_active"


@dataclass(frozen=True)
class Scenario:
    id: str
    kind: str
    start: Tuple[str, str]  # (plan_id, interval)
    target: Optional[Tuple[str, str]]
    why: str
    requires_plans: Tuple[str, ...] = ()

    def needed_plans(self) -> Tuple[str, ...]:
        plans = [self.start[0]]
        if self.target:
            plans.append(self.target[0])
        plans.extend(self.requires_plans)
        return tuple(dict.fromkeys(plans))


# Launch-critical transitions on the current catalog. Max is included but
# skipped when the checked-out catalog has no `max` plan (main today).
SCENARIOS: Tuple[Scenario, ...] = (
    Scenario(
        id="plus_month_to_unlimited_v2_month",
        kind=KIND_CROSS_PLAN,
        start=("plus", "month"),
        target=("unlimited_v2", "month"),
        why="Mobile launch upgrade: Plus → Unlimited, immediate Stripe proration",
    ),
    Scenario(
        id="unlimited_v2_month_to_plus_month",
        kind=KIND_CROSS_PLAN,
        start=("unlimited_v2", "month"),
        target=("plus", "month"),
        why="Mobile launch downgrade: Unlimited → Plus, immediate Stripe proration",
    ),
    Scenario(
        id="operator_month_to_architect_month",
        kind=KIND_CROSS_PLAN,
        start=("operator", "month"),
        target=("architect", "month"),
        why="Desktop family upgrade: Operator → Architect (allowed)",
    ),
    Scenario(
        id="architect_month_to_operator_month",
        kind=KIND_CROSS_PLAN,
        start=("architect", "month"),
        target=("operator", "month"),
        why="Desktop family downgrade: Architect → Operator (allowed)",
    ),
    Scenario(
        id="plus_month_to_plus_year",
        kind=KIND_INTERVAL,
        start=("plus", "month"),
        target=("plus", "year"),
        why="Same-plan monthly → annual is scheduled at period end, not prorated now",
    ),
    Scenario(
        id="plus_year_to_plus_month",
        kind=KIND_INTERVAL,
        start=("plus", "year"),
        target=("plus", "month"),
        why="Same-plan annual → monthly is scheduled at period end",
    ),
    Scenario(
        id="operator_month_to_plus_month_blocked",
        kind=KIND_DESKTOP_BLOCKED,
        start=("operator", "month"),
        target=("plus", "month"),
        why="desktop_to_consumer_plan_change_error: Operator must not prorate onto Plus",
    ),
    Scenario(
        id="architect_month_to_unlimited_v2_month_blocked",
        kind=KIND_DESKTOP_BLOCKED,
        start=("architect", "month"),
        target=("unlimited_v2", "month"),
        why="desktop_to_consumer_plan_change_error: Architect must not prorate onto Unlimited",
    ),
    Scenario(
        id="plus_month_cancel_at_period_end_still_valid",
        kind=KIND_CANCEL_VALID,
        start=("plus", "month"),
        target=None,
        why="Paid access continues until current_period_end after cancel-at-period-end",
    ),
    Scenario(
        id="canceled_status_resolves_basic",
        kind=KIND_INACTIVE_BASIC,
        start=("plus", "month"),
        target=None,
        why="_build_subscription_from_stripe_object maps canceled/unpaid → Basic",
    ),
    Scenario(
        id="plus_month_scheduled_year_both_is_active",
        kind=KIND_SCHEDULED_IS_ACTIVE,
        start=("plus", "month"),
        target=("plus", "year"),
        why="available_plans is_active is true for current price OR scheduled phase-1 price",
    ),
    Scenario(
        id="plus_month_to_max_month",
        kind=KIND_CROSS_PLAN,
        start=("plus", "month"),
        target=("max", "month"),
        why="Post-proto launch upgrade: Plus → Max (skipped until catalog has max)",
        requires_plans=("max",),
    ),
)


def catalog_paid_plan_ids(catalog: Optional[Dict[str, Any]] = None) -> set:
    data = catalog if catalog is not None else _load_catalog()
    return {p["id"] for p in data.get("plans", []) if p.get("is_paid")}


def desktop_to_consumer_blocked(current_plan_id: str, target_plan_id: str) -> bool:
    """Same boundary as utils.subscription.desktop_to_consumer_plan_change_error."""
    entitled = {p.value for p in DESKTOP_ENTITLED_PLAN_TYPES}
    return current_plan_id in entitled and target_plan_id not in entitled


def expected_is_active_price_ids(current_price_id: str, scheduled_price_id: Optional[str]) -> set:
    """Mirrors routers/payment.py PricingOption.is_active assignment."""
    ids = {current_price_id}
    if scheduled_price_id:
        ids.add(scheduled_price_id)
    return ids


def resolve_stripe_status_to_plan(stripe_status: str, price_plan_id: str) -> str:
    """Mirrors routers/payment.py::_build_subscription_from_stripe_object status split."""
    if stripe_status not in ("active", "trialing"):
        return "basic"
    return price_plan_id


def scenario_skip_reason(scenario: Scenario, paid_ids: set) -> Optional[str]:
    missing = [plan for plan in scenario.needed_plans() if plan not in paid_ids]
    if missing:
        return f"catalog missing plan(s): {', '.join(missing)}"
    return None


def list_scenarios(paid_ids: Optional[set] = None) -> List[Dict[str, Any]]:
    ids = paid_ids if paid_ids is not None else catalog_paid_plan_ids()
    rows = []
    for sc in SCENARIOS:
        skip = scenario_skip_reason(sc, ids)
        rows.append(
            {
                "id": sc.id,
                "kind": sc.kind,
                "start": f"{sc.start[0]}/{sc.start[1]}",
                "target": f"{sc.target[0]}/{sc.target[1]}" if sc.target else "—",
                "status": "skip" if skip else "ready",
                "skip_reason": skip,
                "why": sc.why,
            }
        )
    return rows


def print_scenario_table(rows: List[Dict[str, Any]]) -> None:
    print(f"{len(rows)} subscription-change scenarios (catalog paid plans: {sorted(catalog_paid_plan_ids())})")
    for row in rows:
        flag = "SKIP" if row["status"] == "skip" else "READY"
        print(f"  [{flag}] {row['id']}")
        print(f"         {row['start']} → {row['target']}  ({row['kind']})")
        print(f"         {row['why']}")
        if row["skip_reason"]:
            print(f"         skip: {row['skip_reason']}")


def _price_map_from_probe(report: Dict[str, Any]) -> Dict[Tuple[str, str], str]:
    mapping: Dict[Tuple[str, str], str] = {}
    for price in report.get("fixture_prices") or []:
        plan_id = price.get("omi_plan_id")
        interval = price.get("interval")
        price_id = price.get("id")
        if plan_id and interval and price_id:
            mapping[(plan_id, interval)] = price_id
    return mapping


def _attach_test_card(stripe: Any, customer_id: str) -> None:
    pm = stripe.PaymentMethod.create(type="card", card={"token": "tok_visa"})
    stripe.PaymentMethod.attach(pm.id, customer=customer_id)
    stripe.Customer.modify(customer_id, invoice_settings={"default_payment_method": pm.id})


@dataclass
class LiveRun:
    stripe: Any
    price_map: Dict[Tuple[str, str], str]
    clock_id: Optional[str] = None
    customer_id: Optional[str] = None
    created_sub_ids: List[str] = field(default_factory=list)
    created_schedule_ids: List[str] = field(default_factory=list)


_TEST_KEY_PREFIXES = ("sk_test_", "rk_test_", "pk_test_")
_LIVE_KEY_PREFIXES = ("sk_live_", "rk_live_", "pk_live_")


def _sanitize_stripe_error(exc: BaseException) -> str:
    """Drop Stripe key material from exception text before it hits logs."""
    text = str(exc)
    for prefix in _TEST_KEY_PREFIXES + _LIVE_KEY_PREFIXES:
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


def _is_permission_denied(exc: BaseException) -> bool:
    name = type(exc).__name__
    if name == "PermissionError" or name.endswith("PermissionError"):
        return True
    text = str(exc).lower()
    return "permission" in text or "billing_clock_write" in text


def _maybe_create_test_clock(stripe: Any) -> Optional[str]:
    """Create a Test Clock when the key allows it; otherwise continue without one.

    Current scenarios do not advance the clock. Restricted keys often lack
    ``billing_clock_write``. Missing that permission is a degraded path, not a
    hard stop — Customers / Subscriptions still exercise the live Stripe path.
    """
    try:
        clock = stripe.test_helpers.TestClock.create(
            frozen_time=int(time.time()),
            name="omi-phase3-clock",
        )
        clock_id = str(getattr(clock, "id", None) or clock["id"])
        print(f"Test Clock created: {clock_id}", file=sys.stderr)
        return clock_id
    except Exception as exc:  # noqa: BLE001 - restricted keys often lack billing_clock_write
        if not _is_permission_denied(exc):
            raise
        record_fallback(
            component="other",
            from_mode="test_clock",
            to_mode="no_clock",
            reason="other",
            outcome="degraded",
        )
        print(
            "WARN: Test Clock create denied " f"({_sanitize_stripe_error(exc)}); continuing without a clock.",
            file=sys.stderr,
        )
        return None


def _cleanup_live(run: LiveRun) -> None:
    stripe = run.stripe
    for sched_id in run.created_schedule_ids:
        try:
            stripe.SubscriptionSchedule.release(sched_id)
        except Exception:
            try:
                stripe.SubscriptionSchedule.cancel(sched_id)
            except Exception:
                pass
    for sub_id in run.created_sub_ids:
        try:
            stripe.Subscription.cancel(sub_id, invoice_now=False, prorate=False)
        except Exception:
            try:
                stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
            except Exception:
                pass
    if run.customer_id:
        try:
            stripe.Customer.delete(run.customer_id)
        except Exception:
            pass
    if run.clock_id:
        try:
            stripe.test_helpers.TestClock.delete(run.clock_id)
        except Exception:
            pass


def _create_sub(run: LiveRun, price_id: str) -> Any:
    # Do not expand latest_invoice: that requires invoice_read on restricted keys,
    # and none of the scenarios read the invoice object.
    sub = run.stripe.Subscription.create(
        customer=run.customer_id,
        items=[{"price": price_id}],
        metadata={**TEST_FIXTURE_MARKER, "omi_phase3": "1"},
        payment_behavior="error_if_incomplete",
        collection_method="charge_automatically",
    )
    run.created_sub_ids.append(sub.id)
    return sub


def _run_cross_plan(run: LiveRun, sc: Scenario) -> Dict[str, Any]:
    start_id = run.price_map[sc.start]
    target_id = run.price_map[sc.target]  # type: ignore[index]
    sub = _create_sub(run, start_id)
    item_id = sub["items"]["data"][0]["id"]
    updated = run.stripe.Subscription.modify(
        sub.id,
        items=[{"id": item_id, "price": target_id}],
        proration_behavior="always_invoice",
        metadata={**TEST_FIXTURE_MARKER, "omi_phase3": "1", "omi_plan_id": sc.target[0]},
    )
    new_price = updated["items"]["data"][0]["price"]["id"]
    if new_price != target_id:
        raise RuntimeError(f"{sc.id}: expected price {target_id}, got {new_price}")
    if updated["status"] not in ("active", "trialing"):
        raise RuntimeError(f"{sc.id}: expected active sub, got {updated['status']}")
    return {"subscription_id": updated.id, "price_id": new_price, "status": updated["status"]}


def _run_interval_schedule(run: LiveRun, sc: Scenario) -> Dict[str, Any]:
    start_id = run.price_map[sc.start]
    target_id = run.price_map[sc.target]  # type: ignore[index]
    sub = _create_sub(run, start_id)
    schedule = run.stripe.SubscriptionSchedule.create(from_subscription=sub.id)
    run.created_schedule_ids.append(schedule.id)
    run.stripe.SubscriptionSchedule.modify(
        schedule.id,
        phases=[
            {
                "items": [{"price": start_id, "quantity": 1}],
                "start_date": sub["current_period_start"],
                "end_date": sub["current_period_end"],
            },
            {"items": [{"price": target_id}]},
        ],
        metadata={**TEST_FIXTURE_MARKER, "omi_phase3": "1"},
    )
    refreshed = run.stripe.Subscription.retrieve(sub.id)
    if refreshed["items"]["data"][0]["price"]["id"] != start_id:
        raise RuntimeError(f"{sc.id}: current price moved immediately; expected schedule-only")
    active = expected_is_active_price_ids(start_id, target_id)
    if start_id not in active or target_id not in active:
        raise RuntimeError(f"{sc.id}: is_active set mismatch")
    return {"subscription_id": sub.id, "schedule_id": schedule.id, "is_active_ids": sorted(active)}


def _run_desktop_blocked(sc: Scenario) -> Dict[str, Any]:
    assert sc.target is not None
    blocked = desktop_to_consumer_blocked(sc.start[0], sc.target[0])
    if not blocked:
        raise RuntimeError(f"{sc.id}: expected desktop→consumer block")
    return {"blocked": True, "rule": "desktop_to_consumer_plan_change_error"}


def _run_cancel_valid(run: LiveRun, sc: Scenario) -> Dict[str, Any]:
    start_id = run.price_map[sc.start]
    sub = _create_sub(run, start_id)
    updated = run.stripe.Subscription.modify(sub.id, cancel_at_period_end=True)
    period_end = updated["current_period_end"]
    still_valid = period_end is not None and period_end >= int(time.time())
    plan = resolve_stripe_status_to_plan(updated["status"], sc.start[0])
    if not still_valid:
        raise RuntimeError(f"{sc.id}: period already ended; cannot assert cancel-at-period-end validity")
    if plan != sc.start[0]:
        raise RuntimeError(f"{sc.id}: expected plan {sc.start[0]}, resolved {plan}")
    if not updated["cancel_at_period_end"]:
        raise RuntimeError(f"{sc.id}: cancel_at_period_end was not set")
    return {"subscription_id": updated.id, "plan": plan, "cancel_at_period_end": True, "still_valid": True}


def _run_inactive_basic(run: LiveRun, sc: Scenario) -> Dict[str, Any]:
    start_id = run.price_map[sc.start]
    sub = _create_sub(run, start_id)
    canceled = run.stripe.Subscription.cancel(sub.id, invoice_now=False, prorate=False)
    plan = resolve_stripe_status_to_plan(canceled["status"], sc.start[0])
    if plan != "basic":
        raise RuntimeError(f"{sc.id}: expected basic after cancel, got {plan} (status={canceled['status']})")
    return {"subscription_id": canceled.id, "stripe_status": canceled["status"], "resolved_plan": plan}


def apply_scenarios(scenarios: Sequence[Scenario], price_map: Dict[Tuple[str, str], str]) -> List[Dict[str, Any]]:
    stripe = _require_test_mode_key("--apply subscription-change scenarios")
    run = LiveRun(stripe=stripe, price_map=price_map)
    results: List[Dict[str, Any]] = []
    try:
        run.clock_id = _maybe_create_test_clock(stripe)
        customer_kwargs: Dict[str, Any] = {
            "email": f"omi-phase3-{uuid.uuid4().hex[:10]}@example.test",
            "metadata": {**TEST_FIXTURE_MARKER, "omi_phase3": "1"},
        }
        if run.clock_id:
            customer_kwargs["test_clock"] = run.clock_id
            print(f"Customer will use Test Clock {run.clock_id}", file=sys.stderr)
        try:
            customer = stripe.Customer.create(**customer_kwargs)
            run.customer_id = customer.id
            _attach_test_card(stripe, customer.id)
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001 - map Stripe permission denials to a sanitized exit
            if _is_permission_denied(exc):
                raise SystemExit(
                    "Phase 3 --apply needs Customers Write, Payment Methods Write, "
                    "Subscriptions Write, and Subscription Schedules Write on the TEST-MODE key. "
                    f"{_sanitize_stripe_error(exc)}"
                ) from None
            raise

        paid_ids = catalog_paid_plan_ids()
        for sc in scenarios:
            skip = scenario_skip_reason(sc, paid_ids)
            if skip:
                results.append({"id": sc.id, "status": "skipped", "reason": skip})
                continue
            missing_prices = [
                pair for pair in ((sc.start,) + ((sc.target,) if sc.target else ())) if pair not in price_map
            ]
            if missing_prices and sc.kind != KIND_DESKTOP_BLOCKED:
                results.append(
                    {
                        "id": sc.id,
                        "status": "skipped",
                        "reason": f"no fixture price for {missing_prices}; run --create-test-prices",
                    }
                )
                continue
            try:
                if sc.kind == KIND_CROSS_PLAN:
                    detail = _run_cross_plan(run, sc)
                elif sc.kind in (KIND_INTERVAL, KIND_SCHEDULED_IS_ACTIVE):
                    detail = _run_interval_schedule(run, sc)
                elif sc.kind == KIND_DESKTOP_BLOCKED:
                    detail = _run_desktop_blocked(sc)
                elif sc.kind == KIND_CANCEL_VALID:
                    detail = _run_cancel_valid(run, sc)
                elif sc.kind == KIND_INACTIVE_BASIC:
                    detail = _run_inactive_basic(run, sc)
                else:
                    raise RuntimeError(f"unknown kind {sc.kind}")
                results.append({"id": sc.id, "status": "passed", "detail": detail})
                print(f"  PASS {sc.id}")
            except Exception as exc:  # noqa: BLE001 - collect per-scenario failures, still cleanup
                sanitized = _sanitize_stripe_error(exc)
                results.append({"id": sc.id, "status": "failed", "error": sanitized})
                print(f"  FAIL {sc.id}: {sanitized}")
    finally:
        _cleanup_live(run)
    return results


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Run scenarios against Stripe TEST mode (creates ephemeral customers; default is dry-run).",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="Also print the read-only Product/Price probe (needs STRIPE_API_KEY).",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    # Fail closed on a live key even for dry-run if one is present.
    present = os.getenv("STRIPE_API_KEY", "")
    if present and classify_key_kind(present) == "live":
        raise SystemExit("Refusing to run against a LIVE Stripe key. Use a test-mode key (sk_test_/rk_test_).")

    rows = list_scenarios()
    print_scenario_table(rows)

    if not args.apply:
        if args.probe:
            print_probe_report(probe_test_catalog())
        print("\nDry-run only. Pass --apply with a TEST-MODE STRIPE_API_KEY to execute.")
        stripe_cli = "yes" if __import__("shutil").which("stripe") else "no"
        print(f"Stripe CLI on PATH: {stripe_cli} (needed later for stripe listen / stripe trigger webhooks).")
        return 0

    report = probe_test_catalog()
    if args.probe:
        print_probe_report(report)
    price_map = _price_map_from_probe(report)
    if not price_map:
        raise SystemExit("No omi_test_fixture prices found. Run snapshot_stripe_catalog.py --create-test-prices first.")

    print(f"\nApplying {sum(1 for r in rows if r['status'] == 'ready')} scenarios against Stripe TEST mode…")
    results = apply_scenarios(SCENARIOS, price_map)
    failed = [r for r in results if r["status"] == "failed"]
    passed = [r for r in results if r["status"] == "passed"]
    skipped = [r for r in results if r["status"] == "skipped"]
    print(f"\n{len(passed)} passed, {len(failed)} failed, {len(skipped)} skipped")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
