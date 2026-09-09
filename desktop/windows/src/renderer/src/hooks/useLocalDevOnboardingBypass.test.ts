// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup, waitFor } from '@testing-library/react'

const firebaseMock = vi.hoisted(() => ({
  localDevOnboardingBypassActive: false,
  signInWithLocalDevOnboardingBypass: vi.fn()
}))

const suppressionMock = vi.hoisted(() => ({
  isLocalDevOnboardingBypassSuppressed: vi.fn()
}))

vi.mock('../lib/firebase', () => firebaseMock)
vi.mock('../lib/localDevOnboardingBypassState', () => suppressionMock)

import { useLocalDevOnboardingBypass } from './useLocalDevOnboardingBypass'

const fakeUser = { uid: 'local_dev_fixture' } as unknown as import('firebase/auth').User
const pricingUidAUser = { uid: 'pricing_plus' } as unknown as import('firebase/auth').User

beforeEach(() => {
  firebaseMock.localDevOnboardingBypassActive = false
  firebaseMock.signInWithLocalDevOnboardingBypass.mockReset().mockResolvedValue(fakeUser)
  suppressionMock.isLocalDevOnboardingBypassSuppressed.mockReset().mockReturnValue(false)
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

  it('auto-bootstraps exactly once on a fresh profile — active, not loading, signed out, not suppressed', async () => {
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

  it('regression: does NOT auto-sign-in again after an explicit sign-out from a pricing uid', async () => {
    // Reproduces the reported bug in reverse: signing out of pricing_plus must
    // leave the tester signed out, never silently resurrect the fixture.
    firebaseMock.localDevOnboardingBypassActive = true
    const { rerender } = renderHook(
      ({ user, loading }) => useLocalDevOnboardingBypass(user, loading),
      {
        initialProps: {
          user: pricingUidAUser as import('firebase/auth').User | null,
          loading: false
        }
      }
    )
    expect(firebaseMock.signInWithLocalDevOnboardingBypass).not.toHaveBeenCalled()

    // Explicit sign-out: firebase.ts's signOutUser sets the suppression flag
    // BEFORE the auth listener resolves to null — simulate that ordering.
    suppressionMock.isLocalDevOnboardingBypassSuppressed.mockReturnValue(true)
    rerender({ user: null, loading: false })

    // Let any (incorrect) async auto sign-in a chance to fire before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(firebaseMock.signInWithLocalDevOnboardingBypass).not.toHaveBeenCalled()
  })

  it('does not auto-sign-in on a fresh render when suppressed, even though active/signed-out/not-loading', () => {
    firebaseMock.localDevOnboardingBypassActive = true
    suppressionMock.isLocalDevOnboardingBypassSuppressed.mockReturnValue(true)
    renderHook(() => useLocalDevOnboardingBypass(null, false))
    expect(firebaseMock.signInWithLocalDevOnboardingBypass).not.toHaveBeenCalled()
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
