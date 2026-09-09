import { describe, it, expect } from 'vitest'
import { localDevConnectSrcOrigins, widenConnectSrcForLocalDev } from './localDevCsp'

const validEnv = {
  profile: 'local_dev',
  apiBase: 'http://100.81.134.49:8000',
  authEmulatorHost: '100.81.134.49',
  authEmulatorPort: '9099'
}

describe('localDevConnectSrcOrigins', () => {
  // Regression: a local_dev build's Firebase Auth emulator / harness API calls
  // were silently blocked by the renderer's static CSP connect-src allowlist
  // (production hosts only), surfacing as the misleading Firebase SDK error
  // auth/network-request-failed — not a real network failure. See
  // scripts/dev-harness/PRICING_WINDOWS.md.
  it('resolves both the api base origin and the auth emulator origin', () => {
    expect(localDevConnectSrcOrigins(validEnv)).toEqual([
      'http://100.81.134.49:8000',
      'http://100.81.134.49:9099'
    ])
  })

  it('dedupes when the api base and auth emulator share a host:port', () => {
    expect(
      localDevConnectSrcOrigins({
        ...validEnv,
        apiBase: 'http://100.81.134.49:9099',
        authEmulatorPort: '9099'
      })
    ).toEqual(['http://100.81.134.49:9099'])
  })

  it('is empty outside local_dev, regardless of other fields', () => {
    expect(localDevConnectSrcOrigins({})).toEqual([])
    expect(localDevConnectSrcOrigins({ ...validEnv, profile: 'production' })).toEqual([])
    expect(localDevConnectSrcOrigins({ ...validEnv, profile: undefined })).toEqual([])
  })

  it('is empty (not a partial widen) when local_dev is misconfigured', () => {
    // resolveLocalDevConfig throws on a missing/production-shaped value; the CSP
    // must stay untouched rather than widen for a half-valid config — the
    // runtime gate (firebase.ts) is what surfaces the configuration error.
    expect(localDevConnectSrcOrigins({ ...validEnv, apiBase: undefined })).toEqual([])
    expect(localDevConnectSrcOrigins({ ...validEnv, authEmulatorPort: 'not-a-port' })).toEqual([])
    expect(localDevConnectSrcOrigins({ ...validEnv, apiBase: 'https://api.omi.me' })).toEqual([])
  })
})

describe('widenConnectSrcForLocalDev', () => {
  const html = `<meta http-equiv="Content-Security-Policy" content="connect-src 'self' https://api.omi.me;">`

  it('inserts the given origins right after the base connect-src token', () => {
    const out = widenConnectSrcForLocalDev(html, [
      'http://100.81.134.49:8000',
      'http://100.81.134.49:9099'
    ])
    expect(out).toBe(
      `<meta http-equiv="Content-Security-Policy" content="connect-src 'self' http://100.81.134.49:8000 http://100.81.134.49:9099 https://api.omi.me;">`
    )
  })

  it('returns the html unchanged when there are no origins to add', () => {
    expect(widenConnectSrcForLocalDev(html, [])).toBe(html)
  })
})
