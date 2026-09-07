// Windows conformance suite for the shared cross-platform local-dev
// onboarding-bypass contract (contracts/parity/README.md). Runs the repo-root
// fixture's gate_cases through the REAL production gate function — mobile and
// macOS run the same cases through their own gate implementations.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LOCAL_DEV_FIXTURE_UID,
  resolveLocalDevOnboardingBypassActive
} from './localDevOnboardingBypass'

type GateCase = {
  name: string
  local_dev_profile_active: boolean
  bypass_flag_value: string | null
  expected_bypass_active: boolean
}

type FixtureIdentity = {
  uid: string
  display_name: string
}

type Contract = {
  schema_version: number
  fixture_identity: FixtureIdentity
  platform_flag_names: Record<string, string>
  gate_cases: GateCase[]
}

function loadContract(): Contract {
  const path = fileURLToPath(
    new URL('../../../../contracts/parity/local_dev_onboarding_bypass.json', import.meta.url)
  )
  return JSON.parse(readFileSync(path, 'utf8')) as Contract
}

const contract = loadContract()

describe('local-dev onboarding bypass — shared fixture identity', () => {
  it('matches the fixture uid this platform implementation uses', () => {
    expect(LOCAL_DEV_FIXTURE_UID).toBe(contract.fixture_identity.uid)
  })

  it('names this platform flag in platform_flag_names', () => {
    expect(contract.platform_flag_names.windows).toBe('VITE_OMI_LOCAL_DEV_ONBOARDING_BYPASS')
  })
})

describe('local-dev onboarding bypass — shared gate_cases conformance', () => {
  for (const c of contract.gate_cases) {
    it(c.name, () => {
      expect(
        resolveLocalDevOnboardingBypassActive({
          localDevProfileActive: c.local_dev_profile_active,
          bypassFlagValue: c.bypass_flag_value ?? undefined
        })
      ).toBe(c.expected_bypass_active)
    })
  }
})
