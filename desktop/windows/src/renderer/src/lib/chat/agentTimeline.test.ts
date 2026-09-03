import { describe, it, expect } from 'vitest'
import type { AgentThreadCardMsg } from '../../../../shared/types'
import type { AgentPill } from '../../components/bar/agentPills'
import {
  AGENT_UNAVAILABLE_COPY,
  agentCardPreviewText,
  agentPreviewText,
  cardToProjectionRow,
  findPill,
  hasTimelineIdentity,
  hydrateKeys,
  refFromAgentCardBlock
} from './agentTimeline'

const pill = (partial: Partial<AgentPill> = {}): AgentPill => ({
  id: 'pill-1',
  runId: 'run-1',
  sessionId: 'sess-1',
  title: 'Build the report',
  displayStatus: 'running',
  latestActivity: '',
  query: 'assemble the weekly report',
  createdAtMs: 1000,
  completedAtMs: null,
  errorMessage: null,
  provider: null,
  viewedAtMs: null,
  ...partial
})

describe('hydrateKeys', () => {
  it('orders run → session → pill and drops blanks', () => {
    expect(
      hydrateKeys({
        pillId: '  pill-1  ',
        sessionId: '',
        runId: 'run-1'
      })
    ).toEqual([
      { kind: 'runId', value: 'run-1' },
      { kind: 'pillId', value: 'pill-1' }
    ])
  })

  it('is empty when every field is missing', () => {
    expect(hydrateKeys({})).toEqual([])
    expect(hasTimelineIdentity({ pillId: '  ', sessionId: null })).toBe(false)
  })
})

describe('findPill', () => {
  const pills = [
    pill(),
    pill({ id: 'pill-2', runId: 'run-2', sessionId: 'sess-2', title: 'Other' })
  ]

  it('matches runId before a conflicting pillId', () => {
    const found = findPill(pills, { pillId: 'pill-2', runId: 'run-1' })
    expect(found?.id).toBe('pill-1')
  })

  it('falls back to session then pill', () => {
    expect(findPill(pills, { sessionId: 'sess-2' })?.id).toBe('pill-2')
    expect(findPill(pills, { pillId: 'pill-2' })?.id).toBe('pill-2')
  })

  it('returns null when nothing matches', () => {
    expect(findPill(pills, { runId: 'missing' })).toBeNull()
    expect(findPill(pills, {})).toBeNull()
  })
})

describe('cardToProjectionRow', () => {
  it('projects a spawn card into a queued floating-bar row', () => {
    const card: AgentThreadCardMsg = {
      chatId: 'default',
      createdAtMs: 50,
      block: {
        type: 'agentSpawn',
        id: 'spawn-1',
        pillId: 'pill-1',
        sessionId: 'sess-1',
        runId: 'run-1',
        title: 'Build the report',
        objective: 'Assemble the weekly report'
      }
    }
    expect(cardToProjectionRow(card)).toEqual({
      id: 'pill-1',
      runId: 'run-1',
      sessionId: 'sess-1',
      title: 'Build the report',
      status: 'queued',
      latestActivity: 'Assemble the weekly report',
      query: 'Assemble the weekly report',
      createdAtMs: 50,
      completedAtMs: null,
      provider: null,
      errorCode: null,
      errorMessage: null
    })
  })

  it('maps a failed completion onto a terminal failed row', () => {
    const card: AgentThreadCardMsg = {
      chatId: 'default',
      createdAtMs: 90,
      block: {
        type: 'agentCompletion',
        id: 'done-1',
        pillId: 'pill-1',
        sessionId: 'sess-1',
        runId: 'run-1',
        title: 'Build the report',
        promptSnippet: 'Assemble the weekly report',
        output: 'it broke',
        status: 'failed'
      }
    }
    const row = cardToProjectionRow(card)
    expect(row?.status).toBe('failed')
    expect(row?.errorMessage).toBe('it broke')
    expect(row?.completedAtMs).toBe(90)
  })

  it('drops a card missing run or session identity', () => {
    const card: AgentThreadCardMsg = {
      chatId: 'default',
      createdAtMs: 1,
      block: {
        type: 'agentSpawn',
        id: 'spawn-1',
        sessionId: '',
        runId: '',
        title: 'x',
        objective: 'y'
      }
    }
    expect(cardToProjectionRow(card)).toBeNull()
  })
})

describe('agentCardPreviewText', () => {
  it('prefers the prompt over output', () => {
    expect(agentPreviewText('do the thing', 'finished')).toBe('do the thing')
    expect(agentPreviewText('', 'finished')).toBe('finished')
  })

  it('hides a preview the title already embeds', () => {
    expect(agentCardPreviewText('Delegated: write tests', 'write tests', '')).toBe('')
    expect(agentCardPreviewText('Background agent', 'write tests', '')).toBe('write tests')
  })
})

describe('refFromAgentCardBlock', () => {
  it('copies the three identity fields', () => {
    expect(refFromAgentCardBlock({ pillId: 'p', sessionId: 's', runId: 'r' })).toEqual({
      pillId: 'p',
      sessionId: 's',
      runId: 'r'
    })
  })
})

describe('unavailable copy', () => {
  it('matches the macOS card failure line', () => {
    expect(AGENT_UNAVAILABLE_COPY).toContain('dismissed')
  })
})
