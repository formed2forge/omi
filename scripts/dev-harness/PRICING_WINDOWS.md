# Windows pricing QA recipe

The Windows Electron app has a local **Sign In (Developer)** path (parity with
[iOS](PRICING_IOS.md) / [macOS](PRICING_MACOS.md)): it exchanges a seeded
emulator uid for a Firebase custom token via the harness backend's
`/v1/auth/local-dev/custom-token`, then signs in against a Firebase Auth
emulator connection — no OAuth client, no production Firebase project. This
is **local emulator testing only** — it proves the pricing catalogue renders
correctly for a given fixture, not real Stripe entitlements or activation
eligibility. See the "Wire trap" section of
[PRICING_SCENARIOS.md](PRICING_SCENARIOS.md) before judging Settings.

## 1. Start and seed the Mac harness

Run this on the Mac hosting the emulators. Use a Mac address reachable from the
Windows machine — a LAN address is simplest; use a Tailscale address only when
the Windows machine is also on the same tailnet.

```bash
cd /Volumes/LEXAR/tempdev/omi
export OMI_DEV_HOST="$(ipconfig getifaddr en0)"
# Or: export OMI_DEV_HOST="$(tailscale ip -4 | head -1)"
PROVIDER_MODE=offline make dev-up
make dev-status
make seed-pricing-scenario SCENARIO=plan_catalog_matrix
```

`OMI_DEV_HOST` must be set before `make dev-up` — it becomes the bind host for
both the Python API (port 8000) and the Firebase Auth emulator (port 9099).
The Windows machine must be able to reach both ports through the Mac firewall.

## 2. Configure the Windows app for local-dev

On Windows, use Node 22 and pnpm 10:

```powershell
cd desktop\windows
nvm use
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

Edit `.env` and set the local-dev block (`<mac-host>` is the `OMI_DEV_HOST`
value from step 1 — e.g. its LAN IP):

```ini
VITE_OMI_APP_PROFILE=local_dev
VITE_OMI_API_BASE=http://<mac-host>:8000
VITE_FIREBASE_AUTH_EMULATOR_HOST=<mac-host>
VITE_FIREBASE_AUTH_EMULATOR_PORT=9099
```

Leaving `VITE_OMI_APP_PROFILE` unset (or anything other than `local_dev`) keeps
the app on its normal production/cloud OAuth behavior with no Developer
control shown — that's the default `.env.example` state and every non-QA dev
loop. Setting `VITE_OMI_APP_PROFILE=local_dev` without also repointing
`VITE_OMI_API_BASE` at the harness (or without the emulator host/port) is a
**fail-closed configuration error**: the Login screen shows the exact missing
variable instead of silently falling back to `https://api.omi.me` or
production Firebase.

## 3. Run and sign in

```powershell
pnpm run typecheck
pnpm test
pnpm run dev
```

On the Login screen, a **Local development** section appears below the Apple/
Google buttons (only in this profile — a normal build never shows it). Pick or
type a seeded uid — default `pricing_plus` — and click **Sign In
(Developer)**. This exchanges the uid with the harness backend and signs in
against the Firebase Auth emulator; it never invokes Apple/Google OAuth. A uid
signed in for the first time is a fresh emulator account, so the app's normal
onboarding flow runs once before Settings is reachable — this is unrelated to
the pricing fixture and not skipped on Windows (unlike the Mac named-bundle
launcher).

Open **Settings → Plan & Usage → Manage** and verify the title and
description. The main matrix expects:

| uid | Expected title |
|---|---|
| `pricing_never_subscribed` | Free |
| `pricing_basic` | Free |
| `pricing_plus` | Plus |
| `pricing_pro_v2` | Pro |
| `pricing_unlimited` | Neo (Legacy Plan) |
| `pricing_architect` | Architect (Legacy Plan) |
| `pricing_operator` | Operator (Legacy Plan) |
| `pricing_unlimited_v2` | Unlimited (Legacy Plan) |
| `pricing_plus_lapsed` | Free |

Trust the catalog title resolved from `current_price_id`; the wire `plan`
field intentionally uses a compatibility fallback for some fixtures (see
PRICING_SCENARIOS.md's "Wire trap").

To test another uid: sign out (clears the emulator session and local
persisted auth state) and sign in again with a different uid. Restarting the
app restores the same emulator session without re-entering a uid, same as the
normal OAuth path.

For the other scenarios, reseed before signing in again:

```bash
make seed-pricing-scenario SCENARIO=legacy_and_unknown_plan_resilience
make seed-pricing-scenario SCENARIO=cancellation_and_downgrade_safety
```

`OMI_E2E_FAKE_AUTH=1` remains a separate, hermetic UI-test seam (no live
Firebase session, every backend call 401s) — it is not a substitute for this
path and does not load live pricing fixtures.

## 4. Clean up

On Windows: sign out, or just close the app (the emulator session lives only
in this profile's userData).

On the Mac:

```bash
make reset-pricing-scenario SCENARIO=plan_catalog_matrix
make dev-down
```
