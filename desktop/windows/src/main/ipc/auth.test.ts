import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Capture ipcMain.handle registrations so tests can invoke them directly,
// mirroring the pattern in shortcuts.test.ts (vi.mock('electron', ...)).
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: (): string => '/tmp' },
  shell: { openExternal: vi.fn() },
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void => {
      handlers.set(channel, listener)
    }
  }
}))

vi.mock('fs', () => ({ appendFileSync: vi.fn() }))

const startSignIn = vi.hoisted(() => vi.fn())
vi.mock('../auth/signInFlow', () => ({ startSignIn }))

const requestLocalDevCustomToken = vi.hoisted(() => vi.fn())
vi.mock('../auth/localDevAuth', async () => {
  const actual =
    await vi.importActual<typeof import('../auth/localDevAuth')>('../auth/localDevAuth')
  return { ...actual, requestLocalDevCustomToken }
})

import { registerAuthHandlers } from './auth'

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return handler({}, ...args)
}

let onSignedIn: ReturnType<typeof vi.fn>

beforeEach(() => {
  handlers.clear()
  startSignIn.mockReset()
  requestLocalDevCustomToken.mockReset()
  onSignedIn = vi.fn()
  registerAuthHandlers(onSignedIn)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('auth:signIn (OAuth) — unaffected by the local-dev handler existing', () => {
  it('still resolves the provider sign-in and surfaces the window on success', async () => {
    startSignIn.mockResolvedValue({ ok: true, customToken: 'CT' })
    const result = await invoke('auth:signIn', 'google')
    expect(result).toEqual({ ok: true, customToken: 'CT' })
    expect(onSignedIn).toHaveBeenCalledOnce()
  })

  it('rejects an unsupported provider without calling startSignIn', async () => {
    const result = await invoke('auth:signIn', 'github')
    expect(result).toEqual({ ok: false, error: 'Unsupported sign-in provider' })
    expect(startSignIn).not.toHaveBeenCalled()
  })
})

describe('auth:signInLocalDev — profile gate', () => {
  it('refuses outside local_dev even with a well-formed uid, and never calls the backend', async () => {
    vi.stubEnv('VITE_OMI_APP_PROFILE', 'production')
    const result = await invoke('auth:signInLocalDev', 'pricing_plus')
    expect(result).toEqual({
      ok: false,
      error: 'Local development sign-in is only available in the local_dev profile.'
    })
    expect(requestLocalDevCustomToken).not.toHaveBeenCalled()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('refuses when the profile is unset (the default/production case)', async () => {
    vi.stubEnv('VITE_OMI_APP_PROFILE', undefined)
    const result = await invoke('auth:signInLocalDev', 'pricing_plus')
    expect((result as { ok: boolean }).ok).toBe(false)
    expect(requestLocalDevCustomToken).not.toHaveBeenCalled()
  })
})

describe('auth:signInLocalDev — local_dev profile', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OMI_APP_PROFILE', 'local_dev')
  })

  it('sanitizes the uid and rejects an invalid one without calling the backend', async () => {
    const result = await invoke('auth:signInLocalDev', 'pricing plus; rm -rf')
    expect(result).toEqual({
      ok: false,
      error: 'UID must be 1-128 characters: letters, numbers, "_" or "-".'
    })
    expect(requestLocalDevCustomToken).not.toHaveBeenCalled()
  })

  it('rejects a non-string uid', async () => {
    const result = await invoke('auth:signInLocalDev', 42)
    expect((result as { ok: boolean }).ok).toBe(false)
    expect(requestLocalDevCustomToken).not.toHaveBeenCalled()
  })

  it('exchanges a valid uid for a custom token and surfaces the window', async () => {
    requestLocalDevCustomToken.mockResolvedValue({ customToken: 'CT', uid: 'pricing_plus' })
    const result = await invoke('auth:signInLocalDev', '  pricing_plus  ')
    expect(requestLocalDevCustomToken).toHaveBeenCalledWith(expect.any(String), 'pricing_plus')
    expect(result).toEqual({ ok: true, customToken: 'CT' })
    expect(onSignedIn).toHaveBeenCalledOnce()
  })

  it('surfaces a backend failure without surfacing the window', async () => {
    requestLocalDevCustomToken.mockRejectedValue(
      new Error('Local development sign-in failed (404)')
    )
    const result = await invoke('auth:signInLocalDev', 'pricing_plus')
    expect(result).toEqual({ ok: false, error: 'Local development sign-in failed (404)' })
    expect(onSignedIn).not.toHaveBeenCalled()
  })
})
