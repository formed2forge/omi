// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup, waitFor } from '@testing-library/react'

const firebaseMock = vi.hoisted(() => ({
  localDevOnboardingBypassActive: false,
  signInWithLocalDevOnboardingBypass: vi.fn()
}))

vi.mock('../lib/firebase', () => firebaseMock)

import { useLocalDevOnboardingBypass } from './useLocalDevOnboardingBypass'

const fakeUser = { uid: 'local_dev_fixture' } as unknown as import('firebase/auth').User

beforeEach(() => {
  firebaseMock.localDevOnboardingBypassActive = false
  firebaseMock.signInWithLocalDevOnboardingBypass.mockReset().mockResolvedValue(fakeUser)
})

afterEach(() => {
  cleanup()
})

describe('useLocalDevOnboardingBypass', () => {
  it('never signs in when the bypass is inactive (production/normal case)', () => {
    renderHook(() => useLocalDevOnboardingBypass(null, false))
    expect(firebaseMock.signInWithLocalDevOnboardingBypass).not.toHaveBeenCalled()
  })

  it('does nothing while auth is still loading, even if the bypass is active', () => {
    firebaseMock.localDevOnboardingBypassActive = true
    renderHook(() => useLocalDevOnboardingBypass(null, true))
    expect(firebaseMock.signInWithLocalDevOnboardingBypass).not.toHaveBeenCalled()
  })

  it('does nothing once a user is already signed in', () => {
    firebaseMock.localDevOnboardingBypassActive = true
    renderHook(() => useLocalDevOnboardingBypass(fakeUser, false))
    expect(firebaseMock.signInWithLocalDevOnboardingBypass).not.toHaveBeenCalled()
  })

  it('auto-signs-in exactly once when active, not loading, and signed out', async () => {
    firebaseMock.localDevOnboardingBypassActive = true
    const { rerender } = renderHook(
      ({ user, loading }) => useLocalDevOnboardingBypass(user, loading),
      {
        initialProps: { user: null as import('firebase/auth').User | null, loading: false }
      }
    )
    await waitFor(() =>
      expect(firebaseMock.signInWithLocalDevOnboardingBypass).toHaveBeenCalledTimes(1)
    )

    // A re-render with the same (still signed-out) props must not retry.
    rerender({ user: null, loading: false })
    expect(firebaseMock.signInWithLocalDevOnboardingBypass).toHaveBeenCalledTimes(1)
  })

  it('auto-signs-in again after a sign-out that follows a successful auto sign-in', async () => {
    firebaseMock.localDevOnboardingBypassActive = true
    const { rerender } = renderHook(
      ({ user, loading }) => useLocalDevOnboardingBypass(user, loading),
      {
        initialProps: { user: null as import('firebase/auth').User | null, loading: false }
      }
    )
    await waitFor(() =>
      expect(firebaseMock.signInWithLocalDevOnboardingBypass).toHaveBeenCalledTimes(1)
    )

    // The auto sign-in resolves and useAuth reports the fixture as signed in.
    rerender({ user: fakeUser, loading: false })
    // The user signs out (e.g. via the sidebar sign-out control).
    rerender({ user: null, loading: false })

    await waitFor(() =>
      expect(firebaseMock.signInWithLocalDevOnboardingBypass).toHaveBeenCalledTimes(2)
    )
  })

  it('surfaces (logs) a failed auto sign-in without throwing', async () => {
    firebaseMock.localDevOnboardingBypassActive = true
    firebaseMock.signInWithLocalDevOnboardingBypass.mockRejectedValue(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() => useLocalDevOnboardingBypass(null, false))
    await waitFor(() => expect(errorSpy).toHaveBeenCalled())
    errorSpy.mockRestore()
  })
})
