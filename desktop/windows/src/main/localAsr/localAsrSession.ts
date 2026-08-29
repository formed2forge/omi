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
//
// Post-hoc LLM convergence point: each flush's transcript text is also
// accumulated into the session's running transcript, and once the session
// STOPS (not merely finalizes — finalize only flushes buffered audio, the
// session keeps running), the full accumulated text is handed to
// `deps.summarizeTranscript` once, mirroring the conceptual shape of macOS's
// AppState+ListenEvents.swift `handleBackendSegments()` (accumulate live
// segments, then feed a downstream step once the utterance/session is done) —
// same shape, not ported code; that file is Swift, this is TypeScript, and
// macOS's downstream step is different. `summarizeTranscript` is optional:
// omitting it (the default) disables post-hoc summarization entirely, which
// is how the local-LLM Settings toggle gates this without localAsrSession
// itself knowing about app settings.
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
  /** Post-hoc "basic processing" step (localLlmService.ts's summarizeTranscript),
   *  invoked once with the session's full accumulated transcript when the
   *  session stops. Optional: omitted entirely disables summarization (e.g.
   *  the local-LLM Settings toggle is off) — callers gate this at the IPC
   *  layer, not with a flag threaded through here. Returning `null` means
   *  "nothing to report" (e.g. disabled at call time, or intentionally
   *  skipped) and is NOT treated as an error; a thrown/rejected error IS
   *  reported via `onError` (fatal=false) — a failed summary must never mask
   *  that the transcription itself succeeded. */
  summarizeTranscript?: (text: string) => Promise<string | null>
}

/** The production ensureModelReady/createEngine wiring, with no
 *  summarizeTranscript (post-hoc summarization is opt-in — see LocalAsrDeps).
 *  Exported so callers that DO want summarization (omiLocalAsr.ts) can spread
 *  this rather than re-deriving the ASR-engine wiring themselves. */
export const defaultDeps: LocalAsrDeps = {
  ensureModelReady: ensureModelReadyDefault,
  createEngine: createMoonshineEngine
}

export type LocalAsrCallbacks = {
  onSegments: (sessionId: string, segments: BackendSegment[]) => void
  /** fatal=false means the session is still alive (a single flush failed and was
   *  dropped); fatal=true means the session already tore itself down. */
  onError: (sessionId: string, message: string, fatal: boolean) => void
  /** Called once per session, after `stop()`, with the post-hoc LLM summary of
   *  the full transcript — only when `deps.summarizeTranscript` is configured
   *  and it resolved a non-null summary. Optional: omit if the caller doesn't
   *  care about summaries (mirrors summarizeTranscript being optional). */
  onSummary?: (sessionId: string, summary: string) => void
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
  /** Every flush's non-empty transcribed text, in order — joined into one
   *  string and handed to `deps.summarizeTranscript` on stop(). */
  transcriptParts: string[]
}

export type LocalAsrManager = {
  start: (sessionId: string) => void
  feed: (sessionId: string, pcm: Int16Array) => void
  /** Flush whatever is buffered right now (no-op on an empty buffer). */
  finalize: (sessionId: string) => void
  /** Tears the session down synchronously (feed/finalize become no-ops before
   *  this returns), then — if `deps.summarizeTranscript` is configured and the
   *  session produced any transcript — awaits the post-hoc summarization
   *  attempt and delivers its result via `onSummary`/`onError` before the
   *  returned promise settles. Callers that route summary/error events by a
   *  session-owner mapping (see omiLocalAsr.ts) must keep that mapping alive
   *  until this promise settles, not delete it right after calling stop(). */
  stop: (sessionId: string) => Promise<void>
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
      s.transcriptParts.push(text)
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
      stopped: false,
      transcriptParts: []
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

  function stop(sessionId: string): Promise<void> {
    const s = sessions.get(sessionId)
    if (!s) return Promise.resolve()
    s.stopped = true
    if (s.flushTimer) clearInterval(s.flushTimer)
    clearBuffer(s)
    sessions.delete(sessionId)
    void s.engine?.dispose()

    if (!deps.summarizeTranscript || s.transcriptParts.length === 0) return Promise.resolve()

    const fullText = s.transcriptParts.join(' ')
    return deps
      .summarizeTranscript(fullText)
      .then((summary) => {
        if (summary) cb.onSummary?.(sessionId, summary)
      })
      .catch((e) => {
        cb.onError(sessionId, `local LLM summarization failed: ${(e as Error).message}`, false)
      })
  }

  return { start, feed, finalize, stop }
}
