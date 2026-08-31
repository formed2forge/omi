#!/usr/bin/env bash
# Cloud Agent start phase: bring up lightweight per-boot services.
#
# Only redis is started here. It is tiny, idempotent, and harmless to the
# hermetic E2E harness (which uses in-process fakeredis). The heavier live
# stack — the JVM Firestore emulator + a live uvicorn — is intentionally an
# opt-in (.cursor/serve-backend.sh) so it never competes for CPU with, or slows
# down, the hermetic harness (the credential-free, CI-required validation).
set -euo pipefail

echo "=== [start] redis-server ==="
if redis-cli ping >/dev/null 2>&1; then
  echo "redis already running"
else
  redis-server --daemonize yes --save '' --appendonly no
  for _ in $(seq 1 20); do
    if redis-cli ping >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  redis-cli ping >/dev/null 2>&1 && echo "redis started" || { echo "redis failed to start" >&2; exit 1; }
fi

echo "=== [start] complete ==="
# The wire-contract/reconnect e2e tests contain ~45s of intentional sleeps, so
# on this 4-vCPU VM the harness can exceed run.sh's default 120s wall-clock
# guard. Recommend a roomier E2E_PYTEST_TIMEOUT for reliable local runs; CI
# keeps 120s on its own runners.
echo "Hermetic E2E (preferred, no creds): cd backend && source .venv/bin/activate && E2E_PYTEST_TIMEOUT=300s bash testing/e2e/run.sh"
echo "Live API server (opt-in):          bash .cursor/serve-backend.sh"
