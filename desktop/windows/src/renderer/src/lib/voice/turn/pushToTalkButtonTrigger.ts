// Click policy for a visible push-to-talk mic button. Port of macOS
// `PushToTalkButtonTrigger.swift`: a click is a trigger into the ONE voice-turn
// machine, never a second capture path. A click carries no hold, so it maps onto
// the hands-free (locked) lane the double-tap shortcut already drives.
//
// Derived from the authoritative reducer phase — never a second lifecycle state.

import type { VoiceTurnPhase } from './voiceTurnMachine'

export type VoiceTurnPhaseKind = VoiceTurnPhase['kind']

/** What a click on a visible push-to-talk button must do. */
export type PushToTalkClickAction = 'beginHandsFree' | 'finalize' | 'ignore'

/** How a push-to-talk button renders. One projection of the same reducer phase
 *  the floating bar reads, so a composer icon can never disagree with the bar. */
export type PushToTalkButtonState = 'idle' | 'listening' | 'committing' | 'blocked'

/** The action a push-to-talk button click resolves to for a given authoritative
 *  phase. Any capturing phase commits; a phase that is already committing is
 *  inert; everything else opens a fresh hands-free turn. `null` is idle. */
export function clickAction(phaseKind: VoiceTurnPhaseKind | null): PushToTalkClickAction {
  switch (phaseKind) {
    case 'recording':
    case 'lockedRecording':
    case 'pendingLockDecision':
      return 'finalize'
    case 'finalizing':
      return 'ignore'
    case 'idle':
    case 'awaitingResponse':
    case 'awaitingTools':
    case 'playing':
    case 'terminal':
    case null:
      return 'beginHandsFree'
  }
}

/** Whether entering locked listening may lock the turn that already exists.
 *  `.lock` is only a valid transition out of a capturing phase; every other
 *  active turn must be superseded by a fresh locked turn instead. A click
 *  almost never takes this branch (recording maps to finalize), but the hotkey
 *  tap-to-lock window does. */
export function locksExistingTurn(phaseKind: VoiceTurnPhaseKind | null): boolean {
  switch (phaseKind) {
    case 'recording':
    case 'pendingLockDecision':
      return true
    default:
      return false
  }
}

/** How a push-to-talk button must render for a given phase. The blocked
 *  treatment only ever replaces the idle one: a turn that is already capturing
 *  must stay stoppable even if the limit is reached mid-turn. */
export function buttonState(
  phaseKind: VoiceTurnPhaseKind | null,
  isUsageLimitBlocked: boolean
): PushToTalkButtonState {
  switch (clickAction(phaseKind)) {
    case 'finalize':
      return 'listening'
    case 'ignore':
      return 'committing'
    case 'beginHandsFree':
      return isUsageLimitBlocked ? 'blocked' : 'idle'
  }
}
