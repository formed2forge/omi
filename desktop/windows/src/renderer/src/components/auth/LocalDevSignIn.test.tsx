// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

const firebaseMock = vi.hoisted(() => ({
  isLocalDevProfile: true,
  localDevConfigError: null as string | null,
  signInWithLocalDevToken: vi.fn()
}))

vi.mock('../../lib/firebase', () => firebaseMock)

import { LocalDevSignIn } from './LocalDevSignIn'

function uidInput(): HTMLInputElement {
  return screen.getByLabelText('Emulator UID') as HTMLInputElement
}

function submitButton(name = 'Sign In (Developer)'): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

beforeEach(() => {
  firebaseMock.isLocalDevProfile = true
  firebaseMock.localDevConfigError = null
  firebaseMock.signInWithLocalDevToken.mockReset().mockResolvedValue({ uid: 'pricing_plus' })
})

afterEach(() => {
  cleanup()
})

describe('LocalDevSignIn — profile gate', () => {
  it('renders nothing outside the local_dev profile', () => {
    firebaseMock.isLocalDevProfile = false
    const { container } = render(<LocalDevSignIn />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the control in the local_dev profile', () => {
    render(<LocalDevSignIn />)
    expect(screen.getByTestId('local-dev-sign-in')).not.toBeNull()
    expect(submitButton().textContent).toBe('Sign In (Developer)')
  })

  it('defaults the uid field to pricing_plus', () => {
    render(<LocalDevSignIn />)
    expect(uidInput().value).toBe('pricing_plus')
  })
})

describe('LocalDevSignIn — configuration error', () => {
  it('shows the configuration error and disables the control instead of a working button', () => {
    firebaseMock.localDevConfigError = 'VITE_OMI_API_BASE must not point at production.'
    render(<LocalDevSignIn />)
    expect(screen.getByText(/must not point at production/).textContent).toMatch(/must not point/)
    expect(submitButton().disabled).toBe(true)
    expect(uidInput().disabled).toBe(true)
  })
})

describe('LocalDevSignIn — sign-in flow', () => {
  it('validates the uid before calling the bridge', async () => {
    render(<LocalDevSignIn />)
    fireEvent.change(uidInput(), { target: { value: 'bad uid!' } })
    fireEvent.click(submitButton())
    await waitFor(() => expect(screen.getByText(/UID must be 1-128 characters/)).not.toBeNull())
    expect(firebaseMock.signInWithLocalDevToken).not.toHaveBeenCalled()
  })

  it('shows a loading state and signs in with the entered uid', async () => {
    let resolveSignIn: (v: unknown) => void = () => {}
    firebaseMock.signInWithLocalDevToken.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve
      })
    )
    render(<LocalDevSignIn />)
    fireEvent.change(uidInput(), { target: { value: 'pricing_pro_v2' } })
    fireEvent.click(submitButton())

    await waitFor(() => expect(submitButton('Signing in…').disabled).toBe(true))
    expect(firebaseMock.signInWithLocalDevToken).toHaveBeenCalledWith('pricing_pro_v2')

    resolveSignIn({ uid: 'pricing_pro_v2' })
    await waitFor(() => expect(submitButton().disabled).toBe(false))
  })

  it('surfaces a bridge/backend error and re-enables the control', async () => {
    firebaseMock.signInWithLocalDevToken.mockRejectedValue(
      new Error('Local development sign-in failed (404)')
    )
    render(<LocalDevSignIn />)
    fireEvent.click(submitButton())
    await waitFor(() =>
      expect(screen.getByText('Local development sign-in failed (404)')).not.toBeNull()
    )
    expect(submitButton().disabled).toBe(false)
  })

  it('trims whitespace and accepts any seeded pricing uid', async () => {
    render(<LocalDevSignIn />)
    fireEvent.change(uidInput(), { target: { value: '  pricing_unlimited_v2  ' } })
    fireEvent.click(submitButton())
    await waitFor(() =>
      expect(firebaseMock.signInWithLocalDevToken).toHaveBeenCalledWith('pricing_unlimited_v2')
    )
  })
})
