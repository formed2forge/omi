# Local pricing scenario fixtures

The fixtures in `dev_harness.pricing_scenarios` are synthetic, catalog-derived, importable local emulator fixtures for Settings / subscription QA.

They are **LOCAL_EMULATOR_DEV** artifacts only:

- `evidence_class` is hard-coded as `LOCAL_EMULATOR_DEV`.
- `activation_eligible` is hard-coded as `false`.
- `watermark` is hard-coded as `NOT_ACTIVATION_EVIDENCE`.
- Fixture definitions cannot choose evidence labels and must not be used as dev-cloud proof.
- Synthetic users use `{uid}@local.omi.invalid` and `{uid}-local-password-pricing`. No production UIDs, tokens, credentials, or copied Stripe customer data are present.
- Paid documents set `current_price_id` and a far-future `current_period_end`. They do **not** set `stripe_subscription_id`, so live Stripe subscription retrieve/cancel is not on the path.

Plan identity is read from `backend/config/plan_catalog_generated.py` at import time. A catalog add such as `pro_v2` appears as `pricing_pro_v2` without a hardcoded copy. There is no Max fixture.

## Wire trap (read this before judging Settings)

`UserSubscriptionResponse` still rejects `plus` / `pro_v2` / `unlimited_v2` on the OpenAPI `PlanType` enum. `/v1/users/me/subscription` remaps those through `wire_plan_for_client` using `WIRE_FALLBACK_PLAN_TYPES` (not `MOBILE_PLAN_TYPES` — Unlimited-v2 is keep-until-cancel, not a sold mobile SKU) and serializes `plan=unlimited`. Skipping that remap 500s the endpoint and Settings falls through to Free. Clients recover Plus / Pro / Unlimited-v2 by matching `current_price_id` against `available_plans`.

The harness injects `price_local_*` Stripe price ids and stubs `retrieve_price` when `ENVIRONMENT=local-dev-harness` (or `OMI_HARNESS_STRIPE_STUB=1`) so `available_plans` is populated without a network call. Testers should trust the catalog title, not the raw `plan=` field.

Do not expand OpenAPI `PlanType` as part of this harness.

## Commands

```bash
PROVIDER_MODE=offline make dev-up
make list-pricing-scenarios
make seed-pricing-scenario SCENARIO=plan_catalog_matrix
make desktop-run-local DESKTOP_APP_NAME=omi-pricing DESKTOP_USER=pricing_plus
make reset-pricing-scenario SCENARIO=plan_catalog_matrix
```

If local Firestore/Auth emulators are not reachable, seed/reset still validate fixtures and emit a dry-run manifest under the sentinel-owned local harness state root. They do not fake live emulator writes.

`make desktop-run-local` reads auth passwords from the newest seed manifest of **every** scenario kind. Pricing passwords use `-local-password-pricing`; memory passwords stay `-local-password-030`. Seed both kinds if you need Alice *and* a paid pricing user in the same session.

Pricing launches skip Second Brain onboarding. The Python profile sets `OMI_SKIP_ONBOARDING=1` when the selected user starts with `pricing_` or the named bundle is `omi-pricing` / `omi-pricing-*`. `run.sh` also passes `--skip-onboarding`, and the bundle `.env` writer copies the env flag so `open` (which does not inherit the launcher shell) still skips. Memory / `alice` launches are unchanged.

Local Auth HTTP must use the harness Python API. The profile now writes `OMI_AUTH_API_URL` equal to `OMI_PYTHON_API_URL`. If that key is missing, AuthService falls back to production `https://api.omi.me/`, emulator tokens get HTTP 401, and the app signs the tester out.

Windows `pnpm dev` is outside this Mac launcher path and does not skip onboarding unless you pass `--skip-onboarding` yourself.

## Scenarios

| Scenario | What it seeds |
|---|---|
| `plan_catalog_matrix` | Never-subscribed, Free, storefront Plus/Pro, keep-until-cancel Unlimited/Architect/Operator/Unlimited-v2 |
| `legacy_and_unknown_plan_resilience` | Literal `pro` (Architect alias), Neo inside/outside the grandfather cutoff, unrecognized `future_plan_123` |
| `cancellation_and_downgrade_safety` | Plus/Pro `cancel_at_period_end`, lapsed Plus → Free |

Default selected user for `plan_catalog_matrix` is `pricing_plus`.

## Credentials

| Profile | Email | Password | Expected Settings title |
|---|---|---|---|
| `pricing_never_subscribed` | `pricing_never_subscribed@local.omi.invalid` | `pricing_never_subscribed-local-password-pricing` | Free |
| `pricing_basic` | `pricing_basic@local.omi.invalid` | `pricing_basic-local-password-pricing` | Free |
| `pricing_plus` | `pricing_plus@local.omi.invalid` | `pricing_plus-local-password-pricing` | Plus |
| `pricing_pro_v2` | `pricing_pro_v2@local.omi.invalid` | `pricing_pro_v2-local-password-pricing` | Pro |
| `pricing_operator` | `pricing_operator@local.omi.invalid` | `pricing_operator-local-password-pricing` | Operator |
| `pricing_architect` | `pricing_architect@local.omi.invalid` | `pricing_architect-local-password-pricing` | Architect |
| `pricing_unlimited` | `pricing_unlimited@local.omi.invalid` | `pricing_unlimited-local-password-pricing` | Neo |
| `pricing_unlimited_v2` | `pricing_unlimited_v2@local.omi.invalid` | `pricing_unlimited_v2-local-password-pricing` | Unlimited |
| `pricing_pro` | `pricing_pro@local.omi.invalid` | `pricing_pro-local-password-pricing` | Architect |
| `pricing_plus_lapsed` | `pricing_plus_lapsed@local.omi.invalid` | `pricing_plus_lapsed-local-password-pricing` | Free |

## iOS / Android (Flutter)

The Mac named-bundle launcher does not install the phone app. Flutter does **not** read desktop `OMI_AUTH_API_URL`. A **dev** `local_dev` build talks to the harness through `API_BASE_URL` / `OMI_API_BASE_URL` (Python API, default `http://127.0.0.1:8000/` on simulator) and the Firebase Auth emulator host.

After the same seed:

```bash
PROVIDER_MODE=offline make dev-up
make seed-pricing-scenario SCENARIO=plan_catalog_matrix
cd app && APPLE_DEVELOPMENT_TEAM=<10-char-team> bash setup.sh ios
```

`setup.sh ios` (dev flavor) writes `.dev.env`, injects `OMI_APP_PROFILE=local_dev`, and for a simulator uses loopback. A physical iPhone needs `OMI_DEV_HOST=<Mac LAN>` set **before** both `make dev-up` and `setup.sh ios`, otherwise the phone talks to itself. Personal/community Apple teams must pass `APPLE_DEVELOPMENT_TEAM` (or have a matching provisioning profile); without a TTY the script fails fast instead of hanging. Tap **Sign In (Developer)** on the onboarding sign-in screen, enter the seeded user ID (default `pricing_plus`, or e.g. `pricing_pro_v2`), then tap **Sign In**. This control is only available in `local_dev`; it exchanges a harness custom token with the Firebase Auth emulator and does not invoke Apple/Google OAuth. Your personal Apple developer team signs the app; the selected emulator UID determines the subscription fixture. Your normal Omi account and its production subscription are separate.

The harness backend must include `/v1/auth/local-dev/custom-token`; restart it from the same checkout as the app after adding this feature. The endpoint returns 404 unless `FIREBASE_AUTH_EMULATOR_HOST` is configured. A new UID creates a fresh emulator account; seed first and use an exact fixture UID to see a paid plan. To test another UID, sign out and repeat.

Open **Settings → Plan & Usage**. That card is the iOS equivalent of the desktop current-plan Settings card. Tap **Manage** to open the plans sheet.

Pass/fail (same titles as desktop; recover Plus/Pro from `current_price_id`, not from `plan=`):

| uid | Title | Note | Description |
|---|---|---|---|
| `pricing_plus` / `pricing_pro_v2` | Plus / Pro, **no** Legacy suffix | none | non-empty |
| `pricing_unlimited` | `Neo (Legacy Plan)` | supporter note | non-empty Neo entitlements |
| `pricing_architect` / `pricing_operator` / `pricing_unlimited_v2` | `{Title} (Legacy Plan)` | supporter note | non-empty |
| `pricing_basic` | Free, no Legacy | none | non-empty |

## What this Cloud / Linux lane can prove

Pytest, dry-run manifests, emulator seed apply (when emulators are up), and REST catalog stubs. macOS / Windows / device Settings UI is a later human pass on a named bundle.

Related: [MEMORY_SCENARIOS.md](MEMORY_SCENARIOS.md), [local emulator manual QA](../../backend/docs/runbooks/local-emulator-manual-qa.md).
