import { describe, it, expect } from 'vitest'
import { localDevCorsUrlPatterns } from './localDevCors'

const validEnv = {
  profile: 'local_dev',
  apiBase: 'http://100.81.134.49:8000',
  authEmulatorHost: '100.81.134.49',
  authEmulatorPort: '9099'
}

describe('localDevCorsUrlPatterns', () => {
  // Regression: the harness backend's CORSMiddleware is fail-closed
  // (CORS_ALLOWED_ORIGINS defaults to empty — backend/main.py), so every
  // Windows omiApi call to it was blocked by the browser's CORS enforcement
  // (webSecurity ON), surfacing as a bare axios "Network Error" on the Plan &
  // Usage tab even after sign-in and CSP were both already fixed.
  it('returns the api base origin as a webRequest url pattern', () => {
    expect(localDevCorsUrlPatterns(validEnv)).toEqual(['http://100.81.134.49:8000/*'])
  })

  it('is empty outside local_dev', () => {
    expect(localDevCorsUrlPatterns({})).toEqual([])
    expect(localDevCorsUrlPatterns({ ...validEnv, profile: 'production' })).toEqual([])
  })

  it('is empty (not a partial relaxation) when local_dev is misconfigured', () => {
    expect(localDevCorsUrlPatterns({ ...validEnv, apiBase: undefined })).toEqual([])
    expect(localDevCorsUrlPatterns({ ...validEnv, apiBase: 'https://api.omi.me' })).toEqual([])
    expect(localDevCorsUrlPatterns({ ...validEnv, authEmulatorPort: 'not-a-port' })).toEqual([])
  })
})
