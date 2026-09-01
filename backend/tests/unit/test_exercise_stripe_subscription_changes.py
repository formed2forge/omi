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
    assert rows["plus_month_cancel_at_period_end_then_basic"]["status"] == "ready"
    assert rows["plus_month_cancel_at_period_end_then_basic"]["kind"] == ex.KIND_PERIOD_END_BASIC


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
    assert "plus_month_cancel_at_period_end_then_basic" in out
    assert "Dry-run only" in out


def test_dry_run_refuses_live_key(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_live_should_never_run")
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        ex.main([])


def test_sanitize_stripe_error_redacts_restricted_key_material():
    leaked = "rk_test_THISMUSTNOTAPPEARINLOGS"
    text = ex._sanitize_stripe_error(PermissionError(f"key {leaked} lacks billing_clock_write"))
    assert leaked not in text
    assert "rk_test_<redacted>" in text


def test_sanitize_stripe_error_redacts_stripe_ellipsis_tail():
    text = ex._sanitize_stripe_error(
        PermissionError("The provided key 'rk_test_abcdef...EN4Z' does not have customer_write")
    )
    assert "EN4Z" not in text
    assert "abcdef" not in text
    assert "rk_test_<redacted>" in text


def test_maybe_create_test_clock_continues_on_permission_error(capsys):
    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def create(**_kwargs):
                    raise PermissionError("key rk_test_LEAKEDCLOCKKEY lacks billing_clock_write")

    clock_id = ex._maybe_create_test_clock(_Stripe)
    assert clock_id is None
    err = capsys.readouterr().err
    assert "LEAKEDCLOCKKEY" not in err
    assert "continuing without a clock" in err


def test_maybe_create_test_clock_reraises_non_permission_errors():
    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def create(**_kwargs):
                    raise RuntimeError("stripe down")

    with pytest.raises(RuntimeError, match="stripe down"):
        ex._maybe_create_test_clock(_Stripe)


def test_apply_scenarios_omits_test_clock_when_clock_create_denied(monkeypatch):
    captured: dict = {}
    fallbacks: list = []

    class _Obj:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def create(**_kwargs):
                    raise PermissionError("Restricted key missing billing_clock_write (rk_test_LEAKEDAPPLYKEY)")

                @staticmethod
                def delete(_clock_id):
                    raise AssertionError("clock should not be deleted when create was denied")

        class Customer:
            @staticmethod
            def create(**kwargs):
                captured["customer_kwargs"] = kwargs
                return _Obj(id="cus_phase3")

            @staticmethod
            def delete(_customer_id):
                captured["deleted"] = True

    monkeypatch.setattr(ex, "_require_test_mode_key", lambda *_a, **_k: _Stripe)
    monkeypatch.setattr(ex, "_attach_test_card", lambda *_a, **_k: None)
    monkeypatch.setattr(ex, "record_fallback", lambda **kwargs: fallbacks.append(kwargs))

    blocked = [sc for sc in ex.SCENARIOS if sc.kind == ex.KIND_DESKTOP_BLOCKED][:1]
    results = ex.apply_scenarios(blocked, {})
    assert "test_clock" not in captured["customer_kwargs"]
    assert captured["customer_kwargs"]["metadata"]["omi_phase3"] == "1"
    assert results[0]["status"] == "passed"
    assert fallbacks == [
        {
            "component": "other",
            "from_mode": "test_clock",
            "to_mode": "no_clock",
            "reason": "other",
            "outcome": "degraded",
        }
    ]
    assert captured.get("deleted") is True


def test_apply_scenarios_attaches_test_clock_when_create_succeeds(monkeypatch, capsys):
    captured: dict = {}

    class _Obj:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def create(**kwargs):
                    captured["clock_kwargs"] = kwargs
                    return _Obj(id="clock_phase3")

                @staticmethod
                def delete(clock_id):
                    captured["deleted_clock"] = clock_id

        class Customer:
            @staticmethod
            def create(**kwargs):
                captured["customer_kwargs"] = kwargs
                return _Obj(id="cus_phase3")

            @staticmethod
            def delete(_customer_id):
                captured["deleted"] = True

    monkeypatch.setattr(ex, "_require_test_mode_key", lambda *_a, **_k: _Stripe)
    monkeypatch.setattr(ex, "_attach_test_card", lambda *_a, **_k: None)
    fallbacks: list = []
    monkeypatch.setattr(ex, "record_fallback", lambda **kwargs: fallbacks.append(kwargs))

    blocked = [sc for sc in ex.SCENARIOS if sc.kind == ex.KIND_DESKTOP_BLOCKED][:1]
    results = ex.apply_scenarios(blocked, {})
    assert captured["customer_kwargs"]["test_clock"] == "clock_phase3"
    assert captured["deleted_clock"] == "clock_phase3"
    assert results[0]["status"] == "passed"
    assert fallbacks == []
    err = capsys.readouterr().err
    assert "Test Clock created: clock_phase3" in err
    assert "no_clock" not in err


def test_retire_open_subscriptions_cancels_then_clears():
    canceled: list[str] = []
    released: list[str] = []

    class _Stripe:
        class Subscription:
            @staticmethod
            def cancel(sub_id, **_kwargs):
                canceled.append(sub_id)

        class SubscriptionSchedule:
            @staticmethod
            def release(sched_id):
                released.append(sched_id)

    run = ex.LiveRun(stripe=_Stripe, price_map={})
    run.created_sub_ids = ["sub_a", "sub_b"]
    run.created_schedule_ids = ["sched_a"]
    ex._retire_open_subscriptions(run)
    assert canceled == ["sub_a", "sub_b"]
    assert released == ["sched_a"]
    assert run.created_sub_ids == []
    assert run.created_schedule_ids == []


def test_apply_scenarios_exits_sanitized_when_customer_write_denied(monkeypatch):
    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def create(**_kwargs):
                    raise PermissionError("billing_clock_write rk_test_LEAKEDCLOCKKEY")

                @staticmethod
                def delete(_clock_id):
                    pass

        class Customer:
            @staticmethod
            def create(**_kwargs):
                raise PermissionError("The provided key 'rk_test_LEAKEDCUSKEY...EN4Z' does not have customer_write")

            @staticmethod
            def delete(_customer_id):
                raise AssertionError("customer was not created")

    monkeypatch.setattr(ex, "_require_test_mode_key", lambda *_a, **_k: _Stripe)
    monkeypatch.setattr(ex, "record_fallback", lambda **_kwargs: None)

    with pytest.raises(SystemExit, match="Customers Write") as raised:
        ex.apply_scenarios([], {})
    message = str(raised.value)
    assert "LEAKEDCUSKEY" not in message
    assert "EN4Z" not in message
    assert "customer_write" in message


def test_create_sub_does_not_expand_latest_invoice():
    captured: dict = {}

    class _Stripe:
        class Subscription:
            @staticmethod
            def create(**kwargs):
                captured["kwargs"] = kwargs
                return type("Sub", (), {"id": "sub_test"})()

    run = ex.LiveRun(stripe=_Stripe, price_map={})
    run.customer_id = "cus_test"
    sub = ex._create_sub(run, "price_test")
    assert sub.id == "sub_test"
    assert run.created_sub_ids == ["sub_test"]
    assert "expand" not in captured["kwargs"]


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


class _Obj:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)

    def __getitem__(self, key):
        return self.__dict__[key]

    def get(self, key, default=None):
        return self.__dict__.get(key, default)


def test_subscription_period_end_prefers_subscription_then_item():
    assert ex._subscription_period_end({"current_period_end": 100}) == 100
    assert (
        ex._subscription_period_end({"items": {"data": [{"current_period_end": 200}]}}) == 200
    )
    assert ex._subscription_period_end({}) is None


def test_advance_test_clock_polls_until_ready(capsys):
    statuses = ["ready"]

    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def advance(clock_id, frozen_time):
                    assert clock_id == "clock_1"
                    assert frozen_time == 50
                    return _Obj(id=clock_id, status="advancing")

                @staticmethod
                def retrieve(clock_id):
                    return _Obj(id=clock_id, status=statuses.pop(0))

    run = ex.LiveRun(stripe=_Stripe, price_map={})
    run.clock_id = "clock_1"
    slept: list[float] = []
    clock = ex._advance_test_clock(run, 50, timeout=5, sleep=slept.append)
    assert clock["status"] == "ready"
    assert slept == [0.5]
    assert "advanced to 50" in capsys.readouterr().err


def test_advance_test_clock_raises_on_internal_failure():
    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def advance(_clock_id, **_kwargs):
                    return _Obj(status="internal_failure")

                @staticmethod
                def retrieve(_clock_id):
                    raise AssertionError("should not poll after internal_failure")

    run = ex.LiveRun(stripe=_Stripe, price_map={})
    run.clock_id = "clock_1"
    with pytest.raises(RuntimeError, match="internal_failure"):
        ex._advance_test_clock(run, 50, timeout=5, sleep=lambda _s: None)


def test_advance_test_clock_times_out(monkeypatch):
    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def advance(_clock_id, **_kwargs):
                    return _Obj(status="advancing")

                @staticmethod
                def retrieve(_clock_id):
                    return _Obj(status="advancing")

    run = ex.LiveRun(stripe=_Stripe, price_map={})
    run.clock_id = "clock_1"
    monkeypatch.setattr(ex.time, "time", lambda: 1000.0)
    with pytest.raises(RuntimeError, match="timed out"):
        ex._advance_test_clock(run, 50, timeout=0, sleep=lambda _s: None)


def test_apply_scenarios_skips_period_end_when_clock_denied(monkeypatch):
    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def create(**_kwargs):
                    raise PermissionError("Restricted key missing billing_clock_write")

                @staticmethod
                def delete(_clock_id):
                    raise AssertionError("clock should not be deleted when create was denied")

        class Customer:
            @staticmethod
            def create(**_kwargs):
                return _Obj(id="cus_phase3")

            @staticmethod
            def delete(_customer_id):
                pass

    monkeypatch.setattr(ex, "_require_test_mode_key", lambda *_a, **_k: _Stripe)
    monkeypatch.setattr(ex, "_attach_test_card", lambda *_a, **_k: None)
    monkeypatch.setattr(ex, "record_fallback", lambda **_kwargs: None)

    period = [sc for sc in ex.SCENARIOS if sc.kind == ex.KIND_PERIOD_END_BASIC]
    results = ex.apply_scenarios(period, {("plus", "month"): "price_plus_m"})
    assert results[0]["status"] == "skipped"
    assert "no test clock" in results[0]["reason"]


def test_run_period_end_basic_advances_then_resolves_basic():
    period_end = 1_700_000_000
    retrieved: list[str] = []

    class _Stripe:
        class test_helpers:
            class TestClock:
                @staticmethod
                def advance(clock_id, frozen_time):
                    assert clock_id == "clock_1"
                    assert frozen_time == period_end + 1
                    return _Obj(id=clock_id, status="ready")

                @staticmethod
                def retrieve(_clock_id):
                    raise AssertionError("ready on advance; no poll")

        class Subscription:
            @staticmethod
            def create(**_kwargs):
                return _Obj(
                    id="sub_1",
                    status="active",
                    current_period_end=period_end,
                    items={"data": [{"id": "si_1", "price": {"id": "price_plus_m"}}]},
                )

            @staticmethod
            def modify(sub_id, **kwargs):
                assert kwargs["cancel_at_period_end"] is True
                return _Obj(
                    id=sub_id,
                    status="active",
                    cancel_at_period_end=True,
                    current_period_end=period_end,
                )

            @staticmethod
            def retrieve(sub_id):
                retrieved.append(sub_id)
                return _Obj(id=sub_id, status="canceled", cancel_at_period_end=False)

            @staticmethod
            def cancel(sub_id, **_kwargs):
                return _Obj(id=sub_id, status="canceled")

    run = ex.LiveRun(stripe=_Stripe, price_map={("plus", "month"): "price_plus_m"})
    run.clock_id = "clock_1"
    run.customer_id = "cus_1"
    sc = [s for s in ex.SCENARIOS if s.kind == ex.KIND_PERIOD_END_BASIC][0]
    detail = ex._run_period_end_basic(run, sc)
    assert detail["plan_before_advance"] == "plus"
    assert detail["plan_after_advance"] == "basic"
    assert detail["stripe_status_after_advance"] == "canceled"
    assert detail["advanced_to"] == period_end + 1
    assert retrieved == ["sub_1"]
