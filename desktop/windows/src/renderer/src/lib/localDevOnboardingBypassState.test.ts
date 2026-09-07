// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isLocalDevOnboardingBypassSuppressed,
  resetLocalDevOnboardingBypassSuppression,
  suppressLocalDevOnboardingBypass
} from './localDevOnboardingBypassState'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('localDevOnboardingBypassState', () => {
  it('is not suppressed on a fresh profile (never signed out)', () => {
    expect(isLocalDevOnboardingBypassSuppressed()).toBe(false)
  })

  it('becomes suppressed after suppressLocalDevOnboardingBypass()', () => {
    suppressLocalDevOnboardingBypass()
    expect(isLocalDevOnboardingBypassSuppressed()).toBe(true)
  })

  it('survives being checked multiple times (persists, not one-shot)', () => {
    suppressLocalDevOnboardingBypass()
    expect(isLocalDevOnboardingBypassSuppressed()).toBe(true)
    expect(isLocalDevOnboardingBypassSuppressed()).toBe(true)
  })

  it('clears only via the explicit reset action', () => {
    suppressLocalDevOnboardingBypass()
    resetLocalDevOnboardingBypassSuppression()
    expect(isLocalDevOnboardingBypassSuppressed()).toBe(false)
  })

  it('reset on an already-clear profile is a harmless no-op', () => {
    resetLocalDevOnboardingBypassSuppression()
    expect(isLocalDevOnboardingBypassSuppressed()).toBe(false)
  })
})
