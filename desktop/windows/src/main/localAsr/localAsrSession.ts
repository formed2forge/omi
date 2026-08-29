// Local ASR session/buffering layer — structurally parallel to omiListen.ts's
// Session map, but there is no socket: instead of streaming PCM to a cloud
// WebSocket, we buffer it and periodically run it through an on-device AsrEngine.
// Produces the SAME BackendSegment shape the cloud v4/listen socket emits (see
// shared/types.ts), so a downstream consumer doesn't need to know which
// transcription source produced a segment (this task's compatibility requirement).
//
// Chunking: Moonshine's encoder takes a variable-length raw waveform (no fixed
// window), so we don't need overlapping/sliding windows — we simply accumulate
// PCM and flush (run inference on the whole accumulated buffer, then clear it) on
// a timer or on finalize/stop. This is the simplest correct design for "local ASR
// can produce transcript segments" scope; it does NOT preserve decoder context
// across flushes (each flush is an independent utterance to the model), which is
// a known limitation for later refinement (e.g. long silences mid-sentence would
// split across two segments) — acceptable for a capability-only first cut.
import { BackendSegment } from '../../shared/types'
import { ModelDownloadError, ensureModelReady as ensureModelReadyDefault } from './modelManager'
import { createMoonshineEngine, type AsrEngine } from './moonshineEngine'
import { SAMPLE_RATE } from './model'

/** Buffer at most this long before forcing a flush, so a continuously-speaking
 *  session still gets segments at a bounded cadence (matches the general shape of
 *  cloud STT emitting segments well before a full silence boundary). */
const FLUSH_INTERVAL_MS = 4000
/** Never buffer more than this much audio even if flush is somehow delayed
 *  (bounds worst-case memory + a single inference call's CPU time). */
const MAX_BUFFER_MS = 15000

export type LocalAsrDeps = {
  ensureModelReady: (
    onProgress?: (file: string, index: number, total: number) => void
  ) => Promise<string>
  createEngine: (modelDir: string) => AsrEngine
}

const defaultDeps: LocalAsrDeps = {
  ensureModelReady: ensureModelReadyDefault,
  createEngine: createMoonshineEngine
}

export type LocalAsrCallbacks = {
  onSegments: (sessionId: string, segments: BackendSegment[]) => void
  /** fatal=false means the session is still alive (a single flush failed and was
   *  dropped); fatal=true means the session already tore itself down. */
  onError: (sessionId: string, message: string, fatal: boolean) => void
}

type Chunk = { pcm: Int16Array; atMs: number }

type Session = {
  chunks: Chunk[]
  bufferedSamples: number
  startedAtMs: number
  /** Session-relative seconds already flushed — the next segment's `start`. */
  emittedThroughSec: number
  flushTimer: ReturnType<typeof setInterval> | null
  engine: AsrEngine | null
  modelState: 'loading' | 'ready' | 'unavailable'
  stopped: boolean
}

export type LocalAsrManager = {
  start: (sessionId: string) => void
  feed: (sessionId: string, pcm: Int16Array) => void
  /** Flush whatever is buffered right now (no-op on an empty buffer). */
  finalize: (sessionId: string) => void
  stop: (sessionId: string) => void
}

export function createLocalAsrManager(
  cb: LocalAsrCallbacks,
  deps: LocalAsrDeps = defaultDeps
): LocalAsrManager {
  const sessions = new Map<string, Session>()

  function loadModel(sessionId: string, s: Session): void {
    s.modelState = 'loading'
    deps
      .ensureModelReady()
      .then((dir) => {
        if (s.stopped) return
        s.engine = deps.createEngine(dir)
        s.modelState = 'ready'
      })
      .catch((e) => {
        if (s.stopped) return
        s.modelState = 'unavailable'
        const message =
          e instanceof ModelDownloadError ? e.message : `local ASR model unavailable: ${e.message}`
        cb.onError(sessionId, message, false)
      })
  }

  function bufferedMs(s: Session): number {
    return (s.bufferedSamples / SAMPLE_RATE) * 1000
  }

  function clearBuffer(s: Session): void {
    s.chunks = []
    s.bufferedSamples = 0
  }

  async function flush(sessionId: string, s: Session): Promise<void> {
    if (s.stopped || s.bufferedSamples === 0 || !s.engine) return
    const samples = s.bufferedSamples
    const pcm = new Int16Array(samples)
    let offset = 0
    for (const c of s.chunks) {
      pcm.set(c.pcm, offset)
      offset += c.pcm.length
    }
    const startSec = s.emittedThroughSec
    const endSec = startSec + samples / SAMPLE_RATE
    clearBuffer(s)
    s.emittedThroughSec = endSec

    const float32 = new Float32Array(samples)
    for (let i = 0; i < samples; i++) float32[i] = pcm[i] / 32768

    try {
      const { text } = await s.engine.transcribe(float32)
      if (s.stopped) return
      if (!text) return
      const segment: BackendSegment = {
        text,
        is_user: true,
        start: startSec,
        end: endSec
      }
      cb.onSegments(sessionId, [segment])
    } catch (e) {
      if (s.stopped) return
      cb.onError(sessionId, `local ASR inference failed: ${(e as Error).message}`, false)
    }
  }

  function start(sessionId: string): void {
    if (sessions.has(sessionId)) return // idempotent, mirrors AudioSessionHost
    const s: Session = {
      chunks: [],
      bufferedSamples: 0,
      startedAtMs: Date.now(),
      emittedThroughSec: 0,
      flushTimer: null,
      engine: null,
      modelState: 'loading',
      stopped: false
    }
    sessions.set(sessionId, s)
    s.flushTimer = setInterval(() => void flush(sessionId, s), FLUSH_INTERVAL_MS)
    s.flushTimer.unref?.()
    loadModel(sessionId, s)
  }

  function feed(sessionId: string, pcm: Int16Array): void {
    const s = sessions.get(sessionId)
    if (!s || s.stopped) return
    s.chunks.push({ pcm, atMs: Date.now() })
    s.bufferedSamples += pcm.length
    if (bufferedMs(s) >= MAX_BUFFER_MS) void flush(sessionId, s)
  }

  function finalize(sessionId: string): void {
    const s = sessions.get(sessionId)
    if (!s || s.stopped) return
    void flush(sessionId, s)
  }

  function stop(sessionId: string): void {
    const s = sessions.get(sessionId)
    if (!s) return
    s.stopped = true
    if (s.flushTimer) clearInterval(s.flushTimer)
    clearBuffer(s)
    sessions.delete(sessionId)
    void s.engine?.dispose()
  }

  return { start, feed, finalize, stop }
}
