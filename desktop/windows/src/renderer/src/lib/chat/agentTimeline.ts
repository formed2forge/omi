// Shared open-by-id identity for floating agent pills (INV-CHAT-1 / INV-6).
//
// Faithful port of macOS `AgentTimelineRef` + `AgentTimelineHydratePreference`
// (ChatProvider.swift). Prefer runId, then sessionId, then pillId. Used by
// Home cards, the bar conversation, and useAgentPills.resolveAndPresent — one
// identity, no second pill store.

import type { AgentThreadCardMsg } from '../../../../shared/types'
import type { AgentPill, PillProjectionRow } from '../../components/bar/agentPills'

export type AgentTimelineRef = {
  pillId?: string | null
  sessionId?: string | null
  runId?: string | null
}

export type AgentTimelineHydrateKey =
  | { kind: 'runId'; value: string }
  | { kind: 'sessionId'; value: string }
  | { kind: 'pillId'; value: string }

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Hydrate key order: run → session → pill (macOS AgentTimelineHydratePreference). */
export function hydrateKeys(ref: AgentTimelineRef): AgentTimelineHydrateKey[] {
  const keys: AgentTimelineHydrateKey[] = []
  const runId = nonEmpty(ref.runId)
  const sessionId = nonEmpty(ref.sessionId)
  const pillId = nonEmpty(ref.pillId)
  if (runId) keys.push({ kind: 'runId', value: runId })
  if (sessionId) keys.push({ kind: 'sessionId', value: sessionId })
  if (pillId) keys.push({ kind: 'pillId', value: pillId })
  return keys
}

export function hasTimelineIdentity(ref: AgentTimelineRef): boolean {
  return hydrateKeys(ref).length > 0
}

export function refFromAgentCardBlock(block: {
  pillId?: string
  sessionId?: string
  runId?: string
}): AgentTimelineRef {
  return {
    pillId: block.pillId ?? null,
    sessionId: block.sessionId ?? null,
    runId: block.runId ?? null
  }
}

/** First in-memory pill matching the hydrate preference. */
export function findPill(pills: readonly AgentPill[], ref: AgentTimelineRef): AgentPill | null {
  for (const key of hydrateKeys(ref)) {
    const match = pills.find((pill) => {
      if (key.kind === 'runId') return pill.runId === key.value
      if (key.kind === 'sessionId') return pill.sessionId === key.value
      return pill.id === key.value
    })
    if (match) return match
  }
  return null
}

const COMPLETION_TO_WIRE: Record<string, string> = {
  succeeded: 'succeeded',
  success: 'succeeded',
  done: 'succeeded',
  completed: 'completed',
  stopped: 'cancelled',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  failed: 'failed',
  error: 'failed',
  timed_out: 'timed_out',
  timeout: 'timed_out',
  orphaned: 'orphaned'
}

/** Project a shared-thread agent card into a bar pill row (eager upsert). */
export function cardToProjectionRow(card: AgentThreadCardMsg): PillProjectionRow | null {
  const block = card.block
  const runId = nonEmpty(block.runId)
  const sessionId = nonEmpty(block.sessionId)
  const id = nonEmpty(block.pillId) ?? runId
  if (!id || !runId || !sessionId) return null

  if (block.type === 'agentSpawn') {
    return {
      id,
      runId,
      sessionId,
      title: block.title,
      status: 'queued',
      latestActivity: block.objective,
      query: block.objective,
      createdAtMs: card.createdAtMs,
      completedAtMs: null,
      provider: null,
      errorCode: null,
      errorMessage: null
    }
  }

  const wire = COMPLETION_TO_WIRE[block.status.toLowerCase()] ?? 'failed'
  return {
    id,
    runId,
    sessionId,
    title: block.title,
    status: wire,
    latestActivity: block.output || block.promptSnippet,
    query: block.promptSnippet,
    createdAtMs: card.createdAtMs,
    completedAtMs: card.createdAtMs,
    provider: null,
    errorCode: null,
    errorMessage: wire === 'failed' ? block.output || 'Agent failed' : null
  }
}

/** Collapsed card preview: prompt/objective wins; output is expanded-body only.
 *  Empty when the title already embeds the prompt (macOS agentCardPreviewText). */
export function agentPreviewText(prompt: string, output: string): string {
  const trimmed = prompt.trim()
  if (trimmed) return trimmed
  return output.trim()
}

export function agentCardPreviewText(title: string, prompt: string, output: string): string {
  const preview = agentPreviewText(prompt, output)
  if (!preview) return ''
  const normalizedTitle = title.trim().toLowerCase()
  const normalizedPreview = preview.toLowerCase()
  return normalizedTitle.endsWith(normalizedPreview) ? '' : preview
}

export const AGENT_UNAVAILABLE_COPY = 'Agent unavailable — it may have been dismissed.'
