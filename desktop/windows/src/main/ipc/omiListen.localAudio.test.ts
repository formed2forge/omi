import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Local-audio persistence (Core free-tier mechanism, dev-toggle gated) is
// ADDITIVE to the existing Deepgram STT WebSocket lane: this suite proves the
// wiring in omiListen.ts writes the SAME fed PCM bytes to a local WAV file,
// namespaced by conversation id, and finalizes it on session teardown —
// entirely independent of whatever the (fake) WebSocket does.

const dir = mkdtempSync(join(tmpdir(), 'omi-listen-localaudio-'))

const h = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  class FakeWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    static instances: FakeWebSocket[] = []
    readyState = FakeWebSocket.CONNECTING
    binaryType = ''
    sent: unknown[] = []
    private listeners = new Map<string, Listener[]>()
    constructor(public url: string) {
      FakeWebSocket.instances.push(this)
    }
    on(ev: string, fn: Listener): void {
      const arr = this.listeners.get(ev) ?? []
      arr.push(fn)
      this.listeners.set(ev, arr)
    }
    send(data: unknown): void {
      this.sent.push(data)
    }
    close(): void {
      this.readyState = FakeWebSocket.CLOSED
      for (const fn of this.listeners.get('close') ?? []) fn(1000, Buffer.from(''))
    }
    simulateOpen(): void {
      this.readyState = FakeWebSocket.OPEN
      for (const fn of this.listeners.get('open') ?? []) fn()
    }
  }
  const ipcHandlers = new Map<string, (...args: unknown[]) => void>()
  return { FakeWebSocket, ipcHandlers }
})

vi.mock('ws', () => ({ default: h.FakeWebSocket }))
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => void) => h.ipcHandlers.set(ch, fn),
    on: (ch: string, fn: (...args: unknown[]) => void) => h.ipcHandlers.set(ch, fn)
  },
  webContents: {
    fromId: () => ({ isDestroyed: () => false, send: () => {} })
  }
}))

import { getAppSettings, setAppSettings, _resetForTests } from '../appSettings'
import { registerOmiListenHandlers } from './omiListen'
import { isLocalAudioRecordingActive } from '../localAudio/localAudioStore'

const ipc = {
  start: (sessionId: string, clientConversationId?: string, ownerId = 1) =>
    h.ipcHandlers.get('omi-listen:start')!(
      { sender: { id: ownerId, once: vi.fn() } },
      {
        sessionId,
        token: 'tok',
        language: 'en',
        source: 'mic',
        mode: 'conversation',
        deviceIdHash: 'abcd1234',
        clientConversationId
      }
    ),
  feed: (sessionId: string, pcm: ArrayBuffer, ownerId = 1) =>
    h.ipcHandlers.get('omi-listen:feed')!({ sender: { id: ownerId } }, sessionId, pcm),
  stop: (sessionId: string, ownerId = 1) =>
    h.ipcHandlers.get('omi-listen:stop')!({ sender: { id: ownerId } }, sessionId)
}

function lastWs(): InstanceType<typeof h.FakeWebSocket> {
  return h.FakeWebSocket.instances[h.FakeWebSocket.instances.length - 1]
}

beforeAll(() => {
  registerOmiListenHandlers(() => true)
})

afterEach(() => {
  _resetForTests()
  try {
    rmSync(join(dir, 'app-settings.json'), { force: true })
  } catch {
    /* ignore */
  }
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('local-audio persistence wiring (dev toggle)', () => {
  it('does nothing when the dev toggle is off (default)', () => {
    expect(getAppSettings().localAudioPersistenceEnabled).toBe(false)
    ipc.start('sess-off', 'conv-off')
    ipc.feed('sess-off', new Int16Array([1, 2, 3]).buffer)
    ipc.stop('sess-off')
    expect(existsSync(join(dir, 'local-audio'))).toBe(false)
  })

  it('writes fed PCM to a local WAV file namespaced by conversation id, and finalizes it on stop', () => {
    setAppSettings({ localAudioPersistenceEnabled: true })

    ipc.start('sess-1', 'conv-123')
    expect(isLocalAudioRecordingActive('sess-1')).toBe(true)

    const chunkA = new Int16Array([1, 2, 3, 4]).buffer
    const chunkB = new Int16Array([5, 6]).buffer
    ipc.feed('sess-1', chunkA)
    ipc.feed('sess-1', chunkB)

    // Independent of the cloud-STT socket's state — no 'open' was simulated, so
    // nothing was sent over the WebSocket, yet local persistence still happened.
    expect(lastWs().sent).toHaveLength(0)

    ipc.stop('sess-1')
    expect(isLocalAudioRecordingActive('sess-1')).toBe(false)

    const path = join(dir, 'local-audio', 'conv-123__sess-1.wav')
    expect(existsSync(path)).toBe(true)
    const onDisk = readFileSync(path)
    expect(onDisk.readUInt32LE(40)).toBe(chunkA.byteLength + chunkB.byteLength) // WAV data-size header
    expect(onDisk.byteLength).toBe(44 + chunkA.byteLength + chunkB.byteLength)
  })

  it('finalizes local audio on a natural socket close too, not only on explicit stop', () => {
    setAppSettings({ localAudioPersistenceEnabled: true })

    ipc.start('sess-2', 'conv-456')
    ipc.feed('sess-2', new Int16Array([9, 9]).buffer)
    lastWs().close() // natural close, NOT ipc.stop()

    expect(isLocalAudioRecordingActive('sess-2')).toBe(false)
    expect(existsSync(join(dir, 'local-audio', 'conv-456__sess-2.wav'))).toBe(true)
  })
})
