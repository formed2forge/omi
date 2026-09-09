import { useId, useState } from 'react'
import {
  isLocalDevProfile,
  localDevConfigError,
  localDevOnboardingBypassActive,
  resetLocalDevOnboardingBypassFixture,
  signInWithLocalDevToken
} from '../../lib/firebase'

// Seeded pricing fixtures documented in scripts/dev-harness/PRICING_SCENARIOS.md
// (plan_catalog_matrix + cancellation_and_downgrade_safety). Offered as
// selectable presets; any uid matching UID_PATTERN below is still accepted so a
// tester can sign in to a fresh ad-hoc emulator identity too.
const SEEDED_UIDS = [
  'pricing_basic',
  'pricing_plus',
  'pricing_pro_v2',
  'pricing_unlimited',
  'pricing_architect',
  'pricing_operator',
  'pricing_unlimited_v2',
  'pricing_plus_lapsed'
]

const DEFAULT_UID = 'pricing_plus'

// Mirrors the backend's uid charset (backend/routers/auth.py) and
// main/auth/localDevAuth.ts's sanitizeLocalDevUid — kept in sync manually since
// this is a display-only pre-check (main re-validates authoritatively).
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/**
 * "Sign In (Developer)" control — Windows counterpart of the Flutter app's
 * LocalDevSignIn (app/lib/pages/onboarding/local_dev_sign_in.dart). Visible only
 * when this build was compiled with OMI_APP_PROFILE=local_dev; a normal/
 * production build never sets that, so this returns null before touching
 * anything else local-dev-specific.
 */
export function LocalDevSignIn(): React.JSX.Element | null {
  const inputId = useId()
  const [uid, setUid] = useState(DEFAULT_UID)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  if (!isLocalDevProfile) return null

  const disabled = loading || resetting || !!localDevConfigError

  const onSubmit = async (): Promise<void> => {
    const trimmed = uid.trim()
    if (!UID_PATTERN.test(trimmed)) {
      setError('UID must be 1-128 characters: letters, numbers, "_" or "-".')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await signInWithLocalDevToken(trimmed)
      // Signed in — onAuthStateChanged takes over; nothing else to do here.
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Undoes the sign-out suppression a prior explicit sign-out set (see
  // firebase.ts's signOutUser / useLocalDevOnboardingBypass.ts) and signs in
  // as the fixture immediately, rather than just arming a flag for next
  // launch — so this control's effect is visible right away. Only rendered
  // when the bypass is actually configured to auto-fire; with the flag off
  // there is no "automatic" sign-in to re-enable.
  const onResetToAutoSignIn = async (): Promise<void> => {
    setError(null)
    setResetting(true)
    try {
      await resetLocalDevOnboardingBypassFixture()
      // Signed in — onAuthStateChanged takes over; nothing else to do here.
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div data-testid="local-dev-sign-in" className="mt-8 w-full max-w-[420px]">
      <div className="mb-3 flex items-center gap-3 text-xs uppercase tracking-wide text-white/40">
        <span className="h-px flex-1 bg-white/10" />
        Local development
        <span className="h-px flex-1 bg-white/10" />
      </div>
      {localDevConfigError && (
        <p className="mb-3 text-center text-sm text-red-400/90">{localDevConfigError}</p>
      )}
      <label htmlFor={inputId} className="sr-only">
        Emulator UID
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          list={`${inputId}-seeded-uids`}
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          disabled={disabled}
          maxLength={128}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={DEFAULT_UID}
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none disabled:opacity-50"
        />
        <datalist id={`${inputId}-seeded-uids`}>
          {SEEDED_UIDS.map((seededUid) => (
            <option key={seededUid} value={seededUid} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={disabled}
          className="whitespace-nowrap rounded-xl border border-white/20 px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign In (Developer)'}
        </button>
      </div>
      {error && <p className="mt-2 text-center text-sm text-red-400/90">{error}</p>}
      {localDevOnboardingBypassActive && (
        <button
          type="button"
          onClick={() => void onResetToAutoSignIn()}
          disabled={disabled}
          className="mt-3 w-full whitespace-nowrap rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-white/50 transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {resetting ? 'Resetting…' : 'Reset to auto sign-in'}
        </button>
      )}
    </div>
  )
}
