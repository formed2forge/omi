#!/usr/bin/env bash
#
# Behavioral test for the ATS policy generate_ios_dev_info_plist.sh writes into
# Info-Dev.plist.
#
# Regression covered (#11782): the generator used to write
# NSAllowsLocalNetworking unconditionally on every `setup.sh ios` run. That key
# only covers .local/unqualified/link-local hosts, never a Tailscale CGNAT
# address (100.64.0.0/10) — the address the documented physical-device setup
# actually uses (see #11730/#11652). Because the generator runs on every
# `setup.sh ios` invocation and always starts from a fresh copy of Info.plist,
# it silently reverted the CGNAT fix that #11652 hand-edited into the checked-in
# Info-Dev.plist, with no warning and no diff to notice. Confirmed live on a
# physical device: every NSURLSession call failed with CFNetwork Code=-1022
# until the generator's output was corrected.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/../.."
GENERATOR="${APP_DIR}/scripts/generate_ios_dev_info_plist.sh"

failures=0
pass() { echo "  ok   - $1"; }
fail() { echo "  FAIL - $1" >&2; failures=$((failures + 1)); }

[[ -f "$GENERATOR" ]] || { echo "FAIL: missing $GENERATOR" >&2; exit 1; }

work=$(mktemp -d -t omi_ios_dev_ats_XXXXXX)
cat > "$work/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Runner</string>
</dict>
</plist>
PLIST

bash "$GENERATOR" "$work/Info.plist" "$work/Info-Dev.plist" >/dev/null 2>&1

echo "generate_ios_dev_info_plist.sh ATS output:"

# The generator itself is implemented with Python's stdlib plistlib rather
# than PlistBuddy/plutil (both macOS-only), so this test reads the output the
# same cross-platform way instead of shelling out to PlistBuddy — that keeps
# real behavioral coverage on the Linux CI runner instead of skipping it.
read_ats_key() {
  python3 - "$1" "$2" <<'PY'
import plistlib
import sys

path, key = sys.argv[1], sys.argv[2]
with open(path, "rb") as f:
    data = plistlib.load(f)
value = data.get("NSAppTransportSecurity", {}).get(key)
if value is not None:
    print(value)
PY
}

if [ "$(read_ats_key "$work/Info-Dev.plist" NSAllowsArbitraryLoads)" = "True" ]; then
  pass "output declares NSAllowsArbitraryLoads=true"
else
  fail "output is missing NSAllowsArbitraryLoads=true — CGNAT dev hosts (Tailscale) would be ATS-blocked"
fi

if [ -z "$(read_ats_key "$work/Info-Dev.plist" NSAllowsLocalNetworking)" ]; then
  pass "output does not declare NSAllowsLocalNetworking"
else
  fail "output declares NSAllowsLocalNetworking — combined with NSAllowsArbitraryLoads this is a documented no-op that silently re-blocks CGNAT hosts"
fi

rm -rf "$work"

echo
if [[ "$failures" -gt 0 ]]; then
  echo "$failures shell test(s) failed" >&2
  exit 1
fi
echo "all iOS dev ATS config shell tests passed"
