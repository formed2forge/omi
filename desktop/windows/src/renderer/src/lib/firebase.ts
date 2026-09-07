import { initializeApp } from 'firebase/app'
import {
  initializeAuth,
  getAuth,
  connectAuthEmulator,
  signInWithCustomToken,
  signOut,
  updateProfile,
  onAuthStateChanged,
  browserLocalPersistence,
  type User
} from 'firebase/auth'
import { teardownUserData } from './authTeardown'
import { encryptedAuthPersistence, scrubLegacyPlaintextAuth } from './encryptedAuthPersistence'
import { isByokActive } from '../../../shared/byok'
import {
  LocalDevConfigError,
  resolveAppProfile,
  resolveLocalDevConfig
} from '../../../shared/environmentProfile'
import {
  LOCAL_DEV_FIXTURE_DISPLAY_NAME,
  LOCAL_DEV_FIXTURE_UID,
  resolveLocalDevOnboardingBypassActive
} from '../../../shared/localDevOnboardingBypass'
import type { SignInProvider } from '../../../shared/types'

/** True only when this bundle was built with OMI_APP_PROFILE=local_dev (frozen at
 *  build time — see shared/environmentProfile.ts). Gates the "Sign In
 *  (Developer)" control; a normal/production build never sets this. */
export const isLocalDevProfile =
  resolveAppProfile(import.meta.env.VITE_OMI_APP_PROFILE) === 'local_dev'

// Resolve the local-dev harness config once at module load. Outside local_dev
// this is always `{config: null, error: null}` — a no-op. Inside local_dev, a
// missing/production-shaped value is captured as a VISIBLE configuration error
// (surfaced by LocalDevSignIn) instead of throwing out of module init and
// blanking the whole renderer, and instead of silently connecting to production.
const localDevResolution = ((): {
  config: ReturnType<typeof resolveLocalDevConfig>
  error: string | null
} => {
  try {
    return {
      config: resolveLocalDevConfig({
        profile: import.meta.env.VITE_OMI_APP_PROFILE,
        apiBase: import.meta.env.VITE_OMI_API_BASE,
        authEmulatorHost: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST,
        authEmulatorPort: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT
      }),
      error: null
    }
  } catch (e) {
    return { config: null, error: e instanceof LocalDevConfigError ? e.message : String(e) }
  }
})()

/** Non-null only when local_dev is misconfigured — LocalDevSignIn renders this
 *  instead of a working control, per the fail-closed contract in
 *  shared/environmentProfile.ts. */
export const localDevConfigError = localDevResolution.error

/** Local-dev onboarding bypass gate — contracts/parity/
 *  local_dev_onboarding_bypass.json. Requires local_dev to ALSO be validly
 *  configured (never activates on top of a misconfigured profile) plus the
 *  separate VITE_OMI_LOCAL_DEV_ONBOARDING_BYPASS='1' flag; local_dev alone
 *  (the manual "Sign In (Developer)" pricing-QA flow) never trips this. */
export const localDevOnboardingBypassActive = resolveLocalDevOnboardingBypassActive({
  localDevProfileActive: isLocalDevProfile && !localDevConfigError,
  bypassFlagValue: import.meta.env.VITE_OMI_LOCAL_DEV_ONBOARDING_BYPASS
})

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string
})

// Initialize auth with persistence set SYNCHRONOUSLY at init so the saved session
// is rehydrated deterministically. The previous getAuth(app) + async
// setPersistence() raced: onAuthStateChanged could emit null before the persisted
// user loaded, which made the (reloaded) overlay window falsely show signed-out.
// Falls back to getAuth in non-browser environments (node/Vitest), where
// initializeAuth's browser persistence can't initialize — keeps importing
// modules that touch firebase unit-testable without changing runtime behavior.
// Persistence hierarchy: the encrypted-at-rest store (safeStorage/DPAPI via the
// main process) is primary; browserLocalPersistence stays as a permanent fallback
// so a machine without OS encryption degrades to plaintext rather than locking the
// user out. Firebase auto-migrates any existing plaintext session INTO the
// encrypted store on init and deletes the plaintext copy (see
// encryptedAuthPersistence — _shouldAllowMigration).
export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: [encryptedAuthPersistence, browserLocalPersistence]
    })
  } catch {
    return getAuth(app)
  }
})()

// Connect to the local Auth emulator BEFORE any other Auth call (Firebase's own
// requirement for connectAuthEmulator) — this must stay the very next statement
// after `auth` is created, ahead of the onAuthStateChanged subscription below.
// Only reachable with a fully-resolved local-dev config (never a partial one —
// see resolveLocalDevConfig's fail-closed contract), so a misconfigured local_dev
// build never silently talks to production Firebase either.
if (localDevResolution.config) {
  const { authEmulatorHost, authEmulatorPort } = localDevResolution.config
  connectAuthEmulator(auth, `http://${authEmulatorHost}:${authEmulatorPort}`, {
    disableWarnings: true
  })
}

// Belt-and-suspenders: once auth init has settled, sweep any lingering plaintext
// `firebase:authUser:*` key that Firebase's own migration didn't clear (e.g. a
// window that loaded mid-migration). Guarded so it only removes a key the
// encrypted store already holds. Fire-and-forget; never blocks boot.
onAuthStateChanged(auth, (user) => {
  void scrubLegacyPlaintextAuth()
  if (!user || typeof window === 'undefined') return
  void user
    .getIdToken()
    .then(async (token) => {
      const keys = await window.omi?.byokGetAll?.()
      if (keys && isByokActive(keys)) {
        await window.omi?.byokEnroll?.(token)
      }
    })
    .catch(() => undefined)
})

/**
 * Google or Apple sign-in via the backend-mediated OAuth flow in the SYSTEM browser.
 * The main process runs the whole PKCE + loopback dance (Google blocks OAuth
 * inside embedded webviews, so the old signInWithPopup path is gone for good)
 * and hands back a Firebase CUSTOM token; from signInWithCustomToken on,
 * persistence and onAuthStateChanged behave exactly as before.
 */
export async function signInWithProvider(provider: SignInProvider): Promise<User> {
  const result = await window.omi.signInWithProvider(provider)
  if (!result.ok) throw new Error(result.error)
  const cred = await signInWithCustomToken(auth, result.customToken)
  // Custom-token sessions can start with an empty displayName (fresh Firebase
  // user record); best-effort seed it from the provider profile claims so the
  // sidebar/home greeting show a name immediately.
  const name = [result.givenName, result.familyName].filter(Boolean).join(' ')
  if (name && !cred.user.displayName) {
    try {
      await updateProfile(cred.user, { displayName: name })
    } catch {
      /* cosmetic only */
    }
  }
  return cred.user
}

/**
 * Sign in against the local harness with no OAuth provider involved — the
 * Windows counterpart of the Flutter app's AuthService.signInWithLocalDevToken.
 * Main exchanges `uid` for a Firebase custom token minted against the local Auth
 * emulator (backend POST /v1/auth/local-dev/custom-token); this finishes with the
 * same signInWithCustomToken the OAuth path uses, so persistence and
 * onAuthStateChanged behave identically either way.
 *
 * The real gate is main-side and structural (see ipc/auth.ts / the backend route
 * itself, which 404s unless bound to an Auth emulator) — the checks here only
 * stop the call from being attempted at all outside local_dev.
 */
export async function signInWithLocalDevToken(uid: string): Promise<User> {
  if (!isLocalDevProfile) {
    throw new Error('Local development sign-in is only available in the local_dev profile.')
  }
  if (localDevConfigError) throw new Error(localDevConfigError)
  const result = await window.omi.signInWithLocalDevToken(uid)
  if (!result.ok) throw new Error(result.error)
  return (await signInWithCustomToken(auth, result.customToken)).user
}

/**
 * Local-dev onboarding bypass entry point (contracts/parity/
 * local_dev_onboarding_bypass.json) — auto-signs-in the deterministic
 * `local_dev_fixture` identity, the same way `signInWithLocalDevToken` signs in
 * any manually-typed uid, then forces the display name to "Local Dev" so a
 * fresh emulator user (which the backend creates with no displayName at all)
 * renders a stable, obviously-synthetic identity everywhere the app already
 * reads `user.displayName`. Never called for any other uid — the generic
 * `signInWithLocalDevToken` above must not acquire this side effect, or a
 * tester's manually-typed pricing_plus/pro_v2/etc. sign-in would get silently
 * renamed too.
 */
export async function signInWithLocalDevOnboardingBypass(): Promise<User> {
  const user = await signInWithLocalDevToken(LOCAL_DEV_FIXTURE_UID)
  if (!user.displayName) {
    try {
      await updateProfile(user, { displayName: LOCAL_DEV_FIXTURE_DISPLAY_NAME })
    } catch {
      /* cosmetic only — the uid match is what onboarding-gating relies on */
    }
  }
  return user
}

export async function signOutUser(): Promise<void> {
  // User-initiated sign-out is the NUCLEAR path (vs the LIGHT session
  // invalidation on a 401 — see authSession.forceReauth): tear down all
  // user-scoped local data FIRST so a second account on this machine can't see
  // it, THEN drop the Firebase session.
  //
  // Grab the token BEFORE signing out so we can deactivate BYOK server-side while
  // the session is still valid: teardownUserData wipes the local keys, and this
  // DELETE drops the matching backend enrollment so this account isn't left
  // "enrolled" with no keys (which would 403 its own next requests). Best-effort.
  const token = await auth.currentUser?.getIdToken().catch(() => undefined)
  await teardownUserData()
  if (token) {
    try {
      await window.omi.byokDeactivate(token)
    } catch {
      /* best-effort; the backend heartbeat TTL also lapses the activation */
    }
  }
  await signOut(auth)
}

export { onAuthStateChanged }
