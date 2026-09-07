// Local-dev onboarding bypass — cross-platform contract in
// contracts/parity/local_dev_onboarding_bypass.json (mobile: app/lib/env/
// local_dev_onboarding_bypass.dart, macOS: OmiSupport/DesktopLocalProfile.swift
// + AuthService.swift). One canonical fixture identity, one gate rule, three
// thin platform adapters — see scripts/dev-harness/PRICING_WINDOWS.md for the
// enable/disable/reset recipe.
//
// WHY A SEPARATE FLAG FROM local_dev: the local_dev profile is ALSO used for
// the existing manual "Sign In (Developer)" pricing-QA flow (arbitrary typed
// uid, e.g. pricing_plus), which must keep running onboarding normally so
// testers can verify the plan catalogue post-onboarding. The bypass is a
// SEPARATE, narrower opt-in on top of local_dev — never inferred from build
// type, persisted state, or an existing login alone.

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

/** Whether `uid` is the bypass's own fixture identity — used to require that
 *  onboarding-skip composes with "genuinely signed in as the fixture", not
 *  "any local_dev login" (e.g. a manually-typed pricing_plus session must
 *  still run onboarding even while the bypass flag happens to be set). */
export function isLocalDevOnboardingBypassIdentity(uid: string | null | undefined): boolean {
  return uid === LOCAL_DEV_FIXTURE_UID
}
