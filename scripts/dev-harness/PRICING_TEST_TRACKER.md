# Pricing catalogue test tracker

Use one copy of this file per QA pass. The tracker covers Omi's supported app
surfaces: Flutter iOS and Android, the Swift macOS app, and the Electron
Windows app. Use `PASS`, `FAIL`, `BLOCKED`, or `N/A` in each platform cell and
put the evidence or defect reference in **Notes**.

## Test run

| Field | Value |
|---|---|
| Tester |  |
| Date / time |  |
| Repository commit |  |
| Harness checkout |  |
| Mac host address |  |
| iOS device / version |  |
| Android device / version |  |
| macOS version |  |
| Windows version |  |
| Provider mode | `offline` |

## Platform readiness

| Check | Result | Notes |
|---|---|---|
| `make dev-up` starts successfully |  |  |
| Firestore/Auth emulators are reachable |  |  |
| `make seed-pricing-scenario` completes |  |  |
| iOS dev build installs and reaches onboarding |  |  |
| Android dev build installs and reaches onboarding |  |  |
| macOS named bundle launches |  |  |
| Windows app launches |  |  |

## Scenario results

`plan_catalog_matrix` is the minimum complete pass. The other two scenarios
cover legacy aliases, unknown plans, cancellation, and downgrade behavior.

| Scenario | UID / case | Expected result | iOS | Android | macOS | Windows | Notes |
|---|---|---|---|---|---|---|---|
| `plan_catalog_matrix` | `pricing_never_subscribed` | Free |  |  |  |  |  |
| `plan_catalog_matrix` | `pricing_basic` | Free |  |  |  |  |  |
| `plan_catalog_matrix` | `pricing_plus` | Plus |  |  |  |  |  |
| `plan_catalog_matrix` | `pricing_pro_v2` | Pro |  |  |  |  |  |
| `plan_catalog_matrix` | `pricing_unlimited` | Neo (Legacy Plan) |  |  |  |  |  |
| `plan_catalog_matrix` | `pricing_architect` | Architect (Legacy Plan) |  |  |  |  |  |
| `plan_catalog_matrix` | `pricing_operator` | Operator (Legacy Plan) |  |  |  |  |  |
| `plan_catalog_matrix` | `pricing_unlimited_v2` | Unlimited (Legacy Plan) |  |  |  |  |  |
| `legacy_and_unknown_plan_resilience` | literal `pro` | Architect alias, legacy labeling |  |  |  |  |  |
| `legacy_and_unknown_plan_resilience` | Neo inside cutoff | Neo legacy labeling |  |  |  |  |  |
| `legacy_and_unknown_plan_resilience` | Neo outside cutoff | Current Neo behavior |  |  |  |  |  |
| `legacy_and_unknown_plan_resilience` | `future_plan_123` | Safe unknown-plan handling |  |  |  |  |  |
| `cancellation_and_downgrade_safety` | Plus, `cancel_at_period_end` | Plus with cancellation state |  |  |  |  |  |
| `cancellation_and_downgrade_safety` | Pro, `cancel_at_period_end` | Pro with cancellation state |  |  |  |  |  |
| `cancellation_and_downgrade_safety` | `pricing_plus_lapsed` | Free after lapse |  |  |  |  |  |

For every result, check **Settings → Plan & Usage**, open **Manage**, and
confirm the title, legacy label, supporter note, entitlements/description,
price presentation, and cancellation copy where applicable. Judge Plus, Pro,
and Unlimited-v2 by the catalog identity resolved from `current_price_id`, not
the compatibility `plan` wire value.

## Platform notes

- **iOS:** follow [PRICING_IOS.md](PRICING_IOS.md). Use **Sign In (Developer)**
  with the seeded UID. Set `OMI_DEV_HOST` before both `make dev-up` and
  `setup.sh ios` for a physical phone.
- **Android:** use the Flutter `dev` build and the same local harness. For a
  physical device, set `OMI_DEV_HOST` to the Mac's reachable LAN address; an
  Android emulator normally uses `10.0.2.2`. Use the local developer sign-in
  path when present in the build.
- **macOS:** follow [PRICING_MACOS.md](PRICING_MACOS.md) and use a named
  `omi-pricing` bundle for each selected UID.
- **Windows:** follow [PRICING_WINDOWS.md](PRICING_WINDOWS.md). Set
  `VITE_OMI_APP_PROFILE=local_dev` (plus the local API base and Firebase Auth
  emulator host/port) and use the **Sign In (Developer)** control on Login with
  the seeded UID — same fixtures, same expected titles as iOS/macOS.
  `OMI_E2E_FAKE_AUTH` remains a hermetic UI seam and is not a live catalogue
  result.

## Tester notes

Record environment details, screenshots, API responses, unexpected wire-plan
values, and defect links here.

```text
Tester notes:



```

## Cleanup confirmation

| Action | Done | Notes |
|---|---|---|
| Reset the seeded pricing scenario |  |  |
| Stopped the local harness with `make dev-down` |  |  |
| Removed test app data / named bundles where appropriate |  |  |

