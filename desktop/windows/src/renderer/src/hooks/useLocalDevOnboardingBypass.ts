import { useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import { localDevOnboardingBypassActive, signInWithLocalDevOnboardingBypass } from '../lib/firebase'

/**
 * Auto-signs-in the deterministic local-dev fixture (contracts/parity/
 * local_dev_onboarding_bypass.json) once per sign-out, when the bypass is
 * active and no user is signed in yet. A no-op everywhere else —
 * `localDevOnboardingBypassActive` is `false` outside local_dev, so this
 * effect body never runs in a normal/production build.
 *
 * `attempted` only suppresses retries while STILL signed out (so a failed
 * attempt, or a re-render with the same signed-out props, doesn't loop) — it
 * resets the moment a user signs in. Without that reset, a real sign-out
 * (user: fixture -> null) would find the latch already tripped from the
 * initial auto sign-in and never re-attempt, stranding the tester signed out.
 */
export function useLocalDevOnboardingBypass(user: User | null, loading: boolean): void {
  const attempted = useRef(false)

  useEffect(() => {
    if (user) {
      attempted.current = false
      return
    }
    if (!localDevOnboardingBypassActive || loading || attempted.current) return
    attempted.current = true
    void signInWithLocalDevOnboardingBypass().catch((e) => {
      console.error('[local-dev-onboarding-bypass] auto sign-in failed:', e)
    })
  }, [user, loading])
}
