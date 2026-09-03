import { Loader2, Mic, MicOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { PushToTalkButtonState } from '../../lib/voice/turn/pushToTalkButtonTrigger'
import { VoiceWaveformBars } from './VoiceWaveformBars'

const LABEL: Record<PushToTalkButtonState, { aria: string; title: string }> = {
  idle: {
    aria: 'Start voice input',
    title: 'Ask by voice — click to start, click again to send'
  },
  listening: {
    aria: 'Stop voice input and send',
    title: 'Stop and send'
  },
  committing: {
    aria: 'Sending voice input',
    title: 'Sending your voice message…'
  },
  blocked: {
    aria: 'Voice input unavailable, monthly message limit reached',
    title: 'Monthly free message limit reached — click to see your options'
  }
}

/** Visible push-to-talk affordance shared by the Home composer and the bar.
 *  A trigger, not a capture path: every click enters the one VoiceHubTurnDriver
 *  turn the keyboard shortcut already drives (INV-VOICE-1). Click-to-lock,
 *  click-to-send — there is no hold. Deliberately never `disabled` while
 *  blocked: a disabled button would swallow the click that must surface the
 *  usage-limit popup. */
export function PushToTalkMicButton(props: {
  state: PushToTalkButtonState
  onClick: () => void
  level?: number
  diameter?: number
  tone?: 'home' | 'bar'
  className?: string
}): React.JSX.Element {
  const { state, onClick, level = 0, diameter = 34, tone = 'home', className } = props
  const copy = LABEL[state]
  const idleHover =
    tone === 'bar'
      ? 'text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-100'
      : 'text-home-muted hover:bg-white/10 hover:text-home-ink'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copy.aria}
      aria-pressed={state === 'listening'}
      title={copy.title}
      data-testid="push-to-talk-mic"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full transition-colors duration-150',
        state === 'listening' ? 'bg-emerald-400/20 text-emerald-300' : idleHover,
        className
      )}
      style={{ width: diameter, height: diameter }}
    >
      {state === 'listening' ? (
        <VoiceWaveformBars active level={level} />
      ) : state === 'committing' ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
      ) : state === 'blocked' ? (
        <MicOff className="h-[15px] w-[15px] opacity-55" strokeWidth={2.25} />
      ) : (
        <Mic className="h-[15px] w-[15px]" strokeWidth={2.25} />
      )}
    </button>
  )
}
