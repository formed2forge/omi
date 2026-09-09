// Explicit local-dev gate — Windows parity with the Flutter app's
// AppEnvironmentProfile / app/lib/services/auth/local_dev_auth.dart. Community/
// dev builds cannot complete a real OAuth flow against Google/Apple, so a local
// harness needs a separate sign-in path that mints a Firebase custom token
// against a local Auth emulator (backend/routers/auth.py
// POST /v1/auth/local-dev/custom-token).
//
// This module is pure (no Electron/Firebase imports) so it runs identically, and
// is unit-testable, in main, preload, and renderer: electron-vite freezes every
// VITE_-prefixed var into all three bundles at BUILD time from the same .env
// (see main/auth/firebaseIdToken.ts's comment on VITE_FIREBASE_PROJECT_ID for the
// precedent), so there is exactly one source of truth for the profile gate.
//
// Fail-closed by design: selecting local_dev with a missing or production-shaped
// value THROWS rather than silently falling back to production config. Callers
// that only care about "is local_dev active" (not full config resolution) use
// resolveAppProfile directly; callers that need the harness endpoints use
// resolveLocalDevConfig and must handle LocalDevConfigError explicitly (surfacing
// it as a visible configuration error, never swallowing it into a default).

export type AppEnvironmentProfile = 'production' | 'local_dev'

/** The production Omi API — local_dev must never resolve to this, even if a
 *  developer's .env accidentally left VITE_OMI_API_BASE at its default. */
export const PRODUCTION_API_BASE = 'https://api.omi.me'

export function resolveAppProfile(raw: string | undefined): AppEnvironmentProfile {
  return raw === 'local_dev' ? 'local_dev' : 'production'
}

export class LocalDevConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalDevConfigError'
  }
}

export type LocalDevConfig = {
  /** Local harness API base (e.g. http://<mac-host>:8000), no trailing slash. */
  apiBase: string
  authEmulatorHost: string
  authEmulatorPort: number
}

export type LocalDevEnv = {
  profile?: string
  apiBase?: string
  authEmulatorHost?: string
  authEmulatorPort?: string
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Resolves the local-dev harness config, or null when the profile isn't
 * local_dev at all (the normal/production case — every other caller no-ops).
 *
 * Inside local_dev, this NEVER returns a partial or best-guessed config: any
 * missing or production-shaped value throws LocalDevConfigError with an
 * actionable message instead of silently pointing at production.
 */
export function resolveLocalDevConfig(env: LocalDevEnv): LocalDevConfig | null {
  if (resolveAppProfile(env.profile) !== 'local_dev') return null

  const apiBase = stripTrailingSlashes((env.apiBase ?? '').trim())
  if (!apiBase) {
    throw new LocalDevConfigError(
      'OMI_APP_PROFILE=local_dev requires VITE_OMI_API_BASE to point at the local harness (e.g. http://<mac-host>:8000).'
    )
  }
  if (apiBase === stripTrailingSlashes(PRODUCTION_API_BASE)) {
    throw new LocalDevConfigError(
      `OMI_APP_PROFILE=local_dev must not point VITE_OMI_API_BASE at production (${PRODUCTION_API_BASE}).`
    )
  }
  let parsed: URL
  try {
    parsed = new URL(apiBase)
  } catch {
    throw new LocalDevConfigError(`VITE_OMI_API_BASE is not a valid URL: "${apiBase}".`)
  }
  if (parsed.protocol === 'https:') {
    throw new LocalDevConfigError(
      'OMI_APP_PROFILE=local_dev requires an http:// VITE_OMI_API_BASE (the local harness), not https://.'
    )
  }

  const authEmulatorHost = (env.authEmulatorHost ?? '').trim()
  if (!authEmulatorHost) {
    throw new LocalDevConfigError(
      'OMI_APP_PROFILE=local_dev requires VITE_FIREBASE_AUTH_EMULATOR_HOST (the Mac harness LAN/Tailscale address, e.g. 127.0.0.1 or a tailnet IP).'
    )
  }

  const portRaw = (env.authEmulatorPort ?? '').trim()
  const authEmulatorPort = Number(portRaw)
  if (
    !portRaw ||
    !Number.isInteger(authEmulatorPort) ||
    authEmulatorPort <= 0 ||
    authEmulatorPort > 65535
  ) {
    throw new LocalDevConfigError(
      'OMI_APP_PROFILE=local_dev requires VITE_FIREBASE_AUTH_EMULATOR_PORT to be a valid port number (e.g. 9099).'
    )
  }

  return { apiBase, authEmulatorHost, authEmulatorPort }
}
