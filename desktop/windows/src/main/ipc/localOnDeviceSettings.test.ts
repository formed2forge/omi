import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Real appSettings.ts persistence (throwaway userData dir), same pattern as
// appSettings.test.ts — this suite is about the IPC get/set wiring actually
// reading/writing the real settings store, not re-testing sanitization
// (covered by appSettings.test.ts).
const dir = mkdtempSync(join(tmpdir(), 'omi-local-ondevice-settings-'))

const h = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  return { ipcHandlers }
})

vi.mock('electron', () => ({
  app: { getPath: (): string => dir },
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown) => h.ipcHandlers.set(ch, fn)
  },
  globalShortcut: {
    register: (): boolean => true,
    unregister: (): void => {},
    isRegistered: (): boolean => false
  }
}))

import { registerLocalOnDeviceSettingsHandlers } from './localOnDeviceSettings'
import { _resetForTests } from '../appSettings'

const invoke = (ch: string, ...args: unknown[]): unknown => h.ipcHandlers.get(ch)!({}, ...args)

describe('localOnDeviceSettings IPC', () => {
  beforeEach(() => {
    _resetForTests()
    try {
      rmSync(join(dir, 'app-settings.json'), { force: true })
    } catch {
      /* ignore */
    }
    registerLocalOnDeviceSettingsHandlers()
  })

  it('local ASR toggle defaults OFF and round-trips an explicit enable', async () => {
    expect(await invoke('local-ondevice:getAsrEnabled')).toBe(false)
    expect(await invoke('local-ondevice:setAsrEnabled', true)).toBe(true)
    expect(await invoke('local-ondevice:getAsrEnabled')).toBe(true)
  })

  it('local LLM summary toggle defaults OFF and round-trips an explicit enable', async () => {
    expect(await invoke('local-ondevice:getLlmSummaryEnabled')).toBe(false)
    expect(await invoke('local-ondevice:setLlmSummaryEnabled', true)).toBe(true)
    expect(await invoke('local-ondevice:getLlmSummaryEnabled')).toBe(true)
  })

  // Main error path: a non-boolean payload (e.g. IPC tampering, a stale
  // renderer) must coerce to false, never silently enable the feature.
  it('coerces a non-boolean set payload to false rather than throwing or enabling', async () => {
    expect(await invoke('local-ondevice:setAsrEnabled', 'true')).toBe(false)
    expect(await invoke('local-ondevice:getAsrEnabled')).toBe(false)
  })

  it('the two toggles are independent — enabling one leaves the other off', async () => {
    await invoke('local-ondevice:setAsrEnabled', true)
    expect(await invoke('local-ondevice:getLlmSummaryEnabled')).toBe(false)
  })
})
