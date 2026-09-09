import { describe, it, expect } from 'vitest'
import {
  LocalDevConfigError,
  PRODUCTION_API_BASE,
  resolveAppProfile,
  resolveLocalDevConfig
} from './environmentProfile'

describe('resolveAppProfile', () => {
  it('resolves local_dev only for the exact string', () => {
    expect(resolveAppProfile('local_dev')).toBe('local_dev')
  })

  it('defaults to production for anything else, including unset', () => {
    expect(resolveAppProfile(undefined)).toBe('production')
    expect(resolveAppProfile('')).toBe('production')
    expect(resolveAppProfile('production')).toBe('production')
    expect(resolveAppProfile('LOCAL_DEV')).toBe('production')
    expect(resolveAppProfile('local-dev')).toBe('production')
  })
})

describe('resolveLocalDevConfig', () => {
  const validEnv = {
    profile: 'local_dev',
    apiBase: 'http://192.168.1.50:8000',
    authEmulatorHost: '192.168.1.50',
    authEmulatorPort: '9099'
  }

  it('is a no-op outside local_dev, regardless of other fields', () => {
    expect(resolveLocalDevConfig({})).toBeNull()
    expect(resolveLocalDevConfig({ profile: 'production', apiBase: '' })).toBeNull()
    // Even a fully valid-looking config is ignored when the profile isn't local_dev.
    expect(resolveLocalDevConfig({ ...validEnv, profile: undefined })).toBeNull()
  })

  it('resolves a fully-specified local_dev config', () => {
    expect(resolveLocalDevConfig(validEnv)).toEqual({
      apiBase: 'http://192.168.1.50:8000',
      authEmulatorHost: '192.168.1.50',
      authEmulatorPort: 9099
    })
  })

  it('strips a trailing slash from the api base', () => {
    expect(
      resolveLocalDevConfig({ ...validEnv, apiBase: 'http://192.168.1.50:8000/' })?.apiBase
    ).toBe('http://192.168.1.50:8000')
  })

  it('throws (not falls back) when the api base is missing', () => {
    expect(() => resolveLocalDevConfig({ ...validEnv, apiBase: undefined })).toThrow(
      LocalDevConfigError
    )
    expect(() => resolveLocalDevConfig({ ...validEnv, apiBase: '   ' })).toThrow(
      LocalDevConfigError
    )
  })

  it('throws when the api base is left at the production default', () => {
    expect(() => resolveLocalDevConfig({ ...validEnv, apiBase: PRODUCTION_API_BASE })).toThrow(
      /must not point .* at production/
    )
    // Trailing-slash variant of the same production URL.
    expect(() =>
      resolveLocalDevConfig({ ...validEnv, apiBase: `${PRODUCTION_API_BASE}/` })
    ).toThrow(LocalDevConfigError)
  })

  it('throws when the api base is an unparseable URL', () => {
    expect(() => resolveLocalDevConfig({ ...validEnv, apiBase: 'not a url' })).toThrow(
      LocalDevConfigError
    )
  })

  it('throws on an https api base (production-shaped) even if not the exact prod host', () => {
    expect(() => resolveLocalDevConfig({ ...validEnv, apiBase: 'https://staging.omi.me' })).toThrow(
      /http:\/\//
    )
  })

  it('throws when the auth emulator host is missing', () => {
    expect(() => resolveLocalDevConfig({ ...validEnv, authEmulatorHost: undefined })).toThrow(
      /VITE_FIREBASE_AUTH_EMULATOR_HOST/
    )
    expect(() => resolveLocalDevConfig({ ...validEnv, authEmulatorHost: '  ' })).toThrow(
      LocalDevConfigError
    )
  })

  it('throws when the auth emulator port is missing or invalid', () => {
    expect(() => resolveLocalDevConfig({ ...validEnv, authEmulatorPort: undefined })).toThrow(
      /VITE_FIREBASE_AUTH_EMULATOR_PORT/
    )
    expect(() => resolveLocalDevConfig({ ...validEnv, authEmulatorPort: 'abc' })).toThrow(
      LocalDevConfigError
    )
    expect(() => resolveLocalDevConfig({ ...validEnv, authEmulatorPort: '0' })).toThrow(
      LocalDevConfigError
    )
    expect(() => resolveLocalDevConfig({ ...validEnv, authEmulatorPort: '70000' })).toThrow(
      LocalDevConfigError
    )
    expect(() => resolveLocalDevConfig({ ...validEnv, authEmulatorPort: '9099.5' })).toThrow(
      LocalDevConfigError
    )
  })
})
