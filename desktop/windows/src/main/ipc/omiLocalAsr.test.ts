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
    stop: vi.fn(async () => {})
  }
  let callbacks: {
    onSegments: (sessionId: string, segments: unknown[]) => void
    onError: (sessionId: string, message: string, fatal: boolean) => void
    onSummary?: (sessionId: string, summary: string) => void
  } | null = null
  let capturedDeps: { summarizeTranscript?: (text: string) => Promise<string | null> } | null = null
  return {
    ipcHandlers,
    sent,
    managerCalls,
    getCallbacks: () => callbacks,
    setCallbacks: (c: typeof callbacks) => (callbacks = c),
    getCapturedDeps: () => capturedDeps,
    setCapturedDeps: (d: typeof capturedDeps) => (capturedDeps = d)
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
  defaultDeps: { ensureModelReady: vi.fn(), createEngine: vi.fn() },
  createLocalAsrManager: (
    cb: {
      onSegments: (sessionId: string, segments: unknown[]) => void
      onError: (sessionId: string, message: string, fatal: boolean) => void
      onSummary?: (sessionId: string, summary: string) => void
    },
    deps?: { summarizeTranscript?: (text: string) => Promise<string | null> }
  ) => {
    h.setCallbacks(cb)
    h.setCapturedDeps(deps ?? null)
    return h.managerCalls
  }
}))

vi.mock('../appSettings', () => ({ getAppSettings: vi.fn() }))
vi.mock('../inference/localLlmService', () => ({ summarizeTranscript: vi.fn() }))

import {
  isLocalAsrSessionOwnedBy,
  killLocalAsrSessionsForOwner,
  registerOmiLocalAsrHandlers
} from './omiLocalAsr'
import { getAppSettings } from '../appSettings'
import { summarizeTranscript } from '../inference/localLlmService'

const mockGetAppSettings = vi.mocked(getAppSettings)
const mockSummarizeTranscript = vi.mocked(summarizeTranscript)

const ipc = {
  start: (sessionId: string, ownerId = 1) =>
    h.ipcHandlers.get('omi-local-asr:start')!({ sender: { id: ownerId } }, sessionId),
  stop: (sessionId: string, ownerId = 1) =>
    h.ipcHandlers.get('omi-local-asr:stop')!(
      { sender: { id: ownerId } },
      sessionId
    ) as Promise<void>,
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
    mockGetAppSettings.mockReset()
    mockSummarizeTranscript.mockReset()
    // Default: the local-LLM Settings toggle is off, matching its real
    // appSettings default — most tests don't care about summarization.
    mockGetAppSettings.mockReturnValue({ localLlmSummaryEnabled: false } as ReturnType<
      typeof getAppSettings
    >)
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

  it('feed/finalize/stop from a window that does not own the session are ignored', async () => {
    ipc.start('s1', 7)
    ipc.feed('s1', 99)
    ipc.finalize('s1', 99)
    await ipc.stop('s1', 99)
    expect(h.managerCalls.feed).not.toHaveBeenCalled()
    expect(h.managerCalls.finalize).not.toHaveBeenCalled()
    expect(h.managerCalls.stop).not.toHaveBeenCalled()
    // The rightful owner can still use it — ownership wasn't corrupted.
    ipc.feed('s1', 7)
    expect(h.managerCalls.feed).toHaveBeenCalledWith('s1', expect.any(Int16Array))
  })

  it('stop from the owning window clears ownership and stops the manager session', async () => {
    ipc.start('s1', 7)
    await ipc.stop('s1', 7)
    expect(h.managerCalls.stop).toHaveBeenCalledWith('s1')
    expect(isLocalAsrSessionOwnedBy('s1', 7)).toBe(false)
  })

  it('keeps ownership until stop() (and its trailing summary/error) fully settles', async () => {
    // Regression coverage for the ordering bug this wiring must avoid: if
    // ownership were cleared BEFORE stop() resolves, a summary/error that
    // localAsrSession.ts emits asynchronously during stop() would route to
    // nobody (onSummary/onError both bail out on an unknown owner).
    let resolveStop: () => void = () => {}
    h.managerCalls.stop.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveStop = resolve))
    )
    ipc.start('s1', 7)
    const stopPromise = ipc.stop('s1', 7)
    expect(isLocalAsrSessionOwnedBy('s1', 7)).toBe(true) // still owned mid-stop
    resolveStop()
    await stopPromise
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

  it('routes onSummary from the manager back to the owning webContents', () => {
    ipc.start('s1', 7)
    const cb = h.getCallbacks()!
    cb.onSummary?.('s1', 'a short summary')

    expect(h.sent).toEqual([
      {
        ownerId: 7,
        channel: 'omi-local-asr:message',
        payload: { sessionId: 's1', kind: 'summary', summary: 'a short summary' }
      }
    ])
  })

  it('a fatal error clears ownership (mirrors a session that tore itself down)', () => {
    ipc.start('s1', 7)
    const cb = h.getCallbacks()!
    cb.onError('s1', 'model download failed', true)
    expect(isLocalAsrSessionOwnedBy('s1', 7)).toBe(false)
  })

  it('killLocalAsrSessionsForOwner stops every session owned by that webContents id', async () => {
    ipc.start('s1', 7)
    ipc.start('s2', 7)
    ipc.start('s3', 9)
    await killLocalAsrSessionsForOwner(7)
    expect(h.managerCalls.stop).toHaveBeenCalledWith('s1')
    expect(h.managerCalls.stop).toHaveBeenCalledWith('s2')
    expect(h.managerCalls.stop).not.toHaveBeenCalledWith('s3')
    expect(isLocalAsrSessionOwnedBy('s1', 7)).toBe(false)
    expect(isLocalAsrSessionOwnedBy('s3', 9)).toBe(true)
  })

  describe('the summarizeTranscript dep passed to createLocalAsrManager', () => {
    it('resolves null without calling the real summarizer when the Settings toggle is off', async () => {
      mockGetAppSettings.mockReturnValue({ localLlmSummaryEnabled: false } as ReturnType<
        typeof getAppSettings
      >)
      ipc.start('s1', 7) // triggers getManager(), which captures deps
      const deps = h.getCapturedDeps()!
      await expect(deps.summarizeTranscript!('hello')).resolves.toBeNull()
      expect(mockSummarizeTranscript).not.toHaveBeenCalled()
    })

    it('calls the real summarizer when the Settings toggle is on', async () => {
      mockGetAppSettings.mockReturnValue({ localLlmSummaryEnabled: true } as ReturnType<
        typeof getAppSettings
      >)
      mockSummarizeTranscript.mockResolvedValue('a real summary')
      ipc.start('s1', 7)
      const deps = h.getCapturedDeps()!
      await expect(deps.summarizeTranscript!('hello')).resolves.toBe('a real summary')
      expect(mockSummarizeTranscript).toHaveBeenCalledWith('hello')
    })
  })
})
