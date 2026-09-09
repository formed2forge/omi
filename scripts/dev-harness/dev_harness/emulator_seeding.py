"""Shared Firestore/Auth emulator apply engine for local scenario fixtures.

Memory and pricing scenario modules build operations; this module applies them
to the Auth/Firestore emulators (Admin SDK with REST fallback), remaps
synthetic UIDs, and writes seed/reset manifests. LOCAL_EMULATOR_DEV only.
"""

from __future__ import annotations

import json
import os
import socket
import time
from dataclasses import asdict, dataclass, is_dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Literal, Mapping, Sequence
from urllib.parse import quote
import urllib.error
import urllib.request

from . import config, safety

EVIDENCE_CLASS = "LOCAL_EMULATOR_DEV"
ACTIVATION_ELIGIBLE = False
WATERMARK = "NOT_ACTIVATION_EVIDENCE"
AUTH_UID_MANIFEST = "canonical-auth-uids.json"
LOCAL_DEV_PROJECT_ID = safety.DEFAULT_LOCAL_FIREBASE_PROJECT_ID
LOCAL_DEV_DATABASE_ID = safety.DEFAULT_FIRESTORE_DATABASE_ID
_AUTH_EMULATOR_APP_NAME = "omi-local-dev-harness-auth-emulator"


@dataclass(frozen=True)
class ScenarioUser:
    uid: str
    email: str
    display_name: str
    password: str


@dataclass(frozen=True)
class FirestoreSeed:
    path: str
    data: Mapping[str, object]
    protected: bool = False


@dataclass(frozen=True)
class RedisSeed:
    key: str
    value: str


@dataclass(frozen=True)
class FileSeed:
    relative_path: str
    content: str


@dataclass(frozen=True)
class LocalReportMetadata:
    evidence_class: str = EVIDENCE_CLASS
    activation_eligible: bool = ACTIVATION_ELIGIBLE
    watermark: str = WATERMARK
    firebase_project_id: str = LOCAL_DEV_PROJECT_ID
    firestore_database_id: str = LOCAL_DEV_DATABASE_ID


@dataclass(frozen=True)
class SeedOperation:
    kind: Literal["auth", "firestore", "redis", "file", "metadata"]
    action: Literal["upsert", "delete", "write"]
    target: str
    payload: Mapping[str, object] | str | None = None
    protected: bool = False
    requires_fixed_uid: bool = False


@dataclass(frozen=True)
class SeedManifest:
    schema_version: int
    scenario_id: str
    scenario_digest: str
    generated_at: str
    dry_run: bool
    applied: bool
    emulator_available: Mapping[str, bool]
    report_metadata: LocalReportMetadata
    operations: tuple[SeedOperation, ...]


def jsonable(value: object) -> object:
    if is_dataclass(value):
        return {k: jsonable(v) for k, v in asdict(value).items()}  # type: ignore[arg-type]
    if isinstance(value, Mapping):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, tuple | list):
        return [jsonable(v) for v in value]
    return value


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def auth_seed_payloads(users: Sequence[ScenarioUser]) -> tuple[Mapping[str, object], ...]:
    return tuple(
        {
            "localId": user.uid,
            "email": user.email,
            "displayName": user.display_name,
            "password": user.password,
            "emailVerified": True,
            "disabled": False,
        }
        for user in users
    )


def profile_seeds(
    users: Sequence[ScenarioUser], *, extra: Mapping[str, object] | None = None, created_by: str
) -> tuple[FirestoreSeed, ...]:
    extra_data = dict(extra or {})
    return tuple(
        FirestoreSeed(
            path=f"users/{user.uid}",
            protected=True,
            data={
                "uid": user.uid,
                "email": user.email,
                "display_name": user.display_name,
                "synthetic": True,
                "local_harness": True,
                "created_by": created_by,
                **(extra_data.get(user.uid, {}) if isinstance(extra_data.get(user.uid), Mapping) else extra_data),
            },
        )
        for user in users
    )


def current_manifest_name(kind: str) -> str:
    return f"{kind}-scenario-current.json"


def seed_manifest_name(kind: str, scenario_id: str, *, reset: bool = False) -> str:
    suffix = "reset" if reset else "seed"
    return f"{kind}-scenario-{scenario_id}-{suffix}.json"


def auth_uid_manifest_path(cfg: config.HarnessConfig) -> Path:
    return cfg.layout.state_root / "manifests" / AUTH_UID_MANIFEST


def port_open(hostport: str, timeout: float = 0.2) -> bool:
    host, raw_port = hostport.rsplit(":", 1)
    try:
        with socket.create_connection((host, int(raw_port)), timeout=timeout):
            return True
    except OSError:
        return False


def emulator_availability(cfg: config.HarnessConfig) -> dict[str, bool]:
    return {
        "firestore": port_open(cfg.firestore_host),
        "auth": port_open(cfg.auth_host),
        "redis": port_open(f"{cfg.redis_host}:{cfg.redis_port}"),
    }


def firestore_value(value: object) -> dict[str, object]:
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int) and not isinstance(value, bool):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        if value.endswith("Z"):
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
                return {"timestampValue": value}
            except ValueError:
                pass
        return {"stringValue": value}
    if isinstance(value, Mapping):
        return {"mapValue": {"fields": {str(k): firestore_value(v) for k, v in value.items()}}}
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return {"arrayValue": {"values": [firestore_value(v) for v in value]}}
    return {"stringValue": str(value)}


def firestore_document_payload(data: Mapping[str, object]) -> dict[str, object]:
    return {"fields": {str(k): firestore_value(v) for k, v in data.items()}}


def request_json(method: str, url: str, payload: Mapping[str, object] | None = None) -> tuple[int, str]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=2) as response:
            return int(response.status), response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", "replace")


def apply_firestore_admin_sdk(cfg: config.HarnessConfig, op: SeedOperation) -> bool:
    try:
        from google.auth.credentials import AnonymousCredentials
        from google.cloud import firestore
    except Exception:
        return False

    old_host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    os.environ["FIRESTORE_EMULATOR_HOST"] = cfg.firestore_host
    try:
        client = firestore.Client(project=cfg.project_id, credentials=AnonymousCredentials())
        document = client.document(op.target)
        if op.action == "upsert":
            payload = dict(op.payload if isinstance(op.payload, Mapping) else {})
            document.set(payload)
        elif op.action == "delete":
            document.delete()
        else:
            raise RuntimeError(f"Unsupported Firestore scenario action: {op.action}")
        return True
    finally:
        if old_host is None:
            os.environ.pop("FIRESTORE_EMULATOR_HOST", None)
        else:
            os.environ["FIRESTORE_EMULATOR_HOST"] = old_host


def apply_auth_admin_sdk(cfg: config.HarnessConfig, op: SeedOperation) -> bool:
    try:
        import firebase_admin
        from firebase_admin import auth as firebase_auth
    except ImportError:
        return False

    old_host = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
    os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = cfg.auth_host
    try:
        try:
            app = firebase_admin.get_app(_AUTH_EMULATOR_APP_NAME)
        except ValueError:
            app = firebase_admin.initialize_app(
                options={"projectId": cfg.project_id},
                name=_AUTH_EMULATOR_APP_NAME,
            )
        if op.action == "upsert":
            payload = dict(op.payload if isinstance(op.payload, Mapping) else {})
            try:
                firebase_auth.get_user(op.target, app=app)
            except firebase_auth.UserNotFoundError:
                firebase_auth.create_user(
                    uid=op.target,
                    email=str(payload["email"]),
                    password=str(payload["password"]),
                    display_name=str(payload.get("displayName", "")),
                    email_verified=bool(payload.get("emailVerified", False)),
                    disabled=bool(payload.get("disabled", False)),
                    app=app,
                )
        elif op.action == "delete":
            try:
                firebase_auth.delete_user(op.target, app=app)
            except firebase_auth.UserNotFoundError:
                pass
        else:
            raise RuntimeError(f"Unsupported Auth scenario action: {op.action}")
        return True
    finally:
        if old_host is None:
            os.environ.pop("FIREBASE_AUTH_EMULATOR_HOST", None)
        else:
            os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = old_host


def apply_operation(cfg: config.HarnessConfig, op: SeedOperation, *, kind: str) -> None:
    if op.kind == "file":
        target = cfg.layout.state_root / "files" / op.target
        safety.validate_destructive_target(target.parent, state_root=cfg.layout.state_root, repo_root=cfg.repo_root)
        if op.action == "write":
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(str(op.payload), encoding="utf-8")
        elif target.exists():
            safety.validate_destructive_target(target, state_root=cfg.layout.state_root, repo_root=cfg.repo_root)
            target.unlink()
        return
    if op.kind == "metadata":
        target = cfg.layout.state_root / "manifests" / current_manifest_name(kind)
        if op.action == "write":
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(op.payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        elif target.exists():
            target.unlink()
        return
    if op.kind == "firestore":
        if apply_firestore_admin_sdk(cfg, op):
            return
        encoded_path = "/".join(quote(part, safe="") for part in op.target.split("/"))
        url = (
            f"http://{cfg.firestore_host}/v1/projects/{cfg.project_id}/databases/"
            f"{quote(cfg.database_id, safe='')}/documents/{encoded_path}"
        )
        if op.action == "upsert":
            status, body = request_json(
                "PATCH", url, firestore_document_payload(op.payload if isinstance(op.payload, Mapping) else {})
            )
            if status >= 400:
                raise RuntimeError(f"Firestore emulator write failed for {op.target}: HTTP {status} {body[:200]}")
        elif op.action == "delete":
            status, body = request_json("DELETE", url)
            if status not in {200, 404}:
                raise RuntimeError(f"Firestore emulator delete failed for {op.target}: HTTP {status} {body[:200]}")
        return
    if op.kind == "auth":
        if apply_auth_admin_sdk(cfg, op):
            return
        if op.requires_fixed_uid:
            raise RuntimeError("Fixtures that require a fixed Auth UID need Firebase Admin Auth")
        if op.action == "upsert":
            payload = dict(op.payload if isinstance(op.payload, Mapping) else {})
            url = f"http://{cfg.auth_host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-dev-harness"
            status, body = request_json("POST", url, payload)
            if status >= 400 and "UNEXPECTED_PARAMETER : User ID" in body:
                payload.pop("localId", None)
                status, body = request_json("POST", url, payload)
            if status >= 400 and "EMAIL_EXISTS" not in body:
                raise RuntimeError(f"Auth emulator user seed failed for {op.target}: HTTP {status} {body[:200]}")
        elif op.action == "delete":
            url = f"http://{cfg.auth_host}/emulator/v1/projects/{cfg.project_id}/accounts?localId={quote(op.target, safe='')}"
            status, body = request_json("DELETE", url)
            if status not in {200, 404}:
                raise RuntimeError(f"Auth emulator user reset failed for {op.target}: HTTP {status} {body[:200]}")
        return
    if op.kind == "redis":
        return


def lookup_auth_uid(cfg: config.HarnessConfig, email: str, password: str) -> str:
    url = f"http://{cfg.auth_host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-dev-harness"
    status, body = request_json(
        "POST",
        url,
        {"email": email, "password": password, "returnSecureToken": True},
    )
    if status >= 400:
        raise RuntimeError(f"Auth uid lookup failed for {email}: HTTP {status} {body[:200]}")
    payload = json.loads(body)
    local_id = payload.get("localId")
    if not isinstance(local_id, str) or not local_id.strip():
        raise RuntimeError(f"Auth uid lookup for {email} returned no localId")
    return local_id


def resolve_auth_uid_map(cfg: config.HarnessConfig, users: Sequence[ScenarioUser]) -> dict[str, str]:
    return {user.uid: lookup_auth_uid(cfg, user.email, user.password) for user in users}


def remap_firestore_seed(seed: FirestoreSeed, uid_map: Mapping[str, str]) -> FirestoreSeed:
    parts = seed.path.split("/")
    if len(parts) >= 2 and parts[0] == "users" and parts[1] in uid_map:
        parts[1] = uid_map[parts[1]]
        data = dict(seed.data)
        uid_value = data.get("uid")
        if isinstance(uid_value, str) and uid_value in uid_map:
            data["uid"] = uid_map[uid_value]
        return FirestoreSeed(path="/".join(parts), protected=seed.protected, data=data)
    return seed


def remap_auth_operation(op: SeedOperation, uid_map: Mapping[str, str]) -> SeedOperation:
    if op.kind != "auth":
        return op
    resolved = uid_map.get(op.target, op.target)
    return replace(op, target=resolved)


def remap_seed_operation(op: SeedOperation, uid_map: Mapping[str, str]) -> SeedOperation:
    if op.kind != "firestore" or not isinstance(op.payload, Mapping):
        return op
    remapped = remap_firestore_seed(FirestoreSeed(path=op.target, data=op.payload, protected=op.protected), uid_map)
    return replace(op, target=remapped.path, payload=remapped.data)


def write_auth_uid_manifest(
    cfg: config.HarnessConfig,
    uid_map: Mapping[str, str],
    *,
    selected_user: str | None = None,
) -> Path:
    path = auth_uid_manifest_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    selected = uid_map.get(selected_user or "", "")
    if not selected and uid_map:
        selected = next(iter(uid_map.values()))
    payload = {
        "schema_version": 1,
        "generated_at": now_iso(),
        "users": dict(uid_map),
        "canonical_users": list(uid_map.values()),
        "selected_user": selected,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def read_auth_uid_manifest(cfg: config.HarnessConfig) -> dict[str, object]:
    path = auth_uid_manifest_path(cfg)
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def apply_seed_operations(
    cfg: config.HarnessConfig,
    users: Sequence[ScenarioUser],
    ops: tuple[SeedOperation, ...],
    *,
    kind: str,
    selected_user: str | None = None,
) -> dict[str, str]:
    auth_ops = [op for op in ops if op.kind == "auth"]
    other_ops = [op for op in ops if op.kind != "auth"]
    for op in auth_ops:
        apply_operation(cfg, op, kind=kind)
    uid_map = resolve_auth_uid_map(cfg, users)
    write_auth_uid_manifest(cfg, uid_map, selected_user=selected_user)
    for op in other_ops:
        apply_operation(cfg, remap_seed_operation(op, uid_map), kind=kind)
    return uid_map


def apply_reset_operations(
    cfg: config.HarnessConfig,
    users: Sequence[ScenarioUser],
    ops: tuple[SeedOperation, ...],
    *,
    kind: str,
) -> None:
    uid_map = read_auth_uid_manifest(cfg).get("users")
    if not isinstance(uid_map, dict):
        uid_map = resolve_auth_uid_map(cfg, users)
    typed_uid_map = {str(k): str(v) for k, v in uid_map.items()}
    for op in ops:
        remapped = (
            remap_auth_operation(op, typed_uid_map) if op.kind == "auth" else remap_seed_operation(op, typed_uid_map)
        )
        apply_operation(cfg, remapped, kind=kind)
    manifest_path = auth_uid_manifest_path(cfg)
    if manifest_path.exists():
        manifest_path.unlink()


def write_manifest(cfg: config.HarnessConfig, manifest: SeedManifest, *, kind: str, reset: bool = False) -> Path:
    cfg.layout.process_manifest.parent.mkdir(parents=True, exist_ok=True)
    path = cfg.layout.process_manifest.parent / seed_manifest_name(kind, manifest.scenario_id, reset=reset)
    path.write_text(json.dumps(jsonable(manifest), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def latest_seed_manifests_by_kind(cfg: config.HarnessConfig) -> dict[str, Path]:
    """Newest seed manifest per scenario kind (`memory`, `pricing`, …)."""

    manifests_dir = cfg.layout.state_root / "manifests"
    if not manifests_dir.is_dir():
        return {}
    newest: dict[str, Path] = {}
    for path in manifests_dir.glob("*-scenario-*-seed.json"):
        name = path.name
        kind, _, rest = name.partition("-scenario-")
        if not rest.endswith("-seed.json") or not kind:
            continue
        current = newest.get(kind)
        if current is None or path.stat().st_mtime >= current.stat().st_mtime:
            newest[kind] = path
    return newest


def load_json(path: Path) -> dict[str, object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def merged_auth_users_from_seed_manifests(cfg: config.HarnessConfig) -> dict[str, dict[str, str]]:
    """Union of auth upsert payloads across the newest seed manifest of every kind."""

    users: dict[str, dict[str, str]] = {}
    for path in latest_seed_manifests_by_kind(cfg).values():
        data = load_json(path)
        operations = data.get("operations", [])
        if not isinstance(operations, list):
            continue
        for op in operations:
            if not isinstance(op, dict) or op.get("kind") != "auth" or op.get("action") != "upsert":
                continue
            payload = op.get("payload")
            if not isinstance(payload, dict):
                continue
            local_id = payload.get("localId")
            if isinstance(local_id, str) and local_id:
                users[local_id] = {str(k): str(v) for k, v in payload.items() if v is not None}
    return users


def current_scenario_manifest(cfg: config.HarnessConfig) -> dict[str, object] | None:
    manifests_dir = cfg.layout.state_root / "manifests"
    currents = sorted(manifests_dir.glob("*-scenario-current.json"), key=lambda path: path.stat().st_mtime)
    for path in reversed(currents):
        data = load_json(path)
        if data:
            return data
    newest = latest_seed_manifests_by_kind(cfg)
    if not newest:
        return None
    latest = max(newest.values(), key=lambda path: path.stat().st_mtime)
    data = load_json(latest)
    return data or None
