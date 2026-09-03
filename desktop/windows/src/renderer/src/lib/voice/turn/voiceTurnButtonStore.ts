// Main-window pub/sub for the composer mic button. The VoiceHubTurnDriver is the
// lifecycle owner (INV-VOICE-1); this store is a projection + a click entry so
// HubAskBar can toggle without mounting a second PTT machine.

import type { VoiceTurnPhaseKind } from './pushToTalkButtonTrigger'

export type VoiceTurnButtonSnapshot = {
  phaseKind: VoiceTurnPhaseKind | null
  isListening: boolean
  orbLevel: number
  hint: string
}

export const IDLE_VOICE_TURN_BUTTON_SNAPSHOT: VoiceTurnButtonSnapshot = {
  phaseKind: null,
  isListening: false,
  orbLevel: 0,
  hint: ''
}

let snapshot: VoiceTurnButtonSnapshot = IDLE_VOICE_TURN_BUTTON_SNAPSHOT
let toggleImpl: (() => void) | null = null
const listeners = new Set<(s: VoiceTurnButtonSnapshot) => void>()

/** Register the live driver's `toggleFromButton`. Returns an unbind that no-ops
 *  if a newer driver has already replaced this one (resetVoicePlane). */
export function bindVoiceTurnToggle(toggle: () => void): () => void {
  toggleImpl = toggle
  return () => {
    if (toggleImpl === toggle) toggleImpl = null
  }
}

export function publishVoiceTurnButtonSnapshot(next: VoiceTurnButtonSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener(next)
}

export function getVoiceTurnButtonSnapshot(): VoiceTurnButtonSnapshot {
  return snapshot
}

/** Entry point for a visible push-to-talk button (Home composer). No-op until
 *  VoiceHubDriverHost binds the live driver. */
export function toggleVoiceTurnFromButton(): void {
  toggleImpl?.()
}

export function onVoiceTurnButtonSnapshot(
  cb: (s: VoiceTurnButtonSnapshot) => void
): () => void {
  listeners.add(cb)
  cb(snapshot)
  return () => {
    listeners.delete(cb)
  }
}

/** Test-only: drop listeners, unbind the toggle, restore idle. */
export function __resetVoiceTurnButtonStoreForTests(): void {
  snapshot = IDLE_VOICE_TURN_BUTTON_SNAPSHOT
  toggleImpl = null
  listeners.clear()
}
