// Local-dev-only CORS relaxation target for main/index.ts's existing
// onBeforeSendHeaders/onHeadersReceived CORS-injection (see that file for the
// full mechanism — webSecurity stays ON, so a fixed allowlist of upstream URLs
// gets its Origin header stripped and permissive access-control-allow-* headers
// injected on the response).
//
// WHY THIS EXISTS: the harness backend's CORSMiddleware (backend/main.py) is
// fail-closed — CORS_ALLOWED_ORIGINS defaults to empty, and the dev harness
// never sets it (scripts/dev-harness/dev_harness/config.py's
// _harness_service_extra has no CORS_ALLOWED_ORIGINS entry). iOS/Android/macOS
// clients never notice: native URLSession/dart:io HTTP isn't subject to CORS at
// all. The Windows app's REST calls (lib/apiClient.ts) run inside a Chromium
// renderer with webSecurity ON, so they ARE subject to it — every omiApi call
// to the harness gets a browser-level CORS block, surfacing as a bare axios
// "Network Error" with no response body (see PlanUsageTab.tsx's apiError,
// which can only show a backend `detail` when a response body existed at all).
//
// Reuses resolveLocalDevConfig (the same fail-closed resolver localDevCsp.ts /
// firebase.ts use) so there is one definition of "what local_dev's API is" —
// a misconfigured local_dev build adds no exception here either.
import { resolveLocalDevConfig, type LocalDevEnv } from './environmentProfile'

/** Electron `webRequest` URL-filter patterns (e.g. `http://<host>:<port>/*`)
 *  to add to main/index.ts's CORS-relaxation allowlist. `[]` outside local_dev
 *  or when it's misconfigured. */
export function localDevCorsUrlPatterns(env: LocalDevEnv): string[] {
  let config: ReturnType<typeof resolveLocalDevConfig>
  try {
    config = resolveLocalDevConfig(env)
  } catch {
    return []
  }
  if (!config) return []
  try {
    return [`${new URL(config.apiBase).origin}/*`]
  } catch {
    return []
  }
}
