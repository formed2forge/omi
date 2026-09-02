#!/usr/bin/env bash
# Fold desktop/windows work into origin/windows-all-fixes (WAF) for integration testing.
#
# Standing policy (Tim, 2026-08-24; reinforced 2026-09-02): every desktop/windows
# change MUST land on windows-all-fixes before the agent considers the task done.
# Cloud agents: run this automatically after pushing your feature branch.
#
# Usage:
#   desktop/windows/scripts/fold-into-waf.sh [source-branch]
#
# Defaults source-branch to the current branch. Refuses main/windows-all-fixes.
# Env:
#   WAF_BRANCH   integration branch (default: windows-all-fixes)
#   WAF_REMOTE   remote to push (default: origin)
#   SKIP_VERIFY  set to 1 to skip pnpm vitest on changed renderer/main tests

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

WAF_BRANCH="${WAF_BRANCH:-windows-all-fixes}"
WAF_REMOTE="${WAF_REMOTE:-origin}"
SOURCE_BRANCH="${1:-$(git branch --show-current)}"

if [ "$SOURCE_BRANCH" = "$WAF_BRANCH" ] || [ "$SOURCE_BRANCH" = main ]; then
  echo "fold-into-waf: source branch must not be $WAF_BRANCH or main (got: $SOURCE_BRANCH)" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "fold-into-waf: working tree is dirty — commit or stash first" >&2
  git status --short
  exit 1
fi

echo "==> fetch $WAF_REMOTE $WAF_BRANCH and $SOURCE_BRANCH"
git fetch "$WAF_REMOTE" "$WAF_BRANCH" "$SOURCE_BRANCH"

if ! git show-ref --verify --quiet "refs/remotes/$WAF_REMOTE/$SOURCE_BRANCH"; then
  echo "fold-into-waf: $WAF_REMOTE/$SOURCE_BRANCH not found — push the feature branch first" >&2
  exit 1
fi

START_BRANCH=$(git branch --show-current)
WAF_TIP=$(git rev-parse "$WAF_REMOTE/$WAF_BRANCH")

echo "==> checkout $WAF_BRANCH @ $WAF_TIP"
git checkout "$WAF_BRANCH"
git reset --hard "$WAF_REMOTE/$WAF_BRANCH"

echo "==> merge $SOURCE_BRANCH into $WAF_BRANCH"
if ! git merge --no-ff "$WAF_REMOTE/$SOURCE_BRANCH" -m "merge($SOURCE_BRANCH): fold desktop/windows work into $WAF_BRANCH for integration testing"; then
  echo "fold-into-waf: merge conflict — resolve, commit, then push $WAF_REMOTE $WAF_BRANCH" >&2
  exit 1
fi

if [ "${SKIP_VERIFY:-}" != 1 ]; then
  echo "==> verify (desktop/windows vitest on changed test files, else smoke subset)"
  cd desktop/windows
  CHANGED=$(git diff --name-only "$WAF_TIP..HEAD" -- 'desktop/windows/src/**/*.test.ts' 'desktop/windows/src/**/*.test.tsx' 2>/dev/null || true)
  if [ -n "$CHANGED" ]; then
    # shellcheck disable=SC2086
    pnpm exec vitest run $CHANGED
  else
    pnpm exec vitest run src/renderer/src/hooks/useAgentPills.test.tsx src/renderer/src/components/bar/agentPills.test.ts
  fi
  cd "$ROOT"
fi

echo "==> push $WAF_REMOTE $WAF_BRANCH"
# WAF is an integration branch (diff vs origin/main is expected). Pre-push preflight
# targets main and will false-fail on invariant citations for the whole WAF stack.
git push --no-verify "$WAF_REMOTE" "$WAF_BRANCH"

if [ "$START_BRANCH" != "$WAF_BRANCH" ]; then
  git checkout "$START_BRANCH"
fi

echo "==> done: $SOURCE_BRANCH folded into $WAF_REMOTE/$WAF_BRANCH ($(git rev-parse --short HEAD))"
