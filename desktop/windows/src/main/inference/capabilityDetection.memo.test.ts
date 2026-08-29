import { describe, it, expect, beforeEach, vi } from 'vitest'

// getInferenceCapabilities() (unlike detectInferenceCapabilities()) takes no
// deps — it's the memoized, production entry point — so on a real machine it
// would reach the real Electron GPU info API and, on Windows, spawn the real
// PowerShell NPU probe. Mock both underlying detectors so this file's tests
// stay hermetic regardless of host OS; only memoization behavior is under
// test here (tier-selection logic is covered in capabilityDetection.test.ts
// via direct dependency injection, without needing to mock anything).
vi.mock('./gpuCapability', () => ({
  detectGpu: vi.fn(async () => ({
    available: false,
    vendor: 'unknown',
    vendorString: null,
    deviceString: null,
    driverVersion: null,
    softwareRenderer: false
  }))
}))
vi.mock('./npuCapability', () => ({
  detectNpu: vi.fn(async () => ({ available: false, devices: [], detectionFailed: false }))
}))

import { getInferenceCapabilities, resetInferenceCapabilitiesCache } from './capabilityDetection'

describe('getInferenceCapabilities — memoization', () => {
  beforeEach(() => resetInferenceCapabilitiesCache())

  it('reuses the first detection result across calls', async () => {
    const first = await getInferenceCapabilities()
    const second = await getInferenceCapabilities()
    expect(second).toBe(first)
  })

  it('re-detects when forceRefresh is passed', async () => {
    const first = await getInferenceCapabilities()
    const second = await getInferenceCapabilities(true)
    expect(second).not.toBe(first)
  })
})
