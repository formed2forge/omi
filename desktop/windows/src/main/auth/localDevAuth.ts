// Local-dev emulator sign-in — Windows parity with the Flutter app's
// app/lib/services/auth/local_dev_auth.dart. Community/dev builds can't complete
// a real Google/Apple OAuth flow, so this exchanges a seeded emulator uid for a
// Firebase custom token minted by the local harness backend, reusing the same
// signInWithCustomToken finish as the OAuth path (see auth/omiAuth.ts).
//
// Electron-free by design (same rationale as omiAuth.ts): unit-testable under
// node Vitest. Electron IPC wiring lives in main/ipc/auth.ts, which also owns the
// profile gate (this module trusts the uid it's given has already been
// sanitized by the caller via sanitizeLocalDevUid).
//
// Backend contract (backend/routers/auth.py POST /v1/auth/local-dev/custom-token,
// gated server-side on FIREBASE_AUTH_EMULATOR_HOST — 404s when that's unset, so a
// production deployment never advertises this route at all):
//   POST {api}/v1/auth/local-dev/custom-token  (application/x-www-form-urlencoded)
//     uid=<seeded fixture id, e.g. pricing_plus>
//     → 200 { custom_token, uid, provider } | 400 (bad uid) | 404 (emulator not
//       configured) | 500 (emulator user creation failed)

/** Firebase uid charset the backend accepts (1-128 chars); the seeded pricing
 *  fixtures are all `pricing_*` snake_case identifiers, but any uid matching this
 *  is allowed so a tester can create a fresh ad-hoc emulator identity too. */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** Trim + validate a candidate emulator uid. Returns null (not a thrown error) so
 *  callers can surface a plain validation message without a try/catch. */
export function sanitizeLocalDevUid(raw: string): string | null {
  const trimmed = raw.trim()
  return UID_PATTERN.test(trimmed) ? trimmed : null
}

export type LocalDevTokenSuccess = { customToken: string; uid: string }

/** Exchange a sanitized uid for a Firebase custom token against the local Auth
 *  emulator. Throws with the backend's `detail` message (or a clarified message
 *  on 404) on any non-200 response. */
export async function requestLocalDevCustomToken(
  apiBase: string,
  uid: string,
  fetchImpl: typeof fetch = fetch
): Promise<LocalDevTokenSuccess> {
  const res = await fetchImpl(`${apiBase.replace(/\/+$/, '')}/v1/auth/local-dev/custom-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ uid })
  })
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        'Local development sign-in is unavailable — the backend is not bound to a Firebase Auth emulator (FIREBASE_AUTH_EMULATOR_HOST unset).'
      )
    }
    let detail = ''
    try {
      detail = String(((await res.json()) as { detail?: unknown }).detail ?? '')
    } catch {
      /* non-JSON body */
    }
    throw new Error(
      `Local development sign-in failed (${res.status})${detail ? `: ${detail}` : ''}`
    )
  }
  const json = (await res.json()) as { custom_token?: string; uid?: string }
  if (!json.custom_token) throw new Error('Local development sign-in returned no custom_token')
  return { customToken: json.custom_token, uid: json.uid ?? uid }
}
