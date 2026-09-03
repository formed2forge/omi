import { useEffect, useState } from 'react'
import { buttonState, type PushToTalkButtonState } from '../lib/voice/turn/pushToTalkButtonTrigger'
import {
  getVoiceTurnButtonSnapshot,
  onVoiceTurnButtonSnapshot,
  toggleVoiceTurnFromButton,
  type VoiceTurnButtonSnapshot
} from '../lib/voice/turn/voiceTurnButtonStore'
import { mainChatQuotaGate } from './useChat'

/** Home-composer subscription to the live VoiceHubTurnDriver projection. */
export function useVoiceTurnButton(): {
  snapshot: VoiceTurnButtonSnapshot
  state: PushToTalkButtonState
  toggle: () => void
} {
  const [snapshot, setSnapshot] = useState(getVoiceTurnButtonSnapshot)
  useEffect(() => onVoiceTurnButtonSnapshot(setSnapshot), [])
  return {
    snapshot,
    state: buttonState(snapshot.phaseKind, mainChatQuotaGate.isLimitReached()),
    toggle: toggleVoiceTurnFromButton
  }
}
