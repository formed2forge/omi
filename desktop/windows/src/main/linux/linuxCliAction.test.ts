import { describe, expect, it, vi } from 'vitest'
import {
  dispatchLinuxCliAction,
  formatLinuxCliSpawnCommand,
  parseLinuxCliAction
} from './linuxCliAction'

describe('parseLinuxCliAction', () => {
  it('parses summon and record-mic actions', () => {
    expect(parseLinuxCliAction(['omi-windows', '--omi-action', 'summon'])).toBe('summon')
    expect(parseLinuxCliAction(['omi-windows', '--omi-action', 'record-mic'])).toBe('record-mic')
  })

  it('returns null when the flag or value is missing', () => {
    expect(parseLinuxCliAction(['omi-windows'])).toBeNull()
    expect(parseLinuxCliAction(['omi-windows', '--omi-action'])).toBeNull()
    expect(parseLinuxCliAction(['omi-windows', '--omi-action', 'unknown'])).toBeNull()
  })
})

describe('formatLinuxCliSpawnCommand', () => {
  it('formats packaged spawn commands', () => {
    expect(formatLinuxCliSpawnCommand('summon')).toBe('omi-windows --omi-action summon')
    expect(formatLinuxCliSpawnCommand('record-mic')).toBe('omi-windows --omi-action record-mic')
  })
})

describe('dispatchLinuxCliAction', () => {
  it('routes summon and record-mic to handlers', () => {
    const summon = vi.fn()
    const recordMic = vi.fn()
    dispatchLinuxCliAction('summon', { summon, recordMic })
    dispatchLinuxCliAction('record-mic', { summon, recordMic })
    expect(summon).toHaveBeenCalledTimes(1)
    expect(recordMic).toHaveBeenCalledTimes(1)
  })
})
