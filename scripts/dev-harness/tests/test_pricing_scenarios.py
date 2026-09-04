from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dev_harness import config, emulator_seeding, pricing_scenarios, safety

REPO_ROOT = Path(__file__).resolve().parents[3]


def _env(tmp_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["PROVIDER_MODE"] = "offline"
    env["OMI_LOCAL_STATE_ROOT"] = str(tmp_path / "state")
    pythonpath = [str(REPO_ROOT / "scripts" / "dev-harness")]
    if existing := env.get("PYTHONPATH"):
        pythonpath.append(existing)
    env["PYTHONPATH"] = os.pathsep.join(pythonpath)
    return env


def test_catalog_matrix_tracks_storefront_plus_and_pro_without_max() -> None:
    pricing_scenarios.validate_all_scenarios()
    names = {scenario.scenario_id for scenario in pricing_scenarios.list_scenarios()}
    assert names == {
        "cancellation_and_downgrade_safety",
        "legacy_and_unknown_plan_resilience",
        "plan_catalog_matrix",
    }

    matrix = pricing_scenarios.get_scenario("plan_catalog_matrix")
    uids = {user.uid for user in matrix.users}
    assert "pricing_pro_v2" in uids
    assert "pricing_plus" in uids
    assert "pricing_never_subscribed" in uids
    assert "pricing_basic" in uids
    assert all("max" not in uid.lower() for uid in uids)
    assert matrix.selected_user == "pricing_plus"
    assert matrix.report_metadata.evidence_class == "LOCAL_EMULATOR_DEV"
    assert matrix.report_metadata.activation_eligible is False

    plus = matrix.expected["pricing_plus"]
    pro = matrix.expected["pricing_pro_v2"]
    assert plus.display_name == "Plus"
    assert plus.desktop_entitled is True
    assert plus.paid is True
    assert pro.display_name == "Pro"
    assert pro.desktop_entitled is True
    assert pro.plan == "pro_v2"


def test_local_price_ids_cover_every_primary_billing_env_var() -> None:
    for _plan, intervals in pricing_scenarios.PRIMARY_BILLING_ENV_VARS.items():
        for env_var in intervals.values():
            assert env_var in config.LOCAL_STRIPE_PRICE_ID_ENV
            price_id = config.LOCAL_STRIPE_PRICE_ID_ENV[env_var]
            assert price_id in config.LOCAL_STRIPE_PRICE_AMOUNTS
            assert price_id.startswith("price_local_")
    assert pricing_scenarios.price_id_for("plus") == "price_local_plus_month"
    assert pricing_scenarios.price_id_for("pro_v2") == "price_local_pro_v2_month"
    assert set(config.LOCAL_STRIPE_PRICE_ID_ENV.values()) == set(config.LOCAL_STRIPE_PRICE_AMOUNTS)


def test_harness_stripe_amount_catalog_stays_in_lockstep() -> None:
    stripe_source = (REPO_ROOT / "backend" / "utils" / "stripe.py").read_text(encoding="utf-8")
    for price_id, (amount, interval) in config.LOCAL_STRIPE_PRICE_AMOUNTS.items():
        needle = f"'{price_id}': ({amount}, '{interval}')"
        assert needle in stripe_source, f"missing lockstep stub {needle}"


def test_paid_fixtures_use_far_future_period_end_and_pricing_passwords() -> None:
    now = int(time.time())
    for scenario in pricing_scenarios.list_scenarios():
        for user in scenario.users:
            assert user.password == f"{user.uid}-{pricing_scenarios.PASSWORD_SUFFIX}"
            assert user.email == f"{user.uid}@local.omi.invalid"
        for seed in scenario.profile_seed:
            sub = seed.data.get("subscription")
            if not isinstance(sub, dict):
                continue
            assert "stripe_subscription_id" not in sub
            plan = sub.get("plan")
            period_end = sub.get("current_period_end")
            if plan not in {None, "basic", "future_plan_123"} and isinstance(period_end, int) and period_end > now:
                assert period_end - now >= pricing_scenarios.MIN_ACTIVE_PERIOD_MARGIN_SECONDS


def test_desktop_entitlement_follows_catalog() -> None:
    matrix = pricing_scenarios.get_scenario("plan_catalog_matrix")
    entitled_ids = {plan.value for plan in pricing_scenarios.DESKTOP_ENTITLED_PLAN_TYPES}
    for uid, expected in matrix.expected.items():
        if expected.plan in entitled_ids:
            assert expected.desktop_entitled, uid
        else:
            assert expected.desktop_entitled is False, uid


def test_lapsed_plus_falls_to_free() -> None:
    cancel = pricing_scenarios.get_scenario("cancellation_and_downgrade_safety")
    lapsed = cancel.expected["pricing_plus_lapsed"]
    assert lapsed.plan == "basic"
    assert lapsed.display_name == "Free"
    assert lapsed.desktop_entitled is False
    assert lapsed.paid is False
    canceling = cancel.expected["pricing_plus_cancel_at_period_end"]
    assert canceling.plan == "plus"
    assert canceling.paid is True


def test_legacy_pro_alias_resolves_to_architect() -> None:
    legacy = pricing_scenarios.get_scenario("legacy_and_unknown_plan_resilience")
    architect = legacy.expected["pricing_pro"]
    assert architect.plan == "architect"
    assert architect.display_name == "Architect"
    unknown = legacy.expected["pricing_unknown_future_plan"]
    assert unknown.display_name == "unknown"
    assert unknown.desktop_entitled is False


def test_seed_manifest_generation_is_dry_run_without_emulators(tmp_path: Path) -> None:
    env = _env(tmp_path)
    cfg = config.load_config(REPO_ROOT, env=env, create_layout=True)

    manifest = pricing_scenarios.seed_scenario("plan_catalog_matrix", cfg, dry_run=True)

    assert manifest.scenario_id == "plan_catalog_matrix"
    assert manifest.dry_run is True
    assert manifest.applied is False
    assert manifest.report_metadata.evidence_class == "LOCAL_EMULATOR_DEV"
    assert any(op.kind == "auth" and op.target == "pricing_plus" for op in manifest.operations)
    manifest_path = cfg.layout.process_manifest.parent / "pricing-scenario-plan_catalog_matrix-seed.json"
    assert manifest_path.is_file()
    saved = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert saved["report_metadata"]["watermark"] == "NOT_ACTIVATION_EVIDENCE"


def test_reset_manifest_is_idempotent_in_temp_state(tmp_path: Path) -> None:
    env = _env(tmp_path)
    cfg = config.load_config(REPO_ROOT, env=env, create_layout=True)

    first = pricing_scenarios.reset_scenario("plan_catalog_matrix", cfg, dry_run=True)
    second = pricing_scenarios.reset_scenario("plan_catalog_matrix", cfg, dry_run=True)

    assert first.dry_run is True
    assert second.dry_run is True
    assert [op.target for op in first.operations] == [op.target for op in second.operations]
    safety.read_and_validate_sentinel(cfg.layout.state_root, repo_root=REPO_ROOT, instance="default")


def test_merged_auth_users_union_memory_and_pricing_passwords(tmp_path: Path) -> None:
    env = _env(tmp_path)
    cfg = config.load_config(REPO_ROOT, env=env, create_layout=True)
    from dev_harness import memory_scenarios

    memory_scenarios.seed_scenario("happy_path", cfg, dry_run=True)
    pricing_scenarios.seed_scenario("plan_catalog_matrix", cfg, dry_run=True)

    users = emulator_seeding.merged_auth_users_from_seed_manifests(cfg)
    assert users["alice"]["password"] == "alice-local-password-030"
    assert users["pricing_plus"]["password"] == "pricing_plus-local-password-pricing"
    newest = emulator_seeding.latest_seed_manifests_by_kind(cfg)
    assert set(newest) == {"memory", "pricing"}


def test_pricing_scenario_cli_listing_json(tmp_path: Path) -> None:
    env = _env(tmp_path)
    result = subprocess.run(
        [sys.executable, "-m", "dev_harness.pricing_scenarios", "list", "--json"],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout
    payload = json.loads(result.stdout)
    assert any(item["scenario_id"] == "plan_catalog_matrix" for item in payload)
    assert any(item["scenario_id"] == "legacy_and_unknown_plan_resilience" for item in payload)
