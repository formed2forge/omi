// Persisted marker distinguishing "this local-dev/emulator profile has never
// had an explicit sign-out" (safe to auto-bootstrap the bypass fixture) from
// "a user explicitly signed out at least once" (stay signed out — never
// silently resurrect a session). This is a SEPARATE, Windows-local gate on top
// of the cross-platform bypass contract in shared/localDevOnboardingBypass.ts
// (contracts/parity/local_dev_onboarding_bypass.json): that contract decides
// whether the bypass feature is active at all; this decides whether it's
// allowed to fire again in THIS profile right now.
//
// Machine/profile-scoped, like authTeardown's LAST_UID_KEY — deliberately NOT
// cleared by the user-scoped teardown a sign-out runs. A sign-out must stay
// "stuck" across an app restart (no persisted auth session survives a real
// sign-out either), not just for the rest of this render tree.
const KEY = 'omi.localDevOnboardingBypass.suppressed'

export function isLocalDevOnboardingBypassSuppressed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Called on every explicit sign-out (see firebase.ts's signOutUser) so the
 *  bypass never auto-signs the fixture back in after a user chose to sign
 *  out — regardless of whether they were signed in as the fixture itself or a
 *  manually-typed pricing uid. */
export function suppressLocalDevOnboardingBypass(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* privacy mode / quota — worst case the bypass can fire again; this isn't
       the nuclear teardown path, so failing open here is acceptable */
  }
}

/** Explicit, developer-initiated opt back in to automatic fixture sign-in
 *  (see firebase.ts's resetLocalDevOnboardingBypassFixture) — the only way
 *  suppression is ever lifted. Never called implicitly by sign-in/sign-out. */
export function resetLocalDevOnboardingBypassSuppression(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* privacy mode */
  }
}
