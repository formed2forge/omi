import { describe, it, expect, vi, beforeEach } from 'vitest'

// IPC-layer contract for the local ASR path — ownership gating mirrors
// omi-listen's (a command may only touch the session its own renderer opened),
// and message routing mirrors emit()'s webContents.fromId lookup. The actual
// buffering/inference (localAsrSession.ts) is mocked here — this suite is about
// the wiring, not the ASR logic (covered by localAsrSession.test.ts).

const h = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const sent: { ownerId: number; channel: string; payload: unknown }[] = []
  const managerCalls = {
    start: vi.fn(),
    feed: vi.fn(),
    finalize: vi.fn(),
    stop: vi.fn()
  }
  let callbacks: {
    onSegments: (sessionId: string, segments: unknown[]) => void
    onError: (sessionId: string, message: string, fatal: boolean) => void
  } | null = null
  return {
    ipcHandlers,
    sent,
    managerCalls,
    getCallbacks: () => callbacks,
    setCallbacks: (c: typeof callbacks) => (callbacks = c)
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown) => h.ipcHandlers.set(ch, fn),
    on: (ch: string, fn: (...args: unknown[]) => unknown) => h.ipcHandlers.set(ch, fn)
  },
  webContents: {
    fromId: (id: number) => ({
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => h.sent.push({ ownerId: id, channel, payload })
    })
  }
}))

vi.mock('../localAsr/localAsrSession', () => ({
  createLocalAsrManager: (cb: {
    onSegments: (sessionId: string, segments: unknown[]) => void
    onError: (sessionId: string, message: string, fatal: boolean) => void
  }) => {
    h.setCallbacks(cb)
    return h.managerCalls
  }
}))

import {
  isLocalAsrSessionOwnedBy,
  killLocalAsrSessionsForOwner,
  registerOmiLocalAsrHandlers
} from './omiLocalAsr'

const ipc = {
  start: (sessionId: string, ownerId = 1) =>
    h.ipcHandlers.get('omi-local-asr:start')!({ sender: { id: ownerId } }, sessionId),
  stop: (sessionId: string, ownerId = 1) =>
    h.ipcHandlers.get('omi-local-asr:stop')!({ sender: { id: ownerId } }, sessionId),
  feed: (sessionId: string, ownerId = 1) =>
    h.ipcHandlers.get('omi-local-asr:feed')!(
      { sender: { id: ownerId } },
      sessionId,
      new ArrayBuffer(4)
    ),
  finalize: (sessionId: string, ownerId = 1) =>
    h.ipcHandlers.get('omi-local-asr:finalize')!({ sender: { id: ownerId } }, sessionId)
}

describe('omiLocalAsr IPC', () => {
  beforeEach(() => {
    h.sent.length = 0
    h.managerCalls.start.mockClear()
    h.managerCalls.feed.mockClear()
    h.managerCalls.finalize.mockClear()
    h.managerCalls.stop.mockClear()
    registerOmiLocalAsrHandlers(() => true)
  })

  it('start records ownership and starts the manager session', () => {
    ipc.start('s1', 7)
    expect(h.managerCalls.start).toHaveBeenCalledWith('s1')
    expect(isLocalAsrSessionOwnedBy('s1', 7)).toBe(true)
  })

  it('rejects start when the caller is not allowed', () => {
    registerOmiLocalAsrHandlers(() => false)
    expect(() => ipc.start('s2', 1)).toThrow(/not allowed/)
  })

  it('feed/finalize/stop from a window that does not own the session are ignored', () => {
    ipc.start('s1', 7)
    ipc.feed('s1', 99)
    ipc.finalize('s1', 99)
    ipc.stop('s1', 99)
    expect(h.managerCalls.feed).not.toHaveBeenCalled()
    expect(h.managerCalls.finalize).not.toHaveBeenCalled()
    expect(h.managerCalls.stop).not.toHaveBeenCalled()
    // The rightful owner can still use it — ownership wasn't corrupted.
    ipc.feed('s1', 7)
    expect(h.managerCalls.feed).toHaveBeenCalledWith('s1', expect.any(Int16Array))
  })

  it('stop from the owning window clears ownership and stops the manager session', () => {
    ipc.start('s1', 7)
    ipc.stop('s1', 7)
    expect(h.managerCalls.stop).toHaveBeenCalledWith('s1')
    expect(isLocalAsrSessionOwnedBy('s1', 7)).toBe(false)
  })

  it('routes onSegments/onError from the manager back to the owning webContents', () => {
    ipc.start('s1', 7)
    const cb = h.getCallbacks()!
    cb.onSegments('s1', [{ text: 'hi' }])
    cb.onError('s1', 'boom', false)

    expect(h.sent).toEqual([
      {
        ownerId: 7,
        channel: 'omi-local-asr:message',
        payload: { sessionId: 's1', kind: 'segments', segments: [{ text: 'hi' }] }
      },
      {
        ownerId: 7,
        channel: 'omi-local-asr:message',
        payload: { sessionId: 's1', kind: 'error', message: 'boom', fatal: false }
      }
    ])
    // Non-fatal error: ownership survives so the session is still usable.
    expect(isLocalAsrSessionOwnedBy('s1', 7)).toBe(true)
  })

  it('a fatal error clears ownership (mirrors a session that tore itself down)', () => {
    ipc.start('s1', 7)
    const cb = h.getCallbacks()!
    cb.onError('s1', 'model download failed', true)
    expect(isLocalAsrSessionOwnedBy('s1', 7)).toBe(false)
  })

  it('killLocalAsrSessionsForOwner stops every session owned by that webContents id', () => {
    ipc.start('s1', 7)
    ipc.start('s2', 7)
    ipc.start('s3', 9)
    killLocalAsrSessionsForOwner(7)
    expect(h.managerCalls.stop).toHaveBeenCalledWith('s1')
    expect(h.managerCalls.stop).toHaveBeenCalledWith('s2')
    expect(h.managerCalls.stop).not.toHaveBeenCalledWith('s3')
    expect(isLocalAsrSessionOwnedBy('s1', 7)).toBe(false)
    expect(isLocalAsrSessionOwnedBy('s3', 9)).toBe(true)
  })
})
