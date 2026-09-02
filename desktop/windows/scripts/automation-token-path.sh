#!/usr/bin/env bash
# Shared automation-token path resolution for shell harnesses.
# Usage:
#   source "$(dirname "$0")/automation-token-path.sh"
#   TOKEN_FILE="$(omi_automation_token_file "$PORT")"

omi_automation_token_file() {
  local port="${1:?port required}"
  if [ -n "${OMI_AUTOMATION_TOKEN_FILE:-}" ]; then
    printf '%s\n' "$OMI_AUTOMATION_TOKEN_FILE"
    return 0
  fi
  printf '%s\n' "${TMPDIR:-/tmp}/omi-automation-${port}.token"
}
