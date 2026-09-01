import { describe, it, expect, beforeEach, vi } from 'vitest'

const registered = new Set<string>()
const taken = new Set<string>()

vi.mock('electron', () => ({
  globalShortcut: {
    register: (accel: string): boolean => {
      if (taken.has(accel)) return false
      registered.add(accel)
      return true
    },
    unregister: (accel: string): void => {
      registered.delete(accel)
    },
    isRegistered: (accel: string): boolean => registered.has(accel)
  }
}))

import { probeGlobalAccelerator } from './shortcutProbe'

describe('probeGlobalAccelerator', () => {
  beforeEach(() => {
    registered.clear()
    taken.clear()
  })

  it('returns true when the OS accepts the chord', () => {
    expect(probeGlobalAccelerator('Ctrl+Shift+O')).toBe(true)
    expect(registered.has('Ctrl+Shift+O')).toBe(false)
  })

  it('returns false when the chord is taken or empty', () => {
    taken.add('Ctrl+Space')
    expect(probeGlobalAccelerator('Ctrl+Space')).toBe(false)
    expect(probeGlobalAccelerator('   ')).toBe(false)
  })

  it('never leaves the probe registered', () => {
    probeGlobalAccelerator('Alt+O')
    expect(registered.size).toBe(0)
  })
})
