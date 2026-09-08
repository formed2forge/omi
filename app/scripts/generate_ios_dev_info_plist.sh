#!/usr/bin/env bash
set -euo pipefail

SOURCE_PLIST="${1:-ios/Runner/Info.plist}"
OUTPUT_PLIST="${2:-ios/Runner/Info-Dev.plist}"

if [[ ! -f "$SOURCE_PLIST" ]]; then
  echo "Missing source plist: $SOURCE_PLIST" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PLIST")"
cp "$SOURCE_PLIST" "$OUTPUT_PLIST"
# NSAllowsArbitraryLoads, not NSAllowsLocalNetworking: the latter covers only
# .local/unqualified/link-local hosts, never a Tailscale CGNAT address
# (100.64.0.0/10), which is what the documented local-dev device setup uses.
# See #11730/#11652/#11782 — a prior version of this script wrote
# NSAllowsLocalNetworking and silently reverted the CGNAT fix on every run.
#
# Implemented with Python's stdlib plistlib rather than PlistBuddy/plutil so
# this generator (and its shell test) works identically on macOS and on the
# Linux CI runner — PlistBuddy and plutil are macOS-only binaries with no
# Linux equivalent.
python3 - "$OUTPUT_PLIST" <<'PY'
import plistlib
import sys

path = sys.argv[1]
with open(path, "rb") as f:
    data = plistlib.load(f)

# Mirror PlistBuddy's `Add :NSAppTransportSecurity dict`, which fails loudly
# if the key already exists. This generator always starts from a fresh copy
# of Info.plist (see the comment above), so an existing key here means the
# source plist changed in a way this script no longer expects.
if "NSAppTransportSecurity" in data:
    sys.exit("NSAppTransportSecurity already present in source plist; refusing to overwrite")

data["NSAppTransportSecurity"] = {"NSAllowsArbitraryLoads": True}

with open(path, "wb") as f:
    plistlib.dump(data, f)
PY

# Validate the plist is well-formed. Prefer plutil where available (matches
# Xcode's own validator); plistlib.load above already parses the file it just
# wrote, so this is redundant on macOS and a real cross-platform check
# elsewhere (e.g. Linux CI, where plutil doesn't exist).
if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$OUTPUT_PLIST" >/dev/null
else
  python3 -c "import plistlib, sys; plistlib.load(open(sys.argv[1], 'rb'))" "$OUTPUT_PLIST"
fi
