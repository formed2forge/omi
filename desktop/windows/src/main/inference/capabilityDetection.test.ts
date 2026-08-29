import { describe, it, expect } from 'vitest'
import type { cpus } from 'os'
import { detectInferenceCapabilities } from './capabilityDetection'

// Every test below passes explicit gpuFetcher/npuRunner/platform, so
// detectInferenceCapabilities never touches the real Electron GPU info API or
// spawns a real PowerShell process — hermetic on every host OS regardless of
// what's actually installed. getInferenceCapabilities()'s memoized, zero-arg
// entry point (which DOES reach real defaults) is covered separately in
// capabilityDetection.memo.test.ts, where the underlying detectors are mocked.

const FAKE_CPUS = [{ model: 'Fake CPU @ 3.00GHz' }, { model: 'Fake CPU @ 3.00GHz' }] as ReturnType<
  typeof cpus
>

describe('detectInferenceCapabilities — tier selection', () => {
  it('picks npu when an NPU is available, even alongside a GPU (npu > gpu > cpu)', async () => {
    const report = await detectInferenceCapabilities({
      platform: 'win32',
      gpuFetcher: async () => ({ gpuDevice: [{ active: true, vendorId: 0x10de }] }),
      npuRunner: async () => '["Intel(R) AI Boost"]',
      cpuList: FAKE_CPUS
    })
    expect(report.tier).toBe('npu')
    expect(report.gpu.available).toBe(true)
    expect(report.npu.available).toBe(true)
  })

  it('picks gpu when there is no NPU but a real (non-software) GPU is present', async () => {
    const report = await detectInferenceCapabilities({
      platform: 'win32',
      gpuFetcher: async () => ({ gpuDevice: [{ active: true, vendorId: 0x8086 }] }),
      npuRunner: async () => '[]',
      cpuList: FAKE_CPUS
    })
    expect(report.tier).toBe('gpu')
  })

  it('falls back to cpu — the large-base case: no NPU, no GPU (or software-only rendering)', async () => {
    const report = await detectInferenceCapabilities({
      platform: 'win32',
      gpuFetcher: async () => ({ auxAttributes: { softwareRendering: true }, gpuDevice: [] }),
      npuRunner: async () => '[]',
      cpuList: FAKE_CPUS
    })
    expect(report.tier).toBe('cpu')
    expect(report.cpu).toEqual({ cores: 2, model: 'Fake CPU @ 3.00GHz' })
  })

  it('falls back to cpu when GPU/NPU detection itself fails outright (never throws)', async () => {
    const report = await detectInferenceCapabilities({
      platform: 'win32',
      gpuFetcher: async () => {
        throw new Error('no GPU process')
      },
      npuRunner: async () => {
        throw new Error('powershell not found')
      },
      cpuList: FAKE_CPUS
    })
    expect(report.tier).toBe('cpu')
    expect(report.npu.detectionFailed).toBe(true)
  })

  it('never probes for an NPU off-Windows', async () => {
    const report = await detectInferenceCapabilities({
      platform: 'darwin',
      gpuFetcher: async () => ({ gpuDevice: [{ active: true, vendorId: 0x106b }] }),
      cpuList: FAKE_CPUS
    })
    expect(report.npu).toEqual({ available: false, devices: [], detectionFailed: false })
    expect(report.platform).toBe('darwin')
  })

  it('stamps detectedAt from the injected clock', async () => {
    const report = await detectInferenceCapabilities({
      platform: 'linux',
      cpuList: FAKE_CPUS,
      now: () => 1234
    })
    expect(report.detectedAt).toBe(1234)
  })
})
