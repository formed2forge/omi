#!/usr/bin/env bash
# Opt-in: run the Omi backend live for manual API testing (curl the routes).
#
# This brings up the full local stack: redis + the Firestore emulator, seeds a
# dev-only backend/.env + google-credentials.json, and runs uvicorn on :8080.
#
# It is intentionally NOT part of the per-boot `start` phase: the JVM emulator
# and a persisted backend/.env both interfere with the hermetic E2E harness
# (utils/env_loader.py re-reads .env via dotenv_values, leaking creds into the
# harness). Run this only when you actually want a live server, and remove
# backend/.env before running the hermetic harness again.
#
# Auth (verified): Authorization: Bearer local_dev_admin_key<uid>
#   e.g.  curl -H 'Authorization: Bearer local_dev_admin_key123' localhost:8080/v3/memories
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.local/bin:$PATH"

LOG_DIR="$REPO_ROOT/.cursor/run"
mkdir -p "$LOG_DIR"

echo "=== [serve] redis ==="
if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --daemonize yes --save '' --appendonly no
  for _ in $(seq 1 20); do redis-cli ping >/dev/null 2>&1 && break; sleep 0.5; done
fi
redis-cli ping >/dev/null 2>&1 && echo "redis ready" || { echo "redis failed" >&2; exit 1; }

echo "=== [serve] Firestore emulator ==="
FIRESTORE_PORT="$(python3 - <<'PY'
import json, pathlib
cfg = json.loads(pathlib.Path("firebase.json").read_text())
print(cfg.get("emulators", {}).get("firestore", {}).get("port", 8085))
PY
)"
if ! curl -sf "http://127.0.0.1:${FIRESTORE_PORT}/" >/dev/null 2>&1; then
  FIREBASE_BIN="$REPO_ROOT/node_modules/.bin/firebase"
  [ -x "$FIREBASE_BIN" ] || { echo "firebase CLI missing; run .cursor/install.sh" >&2; exit 1; }
  nohup "$FIREBASE_BIN" emulators:start --only firestore --project demo-omi \
    > "$LOG_DIR/firestore-emulator.log" 2>&1 &
  for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:${FIRESTORE_PORT}/" >/dev/null 2>&1 && break; sleep 1; done
fi
curl -sf "http://127.0.0.1:${FIRESTORE_PORT}/" >/dev/null 2>&1 \
  && echo "firestore emulator ready on :${FIRESTORE_PORT}" \
  || { echo "firestore emulator failed; see $LOG_DIR/firestore-emulator.log" >&2; exit 1; }

echo "=== [serve] seed dev backend/.env + credentials ==="
bash .cursor/seed-backend-env.sh

echo "=== [serve] uvicorn on :8080 (Ctrl-C to stop) ==="
cd backend
# shellcheck disable=SC1091
source .venv/bin/activate
exec python -m uvicorn main:app --host 0.0.0.0 --port "${OMI_BACKEND_PORT:-8080}"
