#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$ROOT}"

# A linked worktree's `.git` is a *file* pointing at `<primary>/.git/worktrees/<name>`,
# and `make setup` passes whichever worktree invoked it. Bailing out here would skip the
# repair in exactly the situation that causes the damage: an unisolated `git init` running
# under a linked worktree's exported GIT_DIR has no work tree to infer, so Git re-inits it
# as bare and writes `core.bare=true` to the *shared* config — breaking `git status` and
# `rev-parse --show-toplevel` for the primary checkout and every other worktree. Resolve
# the primary from the common git dir instead of giving up.
if [ -f "$TARGET/.git" ]; then
  COMMON_DIR="$(git -C "$TARGET" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [ -n "$COMMON_DIR" ] && [ -d "$COMMON_DIR" ] || exit 0
  PRIMARY="$(cd "$COMMON_DIR/.." 2>/dev/null && pwd -P || true)"
  [ -n "$PRIMARY" ] || exit 0
  # Only adopt the resolved path when its `.git` *is* the common dir. A repo that is
  # genuinely bare (including a bare worktree host) must never be "repaired".
  [ -d "$PRIMARY/.git" ] || exit 0
  [ "$(cd "$PRIMARY/.git" && pwd -P)" = "$(cd "$COMMON_DIR" && pwd -P)" ] || exit 0
  TARGET="$PRIMARY"
fi

# Primary checkout: repo-root `.git` is a directory. A mistaken `core.bare=true` makes
# Git treat this path as a bare repo: `git status` and `show-toplevel` fail here,
# and `git worktree list` labels the main path "(bare)" even though the tree exists.
if [ ! -d "$TARGET/.git" ]; then
  exit 0
fi

# Use --bool so any valid true spelling (yes, on, 1, TRUE, …) canonicalises
# to "true"; a plain --get returns the raw value and would miss these.
if [ "$(git -C "$TARGET" config --bool --get core.bare 2>/dev/null || echo false)" != "true" ]; then
  exit 0
fi

echo "Repairing mistaken core.bare=true on primary checkout at $TARGET" >&2
git -C "$TARGET" config core.bare false
