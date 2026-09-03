// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { PushToTalkMicButton } from './PushToTalkMicButton'

afterEach(cleanup)

describe('PushToTalkMicButton', () => {
  it('click always fires — even while blocked, so the usage popup can surface', () => {
    const onClick = vi.fn()
    render(<PushToTalkMicButton state="blocked" onClick={onClick} />)
    const btn = screen.getByTestId('push-to-talk-mic')
    expect((btn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(/monthly message limit/i)).toBeTruthy()
  })

  it('idle click starts; listening marks the control selected', () => {
    const onClick = vi.fn()
    const { rerender } = render(<PushToTalkMicButton state="idle" onClick={onClick} />)
    fireEvent.click(screen.getByLabelText('Start voice input'))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<PushToTalkMicButton state="listening" onClick={onClick} level={0.6} />)
    expect(screen.getByLabelText('Stop voice input and send').getAttribute('aria-pressed')).toBe(
      'true'
    )
  })
})
