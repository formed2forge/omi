// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { AgentThreadCard } from './AgentThreadCard'
import { AGENT_UNAVAILABLE_COPY } from '../../lib/chat/agentTimeline'
import type { AgentThreadCardBlock } from '../../../../shared/types'

afterEach(() => cleanup())

type SpawnBlock = Extract<AgentThreadCardBlock, { type: 'agentSpawn' }>
type CompletionBlock = Extract<AgentThreadCardBlock, { type: 'agentCompletion' }>

const spawn = (partial: Partial<Omit<SpawnBlock, 'type'>> = {}): SpawnBlock => ({
  type: 'agentSpawn',
  id: 'spawn-1',
  pillId: 'pill-1',
  sessionId: 'sess-1',
  runId: 'run-1',
  title: 'Build the report',
  objective: 'Assemble the weekly report',
  ...partial
})

const completion = (partial: Partial<Omit<CompletionBlock, 'type'>> = {}): CompletionBlock => ({
  type: 'agentCompletion',
  id: 'done-1',
  pillId: 'pill-1',
  sessionId: 'sess-1',
  runId: 'run-1',
  title: 'Build the report',
  promptSnippet: 'Assemble the weekly report',
  output: 'All done — sent.',
  status: 'succeeded',
  ...partial
})

describe('AgentThreadCard open-by-id', () => {
  it('calls onOpen with the block identity', () => {
    const onOpen = vi.fn()
    render(<AgentThreadCard block={spawn()} compact={false} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open background agent' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0]).toEqual({
      pillId: 'pill-1',
      sessionId: 'sess-1',
      runId: 'run-1'
    })
  })

  it('shows unavailable when open reports failure', () => {
    render(<AgentThreadCard block={spawn()} compact={false} onOpen={(_ref, done) => done(false)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open background agent' }))
    expect(screen.getByRole('status').textContent).toBe(AGENT_UNAVAILABLE_COPY)
    expect(screen.queryByRole('button', { name: 'Open background agent' })).toBeNull()
  })

  it('hides the link-out when the block has no identity', () => {
    render(
      <AgentThreadCard
        block={spawn({ pillId: undefined, sessionId: '', runId: '' })}
        compact
        onOpen={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Open background agent' })).toBeNull()
  })

  it('hides the link-out when onOpen is omitted', () => {
    render(<AgentThreadCard block={spawn()} compact={false} />)
    expect(screen.queryByRole('button', { name: 'Open background agent' })).toBeNull()
  })

  it('expands a completion card to show the output', () => {
    render(<AgentThreadCard block={completion()} compact={false} onOpen={vi.fn()} />)
    expect(screen.queryByText('All done — sent.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand agent output' }))
    expect(screen.getByText('All done — sent.')).not.toBeNull()
  })
})
