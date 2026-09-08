"""Subscription plan tests — migrated off module-scope ``sys.modules`` mutation.

``utils.subscription`` pulls in ``database.users`` at import time, which itself
imports back from ``utils.subscription`` (circular). The original test broke the
cycle by pre-corrupting ``sys.modules`` at module scope with empty stubs. This
file uses the sanctioned Tier-2 reserve seam: a module-scoped fixture that
installs the stubs via ``stub_modules`` and exec's ``utils.subscription`` fresh
with ``load_module_fresh``, then restores on teardown. See
backend/docs/test_isolation.md and testing/import_isolation.py.
"""

import logging
import os
from pathlib import Path
from types import ModuleType
from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest

from models.users import PlanType, Subscription, SubscriptionStatus, UserSubscriptionResponse
from testing.import_isolation import load_module_fresh, stub_modules

_BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def subscription_module():
    """Load a fresh ``utils.subscription`` against stubbed circular-import deps."""
    announcements_stub = ModuleType("database.announcements")
    announcements_stub.compare_versions = lambda a, b: 0
    client_stub = ModuleType("database._client")
    client_stub.get_customer_firestore_client = MagicMock()

    fakes = {
        "database.announcements": announcements_stub,
        "database._client": client_stub,
        "database.users": ModuleType("database.users"),
        "database.user_usage": ModuleType("database.user_usage"),
    }
    with stub_modules(fakes):
        module = load_module_fresh(
            "utils.subscription",
            os.path.join(str(_BACKEND), "utils", "subscription.py"),
        )
        yield module


def test_architect_price_ids_map_to_architect_plan(monkeypatch, subscription_module):
    monkeypatch.setenv("STRIPE_UNLIMITED_MONTHLY_PRICE_ID", "price_unlimited_monthly")
    monkeypatch.setenv("STRIPE_UNLIMITED_ANNUAL_PRICE_ID", "price_unlimited_annual")
    monkeypatch.setenv("STRIPE_ARCHITECT_MONTHLY_PRICE_ID", "price_architect_monthly")
    monkeypatch.setenv("STRIPE_ARCHITECT_ANNUAL_PRICE_ID", "price_architect_annual")

    get_plan_type_from_price_id = subscription_module.get_plan_type_from_price_id

    assert get_plan_type_from_price_id("price_unlimited_monthly") == PlanType.unlimited
    assert get_plan_type_from_price_id("price_unlimited_annual") == PlanType.unlimited
    assert get_plan_type_from_price_id("price_architect_monthly") == PlanType.architect
    assert get_plan_type_from_price_id("price_architect_annual") == PlanType.architect


def test_dev_startup_skips_stripe_price_validation(monkeypatch, subscription_module, caplog):
    monkeypatch.setenv('OMI_ENV_STAGE', 'dev')
    caplog.set_level(logging.INFO, logger=subscription_module.__name__)
    definitions = MagicMock()
    retrieve = MagicMock()
    fallback = MagicMock()
    monkeypatch.setattr(subscription_module, 'get_paid_plan_definitions', definitions)
    monkeypatch.setattr(subscription_module.stripe.Price, 'retrieve', retrieve)
    monkeypatch.setattr(subscription_module, 'record_fallback', fallback)

    subscription_module.validate_stripe_price_ids()

    definitions.assert_not_called()
    retrieve.assert_not_called()
    fallback.assert_called_once_with(
        component='other',
        from_mode='stripe_price_validation',
        to_mode='dev_skip',
        reason='policy',
        outcome='degraded',
        log=subscription_module.logger,
    )
    assert 'Skipping Stripe price validation during dev startup.' in caplog.messages


def test_prod_startup_validates_stripe_price_ids(monkeypatch, subscription_module):
    monkeypatch.setenv('OMI_ENV_STAGE', 'prod')
    monkeypatch.setattr(
        subscription_module,
        'get_paid_plan_definitions',
        lambda: [
            {
                'plan_id': 'operator',
                'monthly_price_id': 'price_operator_monthly',
                'annual_price_id': 'price_operator_annual',
            }
        ],
    )
    retrieve = MagicMock()
    monkeypatch.setattr(subscription_module.stripe.Price, 'retrieve', retrieve)

    subscription_module.validate_stripe_price_ids()

    assert retrieve.call_args_list == [call('price_operator_monthly'), call('price_operator_annual')]


def test_architect_is_treated_as_paid_unlimited_plan(subscription_module):
    assert subscription_module.is_paid_plan(PlanType.architect) is True
    assert subscription_module.get_plan_limits(PlanType.architect).transcription_seconds is None
    assert "Automations and vibe coding" in subscription_module.get_plan_features(PlanType.architect)
    assert "Unlimited listening, memories, and insights" in subscription_module.get_plan_features(PlanType.architect)


def test_basic_plan_features_include_unlimited_memories(subscription_module):
    features = subscription_module.get_plan_features(PlanType.basic)
    assert "Unlimited memories" in features


def test_cancellation_is_pending_until_period_end(subscription_module):
    subscription = SimpleNamespace(cancel_at_period_end=True, current_period_end=200)

    assert subscription_module.is_pending_cancellation(subscription, now=199)
    assert not subscription_module.is_pending_cancellation(subscription, now=200)


def test_missing_period_end_is_still_pending_cancellation(subscription_module):
    subscription = SimpleNamespace(cancel_at_period_end=True, current_period_end=None)

    assert subscription_module.is_pending_cancellation(subscription, now=200)


def test_can_pay_basic_stale_defers_plan_change_until_cancellation_ends(monkeypatch, subscription_module):
    """A cancel-at-period-end Stripe subscription must block a different target
    price even when the local Firestore record is missing/basic (lag or recovery).
    Same-price reactivation stays allowed in that branch."""
    sub = subscription_module

    # Firestore record is basic/stale -> no pending cancellation there.
    monkeypatch.setattr(sub, "users_db", SimpleNamespace())
    sub.users_db.get_user_valid_subscription = lambda uid: None
    sub.users_db.get_stripe_customer_id = lambda uid: "cus_x"
    # No active (non-canceling) subscription, so the basic branch proceeds.
    monkeypatch.setattr(sub, "_has_active_stripe_subscription", lambda uid: False)

    pending = SimpleNamespace(
        plan="paid",
        status="active",
        cancel_at_period_end=True,
        current_period_end=2_000_000_000,
        current_price_id="price_current",
    )
    monkeypatch.setattr(sub, "find_active_paid_subscription_for_user", lambda uid: pending)
    monkeypatch.setattr(
        sub,
        "price_ids_match_plan_and_interval",
        lambda current_price_id, target_price_id: current_price_id == target_price_id,
    )

    # Different target price must be deferred even though Firestore is basic.
    can_pay, reason = sub.can_user_make_payment("u1", target_price_id="price_target")
    assert can_pay is False
    assert "after the current subscription ends" in reason

    # Same-price reactivation is allowed.
    can_pay, reason = sub.can_user_make_payment("u1", target_price_id="price_current")
    assert can_pay is True
    assert "reactivate" in reason


def test_retained_price_matches_current_price_with_same_plan_and_interval(monkeypatch, subscription_module):
    sub = subscription_module
    retained_price_id = "price_1RtJPm1F8wnoWYvwhVJ38kLb"
    monkeypatch.setenv("STRIPE_UNLIMITED_MONTHLY_PRICE_ID", "price_unlimited_monthly")
    monkeypatch.setenv("STRIPE_UNLIMITED_ANNUAL_PRICE_ID", "price_unlimited_annual")

    retrieve = MagicMock(side_effect=AssertionError("retained catalog prices must not require a Stripe read"))
    monkeypatch.setattr(sub.stripe.Price, "retrieve", retrieve)

    assert sub.price_ids_match_plan_and_interval(retained_price_id, "price_unlimited_monthly")
    assert not sub.price_ids_match_plan_and_interval(retained_price_id, "price_unlimited_annual")
    retrieve.assert_not_called()


def test_price_interval_lookup_handles_price_without_recurring(monkeypatch, subscription_module):
    sub = subscription_module
    configured_alias_price_id = "price_configured_neo_alias"
    monkeypatch.setenv("STRIPE_UNLIMITED_MONTHLY_PRICE_ID", "price_unlimited_monthly")
    monkeypatch.setenv("STRIPE_UNLIMITED_ANNUAL_PRICE_ID", "price_unlimited_annual")
    monkeypatch.setenv("STRIPE_NEO_MONTHLY_PRICE_ID", configured_alias_price_id)

    # A configured migration alias without a catalog-ledger interval whose
    # Stripe object carries no recurring block must not crash the lookup.
    price_without_recurring = MagicMock()
    del price_without_recurring.recurring
    monkeypatch.setattr(sub.stripe.Price, "retrieve", MagicMock(return_value=price_without_recurring))

    assert not sub.price_ids_match_plan_and_interval(configured_alias_price_id, "price_unlimited_monthly")
    assert not sub.price_ids_match_plan_and_interval(configured_alias_price_id, "price_unlimited_annual")


def test_reconcile_basic_subscription_without_stored_stripe_id(monkeypatch, subscription_module):
    sub = subscription_module
    stored = SimpleNamespace(plan=PlanType.basic, stripe_subscription_id=None, current_period_end=None)
    recovered = MagicMock()
    recovered.model_dump.return_value = {"stripe_subscription_id": "sub_recovered"}
    users_db = SimpleNamespace(update_user_subscription=MagicMock())
    monkeypatch.setattr(sub, "users_db", users_db)
    monkeypatch.setattr(sub, "find_active_paid_subscription_for_user", lambda uid: recovered)

    assert sub.reconcile_basic_plan_with_stripe("u1", stored) is recovered
    users_db.update_user_subscription.assert_called_once_with("u1", {"stripe_subscription_id": "sub_recovered"})


def test_unlimited_transcription_plan_skips_monthly_usage_scan(monkeypatch, subscription_module):
    monkeypatch.setattr(subscription_module, 'is_trial_paywalled', lambda uid, source=None, **kw: False)
    monkeypatch.setattr(subscription_module.users_db, 'is_byok_active', lambda uid: False, raising=False)
    monkeypatch.setattr(subscription_module, 'get_byok_key', lambda provider: None)
    monkeypatch.setattr(
        subscription_module.users_db,
        'get_user_valid_subscription',
        lambda uid: SimpleNamespace(plan=PlanType.architect),
        raising=False,
    )
    monthly_usage = MagicMock(return_value={'transcription_seconds': 999999})
    monkeypatch.setattr(subscription_module, 'get_monthly_usage_for_subscription', monthly_usage)

    assert subscription_module.has_transcription_credits('uid') is True
    monthly_usage.assert_not_called()


def test_bounded_transcription_plan_reads_monthly_usage_and_enforces_cap(monkeypatch, subscription_module):
    monkeypatch.setattr(subscription_module, 'is_trial_paywalled', lambda uid, source=None, **kw: False)
    monkeypatch.setattr(subscription_module.users_db, 'is_byok_active', lambda uid: False, raising=False)
    monkeypatch.setattr(subscription_module, 'get_byok_key', lambda provider: None)
    monkeypatch.setattr(
        subscription_module.users_db,
        'get_user_valid_subscription',
        lambda uid: SimpleNamespace(plan=PlanType.basic),
        raising=False,
    )
    # The allowance resolver reads the catalog through `transcription_allowance_seconds`
    # (never the env overlay behind `get_plan_limits`), so that is the seam to stub.
    monkeypatch.setattr(subscription_module, 'transcription_allowance_seconds', lambda plan: 60)
    monthly_usage = MagicMock(return_value={'transcription_seconds': 60})
    monkeypatch.setattr(subscription_module, 'get_monthly_usage_for_subscription', monthly_usage)

    assert subscription_module.has_transcription_credits('uid') is False
    monthly_usage.assert_called_once_with('uid')


def test_zero_transcription_allowance_is_exhausted_not_unlimited(monkeypatch, subscription_module):
    _stub_remaining_deps(monkeypatch, subscription_module, PlanType.basic, used_seconds=0)
    monkeypatch.setattr(subscription_module, 'transcription_allowance_seconds', lambda plan: 0)

    assert subscription_module.has_transcription_credits('uid') is False
    assert subscription_module.get_remaining_transcription_seconds('uid') == 0


def test_malformed_transcription_allowance_fails_loudly(monkeypatch, subscription_module):
    original_allocation_limit = subscription_module.allocation_limit

    def malformed_allocation_limit(plan, allocation):
        if allocation == 'transcription':
            raise KeyError('basic.transcription limit is missing')
        return original_allocation_limit(plan, allocation)

    monkeypatch.setattr(subscription_module, 'allocation_limit', malformed_allocation_limit)

    with pytest.raises(KeyError, match='limit is missing'):
        subscription_module.get_plan_limits(PlanType.basic)


def _stub_remaining_deps(monkeypatch, subscription_module, plan, used_seconds):
    monkeypatch.setattr(subscription_module, 'is_trial_paywalled', lambda uid, source=None, **kw: False)
    monkeypatch.setattr(subscription_module.users_db, 'is_byok_active', lambda uid: False, raising=False)
    monkeypatch.setattr(subscription_module, 'get_byok_key', lambda provider: None)
    monkeypatch.setattr(
        subscription_module.users_db,
        'get_user_valid_subscription',
        lambda uid: SimpleNamespace(plan=plan),
        raising=False,
    )
    monkeypatch.setattr(
        subscription_module,
        'get_monthly_usage_for_subscription',
        lambda uid: {'transcription_seconds': used_seconds},
    )


def test_remaining_transcription_seconds_enforces_plus_bounded_cap(monkeypatch, subscription_module):
    # Plus is a paid plan but carries a bounded 1500-min/month transcription cap. The
    # remaining seconds must be reported (so the freemium on-device switch can fire), not
    # short-circuited to None as if the plan were unlimited.
    cap = subscription_module.PLUS_TIER_MONTHLY_SECONDS_LIMIT
    assert cap and cap > 0  # Plus is bounded by construction
    _stub_remaining_deps(monkeypatch, subscription_module, PlanType.plus, used_seconds=cap - 10000)
    assert subscription_module.get_remaining_transcription_seconds('uid') == 10000


def test_remaining_transcription_seconds_zero_at_plus_cap(monkeypatch, subscription_module):
    cap = subscription_module.PLUS_TIER_MONTHLY_SECONDS_LIMIT
    _stub_remaining_deps(monkeypatch, subscription_module, PlanType.plus, used_seconds=cap + 5000)
    assert subscription_module.get_remaining_transcription_seconds('uid') == 0


def test_remaining_transcription_seconds_none_for_unlimited_paid_plan(monkeypatch, subscription_module):
    # Genuinely-unlimited paid plans (transcription_seconds unset) must still report None,
    # i.e. dropping the is_paid_plan short-circuit must not start capping them.
    for plan in (PlanType.architect, PlanType.operator, PlanType.unlimited, PlanType.unlimited_v2):
        _stub_remaining_deps(monkeypatch, subscription_module, plan, used_seconds=10_000_000)
        assert subscription_module.get_remaining_transcription_seconds('uid') is None, plan


def test_plus_and_unlimited_v2_price_ids_resolve(monkeypatch, subscription_module):
    monkeypatch.setenv("STRIPE_PLUS_MONTHLY_PRICE_ID", "price_plus_monthly")
    monkeypatch.setenv("STRIPE_PLUS_ANNUAL_PRICE_ID", "price_plus_annual")
    monkeypatch.setenv("STRIPE_UNLIMITED_V2_MONTHLY_PRICE_ID", "price_unlimited_v2_monthly")

    resolve = subscription_module.get_plan_type_from_price_id
    assert resolve("price_plus_monthly") == PlanType.plus
    assert resolve("price_plus_annual") == PlanType.plus
    assert resolve("price_unlimited_v2_monthly") == PlanType.unlimited_v2


def test_plus_is_capped_unlimited_v2_is_unlimited(subscription_module):
    plus = subscription_module.get_plan_limits(PlanType.plus)
    max_ = subscription_module.get_plan_limits(PlanType.unlimited_v2)
    assert plus.transcription_seconds == subscription_module.PLUS_TIER_MONTHLY_SECONDS_LIMIT
    assert plus.transcription_seconds and plus.transcription_seconds > 0
    assert max_.transcription_seconds is None
    assert subscription_module.is_paid_plan(PlanType.plus) is True
    assert subscription_module.is_paid_plan(PlanType.unlimited_v2) is True


def _released_subscription_response(plan: PlanType) -> UserSubscriptionResponse:
    return UserSubscriptionResponse(
        subscription=Subscription(plan=plan),
        transcription_seconds_used=0,
        transcription_seconds_limit=0,
        words_transcribed_used=0,
        words_transcribed_limit=0,
        insights_gained_used=0,
        insights_gained_limit=0,
    )


def test_wire_plan_remaps_fallback_tiers_for_clients_without_the_enum(monkeypatch, subscription_module):
    # The module fixture stubs compare_versions to a no-op; use a real semver
    # comparator so the version floor actually gates the remap.
    def _cmp(a, b):
        pa = [int(x) for x in a.split('.')]
        pb = [int(x) for x in b.split('.')]
        return (pa > pb) - (pa < pb)

    monkeypatch.setattr(subscription_module, 'compare_versions', _cmp)
    wire = subscription_module.wire_plan_for_client
    # Current clients (below the plus/unlimited_v2-aware floor) must see a known paid label.
    # unlimited_v2 is keep-until-cancel, not a sold mobile SKU — still remap it.
    # Leaving it on the wire 500s UserSubscriptionResponse and Settings shows Free.
    assert wire(PlanType.plus, 'ios', '1.0.600') == PlanType.unlimited
    assert wire(PlanType.pro_v2, 'ios', '1.0.600') == PlanType.unlimited
    assert wire(PlanType.unlimited_v2, 'android', '1.0.600') == PlanType.unlimited
    assert wire(PlanType.unlimited_v2, 'ios', '1.0.600') == PlanType.unlimited
    assert wire(PlanType.plus, 'macos', '0.12.0') == PlanType.unlimited
    assert wire(PlanType.unlimited_v2, 'macos', '0.12.0') == PlanType.unlimited
    assert _released_subscription_response(wire(PlanType.unlimited_v2, 'ios', '1.0.600')).subscription.plan == (
        PlanType.unlimited
    )
    # A plus/unlimited_v2-aware client (at/above the floor) receives the real plan.
    assert wire(PlanType.plus, 'ios', '999.0.0') == PlanType.plus
    assert wire(PlanType.unlimited_v2, 'ios', '999.0.0') == PlanType.unlimited_v2
    # Plans already on the released wire are never remapped.
    assert wire(PlanType.unlimited, 'ios', '1.0.600') == PlanType.unlimited
    assert wire(PlanType.operator, 'ios', '1.0.600') == PlanType.operator


def test_plus_and_unlimited_v2_features_state_transcription_limits(subscription_module):
    """Mobile cards render get_plan_features; Plus/Unlimited must state their
    transcription terms, not fall through to the Free-tier feature list."""
    m = subscription_module
    plus_mobile = m.get_plan_features(PlanType.plus, simplified=True)
    unlim_mobile = m.get_plan_features(PlanType.unlimited_v2, simplified=True)

    assert any("minutes of transcription" in f for f in plus_mobile), plus_mobile
    assert any(f"{m.PLUS_TIER_MINUTES_LIMIT_PER_MONTH:,}" in f for f in plus_mobile), plus_mobile
    assert any("Unlimited transcription" in f for f in unlim_mobile), unlim_mobile
    # Must not leak the Free-tier "Unlimited listening time" fallback.
    assert not any("listening" in f for f in plus_mobile), plus_mobile


def test_basic_feature_defaults_project_from_plan_limits(monkeypatch, subscription_module):
    monkeypatch.setattr(
        subscription_module,
        'get_plan_limits',
        lambda plan: SimpleNamespace(transcription_seconds=600, words_transcribed=7, insights_gained=9),
    )

    features = subscription_module.get_plan_features(PlanType.basic)

    assert '10 minutes of listening per month' in features
    assert '7 words transcribed per month' in features
    assert '9 insights per month' in features


# ---------------------------------------------------------------------------
# resolve_subscription_lapse — "this account's paid access is ending or over"
#
# Every case below is built from a stored-row shape a real Stripe flow actually
# produces, and asserts through the pure resolver's injectable ``now`` seam.
# ---------------------------------------------------------------------------

_NOW = 1_700_000_000


def _paid_active(**overrides) -> Subscription:
    fields = {
        'plan': PlanType.plus,
        'status': SubscriptionStatus.active,
        'current_period_end': _NOW + 86_400,
        'stripe_subscription_id': 'sub_live_1',
        'current_price_id': 'price_plus_month',
    }
    fields.update(overrides)
    return Subscription(**fields)


def test_legacy_row_with_no_lapse_fields_resolves_exactly_as_today(subscription_module):
    """An unmigrated account whose stored subscription is only {plan, status}.

    This is the shape that predates every period/Stripe field, so there is no
    evidence of anything ending and the endpoint must behave as it does today.
    """
    legacy = Subscription(plan=PlanType.basic, status=SubscriptionStatus.active)

    assert legacy.current_period_end is None and legacy.stripe_subscription_id is None
    assert subscription_module.resolve_subscription_lapse(legacy, legacy, now=_NOW) is None


def test_never_subscribed_free_account_is_never_lapsed(subscription_module):
    """The provisioned default Free row, and a Free row that merely says 'free'.

    A Free plan or label is not evidence of a transition, so no amount of time
    passing may turn it into a lapse.
    """
    default_free = subscription_module.get_default_basic_subscription()

    assert subscription_module.resolve_subscription_lapse(default_free, default_free, now=_NOW) is None
    # Even a decade later: there is nothing that ended.
    assert subscription_module.resolve_subscription_lapse(default_free, default_free, now=_NOW + 10**9) is None
    # A Free row that somehow carries a past period end but no paid history at
    # all still is not a lapse — the guard is evidence, not the timestamp.
    stale_free = Subscription(plan=PlanType.basic, current_period_end=_NOW - 86_400)
    assert subscription_module.resolve_subscription_lapse(stale_free, stale_free, now=_NOW) is None


def test_active_paid_plan_has_no_lapse_state(subscription_module):
    active = _paid_active()

    assert subscription_module.resolve_subscription_lapse(active, active, now=_NOW) is None


def test_scheduled_cancellation_reports_user_requested_without_ending_access(subscription_module):
    """cancel_at_period_end + a future period end is written only by a cancel request.

    The user is still entitled here (get_user_valid_subscription returns the paid
    plan), so this state exists to say when access will end — it must not claim
    access is over, and it grants nothing either way.
    """
    scheduled = _paid_active(cancel_at_period_end=True)

    lapse = subscription_module.resolve_subscription_lapse(scheduled, scheduled, now=_NOW)

    assert lapse is not None
    assert lapse.state.value == 'cancellation_scheduled'
    assert lapse.reason.value == 'user_requested'
    assert lapse.recovery_action.value == 'keep_subscription'
    assert lapse.effective_at == _NOW + 86_400


def test_paid_row_whose_period_end_passed_reports_access_ended(subscription_module):
    """The 'expired' shape: a paid row that simply aged out (no webhook landed).

    ``get_user_valid_subscription`` resolves such an account to a fresh Free
    plan, so ``resolved`` is Free while ``stored`` still proves the paid period.
    """
    expired = _paid_active(current_period_end=_NOW - 1)
    resolved_free = subscription_module.get_default_basic_subscription()

    lapse = subscription_module.resolve_subscription_lapse(expired, resolved_free, now=_NOW)

    assert lapse is not None
    assert lapse.state.value == 'access_ended'
    assert lapse.recovery_action.value == 'resubscribe'
    assert lapse.effective_at == _NOW - 1
    # The resolved entitlement is untouched by the projection.
    assert resolved_free.plan is PlanType.basic


def test_webhook_downgraded_row_reports_access_ended_with_an_unknown_reason(subscription_module):
    """The row `_build_subscription_from_stripe_object` writes for every terminal status.

    A Stripe ``canceled``, ``unpaid``, ``past_due``, or ``incomplete_expired``
    subscription all produce this identical Free row (plan basic, status active,
    cancel_at_period_end False, the final period end, the subscription id kept,
    price dropped). The reason is therefore not recoverable from stored state and
    must be reported as ``unknown`` rather than guessed — see
    ``models.users.SubscriptionLapseReason``.
    """
    cancelled_row = Subscription(
        plan=PlanType.basic,
        status=SubscriptionStatus.active,
        current_period_end=_NOW - 3_600,
        stripe_subscription_id='sub_cancelled_1',
        cancel_at_period_end=False,
    )
    payment_failed_row = cancelled_row.model_copy(update={'stripe_subscription_id': 'sub_unpaid_1'})

    cancelled = subscription_module.resolve_subscription_lapse(cancelled_row, cancelled_row, now=_NOW)
    payment_failed = subscription_module.resolve_subscription_lapse(payment_failed_row, payment_failed_row, now=_NOW)

    assert cancelled is not None and payment_failed is not None
    assert cancelled.state.value == payment_failed.state.value == 'access_ended'
    assert cancelled.reason.value == payment_failed.reason.value == 'unknown'
    # The two rows are indistinguishable by construction; asserting they resolve
    # identically is the guard against a future 'reason' that pretends otherwise.
    assert cancelled.model_dump() == payment_failed.model_dump()
    assert {reason.value for reason in subscription_module.SubscriptionLapseReason} == {'user_requested', 'unknown'}


def test_a_resubscribed_account_is_not_reported_as_lapsed(subscription_module):
    """Reconciliation heals the row before the projection runs.

    ``reconcile_basic_plan_with_stripe`` can return the live paid subscription
    without mutating the stale stored object, so the resolver must decide
    liveness from the resolved entitlement, not from the stale stored row.
    """
    stale_stored = Subscription(
        plan=PlanType.basic,
        current_period_end=_NOW - 86_400,
        stripe_subscription_id='sub_old_1',
    )

    assert subscription_module.resolve_subscription_lapse(stale_stored, _paid_active(), now=_NOW) is None


def test_lapse_boundary_is_the_period_end_instant(subscription_module):
    """At exactly current_period_end access has not ended yet — the same
    inclusive rule get_user_valid_subscription applies to paid validity."""
    expiring = _paid_active(current_period_end=_NOW)

    assert subscription_module.resolve_subscription_lapse(expiring, expiring, now=_NOW) is None
    assert subscription_module.resolve_subscription_lapse(expiring, None, now=_NOW + 1) is not None
