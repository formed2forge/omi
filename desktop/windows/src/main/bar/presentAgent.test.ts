import { describe, it, expect } from 'vitest'
import { planPresentFlush } from './presentAgent'

describe('planPresentFlush', () => {
  it('sends immediately when the bar is already expanded', () => {
    expect(planPresentFlush({ visible: true, hiding: false, mode: 'expanded' })).toBe('send-now')
  })

  it('expands first when the bar is a visible peek (mode IPC before present)', () => {
    expect(planPresentFlush({ visible: true, hiding: false, mode: 'peek' })).toBe(
      'expand-then-send'
    )
    expect(planPresentFlush({ visible: true, hiding: false, mode: 'ptt' })).toBe('expand-then-send')
  })

  it('shows the parked or retracting bar, then presents after commitReveal', () => {
    expect(planPresentFlush({ visible: false, hiding: false, mode: null })).toBe('show-then-send')
    expect(planPresentFlush({ visible: true, hiding: true, mode: 'peek' })).toBe('show-then-send')
    expect(planPresentFlush({ visible: false, hiding: true, mode: 'expanded' })).toBe(
      'show-then-send'
    )
  })
})
