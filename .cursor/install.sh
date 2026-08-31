#!/usr/bin/env bash
# Cloud Agent install phase for the Omi Python backend (Linux x86).
# Idempotent: safe to run repeatedly and against cached/partial state.
# Only the backend is exercised on this VM — the macOS/iOS/Android/firmware
# targets need macOS, Xcode, the Android SDK, or embedded hardware.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== [install] system packages (redis, opus, ffmpeg) ==="
# redis-server: live uvicorn + integration harnesses. libopus: opuslib audio.
# ffmpeg: audio decode. Bounded apt retries so a stalled mirror fails fast.
NEEDED_PKGS=()
for pkg in redis-server libopus0 libopus-dev ffmpeg; do
  dpkg -s "$pkg" >/dev/null 2>&1 || NEEDED_PKGS+=("$pkg")
done
# Firestore emulator needs a JRE; the default image ships Java 21, but install a
# headless JRE defensively if a future base image drops it.
command -v java >/dev/null 2>&1 || NEEDED_PKGS+=("default-jre-headless")
if [ "${#NEEDED_PKGS[@]}" -gt 0 ]; then
  sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 update
  sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 install --yes --no-install-recommends "${NEEDED_PKGS[@]}"
else
  echo "system packages already present"
fi

echo "=== [install] uv (pinned to match backend/Dockerfile + CI) ==="
export PATH="$HOME/.local/bin:$PATH"
UV_VERSION="0.11.13"
if ! command -v uv >/dev/null 2>&1 || [ "$(uv --version 2>/dev/null | awk '{print $2}')" != "$UV_VERSION" ]; then
  curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | UV_INSTALL_DIR="$HOME/.local/bin" sh
else
  echo "uv ${UV_VERSION} already installed"
fi

echo "=== [install] backend Python venv (.python-version + pylock.toml) ==="
bash backend/scripts/sync-python-deps.sh

echo "=== [install] Firebase CLI (pinned) for the Firestore emulator ==="
# Provides node_modules/.bin/firebase (firebase-tools) used by the live path.
for attempt in 1 2 3; do
  if npm ci --ignore-scripts --prefer-offline --no-audit --fund=false; then
    break
  fi
  if [ "$attempt" = 3 ]; then
    echo "npm ci failed after 3 attempts" >&2
    exit 1
  fi
  npm cache verify || true
  sleep "$attempt"
done

# NOTE: We deliberately do NOT create backend/.env here. utils/env_loader.py
# reads .env via dotenv_values(), which the hermetic harness cannot fully
# suppress, so a persisted .env leaks GOOGLE_APPLICATION_CREDENTIALS into the
# harness process and breaks its dev-token auth. The baseline VM therefore
# stays .env-free (matching CI) so the hermetic harness passes for every fresh
# agent. The live API path seeds .env on demand via .cursor/serve-backend.sh.

echo "=== [install] prewarm tiktoken tokenizer cache ==="
# tiktoken lazily downloads tokenizer data on first use; do it now so the
# hermetic harness's outbound-network guard never trips on a cold cache.
if [ -f backend/scripts/prewarm_tiktoken_cache.py ]; then
  backend/.venv/bin/python backend/scripts/prewarm_tiktoken_cache.py || true
fi

echo "=== [install] complete ==="
