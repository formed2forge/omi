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
  it('matches the fixture uid', () => {
    expect(isLocalDevOnboardingBypassIdentity(LOCAL_DEV_FIXTURE_UID)).toBe(true)
  })

  it('matches any seeded pricing-QA fixture uid (pricing_ prefix)', () => {
    expect(isLocalDevOnboardingBypassIdentity('pricing_plus')).toBe(true)
    expect(isLocalDevOnboardingBypassIdentity('pricing_unlimited_v2')).toBe(true)
    // Prefix rule, not an enumerated list — a scenario-specific fixture not on
    // any hardcoded list still matches, since the harness seeds these
    // dynamically (dev_harness/pricing_scenarios.py).
    expect(isLocalDevOnboardingBypassIdentity('pricing_unlimited_grandfathered')).toBe(true)
  })

  it('rejects a non-pricing, non-fixture uid (e.g. a real signed-in account)', () => {
    expect(isLocalDevOnboardingBypassIdentity('alice')).toBe(false)
  })

  it('rejects a uid that merely contains "pricing" without the prefix', () => {
    expect(isLocalDevOnboardingBypassIdentity('pricingsomething')).toBe(false)
  })

  it('rejects null/undefined/empty', () => {
    expect(isLocalDevOnboardingBypassIdentity(null)).toBe(false)
    expect(isLocalDevOnboardingBypassIdentity(undefined)).toBe(false)
    expect(isLocalDevOnboardingBypassIdentity('')).toBe(false)
  })
})
