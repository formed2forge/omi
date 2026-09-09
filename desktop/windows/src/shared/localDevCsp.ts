// Local-dev-only CSP widening for the renderer HTML entries (index.html,
// glow.html, capture.html, insight-toast.html — see electron.vite.config.ts).
//
// WHY THIS EXISTS: the renderer's static Content-Security-Policy connect-src
// only lists production hosts (api.omi.me, the Firebase project's real REST
// endpoints, …). A local_dev build's Firebase Auth emulator / harness API live
// at a developer-specific http://<tailnet-or-LAN-ip>:<port> the allowlist can't
// know ahead of time, so Chromium silently blocks those calls — NOT a network
// failure, but Firebase's SDK reports it as the identical, misleading
// `auth/network-request-failed`. See scripts/dev-harness/PRICING_WINDOWS.md.
//
// Reuses resolveLocalDevConfig (the same fail-closed resolution the runtime
// gate and firebase.ts use) so there is exactly one definition of "what
// local_dev's endpoints are" — a misconfigured local_dev build still leaves the
// CSP untouched here (the runtime UI surfaces the configuration error instead;
// widening the CSP for values that failed validation would be pointless).
import { resolveLocalDevConfig, type LocalDevEnv } from './environmentProfile'

/** The extra connect-src origins a local_dev build needs, or [] outside
 *  local_dev / when local_dev is misconfigured (resolveLocalDevConfig threw). */
export function localDevConnectSrcOrigins(env: LocalDevEnv): string[] {
  let config: ReturnType<typeof resolveLocalDevConfig>
  try {
    config = resolveLocalDevConfig(env)
  } catch {
    return []
  }
  if (!config) return []
  const origins = new Set<string>()
  try {
    origins.add(new URL(config.apiBase).origin)
  } catch {
    /* apiBase is already URL-validated by resolveLocalDevConfig; defensive only */
  }
  origins.add(`http://${config.authEmulatorHost}:${config.authEmulatorPort}`)
  return [...origins]
}

/** Insert `origins` into the first `connect-src 'self'` occurrence. A no-op
 *  (returns `html` unchanged) when `origins` is empty — the production/normal
 *  case, so every renderer HTML entry is byte-identical outside local_dev. */
export function widenConnectSrcForLocalDev(html: string, origins: string[]): string {
  if (origins.length === 0) return html
  return html.replace(/connect-src 'self'/, `connect-src 'self' ${origins.join(' ')}`)
}
