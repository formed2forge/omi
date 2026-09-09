"""Tests for subscription restructure: Basic + Operator ($49) + Architect ($400),
deprecate Unlimited for existing users. Issue #6734.

``utils.subscription`` pulls in ``database.users`` / ``database.user_usage`` at import
time, and ``database.users`` imports back from ``utils.subscription`` (circular). The
original test broke the cycle by pre-corrupting ``sys.modules`` at module scope with
empty stubs. This file uses the sanctioned Tier-2 reserve seam: a module-scoped
fixture exposing a context manager that installs the stubs via ``stub_modules`` and
exec's ``utils.subscription`` fresh with ``load_module_fresh`` each time, then
restores on exit. No ``importlib.reload`` and no reliance on a specific
``utils.subscription`` object identity surviving across tests. See
backend/docs/test_isolation.md and testing/import_isolation.py.
"""

import os
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

from models.users import PlanLimits, PlanType, Subscription
from testing.import_isolation import load_module_fresh, stub_modules

pytestmark = pytest.mark.slow

_BACKEND = Path(__file__).resolve().parents[2]
_SUBSCRIPTION_PATH = os.path.join(str(_BACKEND), "utils", "subscription.py")


def _compare_versions(a, b):
    """Semantic version comparison matching the real _compare_versions."""
    a_parts = [int(x) for x in a.split('.')]
    b_parts = [int(x) for x in b.split('.')]
    for x, y in zip(a_parts, b_parts):
        if x != y:
            return 1 if x > y else -1
    return len(a_parts) - len(b_parts)


def _circular_import_fakes():
    """Stubs for the circular-import deps of utils.subscription.

    ``database._client`` must be stubbed: the real module imports google.cloud.firestore
    at load time, and re-exec'ing ``utils.subscription`` then poisons the protobuf
    descriptor pool (``duplicate file name .../document.proto``).
    """
    announcements = ModuleType("database.announcements")
    announcements._compare_versions = _compare_versions
    announcements.compare_versions = _compare_versions
    client = ModuleType("database._client")
    client.get_customer_firestore_client = lambda: None
    redis_mod = ModuleType("database.redis_db")
    return {
        "database.users": SimpleNamespace(),
        "database.user_usage": SimpleNamespace(),
        "database.announcements": announcements,
        "database._client": client,
        "database.redis_db": redis_mod,
    }


@pytest.fixture(scope="module")
def load_subscription():
    """Return a context manager that loads ``utils.subscription`` fresh.

    Each invocation re-installs the circular-import stubs (via ``stub_modules``) and
    re-execs ``utils.subscription`` so env-var-driven module constants are read
    against the current environment. Nothing relies on a specific module object
    surviving in ``sys.modules`` across tests, which keeps the file safe in a
    multi-file pytest run.
    """

    @contextmanager
    def _loader():
        with stub_modules(_circular_import_fakes()):
            yield load_module_fresh("utils.subscription", _SUBSCRIPTION_PATH)

    return _loader


def test_operator_chat_cap_independent_from_unlimited(monkeypatch, load_subscription):
    """F4: Operator and Unlimited chat caps must be independently configurable."""
    monkeypatch.setenv("OPERATOR_CHAT_QUESTIONS_PER_MONTH", "750")
    monkeypatch.setenv("NEO_CHAT_QUESTIONS_PER_MONTH", "3000")

    with load_subscription() as sub_mod:
        operator_limits = sub_mod.get_plan_limits(PlanType.operator)
        unlimited_limits = sub_mod.get_plan_limits(PlanType.unlimited)

    assert operator_limits.chat_questions_per_month == 750
    assert unlimited_limits.chat_questions_per_month == 3000
    assert operator_limits.chat_questions_per_month != unlimited_limits.chat_questions_per_month


def test_operator_and_neo_defaults(monkeypatch, load_subscription):
    """Operator defaults to 500, Neo defaults to 200."""
    monkeypatch.delenv("OPERATOR_CHAT_QUESTIONS_PER_MONTH", raising=False)
    monkeypatch.delenv("NEO_CHAT_QUESTIONS_PER_MONTH", raising=False)

    with load_subscription() as sub_mod:
        operator_limits = sub_mod.get_plan_limits(PlanType.operator)
        unlimited_limits = sub_mod.get_plan_limits(PlanType.unlimited)

    assert operator_limits.chat_questions_per_month == 500
    assert unlimited_limits.chat_questions_per_month == 200


def test_architect_uses_dollar_cap(load_subscription):
    """Architect plan uses dollar cap, not question count."""
    with load_subscription() as sub_mod:
        limits = sub_mod.get_plan_limits(PlanType.architect)

    assert limits.chat_cost_usd_per_month is not None
    assert limits.chat_questions_per_month is None
    assert limits.transcription_seconds is None  # unlimited transcription


def test_operator_is_paid(load_subscription):
    with load_subscription() as sub_mod:
        assert sub_mod.is_paid_plan(PlanType.operator)
        assert sub_mod.is_paid_plan(PlanType.architect)
        assert sub_mod.is_paid_plan(PlanType.unlimited)
        assert not sub_mod.is_paid_plan(PlanType.basic)


def test_filter_plans_for_basic_user(load_subscription):
    """Basic users see Neo, Operator, and Architect in purchase catalog."""
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.basic)

    plan_ids = [d['plan_id'] for d in filtered]
    assert 'operator' in plan_ids
    assert 'architect' in plan_ids


def test_paid_plan_definitions_include_a_description_for_every_plan(load_subscription):
    """Current-plan Settings copy comes from this description. Neo used to ship empty on the card."""
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        by_id = {d['plan_id']: d for d in definitions}

    for plan_id, definition in by_id.items():
        description = definition.get('description') or ''
        assert description.strip(), plan_id
        assert definition.get('subtitle'), plan_id

    neo = by_id['unlimited']
    assert 'chat questions' in neo['description'].lower()
    plus = by_id['plus']
    assert 'chat questions' in plus['description'].lower()
    assert 'transcription' in plus['description'].lower()
    # Filter key stays False so unknown-platform fail-open is unchanged.
    assert neo['legacy'] is False
    assert by_id['plus']['legacy'] is False
    assert neo['keep_until_cancel'] is True
    assert by_id['plus']['keep_until_cancel'] is False
    assert by_id['pro_v2']['keep_until_cancel'] is False
    assert by_id['operator']['keep_until_cancel'] is True


def test_filter_plans_keeps_legacy_for_current_subscriber(load_subscription):
    """Unlimited subscribers see their plan in catalog for active-plan detection."""
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.unlimited)

    plan_ids = [d['plan_id'] for d in filtered]
    assert 'unlimited' in plan_ids
    assert 'operator' in plan_ids
    assert 'architect' in plan_ids


def test_filter_plans_mobile_new_user_sees_only_plus_and_pro(load_subscription):
    """New / never-paid mobile users see the unified consumer tiers Plus + Pro.

    Neo, Unlimited-v2, Operator, and Architect sunset to no storefront, so all
    four are hidden from the mobile purchase catalog. Plus and Pro (`pro_v2`)
    are the new full-unification tiers: sold on mobile, desktop, and web alike.
    """
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        for platform in ('ios', 'android'):
            filtered = sub_mod.filter_plans_for_user(definitions, PlanType.basic, platform=platform)
            plan_ids = [d['plan_id'] for d in filtered]
            assert plan_ids == ['plus', 'pro_v2'], (platform, plan_ids)


def test_filter_plans_desktop_sells_plus_and_pro_not_sunset_legacy(load_subscription):
    """Desktop now sells Plus + Pro; Operator/Architect no longer offered to new users.

    Full storefront unification replaces the old "desktop sells Operator +
    Architect" rule outright: Operator, Architect, Neo, and Unlimited-v2
    sunset and stop appearing for any new (non-subscriber) user, on any
    platform including desktop.
    """
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.basic, platform='macos')
        plan_ids = [d['plan_id'] for d in filtered]
        assert plan_ids == ['plus', 'pro_v2'], plan_ids


def test_filter_plans_hides_neo_on_mobile_for_non_neo_subscribers(load_subscription):
    """Neo is current-Neo only. Architect/Plus/Unlimited/basic must not see it.

    Regression: `ever_purchased` was any paid plan, so Architect subscribers
    saw Neo on the phone sheet next to cheaper Plus. Do not restore that leak.
    """
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        for plan in (PlanType.basic, PlanType.plus, PlanType.pro_v2):
            filtered = sub_mod.filter_plans_for_user(definitions, plan, platform='ios')
            plan_ids = [d['plan_id'] for d in filtered]
            assert 'unlimited' not in plan_ids, (plan, plan_ids)
            assert 'unlimited_v2' not in plan_ids, (plan, plan_ids)
            assert plan_ids == ['plus', 'pro_v2'], (plan, plan_ids)


def test_filter_plans_mobile_desktop_only_plans_are_manage_only(load_subscription):
    """Operator/Architect on iOS/Android see only their current plan.

    Cheaper mobile SKUs must not appear: Continue onto them is an immediate
    prorated swap that strips desktop. Plus and Pro are exempt from this
    manage-only lock even though they're also desktop-entitled, because they
    are themselves sold on mobile now (full unification) — see
    `test_filter_plans_mobile_new_user_sees_only_plus_and_pro`.
    """
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        for platform in ('ios', 'android'):
            architect = [
                d['plan_id'] for d in sub_mod.filter_plans_for_user(definitions, PlanType.architect, platform=platform)
            ]
            operator = [
                d['plan_id'] for d in sub_mod.filter_plans_for_user(definitions, PlanType.operator, platform=platform)
            ]
            pro_plan = [
                d['plan_id'] for d in sub_mod.filter_plans_for_user(definitions, PlanType.pro_v2, platform=platform)
            ]
            assert architect == ['architect'], (platform, architect)
            assert operator == ['operator'], (platform, operator)
            assert pro_plan == ['plus', 'pro_v2'], (platform, pro_plan)


def test_filter_plans_desktop_sunset_siblings_no_longer_cross_shown(load_subscription):
    """An existing Architect/Operator subscriber on desktop no longer sees the

    other sunset plan as a lateral option — both are deprecated identically now
    (omi-pricing.md §3 item 8: same keep-until-cancel rule as any other legacy
    plan, no special Operator<->Architect cross-shopping carve-out once neither
    is sold to new users). They do see the new upgrade catalog (Plus, Pro)
    alongside their own current plan.
    """
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        architect_desktop = [
            d['plan_id'] for d in sub_mod.filter_plans_for_user(definitions, PlanType.architect, platform='macos')
        ]
        operator_desktop = [
            d['plan_id'] for d in sub_mod.filter_plans_for_user(definitions, PlanType.operator, platform='windows')
        ]
        assert architect_desktop == ['architect', 'plus', 'pro_v2'], architect_desktop
        assert operator_desktop == ['operator', 'plus', 'pro_v2'], operator_desktop


def test_filter_plans_shows_neo_on_mobile_for_current_neo_subscriber(load_subscription):
    """Current Neo subscribers (including cancel-at-period-end) still see Neo to manage it.

    Plus + Pro stay visible so they can migrate off the deprecated SKU.
    Operator/Architect/Unlimited-v2 stay invisible to them (sunset, never
    offered as an upgrade path to a consumer-tier subscriber).
    """
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.unlimited, platform='android')

    plan_ids = [d['plan_id'] for d in filtered]
    assert 'unlimited' in plan_ids
    assert 'plus' in plan_ids
    assert 'pro_v2' in plan_ids
    assert 'unlimited_v2' not in plan_ids
    assert 'architect' not in plan_ids
    assert 'operator' not in plan_ids


def test_filter_plans_shows_unlimited_v2_only_for_current_subscriber(load_subscription):
    """Unlimited-v2 is keep-until-cancel: hidden from new users, visible to its own subscriber."""
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        new_user = [d['plan_id'] for d in sub_mod.filter_plans_for_user(definitions, PlanType.basic, platform='ios')]
        current = [
            d['plan_id'] for d in sub_mod.filter_plans_for_user(definitions, PlanType.unlimited_v2, platform='ios')
        ]
    assert 'unlimited_v2' not in new_user
    assert current == ['plus', 'pro_v2', 'unlimited_v2']


def test_filter_plans_hides_neo_on_web_for_new_user(load_subscription):
    """Web sells the unified new catalog (Plus + Pro); deprecated Neo,
    Unlimited-v2, and sunset Operator/Architect are hidden from the web
    purchase catalog for a new user.

    Regression: web (X-App-Platform: web) previously hid nothing, so Neo was
    offered for purchase alongside the new tiers. Neo purchase is restricted to
    existing subscribers only. Operator/Architect additionally sunset from web
    the same as every other storefront (omi-pricing.md §12 item 1) — full
    unification means web is no longer a special "sells everything" surface.
    """
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.basic, platform='web')
    plan_ids = [d['plan_id'] for d in filtered]
    assert 'unlimited' not in plan_ids  # Neo hidden
    assert 'plus' in plan_ids
    assert 'pro_v2' in plan_ids
    assert 'unlimited_v2' not in plan_ids  # sunset: keep-until-cancel only
    assert 'operator' not in plan_ids  # sunset: no longer sold to new users anywhere
    assert 'architect' not in plan_ids  # sunset: no longer sold to new users anywhere


def test_filter_plans_shows_neo_on_web_for_current_neo_subscriber(load_subscription):
    """Existing Neo subscribers still see Neo on web so they can manage/cancel."""
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.unlimited, platform='web')
    assert 'unlimited' in [d['plan_id'] for d in filtered]


def test_filter_plans_keeps_neo_for_unknown_platform(load_subscription):
    """A header-less / unknown platform is still unfiltered — Neo stays visible."""
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.basic, platform=None)

    assert 'unlimited' in [d['plan_id'] for d in filtered]


def test_filter_plans_hides_neo_on_windows_for_new_user(load_subscription):
    """New / never-paid Windows desktop users don't see Neo — same as macOS desktop.

    Regression for the platform defect: _platform_hidden_plans only hid Neo for
    'macos', so a Windows client would have been offered the deprecated Neo plan.
    Operator/Architect are sunset (no longer offered to new desktop users
    either); Plus/Pro are the new desktop-sold tiers.
    """
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.basic, platform='windows')
    plan_ids = [d['plan_id'] for d in filtered]
    assert 'unlimited' not in plan_ids
    assert 'operator' not in plan_ids
    assert 'architect' not in plan_ids
    assert 'plus' in plan_ids
    assert 'pro_v2' in plan_ids


def test_neo_hidden_from_purchase_on_every_client_platform(load_subscription):
    """Reusable guard: the deprecated Neo plan is never offered for purchase to a
    new user on ANY real client platform.

    Twice now a platform was omitted from the Neo-hidden set and started offering
    Neo: first Windows (only 'macos' was hidden), then web (hid nothing). This
    pins the invariant across every X-App-Platform a client actually sends, so the
    next platform added can't silently reintroduce the deprecated-plan-for-sale bug.
    """
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        for platform in ('ios', 'android', 'macos', 'windows', 'web'):
            filtered = sub_mod.filter_plans_for_user(definitions, PlanType.basic, platform=platform)
            plan_ids = [d['plan_id'] for d in filtered]
            assert 'unlimited' not in plan_ids, (platform, plan_ids)
            assert plan_ids, platform  # never an empty catalog


def test_windows_full_catalog_matches_macos_canonical(load_subscription):
    """End-to-end catalog resolution for a Windows client (X-App-Platform: windows).

    Pins the fix: a Windows client gets the SAME catalog macOS gets — Plus + Pro
    visible under their canonical titles, Neo AND sunset Operator/Architect
    hidden from a new basic desktop user — and NEVER the legacy 'Omi Pro' /
    'Unlimited Plan' rename that adapt_plans_for_legacy_client produces for
    pre-rollout clients.
    """
    with load_subscription() as sub_mod:
        # Windows is a modern desktop client → new catalog, no legacy adaptation.
        assert sub_mod.should_show_new_plans('windows', '0.1.0') is True
        definitions = sub_mod.get_paid_plan_definitions()
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.basic, platform='windows')
    by_id = {d['plan_id']: d for d in filtered}
    assert 'plus' in by_id
    assert 'pro_v2' in by_id
    assert 'operator' not in by_id  # sunset
    assert 'architect' not in by_id  # sunset
    assert 'unlimited' not in by_id  # Neo hidden on desktop for a new user
    assert by_id['plus']['title'] == 'Plus'
    assert by_id['pro_v2']['title'] == 'Pro'
    titles = [d['title'] for d in filtered]
    assert 'Omi Pro' not in titles
    assert 'Unlimited Plan' not in titles


def test_windows_is_a_desktop_platform(load_subscription):
    """Windows lives in the single-source-of-truth desktop platform set and tokens."""
    with load_subscription() as sub_mod:
        assert 'windows' in sub_mod.DESKTOP_PLATFORMS
        assert 'macos' in sub_mod.DESKTOP_PLATFORMS
        assert 'windows' in sub_mod._TRIAL_PAYWALL_DESKTOP_TOKENS
        assert 'desktop' in sub_mod._TRIAL_PAYWALL_DESKTOP_TOKENS
        # Mobile is never desktop.
        assert 'ios' not in sub_mod.DESKTOP_PLATFORMS
        assert 'android' not in sub_mod.DESKTOP_PLATFORMS


def test_desktop_to_consumer_plan_change_is_blocked(load_subscription):
    """Any desktop-entitled plan cannot swap onto a non-desktop-entitled tier.

    Architect/Operator (legacy) still block onto Plus/Unlimited/Neo/Basic, and
    still stay open Operator <-> Architect. Plus and Pro are desktop-entitled
    too now (full unification): swapping between them, or onto/from the legacy
    desktop plans, stays open; only dropping to a non-desktop-entitled plan
    (basic, unlimited, unlimited_v2) is blocked.
    """
    with load_subscription() as sub_mod:
        err = sub_mod.desktop_to_consumer_plan_change_error
        for current in (PlanType.architect, PlanType.operator, PlanType.plus, PlanType.pro_v2):
            for target in (PlanType.unlimited_v2, PlanType.unlimited, PlanType.basic):
                assert err(current, target), (current, target)
        assert err(PlanType.architect, PlanType.operator) is None
        assert err(PlanType.operator, PlanType.architect) is None
        assert err(PlanType.unlimited, PlanType.plus) is None
        assert err(PlanType.plus, PlanType.pro_v2) is None
        assert err(PlanType.pro_v2, PlanType.plus) is None
        assert err(PlanType.architect, PlanType.pro_v2) is None
        # Plus is now itself desktop-entitled (full unification), so — unlike
        # before, when Plus carried no desktop access at all — swapping a Plus
        # subscriber onto Unlimited-v2 (not desktop-entitled) is correctly
        # blocked for the same reason Architect/Operator -> Unlimited-v2 is.
        assert err(PlanType.plus, PlanType.unlimited_v2), 'Plus is desktop-entitled now; this must block'


def test_legacy_client_adaptation(load_subscription):
    """Old clients see Unlimited Plan (not legacy suffix) and no Operator/Pro."""
    with load_subscription() as sub_mod:
        definitions = sub_mod.get_paid_plan_definitions()
        adapted = sub_mod.adapt_plans_for_legacy_client(definitions)

    plan_ids = [d['plan_id'] for d in adapted]
    assert 'operator' not in plan_ids
    assert 'pro_v2' not in plan_ids  # postdates this pre-0.11.324 client shape, same as operator
    assert 'unlimited' in plan_ids
    assert 'architect' in plan_ids
    assert 'plus' in plan_ids  # predates this shape's operator/architect split, stays visible

    unlimited_def = next(d for d in adapted if d['plan_id'] == 'unlimited')
    assert unlimited_def['title'] == 'Unlimited Plan'
    assert unlimited_def['legacy'] is False  # old clients don't know about legacy flag

    architect_def = next(d for d in adapted if d['plan_id'] == 'architect')
    assert architect_def['title'] == 'Omi Pro'


def test_version_gating_macos_always_new(load_subscription):
    """macOS always gets new plans (no version header = True)."""
    with load_subscription() as sub_mod:
        assert sub_mod.should_show_new_plans('macos', None) is True
        assert sub_mod.should_show_new_plans('macos', '99.99.999') is True


def test_version_gating_windows_always_new(load_subscription):
    """Windows is a desktop platform: always gets the new Operator + Architect catalog.

    Regression for the platform-recognition defect where only 'macos' was treated
    as desktop, so Windows (X-App-Platform: windows) fell through to the legacy
    catalog — hiding Operator and renaming Architect→'Omi Pro'. Windows defaults
    permissive (pre-release), so every version and a missing version qualify.
    """
    with load_subscription() as sub_mod:
        assert sub_mod.should_show_new_plans('windows', None) is True
        assert sub_mod.should_show_new_plans('windows', '1.0.0') is True
        assert sub_mod.should_show_new_plans('windows', '0.0.1') is True
        assert sub_mod.should_show_new_plans('windows', '99.99.999') is True
        # Case-insensitive, matching the macOS/mobile branches.
        assert sub_mod.should_show_new_plans('Windows', '1.0.0') is True
        # Unparseable version fails open on desktop (same as macOS).
        assert sub_mod.should_show_new_plans('windows', 'not.a.version') is True


def test_version_gating_web_always_new(load_subscription):
    """Web is an always-latest client: always gets the new catalog, version-agnostic."""
    with load_subscription() as sub_mod:
        assert 'web' in sub_mod.WEB_PLATFORMS
        assert sub_mod.should_show_new_plans('web', None) is True
        assert sub_mod.should_show_new_plans('web', '0.0.1') is True
        assert sub_mod.should_show_new_plans('web', '99.99.999') is True
        assert sub_mod.should_show_new_plans('Web', '1.0.0') is True  # case-insensitive


def test_web_full_catalog_shows_new_plans_and_hides_neo(load_subscription):
    """End-to-end catalog resolution for a web client (X-App-Platform: web).

    Web renders the unified catalog under canonical titles — Plus + Pro —
    never the legacy 'Omi Pro' / 'Unlimited Plan' rename, never deprecated
    Neo or Unlimited-v2 for a new user, and (post-unification) never sunset
    Operator/Architect either: web is no longer the one storefront that still
    sells the legacy desktop-only plans to new users.
    """
    with load_subscription() as sub_mod:
        new_plans_enabled = sub_mod.should_show_new_plans('web', None)
        assert new_plans_enabled is True
        definitions = sub_mod.get_paid_plan_definitions()
        # No legacy adaptation for web (new_plans_enabled) → raw canonical catalog.
        filtered = sub_mod.filter_plans_for_user(definitions, PlanType.basic, platform='web')
    by_id = {d['plan_id']: d for d in filtered}
    assert set(by_id) == {'plus', 'pro_v2'}, by_id
    assert 'unlimited' not in by_id  # Neo hidden
    assert 'unlimited_v2' not in by_id  # sunset
    assert 'operator' not in by_id  # sunset
    assert 'architect' not in by_id  # sunset
    assert by_id['plus']['title'] == 'Plus'
    assert by_id['pro_v2']['title'] == 'Pro'
    titles = [d['title'] for d in filtered]
    assert 'Omi Pro' not in titles
    assert 'Unlimited Plan' not in titles


def test_version_gating_mobile_requires_version(load_subscription):
    """Mobile requires version header and must meet minimum."""
    with load_subscription() as sub_mod:
        assert sub_mod.should_show_new_plans('android', None) is False
        assert sub_mod.should_show_new_plans('ios', None) is False

        assert sub_mod.should_show_new_plans('android', '99.99.999') is True
        assert sub_mod.should_show_new_plans('ios', '99.99.999') is True


def test_version_gating_old_mobile_gets_legacy(load_subscription):
    """Old mobile builds get legacy catalog."""
    with load_subscription() as sub_mod:
        assert sub_mod.should_show_new_plans('android', '0.0.1') is False
        assert sub_mod.should_show_new_plans('ios', '0.0.1') is False


def test_version_gating_exact_threshold(load_subscription):
    """Exact threshold version gets new plans."""
    with load_subscription() as sub_mod:
        assert sub_mod.should_show_new_plans('android', '1.0.530') is True
        assert sub_mod.should_show_new_plans('ios', '1.0.530') is True
        assert sub_mod.should_show_new_plans('macos', '0.11.324') is True


def test_version_gating_just_below_threshold(load_subscription):
    """One version below threshold gets legacy."""
    with load_subscription() as sub_mod:
        assert sub_mod.should_show_new_plans('android', '1.0.529') is False
        assert sub_mod.should_show_new_plans('ios', '1.0.529') is False
        assert sub_mod.should_show_new_plans('macos', '0.11.323') is False


def test_version_gating_malformed_version(load_subscription):
    """Malformed version: macOS fail-open, mobile fail-closed."""
    with load_subscription() as sub_mod:
        assert sub_mod.should_show_new_plans('macos', 'not.a.version') is True
        assert sub_mod.should_show_new_plans('android', 'not.a.version') is False
        assert sub_mod.should_show_new_plans('ios', 'not.a.version') is False


def test_version_gating_unknown_platform(load_subscription):
    """Unknown / unrecognized platform gets legacy catalog.

    'linux' is not a shipping desktop plan platform, so it stays on the legacy
    catalog (see DESKTOP_PLATFORMS — only macOS and Windows are wired for plans).
    """
    with load_subscription() as sub_mod:
        assert sub_mod.should_show_new_plans(None, None) is False
        assert sub_mod.should_show_new_plans('linux', '1.0.0') is False
        # 'web' is NOT unknown: it is an always-latest client that always gets
        # the new catalog (see test_version_gating_web_always_new).


def test_subscription_deprecation_fields():
    """Subscription model supports deprecated + deprecation_message."""
    sub = Subscription(plan=PlanType.unlimited, deprecated=True, deprecation_message="Your plan is retiring.")

    assert sub.deprecated is True
    assert sub.deprecation_message == "Your plan is retiring."

    # Non-deprecated plan
    sub2 = Subscription(plan=PlanType.operator)
    assert sub2.deprecated is False
    assert sub2.deprecation_message is None


def test_operator_price_id_mapping(monkeypatch, load_subscription):
    """Operator price IDs resolve to operator plan type."""
    monkeypatch.setenv("STRIPE_OPERATOR_MONTHLY_PRICE_ID", "price_op_monthly")
    monkeypatch.setenv("STRIPE_OPERATOR_ANNUAL_PRICE_ID", "price_op_annual")

    with load_subscription() as sub_mod:
        assert sub_mod.get_plan_type_from_price_id("price_op_monthly") == PlanType.operator
        assert sub_mod.get_plan_type_from_price_id("price_op_annual") == PlanType.operator


def test_plan_features_differentiate_operator_neo(monkeypatch, load_subscription):
    """Operator and Neo show separate feature lists with their own caps."""
    monkeypatch.setenv("OPERATOR_CHAT_QUESTIONS_PER_MONTH", "600")
    monkeypatch.setenv("NEO_CHAT_QUESTIONS_PER_MONTH", "300")

    with load_subscription() as sub_mod:
        op_features = sub_mod.get_plan_features(PlanType.operator)
        neo_features = sub_mod.get_plan_features(PlanType.unlimited)

    assert "600 chat questions per month" in op_features
    assert "300 chat questions per month" in neo_features
    assert "Desktop capture with Free-tier allowance" in neo_features
    assert "No desktop access" not in neo_features


def test_plan_display_names(load_subscription):
    with load_subscription() as sub_mod:
        # Free stays Free; Plus is unchanged; Pro (`pro_v2`) is the new top SKU.
        assert sub_mod.get_plan_display_name(PlanType.basic) == 'Free'
        assert sub_mod.get_plan_display_name(PlanType.plus) == 'Plus'
        assert sub_mod.get_plan_display_name(PlanType.pro_v2) == 'Pro'
        assert sub_mod.get_plan_display_name(PlanType.operator) == 'Operator'
        assert sub_mod.get_plan_display_name(PlanType.architect) == 'Architect'
        assert sub_mod.get_plan_display_name(PlanType.unlimited) == 'Neo'


def test_pro_v2_chat_cap_is_hard_capped_no_overage(load_subscription):
    """Pro: 1,000 questions/month, hard-stop — no overage billing.

    Same allocation shape unlimited_v2 already uses (finite question count,
    hard_cap exhaustion), not Architect's usd_cent-overage shape: Pro is a new
    plan ID (`pro_v2`), not a repurposing of Architect, and `pro` stays the
    Architect wire alias.
    """
    with load_subscription() as sub_mod:
        limits = sub_mod.get_plan_limits(PlanType.pro_v2)
        assert limits.chat_questions_per_month == 1000
        assert limits.chat_cost_usd_per_month is None
        assert sub_mod.plan_uses_overage(PlanType.pro_v2) is False
        assert sub_mod.is_paid_plan(PlanType.pro_v2) is True


def test_plus_and_pro_get_real_desktop_entitlement(load_subscription):
    """Plus and Pro are both real desktop-entitled plans now (full unification).

    Plus previously mapped to `desktop_free` (no desktop access at all); it now
    grants full desktop access, same as Operator. Pro gets the top
    `desktop_architect` tier, same shape Architect already has, which in turn
    grants identical Smart Screen Search access for both (`cloud_screen_vectors`
    is True on both the `desktop_full` and `desktop_architect` profiles).
    """
    with load_subscription() as sub_mod:
        assert sub_mod.plan_grants_desktop(PlanType.plus) is True
        assert sub_mod.effective_desktop_access_tier(PlanType.plus) == sub_mod.DESKTOP_ACCESS_TIER_FULL
        assert sub_mod.effective_desktop_access_tier(PlanType.pro_v2) == sub_mod.DESKTOP_ACCESS_TIER_ARCHITECT

        from config.plan_catalog import DESKTOP_PROFILE_DEFAULTS

        assert DESKTOP_PROFILE_DEFAULTS['desktop_full']['cloud_screen_vectors'] is True
        assert DESKTOP_PROFILE_DEFAULTS['desktop_architect']['cloud_screen_vectors'] is True


def test_plus_and_pro_phone_calls_are_unlimited_for_now(load_subscription):
    """No phone-call cap for Plus or Pro — both keep the existing uncapped
    `paid` phone_calls_profile, unchanged from today.
    """
    with load_subscription() as sub_mod:
        from config.plan_catalog import get_plan_definition

        assert get_plan_definition(PlanType.plus)['phone_calls_profile'] == 'paid'
        assert get_plan_definition(PlanType.pro_v2)['phone_calls_profile'] == 'paid'


def test_pro_wire_alias_still_resolves_to_architect(load_subscription):
    """The `pro` wire alias is untouched: still architect, not reassigned to Pro.

    Reassigning it is blocked by two independent facts: the catalog compiler's
    append-only compatibility guard rejects remapping an existing wire alias
    to a different plan ID, and live `subscription.plan == "pro"` documents
    would silently misattribute if the alias moved. Pro ships as `pro_v2`
    with no wire alias of its own.
    """
    with load_subscription() as sub_mod:
        from config.plan_catalog import WIRE_PLAN_ALIASES

        assert WIRE_PLAN_ALIASES['pro'] == PlanType.architect
        assert 'pro' not in [alias for alias in WIRE_PLAN_ALIASES if WIRE_PLAN_ALIASES[alias] == PlanType.pro_v2]
