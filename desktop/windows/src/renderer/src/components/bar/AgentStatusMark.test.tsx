// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentStatusMark } from './AgentStatusMark'

afterEach(() => cleanup())

describe('AgentStatusMark', () => {
  it('renders a status-colored orb by default', () => {
    render(<AgentStatusMark displayStatus="done" />)
    const mark = screen.getByTestId('agent-status-mark')
    expect(mark.getAttribute('data-agent-status')).toBe('done')
    expect(mark.className).toContain('rounded-full')
  })

  it('masks Hermes/OpenClaw logos to the status color', () => {
    render(<AgentStatusMark displayStatus="running" provider="hermes" />)
    const mark = screen.getByTestId('agent-status-mark')
    expect(mark.getAttribute('data-agent-status')).toBe('running')
    expect(mark.className).not.toContain('rounded-full')
    expect(mark.querySelector('[style*="mask"]')).toBeTruthy()
  })

  it('pulses while queued or running by default', () => {
    const { rerender } = render(<AgentStatusMark displayStatus="queued" />)
    expect(screen.getByTestId('agent-status-mark').className).toContain('animate-pulse')
    rerender(<AgentStatusMark displayStatus="done" />)
    expect(screen.getByTestId('agent-status-mark').className).not.toContain('animate-pulse')
  })
})
