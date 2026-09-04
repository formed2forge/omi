"""Synthetic local pricing/subscription fixtures for the emulator harness.

Plan identity is read from the compiled catalog at import time so a catalog
add such as ``pro_v2`` appears as ``pricing_pro_v2`` without a hardcoded copy.
LOCAL_EMULATOR_DEV only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping, Sequence

from . import config, emulator_seeding, safety
from .emulator_seeding import (
    FirestoreSeed,
    LocalReportMetadata,
    ScenarioUser,
    SeedManifest,
    SeedOperation,
)

SCHEMA_VERSION = 1
SCENARIO_KIND = "pricing"
EVIDENCE_CLASS = emulator_seeding.EVIDENCE_CLASS
PASSWORD_SUFFIX = "local-password-pricing"
CREATED_BY = "pricing-scenario-fixtures"
MIN_ACTIVE_PERIOD_MARGIN_SECONDS = 5 * 365 * 24 * 3600
_NEO_CUTOFF_RE = re.compile(
    r"NEO_DESKTOP_GRANDFATHER_CUTOFF = int\(os\.getenv\('NEO_DESKTOP_GRANDFATHER_CUTOFF', '(\d+)'\)\)"
)


def _load_catalog():
    backend = Path(__file__).resolve().parents[3] / "backend"
    backend_str = str(backend)
    if backend_str not in sys.path:
        sys.path.insert(0, backend_str)
    from config.plan_catalog_generated import (  # type: ignore[import-not-found]
        DESKTOP_ENTITLED_PLAN_TYPES,
        PLAN_DISPLAY_NAMES,
        PLAN_STOREFRONTS,
        PRIMARY_BILLING_ENV_VARS,
        PlanType,
    )

    return {
        "PlanType": PlanType,
        "PLAN_STOREFRONTS": PLAN_STOREFRONTS,
        "PLAN_DISPLAY_NAMES": PLAN_DISPLAY_NAMES,
        "DESKTOP_ENTITLED_PLAN_TYPES": DESKTOP_ENTITLED_PLAN_TYPES,
        "PRIMARY_BILLING_ENV_VARS": PRIMARY_BILLING_ENV_VARS,
    }


_CATALOG = _load_catalog()
PlanType = _CATALOG["PlanType"]
PLAN_STOREFRONTS = _CATALOG["PLAN_STOREFRONTS"]
PLAN_DISPLAY_NAMES = _CATALOG["PLAN_DISPLAY_NAMES"]
DESKTOP_ENTITLED_PLAN_TYPES = _CATALOG["DESKTOP_ENTITLED_PLAN_TYPES"]
PRIMARY_BILLING_ENV_VARS = _CATALOG["PRIMARY_BILLING_ENV_VARS"]


def neo_desktop_grandfather_cutoff() -> int:
    source = Path(__file__).resolve().parents[3] / "backend" / "utils" / "subscription.py"
    match = _NEO_CUTOFF_RE.search(source.read_text(encoding="utf-8"))
    if not match:
        raise RuntimeError("Could not read NEO_DESKTOP_GRANDFATHER_CUTOFF default from subscription.py")
    return int(match.group(1))


def _active_period_end() -> int:
    return int(time.time()) + 6 * 365 * 24 * 3600


def _lapsed_period_end() -> int:
    return int(time.time()) - 86400


def price_id_for(plan: str, interval: str = "month") -> str:
    env_var = PRIMARY_BILLING_ENV_VARS[PlanType(plan)][interval]
    override = os.getenv(env_var, "").strip()
    # Ambient production Stripe ids must not leak into local fixtures. The
    # harness child env injects price_local_* values; only those overrides win.
    if override.startswith("price_local_"):
        return override
    return config.LOCAL_STRIPE_PRICE_ID_ENV[env_var]


def paid_price_ids() -> dict[str, str]:
    """Monthly local price id for every paid catalog plan, keyed by plan id."""

    return {plan.value: price_id_for(plan.value, "month") for plan in PRIMARY_BILLING_ENV_VARS}


@dataclass(frozen=True)
class ExpectedBehavior:
    plan: str | None
    display_name: str
    desktop_entitled: bool
    paid: bool


@dataclass(frozen=True)
class PricingUserSpec:
    uid: str
    display_name: str
    plan: str | None
    current_price_id: str | None = None
    cancel_at_period_end: bool = False
    current_period_end: int | None = None
    current_period_start: int | None = None
    status: str = "active"


@dataclass(frozen=True)
class PricingScenario:
    schema_version: int
    scenario_id: str
    description: str
    users: tuple[ScenarioUser, ...]
    selected_user: str
    auth_seed: tuple[Mapping[str, object], ...]
    profile_seed: tuple[FirestoreSeed, ...]
    firestore_seed: tuple[FirestoreSeed, ...] = ()
    redis_seed: tuple = ()
    file_seed: tuple = ()
    expected: Mapping[str, ExpectedBehavior] = field(default_factory=dict)
    report_metadata: LocalReportMetadata = field(default_factory=LocalReportMetadata)


def _user(uid: str, name: str) -> ScenarioUser:
    return ScenarioUser(
        uid=uid,
        email=f"{uid}@local.omi.invalid",
        display_name=f"Synthetic {name}",
        password=f"{uid}-{PASSWORD_SUFFIX}",
    )


def _subscription_payload(spec: PricingUserSpec) -> Mapping[str, object] | None:
    if spec.plan is None:
        return None
    payload: dict[str, object] = {
        "plan": spec.plan,
        "status": spec.status,
        "cancel_at_period_end": spec.cancel_at_period_end,
    }
    if spec.current_price_id:
        payload["current_price_id"] = spec.current_price_id
    period_end = spec.current_period_end
    if spec.plan != "basic" and period_end is None:
        period_end = _active_period_end()
    if period_end is not None:
        payload["current_period_end"] = period_end
    if spec.current_period_start is not None:
        payload["current_period_start"] = spec.current_period_start
    return payload


def _expected_for(spec: PricingUserSpec) -> ExpectedBehavior:
    if spec.plan is None:
        return ExpectedBehavior(plan=None, display_name="Free", desktop_entitled=False, paid=False)
    if spec.plan == "future_plan_123":
        return ExpectedBehavior(plan=spec.plan, display_name="unknown", desktop_entitled=False, paid=False)
    if spec.plan == "pro":
        plan_enum = PlanType.architect
    else:
        try:
            plan_enum = PlanType(spec.plan)
        except ValueError:
            return ExpectedBehavior(plan=spec.plan, display_name="unknown", desktop_entitled=False, paid=False)
    lapsed = bool(
        spec.current_period_end is not None and spec.current_period_end < int(time.time()) and spec.plan != "basic"
    )
    if lapsed:
        return ExpectedBehavior(plan="basic", display_name="Free", desktop_entitled=False, paid=False)
    entitled = plan_enum in DESKTOP_ENTITLED_PLAN_TYPES
    paid = spec.plan not in {None, "basic"}
    return ExpectedBehavior(
        plan=spec.plan if spec.plan != "pro" else "architect",
        display_name=str(PLAN_DISPLAY_NAMES[plan_enum]),
        desktop_entitled=entitled,
        paid=paid,
    )


def _build_scenario(
    scenario_id: str, description: str, specs: Sequence[PricingUserSpec], selected_user: str
) -> PricingScenario:
    users = tuple(_user(spec.uid, spec.display_name) for spec in specs)
    profiles: list[FirestoreSeed] = []
    expected: dict[str, ExpectedBehavior] = {}
    for spec, user in zip(specs, users, strict=True):
        data: dict[str, object] = {
            "uid": user.uid,
            "email": user.email,
            "display_name": user.display_name,
            "synthetic": True,
            "local_harness": True,
            "created_by": CREATED_BY,
        }
        subscription = _subscription_payload(spec)
        if subscription is not None:
            data["subscription"] = subscription
        profiles.append(FirestoreSeed(path=f"users/{user.uid}", protected=True, data=data))
        expected[spec.uid] = _expected_for(spec)
    return PricingScenario(
        schema_version=SCHEMA_VERSION,
        scenario_id=scenario_id,
        description=description,
        users=users,
        selected_user=selected_user,
        auth_seed=emulator_seeding.auth_seed_payloads(users),
        profile_seed=tuple(profiles),
        expected=expected,
    )


def _storefront_plan_specs() -> list[PricingUserSpec]:
    specs = [
        PricingUserSpec("pricing_never_subscribed", "Never Subscribed", plan=None),
        PricingUserSpec("pricing_basic", "Free", plan="basic"),
    ]
    for plan, storefronts in PLAN_STOREFRONTS.items():
        if not storefronts:
            continue
        uid = f"pricing_{plan.value}"
        specs.append(
            PricingUserSpec(
                uid,
                str(PLAN_DISPLAY_NAMES[plan]),
                plan=plan.value,
                current_price_id=price_id_for(plan.value),
            )
        )
    keep_until_cancel = [
        plan for plan, storefronts in PLAN_STOREFRONTS.items() if not storefronts and plan.value != "basic"
    ]
    for plan in keep_until_cancel:
        if plan not in PRIMARY_BILLING_ENV_VARS:
            continue
        uid = f"pricing_{plan.value}"
        specs.append(
            PricingUserSpec(
                uid,
                str(PLAN_DISPLAY_NAMES[plan]),
                plan=plan.value,
                current_price_id=price_id_for(plan.value),
            )
        )
    return specs


def _build_scenarios() -> dict[str, PricingScenario]:
    cutoff = neo_desktop_grandfather_cutoff()
    matrix = _build_scenario(
        "plan_catalog_matrix",
        "One synthetic user per current catalog plan plus a never-subscribed Free user",
        _storefront_plan_specs(),
        selected_user="pricing_plus",
    )
    legacy = _build_scenario(
        "legacy_and_unknown_plan_resilience",
        "Legacy pro-alias Architect, Neo grandfather windows, and an unrecognized plan id",
        [
            PricingUserSpec(
                "pricing_pro",
                "Architect via pro alias",
                plan="pro",
                current_price_id=price_id_for("architect"),
            ),
            PricingUserSpec(
                "pricing_unlimited_grandfathered",
                "Neo inside grandfather window",
                plan="unlimited",
                current_price_id=price_id_for("unlimited"),
                current_period_start=cutoff - 100_000,
            ),
            PricingUserSpec(
                "pricing_unlimited_post_cutoff",
                "Neo outside grandfather window",
                plan="unlimited",
                current_price_id=price_id_for("unlimited"),
                current_period_start=cutoff + 100_000,
            ),
            PricingUserSpec(
                "pricing_unknown_future_plan",
                "Unrecognized future plan",
                plan="future_plan_123",
                current_price_id="price_local_future_plan_month",
                current_period_end=_active_period_end(),
            ),
        ],
        selected_user="pricing_pro",
    )
    cancel = _build_scenario(
        "cancellation_and_downgrade_safety",
        "Cancel-at-period-end stays paid until period end; a lapsed paid fixture falls to Free",
        [
            PricingUserSpec(
                "pricing_plus_cancel_at_period_end",
                "Plus canceling",
                plan="plus",
                current_price_id=price_id_for("plus"),
                cancel_at_period_end=True,
            ),
            PricingUserSpec(
                "pricing_pro_v2_cancel_at_period_end",
                "Pro canceling",
                plan="pro_v2",
                current_price_id=price_id_for("pro_v2"),
                cancel_at_period_end=True,
            ),
            PricingUserSpec(
                "pricing_plus_lapsed",
                "Plus lapsed",
                plan="plus",
                current_price_id=price_id_for("plus"),
                current_period_end=_lapsed_period_end(),
            ),
        ],
        selected_user="pricing_plus_cancel_at_period_end",
    )
    return {s.scenario_id: s for s in (matrix, legacy, cancel)}


SCENARIOS = _build_scenarios()


def list_scenarios() -> tuple[PricingScenario, ...]:
    return tuple(SCENARIOS[name] for name in sorted(SCENARIOS))


def get_scenario(scenario_id: str) -> PricingScenario:
    try:
        return SCENARIOS[scenario_id]
    except KeyError as exc:
        raise ValueError(
            f"Unknown pricing scenario {scenario_id!r}; choose one of {', '.join(sorted(SCENARIOS))}"
        ) from exc


def validate_scenario(scenario: PricingScenario) -> None:
    if scenario.schema_version != SCHEMA_VERSION:
        raise ValueError(f"Unsupported scenario schema_version={scenario.schema_version}")
    if scenario.scenario_id not in SCENARIOS:
        raise ValueError("Scenario ID must be registered")
    user_ids = {user.uid for user in scenario.users}
    if scenario.selected_user not in user_ids:
        raise ValueError("selected_user must be one of scenario.users")
    if scenario.report_metadata.evidence_class != EVIDENCE_CLASS or scenario.report_metadata.activation_eligible:
        raise ValueError("Local scenario report metadata must remain LOCAL_EMULATOR_DEV and activation_eligible=false")
    for seed in scenario.profile_seed:
        if not seed.path or seed.path.startswith("/") or ".." in seed.path.split("/"):
            raise ValueError(f"Unsafe Firestore seed path {seed.path!r}")
        if "evidence_class" in seed.data or "activation_eligible" in seed.data:
            raise ValueError("Fixture seed documents cannot select evidence/report labels")
        sub = seed.data.get("subscription")
        if isinstance(sub, Mapping) and sub.get("plan") not in {None, "basic"} and sub.get("plan") != "future_plan_123":
            period_end = sub.get("current_period_end")
            if isinstance(period_end, int) and period_end > int(time.time()):
                if period_end - int(time.time()) < MIN_ACTIVE_PERIOD_MARGIN_SECONDS:
                    raise ValueError(f"Active paid fixture {seed.path} period end is too close to now")


def validate_all_scenarios() -> None:
    for scenario in SCENARIOS.values():
        validate_scenario(scenario)


def scenario_digest(scenario: PricingScenario) -> str:
    payload = json.dumps(emulator_seeding.jsonable(scenario), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_seed_operations(scenario: PricingScenario) -> tuple[SeedOperation, ...]:
    validate_scenario(scenario)
    ops: list[SeedOperation] = [
        SeedOperation(
            kind="metadata",
            action="write",
            target=f"scenario:{scenario.scenario_id}",
            payload={
                "scenario_id": scenario.scenario_id,
                "scenario_digest": scenario_digest(scenario),
                "selected_user": scenario.selected_user,
                "report_metadata": emulator_seeding.jsonable(scenario.report_metadata),
            },
        )
    ]
    ops.extend(SeedOperation("auth", "upsert", str(user["localId"]), user) for user in scenario.auth_seed)
    ops.extend(
        SeedOperation("firestore", "upsert", seed.path, seed.data, seed.protected) for seed in scenario.profile_seed
    )
    return tuple(ops)


def build_reset_operations(scenario: PricingScenario) -> tuple[SeedOperation, ...]:
    validate_scenario(scenario)
    ops: list[SeedOperation] = []
    ops.extend(SeedOperation("auth", "delete", str(user["localId"])) for user in scenario.auth_seed)
    ops.extend(
        SeedOperation("firestore", "delete", seed.path, protected=seed.protected) for seed in scenario.profile_seed
    )
    ops.append(SeedOperation("metadata", "delete", f"scenario:{scenario.scenario_id}"))
    return tuple(ops)


def build_manifest(
    scenario: PricingScenario,
    cfg: config.HarnessConfig,
    *,
    operations: tuple[SeedOperation, ...],
    dry_run: bool,
    applied: bool,
) -> SeedManifest:
    return SeedManifest(
        schema_version=SCHEMA_VERSION,
        scenario_id=scenario.scenario_id,
        scenario_digest=scenario_digest(scenario),
        generated_at=emulator_seeding.now_iso(),
        dry_run=dry_run,
        applied=applied,
        emulator_available=emulator_seeding.emulator_availability(cfg),
        report_metadata=scenario.report_metadata,
        operations=operations,
    )


def write_manifest(cfg: config.HarnessConfig, manifest: SeedManifest, *, reset: bool = False) -> Path:
    return emulator_seeding.write_manifest(cfg, manifest, kind=SCENARIO_KIND, reset=reset)


def seed_scenario(scenario_id: str, cfg: config.HarnessConfig, *, dry_run: bool | None = None) -> SeedManifest:
    scenario = get_scenario(scenario_id)
    ops = build_seed_operations(scenario)
    availability = emulator_seeding.emulator_availability(cfg)
    effective_dry_run = (not (availability["firestore"] and availability["auth"])) if dry_run is None else dry_run
    applied = False
    if not effective_dry_run:
        safety.read_and_validate_sentinel(cfg.layout.state_root, repo_root=cfg.repo_root, instance=cfg.instance)
        emulator_seeding.apply_seed_operations(
            cfg, scenario.users, ops, kind=SCENARIO_KIND, selected_user=scenario.selected_user
        )
        applied = True
    else:
        if cfg.layout.sentinel_path.exists():
            for op in ops:
                if op.kind in {"metadata", "file"}:
                    emulator_seeding.apply_operation(cfg, op, kind=SCENARIO_KIND)
    manifest = build_manifest(scenario, cfg, operations=ops, dry_run=effective_dry_run, applied=applied)
    write_manifest(cfg, manifest)
    return manifest


def reset_scenario(scenario_id: str, cfg: config.HarnessConfig, *, dry_run: bool | None = None) -> SeedManifest:
    scenario = get_scenario(scenario_id)
    ops = build_reset_operations(scenario)
    availability = emulator_seeding.emulator_availability(cfg)
    effective_dry_run = (not (availability["firestore"] and availability["auth"])) if dry_run is None else dry_run
    applied = False
    if not effective_dry_run:
        safety.read_and_validate_sentinel(cfg.layout.state_root, repo_root=cfg.repo_root, instance=cfg.instance)
        emulator_seeding.apply_reset_operations(cfg, scenario.users, ops, kind=SCENARIO_KIND)
        applied = True
    else:
        if cfg.layout.sentinel_path.exists():
            for op in ops:
                if op.kind in {"metadata", "file"}:
                    emulator_seeding.apply_operation(cfg, op, kind=SCENARIO_KIND)
    manifest = build_manifest(scenario, cfg, operations=ops, dry_run=effective_dry_run, applied=applied)
    write_manifest(cfg, manifest, reset=True)
    return manifest


def _repo_root() -> Path:
    return config.repo_root_from(Path.cwd())


def print_scenario_list(*, json_output: bool = False) -> None:
    validate_all_scenarios()
    if json_output:
        print(
            json.dumps(
                [
                    {"scenario_id": s.scenario_id, "description": s.description, "selected_user": s.selected_user}
                    for s in list_scenarios()
                ],
                indent=2,
                sort_keys=True,
            )
        )
        return
    print("Local pricing emulator scenarios (LOCAL_EMULATOR_DEV, activation_eligible=false)")
    for scenario in list_scenarios():
        print(f"- {scenario.scenario_id}: {scenario.description}")
        for uid, expected in scenario.expected.items():
            print(f"    {uid}: plan={expected.plan} display={expected.display_name}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pricing-scenarios")
    sub = parser.add_subparsers(dest="command", required=True)
    list_parser = sub.add_parser("list")
    list_parser.add_argument("--json", action="store_true")
    seed_parser = sub.add_parser("seed")
    seed_parser.add_argument("scenario")
    seed_parser.add_argument("--dry-run", action="store_true", default=None)
    seed_parser.add_argument("--apply", action="store_false", dest="dry_run")
    reset_parser = sub.add_parser("reset")
    reset_parser.add_argument("scenario")
    reset_parser.add_argument("--dry-run", action="store_true", default=None)
    reset_parser.add_argument("--apply", action="store_false", dest="dry_run")
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    try:
        if args.command == "list":
            print_scenario_list(json_output=bool(args.json))
            return 0
        cfg = config.load_config(_repo_root(), create_layout=True)
        if args.command == "seed":
            manifest = seed_scenario(args.scenario, cfg, dry_run=args.dry_run)
            print(json.dumps(emulator_seeding.jsonable(manifest), indent=2, sort_keys=True))
            return 0
        if args.command == "reset":
            manifest = reset_scenario(args.scenario, cfg, dry_run=args.dry_run)
            print(json.dumps(emulator_seeding.jsonable(manifest), indent=2, sort_keys=True))
            return 0
    except (ValueError, safety.SafetyError, RuntimeError) as exc:
        print(f"Pricing scenario command failed: {exc}", file=sys.stderr)
        return 2
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
