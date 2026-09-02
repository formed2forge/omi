#!/usr/bin/env bash
# Hermetic regression: fold-into-waf prefers the local feature branch ref when present.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/omi-fold-waf.XXXXXX")"
trap 'rm -rf "$TMPDIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

REPO="$TMPDIR/repo"
BARE="$TMPDIR/origin.git"
git init -q --bare "$BARE"
git init -q "$REPO"
git -C "$REPO" remote add origin "$BARE"
git -C "$REPO" config user.email "fold-waf@test"
git -C "$REPO" config user.name "fold-waf-test"
git -C "$REPO" checkout -b main
mkdir -p "$REPO/desktop/windows/scripts"
cp "$ROOT/desktop/windows/scripts/fold-into-waf.sh" "$REPO/desktop/windows/scripts/fold-into-waf.sh"
chmod +x "$REPO/desktop/windows/scripts/fold-into-waf.sh"
echo "main" >"$REPO/desktop/windows/README.md"
git -C "$REPO" add desktop/windows/
git -C "$REPO" commit -m "seed main"
git -C "$REPO" push -u origin main

git -C "$REPO" checkout -b windows-all-fixes
echo "waf" >"$REPO/desktop/windows/README.md"
git -C "$REPO" add desktop/windows/README.md
git -C "$REPO" commit -m "seed waf"
git -C "$REPO" push -u origin windows-all-fixes

git -C "$REPO" checkout -b cursor/feature-6465
echo "feature" >"$REPO/desktop/windows/feature.txt"
git -C "$REPO" add desktop/windows/feature.txt
git -C "$REPO" commit -m "feature work"
# Deliberately do not push the feature branch - fold must merge from local HEAD.

(
  cd "$REPO"
  SKIP_VERIFY=1 bash desktop/windows/scripts/fold-into-waf.sh cursor/feature-6465
)

if ! git -C "$REPO" merge-base --is-ancestor "$(git -C "$REPO" rev-parse cursor/feature-6465)" windows-all-fixes; then
  fail "WAF tip does not contain feature branch commits after local merge"
fi

if [ ! -f "$REPO/desktop/windows/feature.txt" ]; then
  fail "folded feature file missing on windows-all-fixes"
fi

echo "fold-into-waf local-branch merge ref test passed."
