import { describe, it, expect, vi, beforeEach } from 'vitest'

// selectAsrExecutionProviders' only collaborator is getInferenceCapabilities —
// mock it directly, same approach as ../inference/executionProvider.test.ts.
vi.mock('../inference/capabilityDetection', () => ({ getInferenceCapabilities: vi.fn() }))

import { selectAsrExecutionProviders } from './asrExecutionProvider'
import { getInferenceCapabilities } from '../inference/capabilityDetection'
import type { InferenceCapabilityReport } from '../inference/capabilityDetection'

const mockGetInferenceCapabilities = vi.mocked(getInferenceCapabilities)

function makeReport(
  overrides: {
    platform?: NodeJS.Platform
    tier?: InferenceCapabilityReport['tier']
    gpu?: Partial<InferenceCapabilityReport['gpu']>
  } = {}
): InferenceCapabilityReport {
  return {
    tier: overrides.tier ?? 'cpu',
    platform: overrides.platform ?? 'win32',
    gpu: {
      available: false,
      vendor: 'unknown',
      vendorString: null,
      deviceString: null,
      driverVersion: null,
      softwareRenderer: false,
      ...overrides.gpu
    },
    npu: { available: false, devices: [], detectionFailed: false },
    cpu: { cores: 4, model: 'Fake CPU' },
    detectedAt: 0
  }
}

describe('selectAsrExecutionProviders', () => {
  beforeEach(() => mockGetInferenceCapabilities.mockReset())

  it('stays CPU-only — the large-base case: no GPU detected', async () => {
    mockGetInferenceCapabilities.mockResolvedValue(makeReport())
    expect(await selectAsrExecutionProviders()).toEqual(['cpu'])
  })

  it('offers dml ahead of cpu on Windows with a real GPU', async () => {
    mockGetInferenceCapabilities.mockResolvedValue(
      makeReport({ tier: 'gpu', gpu: { available: true, vendor: 'nvidia' } })
    )
    expect(await selectAsrExecutionProviders()).toEqual(['dml', 'cpu'])
  })

  it('offers dml on an npu-tier report too — DirectML is the only GPU EP available, NPU has none', async () => {
    mockGetInferenceCapabilities.mockResolvedValue(
      makeReport({ tier: 'npu', gpu: { available: true, vendor: 'qualcomm' } })
    )
    expect(await selectAsrExecutionProviders()).toEqual(['dml', 'cpu'])
  })

  it('stays CPU-only when the GPU is a software rasterizer', async () => {
    mockGetInferenceCapabilities.mockResolvedValue(
      makeReport({ gpu: { available: true, vendor: 'nvidia', softwareRenderer: true } })
    )
    expect(await selectAsrExecutionProviders()).toEqual(['cpu'])
  })

  it('stays CPU-only off Windows even with a real GPU — dml is Windows-only in onnxruntime-node', async () => {
    mockGetInferenceCapabilities.mockResolvedValue(
      makeReport({ platform: 'darwin', gpu: { available: true, vendor: 'apple' } })
    )
    expect(await selectAsrExecutionProviders()).toEqual(['cpu'])
  })

  // Main error path: capability detection itself throws.
  it('fails open to CPU-only when capability detection throws', async () => {
    mockGetInferenceCapabilities.mockRejectedValueOnce(new Error('detection blew up'))
    expect(await selectAsrExecutionProviders()).toEqual(['cpu'])
  })
})
