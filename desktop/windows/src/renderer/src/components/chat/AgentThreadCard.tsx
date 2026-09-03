import { useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Loader2
} from 'lucide-react'
import type { AgentThreadCardBlock } from '../../../../shared/types'
import type { AgentTimelineRef } from '../../lib/chat/agentTimeline'
import {
  AGENT_UNAVAILABLE_COPY,
  agentCardPreviewText,
  hasTimelineIdentity,
  refFromAgentCardBlock
} from '../../lib/chat/agentTimeline'

// Shared-thread agent cards (B4, INV-CHAT-1). The two durable artifacts a
// background agent leaves in the shared thread: a spawn card at launch and one
// completion card at terminal. Understated + neutral — no purple (INV-UI-1).
//
// Link-out (macOS AgentSpawnCard / AgentCompletionCard) opens the same pill
// the bar shows. Identity is the card's run/session/pill ids — hydrate, don't
// invent a second store.

type CompletionStatus = 'succeeded' | 'stopped' | 'failed'

const STATUS: Record<CompletionStatus, { label: string; dot: string; Icon: typeof CheckCircle2 }> =
  {
    succeeded: { label: 'Done', dot: 'text-emerald-400', Icon: CheckCircle2 },
    stopped: { label: 'Stopped', dot: 'text-white/50', Icon: CircleSlash },
    failed: { label: 'Failed', dot: 'text-red-400', Icon: AlertCircle }
  }

function coerceStatus(status: string): CompletionStatus {
  return status === 'succeeded' || status === 'stopped' || status === 'failed' ? status : 'failed'
}

export type AgentThreadCardOpen = (ref: AgentTimelineRef, done: (ok: boolean) => void) => void

/**
 * One shared-thread agent card. Rendered inside the assistant column of the chat
 * thread (both the main window and the floating bar). `compact` trims padding and
 * type for the bar's narrower panel.
 */
export function AgentThreadCard({
  block,
  compact,
  onOpen
}: {
  block: AgentThreadCardBlock
  compact: boolean
  onOpen?: AgentThreadCardOpen
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [opening, setOpening] = useState(false)

  const ref = refFromAgentCardBlock(block)
  const canOpen = Boolean(onOpen) && hasTimelineIdentity(ref) && !unavailable
  const pad = compact ? 'px-3 py-2' : 'px-3.5 py-2.5'
  const shell = `mr-auto w-fit max-w-[85%] rounded-2xl border border-white/10 bg-white/[0.04] ${pad}`
  const titleCls = `truncate font-medium ${compact ? 'text-[13px]' : 'text-sm'} text-white/90`
  const bodyCls = `${compact ? 'text-[12px]' : 'text-[13px]'} leading-snug text-white/60`

  const openAgent = (): void => {
    if (!canOpen || !onOpen) return
    setOpening(true)
    onOpen(ref, (ok) => {
      setOpening(false)
      if (!ok) setUnavailable(true)
    })
  }

  const title = block.title || 'Background agent'
  const prompt = block.type === 'agentSpawn' ? block.objective : block.promptSnippet
  const output = block.type === 'agentCompletion' ? block.output : ''
  const preview = agentCardPreviewText(title, prompt, output)
  const isSpawn = block.type === 'agentSpawn'
  const status = isSpawn ? null : coerceStatus(block.status)
  const statusUi = status ? STATUS[status] : null

  return (
    <div className={`bubble-in ${shell}`}>
      <div className="flex items-center gap-2">
        <Bot className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0 text-white/70`} />
        <span className={titleCls}>{title}</span>
        {isSpawn ? (
          <span className="ml-1 flex shrink-0 items-center gap-1 text-white/45">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-[11px]">Running</span>
          </span>
        ) : statusUi ? (
          <span className={`ml-1 flex shrink-0 items-center gap-1 ${statusUi.dot}`}>
            <statusUi.Icon className="h-3.5 w-3.5" />
            <span className="text-[11px] font-medium">{statusUi.label}</span>
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {!isSpawn ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse agent output' : 'Expand agent output'}
              className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          ) : null}
          {canOpen ? (
            <button
              type="button"
              onClick={openAgent}
              disabled={opening}
              aria-label="Open background agent"
              title="Open in Omi bar"
              className="flex h-6 w-6 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/10 hover:text-white/90 disabled:opacity-50"
            >
              {opening ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : null}
        </span>
      </div>
      {!expanded && preview ? <p className={`mt-1 line-clamp-2 ${bodyCls}`}>{preview}</p> : null}
      {(expanded || unavailable) && !isSpawn ? (
        <div className={`mt-1.5 space-y-1.5 ${bodyCls}`}>
          {prompt ? <p className="line-clamp-3 text-white/45">{prompt}</p> : null}
          {output ? <p className="line-clamp-6 whitespace-pre-wrap">{output}</p> : null}
        </div>
      ) : null}
      {unavailable ? (
        <p className={`mt-1.5 ${bodyCls}`} role="status">
          {AGENT_UNAVAILABLE_COPY}
        </p>
      ) : null}
    </div>
  )
}
