# macOS pricing QA recipe

This recipe runs the Swift macOS app as an isolated named bundle against the
local pricing harness. It does not use production Firebase data.

## 1. Start and seed the harness

From the repository root:

```bash
cd /Volumes/LEXAR/tempdev/omi
PROVIDER_MODE=offline make dev-up
make dev-status
make list-pricing-scenarios
make seed-pricing-scenario SCENARIO=plan_catalog_matrix
```

Keep the harness terminal running. The seed creates synthetic users such as
`pricing_plus` and `pricing_pro_v2` with passwords in the seed manifest.

## 2. Launch an isolated app bundle

Use a pricing-specific bundle name so its Keychain, preferences, and app data
cannot collide with your normal Omi installation:

```bash
cd /Volumes/LEXAR/tempdev/omi
make desktop-run-local DESKTOP_APP_NAME=omi-pricing DESKTOP_USER=pricing_plus
```

The launcher supplies the local API and Auth emulator endpoints, resets only
the named bundle's local auth state, and skips Second Brain onboarding for
pricing users. It signs in the selected synthetic UID automatically.

## 3. Inspect the catalogue

Open **Settings → Plan & Usage** and then the plans sheet from **Manage**.
Repeat the launch with another seeded user by stopping the app and running, for
example:

```bash
make desktop-run-local DESKTOP_APP_NAME=omi-pricing DESKTOP_USER=pricing_pro_v2
make desktop-run-local DESKTOP_APP_NAME=omi-pricing DESKTOP_USER=pricing_unlimited
```

Expected titles are documented in [PRICING_SCENARIOS.md](PRICING_SCENARIOS.md).
Reseed for the legacy/unknown and cancellation scenarios before checking those
cases:

```bash
make seed-pricing-scenario SCENARIO=legacy_and_unknown_plan_resilience
make seed-pricing-scenario SCENARIO=cancellation_and_downgrade_safety
```

## 4. Clean up

```bash
make reset-pricing-scenario SCENARIO=plan_catalog_matrix
make dev-down
```

