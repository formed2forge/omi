import { describe, it, expect } from 'vitest'
import {
  LOCAL_DEV_FIXTURE_UID,
  isLocalDevOnboardingBypassIdentity,
  resolveLocalDevOnboardingBypassActive
} from './localDevOnboardingBypass'

describe('resolveLocalDevOnboardingBypassActive', () => {
  // Shared contract: contracts/parity/local_dev_onboarding_bypass.json's
  // gate_cases — every platform's gate must agree on this exact truth table.
  it('production_default', () => {
    expect(
      resolveLocalDevOnboardingBypassActive({
        localDevProfileActive: false,
        bypassFlagValue: undefined
      })
    ).toBe(false)
  })

  it('local_dev_no_flag', () => {
    expect(
      resolveLocalDevOnboardingBypassActive({
        localDevProfileActive: true,
        bypassFlagValue: undefined
      })
    ).toBe(false)
  })

  it('local_dev_flag_explicit_off', () => {
    expect(
      resolveLocalDevOnboardingBypassActive({ localDevProfileActive: true, bypassFlagValue: '0' })
    ).toBe(false)
  })

  it('local_dev_flag_on', () => {
    expect(
      resolveLocalDevOnboardingBypassActive({ localDevProfileActive: true, bypassFlagValue: '1' })
    ).toBe(true)
  })

  it('production_flag_on_is_still_refused', () => {
    expect(
      resolveLocalDevOnboardingBypassActive({ localDevProfileActive: false, bypassFlagValue: '1' })
    ).toBe(false)
  })

  it('malformed_flag_value_refused', () => {
    expect(
      resolveLocalDevOnboardingBypassActive({ localDevProfileActive: true, bypassFlagValue: 'yes' })
    ).toBe(false)
  })

  it('whitespace_flag_value_refused', () => {
    expect(
      resolveLocalDevOnboardingBypassActive({
        localDevProfileActive: true,
        bypassFlagValue: '  1  '
      })
    ).toBe(false)
  })
})

describe('isLocalDevOnboardingBypassIdentity', () => {
  it('matches only the exact fixture uid', () => {
    expect(isLocalDevOnboardingBypassIdentity(LOCAL_DEV_FIXTURE_UID)).toBe(true)
  })

  it('rejects any other uid, including a manually-typed pricing fixture', () => {
    expect(isLocalDevOnboardingBypassIdentity('pricing_plus')).toBe(false)
    expect(isLocalDevOnboardingBypassIdentity(null)).toBe(false)
    expect(isLocalDevOnboardingBypassIdentity(undefined)).toBe(false)
    expect(isLocalDevOnboardingBypassIdentity('')).toBe(false)
  })
})
