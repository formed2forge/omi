// Local-dev onboarding bypass — cross-platform contract in
// contracts/parity/local_dev_onboarding_bypass.json (mobile: app/lib/env/
// local_dev_onboarding_bypass.dart, macOS: OmiSupport/DesktopLocalProfile.swift
// + AuthService.swift). One canonical fixture identity, one gate rule, three
// thin platform adapters — see scripts/dev-harness/PRICING_WINDOWS.md for the
// enable/disable/reset recipe.
//
// WHY A SEPARATE FLAG FROM local_dev: the local_dev profile is ALSO used for
// the existing manual "Sign In (Developer)" pricing-QA flow (arbitrary typed
// uid, e.g. pricing_plus). With the flag OFF, that flow still runs onboarding
// normally, so testers can verify the plan catalogue post-onboarding. With the
// flag ON, both the fixture identity AND any seeded pricing_* uid skip
// onboarding (isLocalDevOnboardingBypassIdentity) — a deliberate, user-decided
// widening (2026-09-07) on top of local_dev's own profile gate, never inferred
// from build type, persisted state, or an existing login alone.

/** The single non-privileged fixture identity every platform signs in as when
 *  the bypass is active. Carries no Stripe/subscription document, so it
 *  resolves to Free/no-entitlement through the same path as any brand-new
 *  never-subscribed account. Distinct from the pricing_* fixtures. */
export const LOCAL_DEV_FIXTURE_UID = 'local_dev_fixture'
export const LOCAL_DEV_FIXTURE_GIVEN_NAME = 'Local'
export const LOCAL_DEV_FIXTURE_FAMILY_NAME = 'Dev'
export const LOCAL_DEV_FIXTURE_DISPLAY_NAME = 'Local Dev'

export type LocalDevOnboardingBypassEnv = {
  /** Whether the local_dev profile is active AND correctly configured (i.e.
   *  resolveLocalDevConfig didn't throw) — the bypass never activates on top
   *  of a misconfigured profile. */
  localDevProfileActive: boolean
  bypassFlagValue: string | undefined
}

/** Deterministic gate: both the profile prerequisite AND an exact `"1"` flag
 *  value are required. Any other flag value (empty, "0", "yes", whitespace-
 *  padded) is treated as off — no fuzzy matching, so the gate can't be
 *  half-tripped by a stray env value. See contracts/parity/
 *  local_dev_onboarding_bypass.json's gate_cases for the full truth table. */
export function resolveLocalDevOnboardingBypassActive(env: LocalDevOnboardingBypassEnv): boolean {
  if (!env.localDevProfileActive) return false
  return env.bypassFlagValue === '1'
}

/** Seeded pricing-QA fixture uids (scripts/dev-harness/PRICING_SCENARIOS.md,
 *  e.g. pricing_plus, pricing_unlimited_v2) all carry this prefix. The harness
 *  seeds them dynamically per scenario (dev_harness/pricing_scenarios.py), so
 *  this is a prefix rule, not an enumerated list — a fixed list would drift
 *  the moment a new scenario adds a fixture. */
export const PRICING_FIXTURE_UID_PREFIX = 'pricing_'

/** Whether `uid` satisfies onboarding under the bypass — contracts/parity/
 *  local_dev_onboarding_bypass.json's identity_semantics: the fixture itself,
 *  OR any seeded pricing-QA fixture uid. Composing with "any local_dev login"
 *  would be wrong (a real Google/Apple-signed-in account must still onboard
 *  even with the flag on) — this only matches the fixture and the pricing_*
 *  prefix, both deliberately onboarding-bypass-eligible identities. */
export function isLocalDevOnboardingBypassIdentity(uid: string | null | undefined): boolean {
  if (!uid) return false
  return uid === LOCAL_DEV_FIXTURE_UID || uid.startsWith(PRICING_FIXTURE_UID_PREFIX)
}
