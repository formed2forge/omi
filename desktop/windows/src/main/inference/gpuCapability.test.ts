import { describe, it, expect } from 'vitest'
import { parseGpuInfo, detectGpu } from './gpuCapability'

describe('parseGpuInfo', () => {
  it('reports a real GPU as available, with vendor resolved from PCI id', () => {
    const raw = {
      auxAttributes: { softwareRendering: false },
      gpuDevice: [
        {
          active: true,
          vendorId: 0x10de,
          deviceId: 0x2684,
          vendorString: 'NVIDIA',
          deviceString: 'NVIDIA GeForce RTX 4090',
          driverVersion: '546.01'
        }
      ]
    }
    expect(parseGpuInfo(raw)).toEqual({
      available: true,
      vendor: 'nvidia',
      vendorString: 'NVIDIA',
      deviceString: 'NVIDIA GeForce RTX 4090',
      driverVersion: '546.01',
      softwareRenderer: false
    })
  })

  it('picks the device Chromium marked active on a multi-adapter machine (laptop iGPU + dGPU)', () => {
    const raw = {
      gpuDevice: [
        { active: false, vendorId: 0x8086, vendorString: 'Intel' },
        { active: true, vendorId: 0x1002, vendorString: 'AMD' }
      ]
    }
    expect(parseGpuInfo(raw).vendor).toBe('amd')
  })

  it('falls back to the first device when none is marked active (older Chromium shape)', () => {
    const raw = { gpuDevice: [{ vendorId: 0x8086 }] }
    expect(parseGpuInfo(raw).vendor).toBe('intel')
  })

  it('resolves vendor from vendorString when vendorId is absent/unknown', () => {
    expect(
      parseGpuInfo({ gpuDevice: [{ vendorString: 'Qualcomm Technologies Inc' }] }).vendor
    ).toBe('qualcomm')
    expect(parseGpuInfo({ gpuDevice: [{ vendorString: 'Totally Unknown Corp' }] }).vendor).toBe(
      'unknown'
    )
  })

  it('treats software rendering (SwiftShader / Basic Render Driver) as unavailable regardless of the reported device', () => {
    const raw = {
      auxAttributes: { softwareRendering: true },
      gpuDevice: [{ active: true, vendorId: 0x10de, vendorString: 'NVIDIA' }]
    }
    const result = parseGpuInfo(raw)
    expect(result.available).toBe(false)
    expect(result.softwareRenderer).toBe(true)
    // Vendor/device detail is still surfaced for diagnostics even though it's unusable.
    expect(result.vendor).toBe('nvidia')
  })

  it('degrades to unavailable on missing/malformed input rather than throwing', () => {
    expect(parseGpuInfo(null)).toEqual({
      available: false,
      vendor: 'unknown',
      vendorString: null,
      deviceString: null,
      driverVersion: null,
      softwareRenderer: false
    })
    expect(parseGpuInfo(undefined).available).toBe(false)
    expect(parseGpuInfo('not an object').available).toBe(false)
    expect(parseGpuInfo({}).available).toBe(false)
    expect(parseGpuInfo({ gpuDevice: [] }).available).toBe(false)
  })
})

describe('detectGpu', () => {
  it('parses whatever the fetcher resolves with', async () => {
    const result = await detectGpu(async () => ({
      gpuDevice: [{ active: true, vendorId: 0x8086, vendorString: 'Intel' }]
    }))
    expect(result.available).toBe(true)
    expect(result.vendor).toBe('intel')
  })

  it('degrades to unavailable — never throws — when the fetcher rejects (e.g. called before app.ready)', async () => {
    const result = await detectGpu(async () => {
      throw new Error('GPU process not ready')
    })
    expect(result).toEqual({
      available: false,
      vendor: 'unknown',
      vendorString: null,
      deviceString: null,
      driverVersion: null,
      softwareRenderer: false
    })
  })
})
