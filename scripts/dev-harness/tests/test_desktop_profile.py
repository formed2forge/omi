from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dev_harness import config, desktop_profile

REPO_ROOT = Path(__file__).resolve().parents[3]


def _resolve(user_env: dict[str, str] | None = None) -> desktop_profile.DesktopLocalProfile:
    env = {"OMI_LOCAL_STATE_ROOT": str(REPO_ROOT / ".local-harness-state")}
    if user_env:
        env.update(user_env)
    cfg = config.load_config(REPO_ROOT, env=env, create_layout=False)
    return desktop_profile.resolve_profile(cfg, user="alice", seeded_users=("alice",), env=env)


def test_validate_profile_blocks_default_omi_dev() -> None:
    profile = _resolve()
    assert profile.app_name == desktop_profile.LOCAL_APP_NAME
    assert profile.bundle_id == desktop_profile.LOCAL_BUNDLE_ID

    errors = desktop_profile.validate_profile(profile)
    assert errors
    assert any(desktop_profile.LOCAL_PROFILE_OMI_DEV_BLOCKED in error for error in errors)


def test_validate_profile_allows_omi_memory_named_bundle() -> None:
    profile = _resolve({"OMI_APP_NAME": "omi-memory"})
    assert profile.app_name == "omi-memory"
    assert profile.bundle_id == "com.omi.omi-memory"

    errors = desktop_profile.validate_profile(profile)
    assert not errors


def test_local_profile_points_auth_api_at_python_backend() -> None:
    profile = _resolve({"OMI_APP_NAME": "omi-memory"})
    assert profile.env["OMI_AUTH_API_URL"] == profile.python_api_url
    assert profile.env["OMI_AUTH_API_URL"] == profile.env["OMI_PYTHON_API_URL"]


def test_validate_profile_rejects_missing_auth_api_url() -> None:
    profile = _resolve({"OMI_APP_NAME": "omi-memory"})
    env = dict(profile.env)
    env.pop("OMI_AUTH_API_URL")
    broken = replace(profile, env=env)
    errors = desktop_profile.validate_profile(broken)
    assert any("OMI_AUTH_API_URL" in error for error in errors)


def test_named_bundle_automation_uses_supplied_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMI_ENABLE_LOCAL_AUTOMATION", "ambient-disabled")
    monkeypatch.setenv("OMI_AUTOMATION_PORT", "9999")

    profile = _resolve(
        {
            "OMI_APP_NAME": "omi-memory",
            "OMI_ENABLE_LOCAL_AUTOMATION": "explicit-enabled",
            "OMI_AUTOMATION_PORT": "8765",
        }
    )

    assert profile.env["OMI_ENABLE_LOCAL_AUTOMATION"] == "explicit-enabled"
    assert profile.env["OMI_AUTOMATION_PORT"] == "8765"


def test_named_bundle_automation_defaults_ignore_ambient_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMI_ENABLE_LOCAL_AUTOMATION", "ambient-disabled")
    monkeypatch.setenv("OMI_AUTOMATION_PORT", "9999")

    profile = _resolve({"OMI_APP_NAME": "omi-memory"})

    assert profile.env["OMI_ENABLE_LOCAL_AUTOMATION"] == "1"
    assert "OMI_AUTOMATION_PORT" not in profile.env


def test_pricing_seed_password_is_used_instead_of_memory_suffix(tmp_path: Path) -> None:
    env = {
        "OMI_LOCAL_STATE_ROOT": str(tmp_path / "state"),
        "PROVIDER_MODE": "offline",
        "OMI_APP_NAME": "omi-pricing",
    }
    cfg = config.load_config(REPO_ROOT, env=env, create_layout=True)
    from dev_harness import memory_scenarios, pricing_scenarios

    memory_scenarios.seed_scenario("happy_path", cfg, dry_run=True)
    pricing_scenarios.seed_scenario("plan_catalog_matrix", cfg, dry_run=True)

    alice = desktop_profile.resolve_profile(cfg, user="alice", seeded_users=("alice",), env=env)
    plus = desktop_profile.resolve_profile(cfg, user="pricing_plus", seeded_users=("pricing_plus",), env=env)
    assert alice.selected_user_password == "alice-local-password-030"
    assert plus.selected_user_password == "pricing_plus-local-password-pricing"
    assert plus.selected_user_email == "pricing_plus@local.omi.invalid"
    assert plus.env["OMI_LOCAL_AUTH_PASSWORD"] == plus.selected_user_password
