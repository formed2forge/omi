import { describe, it, expect, vi, beforeEach } from 'vitest'

// selectExecutionPlan's only collaborator is getInferenceCapabilities — mock it
// directly rather than the underlying gpu/npu detectors (those are already
// covered by capabilityDetection.test.ts's own dependency injection). Keeps
// this suite hermetic and focused on the plan-selection logic only.
vi.mock('./capabilityDetection', () => ({ getInferenceCapabilities: vi.fn() }))

import { selectExecutionPlan } from './executionProvider'
import { getInferenceCapabilities, type InferenceCapabilityReport } from './capabilityDetection'

const mockGetInferenceCapabilities = vi.mocked(getInferenceCapabilities)

function makeReport(
  overrides: {
    tier?: InferenceCapabilityReport['tier']
    gpu?: Partial<InferenceCapabilityReport['gpu']>
    npu?: Partial<InferenceCapabilityReport['npu']>
  } = {}
): InferenceCapabilityReport {
  return {
    tier: overrides.tier ?? 'cpu',
    platform: 'win32',
    gpu: {
      available: false,
      vendor: 'unknown',
      vendorString: null,
      deviceString: null,
      driverVersion: null,
      softwareRenderer: false,
      ...overrides.gpu
    },
    npu: { available: false, devices: [], detectionFailed: false, ...overrides.npu },
    cpu: { cores: 4, model: 'Fake CPU' },
    detectedAt: 0
  }
}

describe('selectExecutionPlan', () => {
  beforeEach(() => mockGetInferenceCapabilities.mockReset())

  it('stays CPU-baseline — the large-base case: no GPU/NPU detected at all', async () => {
    mockGetInferenceCapabilities.mockResolvedValue(makeReport())
    expect(await selectExecutionPlan()).toEqual({ provider: 'cpu', gpu: false, threads: 0 })
  })

  it('selects cuda for an NVIDIA GPU', async () => {
    mockGetInferenceCapabilities.mockResolvedValue(
      makeReport({ tier: 'gpu', gpu: { available: true, vendor: 'nvidia' } })
    )
    expect(await selectExecutionPlan()).toEqual({ provider: 'cuda', gpu: 'cuda', threads: 0 })
  })

  it("selects vulkan (llama.cpp's vendor-neutral GPU backend) for AMD/Intel/Qualcomm GPUs", async () => {
    mockGetInferenceCapabilities.mockResolvedValue(
      makeReport({ tier: 'gpu', gpu: { available: true, vendor: 'qualcomm' } })
    )
    expect(await selectExecutionPlan()).toEqual({ provider: 'vulkan', gpu: 'vulkan', threads: 0 })
  })

  it('falls back to CPU when Chromium fell back to a software rasterizer', async () => {
    mockGetInferenceCapabilities.mockResolvedValue(
      makeReport({ gpu: { available: true, vendor: 'nvidia', softwareRenderer: true } })
    )
    expect(await selectExecutionPlan()).toEqual({ provider: 'cpu', gpu: false, threads: 0 })
  })

  it('falls back to CPU on an npu-tier report when the gpu detail has no known vendor mapping', async () => {
    // llama.cpp has no NPU backend — an npu-tier report can only help via its
    // gpu detail, exactly like a gpu-tier report. An unmapped vendor there
    // means CPU, same as the gpu-tier case.
    mockGetInferenceCapabilities.mockResolvedValue(
      makeReport({
        tier: 'npu',
        npu: { available: true, devices: ['Intel AI Boost'] },
        gpu: { available: true, vendor: 'unknown' }
      })
    )
    expect(await selectExecutionPlan()).toEqual({ provider: 'cpu', gpu: false, threads: 0 })
  })

  // Main error path: capability detection itself throws.
  it('fails open to CPU-baseline when capability detection throws', async () => {
    mockGetInferenceCapabilities.mockRejectedValueOnce(new Error('detection blew up'))
    expect(await selectExecutionPlan()).toEqual({ provider: 'cpu', gpu: false, threads: 0 })
  })
})
