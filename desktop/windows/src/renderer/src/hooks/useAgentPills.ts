// The bar's live floating-agent-pill feed (B3). Faithful port of macOS'
// AgentPillsManager projection + per-run polling (upstream
// FloatingControlBar/AgentPill.swift): it reads the SAME canonical source the
// LLM does — `list_agent_sessions` filtered to `surfaceKind: 'floating_bar'` —
// merges rows through the pure B2 model (agentPills.ts), polls each active run's
// `get_agent_run` to refresh status + synthesize its own transcript, and applies
// the post-completion lifecycle (viewed-TTL expiry, soft-cap eviction).
//
// Two doors, both via the trusted-direct-control channel window.omi.agentControlCall:
//   - list_agent_sessions({ surfaceKind:'floating_bar', limit:50 }) → .floating_agent_pills
//   - get_agent_run({ runId }) → { run, session }   (per active pill)
//
// Fail-open everywhere: a rejected or unparseable door call keeps the current
// pills — it never throws into render. All timers are cleared on unmount.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  expireViewedFinished,
  isFinished,
  markViewed as markViewedPure,
  mergeProjectedPills,
  spawnCardToProjectionRow,
  trimForSoftCap,
  VIEWED_FINISHED_TTL_MS,
  type AgentPill,
  type PillProjectionRow
} from '../components/bar/agentPills'
import {
  retainTextForPills,
  runDetailFinalText,
  runDetailToProjectionRow,
  synthesizePillTranscript,
  type AgentRunDetail
} from '../components/bar/agentPillTranscript'
import type { AgentThreadCardMsg } from '../../../shared/types'
import type { ChatMsg } from './useChat'

// Both poll cadences mirror Mac's 2s canonical-run poll (AgentPill.swift:1775).
const LIST_POLL_MS = 2000
const RUN_POLL_MS = 2000
// Idle-burn fix: with NO pills on the bar (the common steady state — no agent
// running), the fast list poll is pure waste. Drop to a slow safety heartbeat and
// lean on the kernel's push (`onAgentCardEvent`, broadcast on run.queued) to
// re-arm the instant an agent appears. The heartbeat is a belt-and-suspenders
// backstop so a session can never be permanently missed even if a push is lost.
const IDLE_LIST_POLL_MS = 30_000
// After a spawn card push, the list poll can briefly return empty (the session
// row lands a beat later). Retry a few times before falling back to the idle
// heartbeat so Ask Omi never looks pill-less for the whole turn.
const SPAWN_LIST_RETRY_MS = [0, 250, 750, 1500, 3000] as const

export type AgentPillsApi = {
  /** The live pills, projection-merged + lifecycle-trimmed. */
  pills: AgentPill[]
  /** Stamp a finished pill viewed (arms its 10-min TTL). No-op while active. */
  markViewed: (id: string) => void
  /** Manually remove a pill from the bar (Mac dismiss → cleanup). */
  dismiss: (id: string) => void
  /** Force a list (+ active-run) poll now — e.g. when the bar flips to conversation. */
  refresh: () => void
  /** The client-synthesized transcript for a pill — its OWN messages, never the
   *  shared Omi thread (INV-CHAT-1). Empty when the pill is unknown. */
  transcriptFor: (id: string) => { messages: ChatMsg[]; sending: boolean }
}

/** A cheap structural signature of the render-affecting pill fields, so a poll
 *  that changed nothing does not churn a new array into state every 2s. */
function pillSig(p: AgentPill): string {
  return [
    p.id,
    p.displayStatus,
    p.title,
    p.latestActivity,
    p.completedAtMs,
    p.viewedAtMs,
    p.errorMessage
  ].join('')
}

function samePills(a: AgentPill[], b: AgentPill[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (pillSig(a[i]) !== pillSig(b[i])) return false
  }
  return true
}

async function callList(): Promise<PillProjectionRow[] | null> {
  try {
    const raw = await window.omi?.agentControlCall('list_agent_sessions', {
      surfaceKind: 'floating_bar',
      limit: 50
    })
    if (typeof raw !== 'string') return null
    const parsed = JSON.parse(raw) as { floating_agent_pills?: unknown }
    const rows = parsed.floating_agent_pills
    return Array.isArray(rows) ? (rows as PillProjectionRow[]) : null
  } catch {
    // Fail-open: a rejected/parse-failed list keeps the current pills.
    return null
  }
}

async function callRun(runId: string): Promise<AgentRunDetail | null> {
  try {
    const raw = await window.omi?.agentControlCall('get_agent_run', { runId })
    if (typeof raw !== 'string') return null
    const parsed = JSON.parse(raw) as AgentRunDetail & { ok?: boolean }
    if (parsed.ok === false) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Durably mark a pill's underlying run/session dismissed in the kernel — Mac's
 * "attention overrides" mechanism. `serializeAgentSessionsList` (controlTools.ts)
 * excludes dismissed `run:<id>` / `session:<id>` subjects from
 * `floating_agent_pills`, so once this commits the list poll never re-projects
 * the pill, and it stays gone across app restarts AND other windows (the override
 * lives in the kernel's SQLite `desktop_attention_overrides` table, a
 * main-process singleton). Without this, dismiss only mutated the renderer's
 * in-memory array and the very next 2s poll resurrected the pill.
 */
async function callDismissOverride(
  subjectKind: 'run' | 'session',
  subjectId: string
): Promise<void> {
  try {
    await window.omi?.agentControlCall('set_desktop_attention_override', {
      subjectKind,
      subjectId,
      dismissed: true
    })
  } catch {
    // Fail-open: the in-memory dismissed-set guard still hides the pill for this
    // session, and a later dismissal or poll reconciles. A failed durable write
    // only risks the pill reappearing after a restart — never a crash into render.
  }
}

// Upper bound on the in-memory dismissed-subject guard (below). It resets every
// session — the kernel override is the durable record — so this only caps a
// pathological single-session dismissal spree. Set iteration is insertion order,
// so evicting the first entry is FIFO.
const DISMISSED_GUARD_CAP = 500

function rememberDismissed(set: Set<string>, id: string): void {
  if (set.has(id)) return
  if (set.size >= DISMISSED_GUARD_CAP) {
    const oldest = set.values().next().value
    if (oldest !== undefined) set.delete(oldest)
  }
  set.add(id)
}

/** True when a freshly projected row was dismissed this session (by run or
 *  session id) before the kernel override took effect — used to drop it from an
 *  in-flight poll snapshot so a stale fetch can't re-create a just-dismissed pill. */
function isRowDismissed(dismissed: Set<string>, row: PillProjectionRow): boolean {
  return (
    (typeof row.runId === 'string' && dismissed.has(row.runId)) ||
    (typeof row.sessionId === 'string' && dismissed.has(row.sessionId))
  )
}

/**
 * @param activePillId The pill whose transcript is currently open (or null).
 *   It is protected from viewed-TTL expiry and soft-cap eviction while open.
 */
export function useAgentPills(activePillId: string | null): AgentPillsApi {
  const [pills, setPills] = useState<AgentPill[]>([])
  const [finalTextByPillId, setFinalTextByPillId] = useState<Record<string, string>>({})

  // Latest-refs so the once-registered interval closures read current values
  // without re-subscribing (which would restart the poll cadence).
  const pillsRef = useRef(pills)
  // eslint-disable-next-line react-hooks/refs -- latest-ref for interval closures
  pillsRef.current = pills
  const activePillIdRef = useRef(activePillId)
  // eslint-disable-next-line react-hooks/refs -- latest-ref for interval closures
  activePillIdRef.current = activePillId

  const applyListRows = useCallback((rows: PillProjectionRow[] | null): void => {
    if (rows === null) return
    const visibleRows = rows.filter((row) => !isRowDismissed(dismissedRef.current, row))
    const now = Date.now()
    setPills((prev) => {
      const merged = mergeProjectedPills(prev, visibleRows, now).pills
      const expired = expireViewedFinished(
        merged,
        now,
        VIEWED_FINISHED_TTL_MS,
        activePillIdRef.current
      )
      const trimmed = trimForSoftCap(expired, activePillIdRef.current)
      setFinalTextByPillId((textPrev) => retainTextForPills(textPrev, trimmed))
      return samePills(prev, trimmed) ? prev : trimmed
    })
  }, [])

  const runListPoll = useCallback(async (): Promise<void> => {
    const rows = await callList()
    applyListRows(rows)
  }, [applyListRows])

  const runRunPoll = useCallback(async (): Promise<void> => {
    const targets = pillsRef.current.filter((p) => !isFinished(p.displayStatus) && p.runId)
    await Promise.all(
      targets.map(async (pill) => {
        const detail = await callRun(pill.runId)
        if (detail === null) return
        const row = runDetailToProjectionRow(pill, detail)
        if (row && !isRowDismissed(dismissedRef.current, row)) {
          setPills((prev) => {
            const next = mergeProjectedPills(prev, [row], Date.now()).pills
            return samePills(prev, next) ? prev : next
          })
        }
        const finalText = runDetailFinalText(detail)
        setFinalTextByPillId((prev) =>
          prev[pill.id] === finalText ? prev : { ...prev, [pill.id]: finalText }
        )
      })
    )
  }, [])

  const refresh = useCallback((): void => {
    void runListPoll()
    void runRunPoll()
  }, [runListPoll, runRunPoll])

  const spawnRetryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const clearSpawnRetries = useCallback((): void => {
    for (const timer of spawnRetryTimersRef.current) clearTimeout(timer)
    spawnRetryTimersRef.current = []
  }, [])

  const scheduleSpawnListRetries = useCallback((): void => {
    clearSpawnRetries()
    for (const delayMs of SPAWN_LIST_RETRY_MS) {
      const timer = setTimeout(() => {
        void runListPoll()
        void runRunPoll()
      }, delayMs)
      spawnRetryTimersRef.current.push(timer)
    }
  }, [clearSpawnRetries, runListPoll, runRunPoll])

  const onSpawnCard = useCallback(
    (card: AgentThreadCardMsg): void => {
      if (card.block.type !== 'agentSpawn') return
      const row = spawnCardToProjectionRow({
        pillId: card.block.pillId ?? null,
        runId: card.block.runId,
        sessionId: card.block.sessionId,
        title: card.block.title,
        objective: card.block.objective,
        provider: card.block.provider ?? null,
        createdAtMs: card.createdAtMs
      })
      if (row && !isRowDismissed(dismissedRef.current, row)) {
        setPills((prev) => {
          const next = mergeProjectedPills(prev, [row], Date.now()).pills
          return samePills(prev, next) ? prev : next
        })
      }
      scheduleSpawnListRetries()
    },
    [scheduleSpawnListRetries]
  )

  // Run/session ids the user dismissed this session. The kernel override
  // (callDismissOverride) is the durable, restart-proof record; this in-memory
  // set is only a race guard, consulted synchronously by the list poll so a
  // snapshot fetched BEFORE the override committed can't re-create the pill.
  const dismissedRef = useRef<Set<string>>(new Set())

  // Drives the poll cadence: fast (2s) while any pill is on the bar, slow heartbeat
  // while empty. A boolean (not the pills array) so the poll effect re-runs only on
  // the empty⇆non-empty edge — never on every no-op poll, which would reset the
  // cadence (the reason the closures below read pills through a ref).
  const hasPills = pills.length > 0

  useEffect(() => {
    let cancelled = false

    const pollList = async (): Promise<void> => {
      if (cancelled) return
      await runListPoll()
    }
    const pollRuns = async (): Promise<void> => {
      if (cancelled) return
      await runRunPoll()
    }

    void pollList()
    void pollRuns()
    // With no pills on the bar, poll the list on a slow heartbeat instead of every
    // 2s, and skip the per-run timer entirely (it has nothing to refresh). A new
    // agent re-arms this via the kernel push below (which flips `hasPills` and
    // re-runs this effect at the fast cadence); the heartbeat only backstops a lost
    // push. With pills present, keep Mac's 2s cadence for both.
    const listTimer = setInterval(
      () => void pollList(),
      hasPills ? LIST_POLL_MS : IDLE_LIST_POLL_MS
    )
    const runTimer = hasPills ? setInterval(() => void pollRuns(), RUN_POLL_MS) : null
    // Kernel push: a background run reaching queued/terminal broadcasts an agent
    // card to every window. Seed the pill from the spawn card immediately, then
    // poll (with short retries) so list projection reconciles without waiting for
    // the idle heartbeat.
    const unsubCards = window.omi?.onAgentCardEvent?.((card) => {
      if (card?.block) onSpawnCard(card)
      void pollList()
      void pollRuns()
    })
    return () => {
      cancelled = true
      clearInterval(listTimer)
      if (runTimer) clearInterval(runTimer)
      clearSpawnRetries()
      unsubCards?.()
    }
  }, [hasPills, runListPoll, runRunPoll, onSpawnCard, clearSpawnRetries])

  const markViewed = useCallback((id: string): void => {
    setPills((prev) => markViewedPure(prev, id, Date.now()))
  }, [])

  const dismiss = useCallback((id: string): void => {
    // Persist the dismissal in the kernel so the list poll stops projecting this
    // pill (durable across restarts + windows), and seed the in-memory guard so
    // an already-in-flight poll can't resurrect it before that write lands. We
    // dismiss both the run and the session subject: the serializer's filter is an
    // OR over `run:<id>` / `session:<id>`, so covering both is resurrection-proof
    // even if the session's projected run changes. Dismissing the session is
    // intentionally pill-wide, not over-broad: a floating_bar session is created
    // per spawn, so it never hosts a second, unrelated pill.
    const pill = pillsRef.current.find((p) => p.id === id)
    if (pill?.runId) {
      rememberDismissed(dismissedRef.current, pill.runId)
      void callDismissOverride('run', pill.runId)
    }
    if (pill?.sessionId) {
      rememberDismissed(dismissedRef.current, pill.sessionId)
      void callDismissOverride('session', pill.sessionId)
    }
    setPills((prev) => prev.filter((p) => p.id !== id))
    setFinalTextByPillId((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const transcriptFor = useCallback(
    (id: string): { messages: ChatMsg[]; sending: boolean } => {
      const pill = pills.find((p) => p.id === id)
      if (!pill) return { messages: [], sending: false }
      return synthesizePillTranscript(pill, finalTextByPillId[id] ?? null)
    },
    [pills, finalTextByPillId]
  )

  return { pills, markViewed, dismiss, refresh, transcriptFor }
}
