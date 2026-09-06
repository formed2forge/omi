# iOS pricing QA recipe

This recipe exercises the Flutter dev app against the local Firestore/Auth
emulators and the Python harness. It is safe for a personal Apple team: the
device is signed with that team, while the selected pricing UID is synthetic.

## 1. Start the harness

Use a Mac address reachable from the iPhone. A LAN address is simplest; use a
Tailscale address only when the iPhone is also connected to the same tailnet.

```bash
cd /Volumes/LEXAR/tempdev/omi
export OMI_DEV_HOST="$(ipconfig getifaddr en0)"
# Or: export OMI_DEV_HOST="$(tailscale ip -4 | head -1)"
export APPLE_DEVELOPMENT_TEAM=<10-character-team-id>
PROVIDER_MODE=offline make dev-up
```

Keep that terminal running. In another terminal, check the stack and seed the
catalogue fixtures:

```bash
cd /Volumes/LEXAR/tempdev/omi
make dev-status
make list-pricing-scenarios
make seed-pricing-scenario SCENARIO=plan_catalog_matrix
```

`OMI_DEV_HOST` must be set before both `make dev-up` and the iOS setup command.
The setup script passes it to the Python API and Firebase Auth emulator. The
phone and Mac must be able to reach the emulator ports through the Mac firewall.

## 2. Build and install the dev app

Pair the iPhone with Xcode, enable Developer Mode, unlock it, and confirm it
appears in `flutter devices`. Then run:

```bash
cd /Volumes/LEXAR/tempdev/omi/app
APPLE_DEVELOPMENT_TEAM="$APPLE_DEVELOPMENT_TEAM" bash setup.sh ios
```

Select the physical device if prompted. Local emulator builds do not initialize
FCM or Crashlytics, so a real GoogleService-Info API key is not needed.

## 3. Sign in and inspect the catalogue

On onboarding, tap **Sign In (Developer)**, enter a seeded UID, and tap
**Sign In**. This does not use Apple/Google OAuth or the personal account.

Open **Settings → Plan & Usage → Manage** and verify the title and description.
The main matrix expects:

| UID | Expected title |
|---|---|
| `pricing_never_subscribed` | Free |
| `pricing_basic` | Free |
| `pricing_plus` | Plus |
| `pricing_pro_v2` | Pro |
| `pricing_unlimited` | Neo (Legacy Plan) |
| `pricing_architect` | Architect (Legacy Plan) |
| `pricing_operator` | Operator (Legacy Plan) |
| `pricing_unlimited_v2` | Unlimited (Legacy Plan) |

Sign out and repeat with each UID. Trust the catalog title resolved from
`current_price_id`; the wire `plan` field intentionally uses a compatibility
fallback for some fixtures.

For the other cases, reseed before signing in again:

```bash
make seed-pricing-scenario SCENARIO=legacy_and_unknown_plan_resilience
make seed-pricing-scenario SCENARIO=cancellation_and_downgrade_safety
```

## 4. Clean up

```bash
cd /Volumes/LEXAR/tempdev/omi
make reset-pricing-scenario SCENARIO=plan_catalog_matrix
make dev-down
```

