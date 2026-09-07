# Local-dev onboarding bypass

A cross-platform pathway that lets any Omi app running against the **local dev
emulator** skip onboarding and land in a deterministic, safe, non-privileged
fixture account — without typing a uid or clicking through the wizard. It is
centrally defined once (see the contract below) with a thin adapter per
platform; mobile, macOS, and Windows all implement the identical gate and
fixture identity.

This is a **separate, narrower opt-in** on top of each platform's existing
local-dev sign-in (the manual "Sign In (Developer)" flow on mobile/Windows,
the named-bundle launcher on macOS) — that existing path is unaffected and
still runs onboarding normally, so testers can still verify the wizard itself
or sign in as a specific `pricing_*` fixture for catalogue QA (see
[PRICING_SCENARIOS.md](PRICING_SCENARIOS.md)).

## The contract

[`contracts/parity/local_dev_onboarding_bypass.json`](../../contracts/parity/local_dev_onboarding_bypass.json)
is the single source of truth: the fixture identity and the gate's truth
table. Each platform's conformance suite runs the SAME `gate_cases` through
its own production gate function.

- **Fixture identity**: uid `local_dev_fixture`, display name **Local Dev**
  (given name "Local", family name "Dev"). It is a brand-new uid with no
  Stripe/subscription document, so it resolves to Free/no-entitlement through
  the same path as any never-subscribed account — no paid-plan wiring, no
  elevated permissions. It carries no real email, tokens, or cloud data: the
  emulator creates it fresh (`local_dev_fixture@local.test`), and only ever
  inside the local Auth emulator.
- **Gate**: requires BOTH an already-valid local-dev profile/config AND a
  SEPARATE, explicit bypass flag set to exactly `"1"`. Neither alone is
  enough, and no other value (`"0"`, `"yes"`, whitespace-padded, unset) counts
  as on — this is a deterministic, non-fuzzy check, never inferred from
  build type, persisted state, or merely having signed in before.
- **Onboarding composition**: on every platform, onboarding is treated as
  satisfied only when the bypass is active AND the currently signed-in
  identity is genuinely the fixture uid — never merely because the bypass
  flag happens to be set. A tester who manually signs in as `pricing_plus`
  (or any other uid) while the flag is on still runs the real onboarding flow.

## Enable / disable / reset

The bypass flag is a build-time value on every platform — a full rebuild or
app restart is required to pick up a change, same as any other local-dev
`.env`/dart-define value.

| Platform | Prerequisite | Bypass flag | Where |
|---|---|---|---|
| Windows | `VITE_OMI_APP_PROFILE=local_dev` | `VITE_OMI_LOCAL_DEV_ONBOARDING_BYPASS=1` | `desktop/windows/.env` |
| Mobile (Flutter) | `OMI_APP_PROFILE=local_dev` (dev flavor) | `OMI_LOCAL_DEV_ONBOARDING_BYPASS=1` | `--dart-define`, e.g. `flutter run --flavor dev --dart-define=OMI_APP_PROFILE=local_dev --dart-define=OMI_LOCAL_DEV_ONBOARDING_BYPASS=1` |
| macOS | `OMI_DESKTOP_LOCAL_PROFILE=1` (harness mode) | `OMI_LOCAL_DEV_ONBOARDING_BYPASS=1` | exported before `./run.sh`, or written into the named bundle's `.env` alongside the other `OMI_LOCAL_*` vars (`scripts/local-profile-env.sh`) |

**Enable**: set the bypass flag alongside the profile prerequisite, then
rebuild/relaunch. The app auto-signs-in as `local_dev_fixture` and lands
directly on the authenticated home surface.

**Disable**: unset the bypass flag (or set it to anything other than `"1"`)
and relaunch — the profile prerequisite can stay set. This is a **runtime-only**
switch: it never persists a fake "onboarding completed" state, so disabling
and relaunching (mobile/Windows) falls straight back through to the real
onboarding wizard with no stale flag to clear first. On macOS, onboarding
completion IS persisted once shown (same as the existing `OMI_SKIP_ONBOARDING`
behavior) — use a fresh named bundle to see the wizard again, matching the
platform's existing testing convention.

**Reset** (see a fresh onboarding pass again):
- **Windows**: sign out and pick a different uid from "Sign In (Developer)"
  (e.g. any `pricing_*` fixture) — an explicit sign-out suppresses the
  bypass's auto sign-in for that profile (see below), so it will not race you
  back into the fixture identity before you can choose one. To go back to the
  auto-bootstrapped fixture, use "Sign In (Developer)"'s **Reset to auto
  sign-in** control (only shown while the bypass flag is on) — it clears the
  suppression and signs in as the fixture immediately. Just disabling the
  bypass flag and relaunching also falls through to the real wizard, same as
  before.
- **Mobile**: sign out (or just disable the bypass and relaunch — the flag
  check is re-evaluated live against the current sign-in each time).
- **macOS**: launch a new named bundle (`OMI_APP_NAME=omi-<feature>`), which
  gets its own isolated storage/UserDefaults root.

**Windows-specific: sign-out is sticky.** An explicit sign-out — whether from
the auto-bootstrapped fixture or a manually-typed uid — persists a
profile-scoped "suppressed" marker (`lib/localDevOnboardingBypassState.ts`,
survives an app restart) so the bypass never silently signs the fixture back
in underneath a tester who chose to sign out or is mid-way through picking a
different pricing uid. Only "Sign In (Developer)"'s **Reset to auto sign-in**
control lifts it.

## Safety boundary

- The bypass never activates without both the profile AND flag explicitly
  set — dropped in a production build (or a production-family macOS bundle,
  which is hard-vetoed independent of any flag), it is completely inert.
- The fixture is signed in through the exact same harness custom-token
  exchange (`POST /v1/auth/local-dev/custom-token`) the manual "Sign In
  (Developer)" flow already uses (Windows/mobile), or the macOS equivalent —
  gated server-side on the backend being bound to a Firebase Auth emulator
  (`FIREBASE_AUTH_EMULATOR_HOST`), which 404s outside that. It never reaches
  a production endpoint.
- On macOS, the fixture signs in through the same
  `RuntimeOwnerIdentity.performEffectiveOwnerTransition` choke point every
  other sign-in path uses (INV-AUTH-1) — it never writes `auth_userId`/
  `authIsSignedIn` directly, and every owner-replacement teardown (voice,
  agent runtime, per-owner storage) still runs.

## Testing

Each platform has a pure, dependency-injected gate function plus a
conformance test that loads the shared JSON fixture directly:

- Windows: `desktop/windows/src/shared/localDevOnboardingBypass.ts` +
  `localDevOnboardingBypassContract.test.ts` (cross-platform gate contract).
  The Windows-only sign-out-suppression behavior above is covered separately:
  `src/renderer/src/lib/localDevOnboardingBypassState.test.ts` (the persisted
  marker), `src/renderer/src/hooks/useLocalDevOnboardingBypass.test.ts` (the
  auto sign-in effect respects it), and
  `src/renderer/src/components/auth/LocalDevSignIn.test.tsx` (the Reset
  control).
- Mobile: `app/lib/env/local_dev_onboarding_bypass.dart` +
  `app/test/unit/local_dev_onboarding_bypass_test.dart`
- macOS: `DesktopLocalProfile.onboardingBypassEnabled` (OmiSupport) +
  `desktop/macos/Desktop/Tests/DesktopLocalProfileTests.swift`
