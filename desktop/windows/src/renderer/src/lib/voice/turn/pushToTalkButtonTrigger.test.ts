import { describe, it, expect } from 'vitest'
import {
  buttonState,
  clickAction,
  locksExistingTurn,
  type VoiceTurnPhaseKind
} from './pushToTalkButtonTrigger'

// Port of macOS PushToTalkButtonTriggerTests: a click maps onto locked
// (hands-free) listening, the next click commits the same turn, and a click
// while a previous answer is in flight barges in rather than locking it.

describe('clickAction', () => {
  it('idle / answering / playing start a hands-free turn', () => {
    const begin: Array<VoiceTurnPhaseKind | null> = [
      null,
      'idle',
      'awaitingResponse',
      'awaitingTools',
      'playing',
      'terminal'
    ]
    for (const phase of begin) {
      expect(clickAction(phase), String(phase)).toBe('beginHandsFree')
    }
  })

  it('any capturing phase commits the same turn', () => {
    expect(clickAction('recording')).toBe('finalize')
    expect(clickAction('lockedRecording')).toBe('finalize')
    expect(clickAction('pendingLockDecision')).toBe('finalize')
  })

  it('a click while committing neither restarts nor re-commits', () => {
    expect(clickAction('finalizing')).toBe('ignore')
  })
})

describe('buttonState', () => {
  it('projects idle / listening / committing from the same click mapping', () => {
    expect(buttonState(null, false)).toBe('idle')
    expect(buttonState('lockedRecording', false)).toBe('listening')
    expect(buttonState('finalizing', false)).toBe('committing')
  })

  it('blocked replaces only the idle treatment — a live turn stays stoppable', () => {
    expect(buttonState(null, true)).toBe('blocked')
    expect(buttonState('awaitingResponse', true)).toBe('blocked')
    expect(buttonState('lockedRecording', true)).toBe('listening')
    expect(buttonState('finalizing', true)).toBe('committing')
  })
})

describe('locksExistingTurn', () => {
  it('only a still-capturing hold is lockable in place', () => {
    expect(locksExistingTurn('recording')).toBe(true)
    expect(locksExistingTurn('pendingLockDecision')).toBe(true)
  })

  it('every other phase is superseded, not locked', () => {
    const superseded: Array<VoiceTurnPhaseKind | null> = [
      'lockedRecording',
      'finalizing',
      'awaitingResponse',
      'awaitingTools',
      'playing',
      'idle',
      'terminal',
      null
    ]
    for (const phase of superseded) {
      expect(locksExistingTurn(phase), String(phase)).toBe(false)
    }
  })
})
