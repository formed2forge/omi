import { describe, it, expect, vi } from 'vitest'
import { parseNpuDeviceNames, detectNpu } from './npuCapability'

describe('parseNpuDeviceNames', () => {
  it('parses a multi-device JSON array', () => {
    expect(parseNpuDeviceNames('["Intel(R) AI Boost","AMD Ryzen AI"]')).toEqual([
      'Intel(R) AI Boost',
      'AMD Ryzen AI'
    ])
  })

  it('parses the empty-array case (query ran, found nothing)', () => {
    expect(parseNpuDeviceNames('[]')).toEqual([])
  })

  it('treats blank/whitespace-only stdout as no devices', () => {
    expect(parseNpuDeviceNames('')).toEqual([])
    expect(parseNpuDeviceNames('   \r\n  ')).toEqual([])
  })

  it('accepts a bare JSON string (defensive — ConvertTo-Json can collapse a single-element array in some PowerShell versions)', () => {
    expect(parseNpuDeviceNames('"Qualcomm(R) Hexagon(TM) NPU"')).toEqual([
      'Qualcomm(R) Hexagon(TM) NPU'
    ])
  })

  it('degrades to empty on garbage/non-JSON stdout rather than throwing', () => {
    expect(parseNpuDeviceNames('Get-PnpDevice : The term is not recognized...')).toEqual([])
    expect(parseNpuDeviceNames('{not json')).toEqual([])
  })

  it('drops non-string entries defensively', () => {
    expect(parseNpuDeviceNames('[1, "Real Device", null, true]')).toEqual(['Real Device'])
  })
})

describe('detectNpu', () => {
  it('skips detection off-Windows without treating it as a failure', async () => {
    const runner = vi.fn()
    const result = await detectNpu('darwin', runner)
    expect(result).toEqual({ available: false, devices: [], detectionFailed: false })
    expect(runner).not.toHaveBeenCalled()
  })

  it('reports available with the matched device names on a Copilot+ PC', async () => {
    const runner = vi.fn().mockResolvedValue('["Intel(R) AI Boost"]')
    const result = await detectNpu('win32', runner)
    expect(result).toEqual({
      available: true,
      devices: ['Intel(R) AI Boost'],
      detectionFailed: false
    })
    expect(runner).toHaveBeenCalledTimes(1)
    // The query targets both the dedicated PnP class and a FriendlyName fallback,
    // and never opens an interactive/profile-loading shell.
    const args = runner.mock.calls[0][0] as string[]
    expect(args).toContain('-NoProfile')
    expect(args).toContain('-NonInteractive')
    expect(args.join(' ')).toMatch(/NeuralProcessors/)
  })

  it('reports not-available (not failed) when the query runs but finds nothing — the legacy-principal case: a Windows box with no NPU at all', async () => {
    const runner = vi.fn().mockResolvedValue('[]')
    const result = await detectNpu('win32', runner)
    expect(result).toEqual({ available: false, devices: [], detectionFailed: false })
  })

  it('reports detectionFailed (not a false "no NPU") when the PowerShell probe fails/times out', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'))
    const result = await detectNpu('win32', runner)
    expect(result).toEqual({ available: false, devices: [], detectionFailed: true })
  })
})
