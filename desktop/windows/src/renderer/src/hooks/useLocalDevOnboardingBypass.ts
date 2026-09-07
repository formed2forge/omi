import { useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import { localDevOnboardingBypassActive, signInWithLocalDevOnboardingBypass } from '../lib/firebase'

/**
 * Auto-signs-in the deterministic local-dev fixture (contracts/parity/
 * local_dev_onboarding_bypass.json) exactly once per app launch, when the
 * bypass is active and no user is signed in yet. A no-op everywhere else —
 * `localDevOnboardingBypassActive` is `false` outside local_dev, so this
 * effect body never runs in a normal/production build.
 */
export function useLocalDevOnboardingBypass(user: User | null, loading: boolean): void {
  const attempted = useRef(false)

  useEffect(() => {
    if (!localDevOnboardingBypassActive || loading || user || attempted.current) return
    attempted.current = true
    void signInWithLocalDevOnboardingBypass().catch((e) => {
      console.error('[local-dev-onboarding-bypass] auto sign-in failed:', e)
    })
  }, [user, loading])
}
