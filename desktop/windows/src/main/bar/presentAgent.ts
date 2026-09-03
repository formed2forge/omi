// Flush plan for presenting a floating agent pill from the main-window chat.
//
// The bar renderer resets to the hub on every `bar:show` / peek→expanded
// `bar:mode` (the peek-landing bug). A present payload sent *before* that
// reset is wiped. This helper is the order contract, kept pure so the
// window.ts IPC can stay a thin dispatcher.

import type { BarMode } from '../../shared/types'

export type PresentFlushAction = 'send-now' | 'expand-then-send' | 'show-then-send'

export function planPresentFlush(input: {
  visible: boolean
  hiding: boolean
  mode: BarMode | null
}): PresentFlushAction {
  if (input.visible && !input.hiding && input.mode === 'expanded') return 'send-now'
  if (input.visible && !input.hiding) return 'expand-then-send'
  return 'show-then-send'
}
