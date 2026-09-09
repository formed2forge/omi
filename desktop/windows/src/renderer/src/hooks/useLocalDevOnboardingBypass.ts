import { useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import { localDevOnboardingBypassActive, signInWithLocalDevOnboardingBypass } from '../lib/firebase'
import { isLocalDevOnboardingBypassSuppressed } from '../lib/localDevOnboardingBypassState'

/**
 * Auto-signs-in the deterministic local-dev fixture (contracts/parity/
 * local_dev_onboarding_bypass.json) on a genuinely fresh profile — no user
 * signed in yet, and no EXPLICIT sign-out has ever happened here — when the
 * bypass is active. A no-op everywhere else — `localDevOnboardingBypassActive`
 * is `false` outside local_dev, so this effect body never runs in a normal/
 * production build.
 *
 * The persisted `isLocalDevOnboardingBypassSuppressed()` check (see
 * lib/localDevOnboardingBypassState.ts) is the real gate: firebase.ts's
 * `signOutUser` sets it on every explicit sign-out — the fixture's own or a
 * manually-typed pricing uid's — so once a tester has signed out even once,
 * this effect never fires again in that profile until the tester explicitly
 * resets it (LocalDevSignIn's "Reset to auto sign-in" control). Without a
 * PERSISTED gate, a plain in-memory latch can't tell "explicit sign-out,
 * stay signed out" apart from "fresh emulator profile, please bootstrap" —
 * both look identical to Firebase after a sign-out clears its own persisted
 * session, and both look identical again after an app restart.
 *
 * `attempted` is a secondary, in-memory guard against retry-looping a single
 * pending/failed attempt within one running app instance — it resets when a
 * user becomes signed in so a LATER fresh-profile scenario (theoretically,
 * e.g. after a manual localStorage wipe) can still auto-bootstrap.
 */
export function useLocalDevOnboardingBypass(user: User | null, loading: boolean): void {
  const attempted = useRef(false)

  useEffect(() => {
    if (user) {
      attempted.current = false
      return
    }
    if (!localDevOnboardingBypassActive || loading || attempted.current) return
    if (isLocalDevOnboardingBypassSuppressed()) return
    attempted.current = true
    void signInWithLocalDevOnboardingBypass().catch((e) => {
      console.error('[local-dev-onboarding-bypass] auto sign-in failed:', e)
    })
  }, [user, loading])
}
