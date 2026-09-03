import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  bindVoiceTurnToggle,
  getVoiceTurnButtonSnapshot,
  onVoiceTurnButtonSnapshot,
  publishVoiceTurnButtonSnapshot,
  toggleVoiceTurnFromButton,
  __resetVoiceTurnButtonStoreForTests
} from './voiceTurnButtonStore'

afterEach(() => __resetVoiceTurnButtonStoreForTests())

describe('voiceTurnButtonStore', () => {
  it('toggle is a no-op until a driver is bound', () => {
    expect(() => toggleVoiceTurnFromButton()).not.toThrow()
  })

  it('forwards clicks to the bound driver and unbinds cleanly', () => {
    const first = vi.fn()
    const unbind = bindVoiceTurnToggle(first)
    toggleVoiceTurnFromButton()
    expect(first).toHaveBeenCalledTimes(1)
    unbind()
    toggleVoiceTurnFromButton()
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('a newer bind replaces the previous toggle (resetVoicePlane)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unbindFirst = bindVoiceTurnToggle(first)
    bindVoiceTurnToggle(second)
    unbindFirst()
    toggleVoiceTurnFromButton()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('publishes snapshots to subscribers', () => {
    const seen: string[] = []
    const unsub = onVoiceTurnButtonSnapshot((s) => seen.push(String(s.phaseKind)))
    publishVoiceTurnButtonSnapshot({
      phaseKind: 'lockedRecording',
      isListening: true,
      orbLevel: 0.4,
      hint: ''
    })
    expect(getVoiceTurnButtonSnapshot().phaseKind).toBe('lockedRecording')
    expect(seen).toEqual(['null', 'lockedRecording'])
    unsub()
  })
})
