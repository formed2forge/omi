import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLocalAsrManager, type LocalAsrDeps } from './localAsrSession'
import { ModelDownloadError } from './modelManager'
import type { AsrEngine } from './moonshineEngine'
import type { BackendSegment } from '../../shared/types'

// Synthetic 16kHz mono PCM — a handful of silent frames is enough; the engine
// itself is always a mock in this suite (no real inference), so content doesn't
// matter, only that it's a valid Int16Array.
function synthPcm(samples: number): Int16Array {
  return new Int16Array(samples)
}

function makeDeps(engine: AsrEngine): LocalAsrDeps {
  return {
    ensureModelReady: vi.fn(async () => '/fake/model/dir'),
    createEngine: vi.fn(() => engine)
  }
}

function fakeEngine(transcribe: AsrEngine['transcribe']): AsrEngine {
  return { transcribe, dispose: vi.fn(async () => {}) }
}

describe('localAsrSession', () => {
  let onSegments: ReturnType<typeof vi.fn>
  let onError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSegments = vi.fn()
    onError = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('buffers PCM, converts it to float32, and emits a BackendSegment on finalize', async () => {
    const transcribe = vi.fn(async (pcm: Float32Array) => {
      // Int16 32000 (all zero) → float32 all zero, length preserved.
      expect(pcm.length).toBe(32000)
      expect(pcm[0]).toBe(0)
      return { text: 'hello world' }
    })
    const deps = makeDeps(fakeEngine(transcribe))
    const mgr = createLocalAsrManager({ onSegments, onError }, deps)

    mgr.start('s1')
    mgr.feed('s1', synthPcm(32000)) // 2s @ 16kHz
    // Let the injected ensureModelReady's microtask resolve before finalizing.
    await Promise.resolve()
    await Promise.resolve()
    mgr.finalize('s1')
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1))

    expect(onSegments).toHaveBeenCalledTimes(1)
    const [sessionId, segments] = onSegments.mock.calls[0] as [string, BackendSegment[]]
    expect(sessionId).toBe('s1')
    expect(segments).toEqual([{ text: 'hello world', is_user: true, start: 0, end: 2 }])
    expect(onError).not.toHaveBeenCalled()

    mgr.stop('s1')
  })

  it('does not run inference before the model is ready — buffers instead', async () => {
    let resolveModel: (dir: string) => void = () => {}
    const deps: LocalAsrDeps = {
      ensureModelReady: vi.fn(() => new Promise<string>((resolve) => (resolveModel = resolve))),
      createEngine: vi.fn(() => fakeEngine(vi.fn(async () => ({ text: 'late' }))))
    }
    const mgr = createLocalAsrManager({ onSegments, onError }, deps)

    mgr.start('s1')
    mgr.feed('s1', synthPcm(1600))
    mgr.finalize('s1') // model not ready yet — must be a no-op, not a crash
    await Promise.resolve()
    expect(onSegments).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    resolveModel('/fake/dir')
    await Promise.resolve()
    await Promise.resolve()
    mgr.finalize('s1')
    await vi.waitFor(() => expect(onSegments).toHaveBeenCalledTimes(1))

    mgr.stop('s1')
  })

  // Main error path 1: the on-demand model download fails.
  it('surfaces a non-fatal error when the model download fails, and stays usable', async () => {
    const deps: LocalAsrDeps = {
      ensureModelReady: vi.fn(async () => {
        throw new ModelDownloadError('encoder_model_quantized.onnx', 'ECONNRESET')
      }),
      createEngine: vi.fn()
    }
    const mgr = createLocalAsrManager({ onSegments, onError }, deps)

    mgr.start('s1')
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    const [sessionId, message, fatal] = onError.mock.calls[0] as [string, string, boolean]
    expect(sessionId).toBe('s1')
    expect(fatal).toBe(false)
    expect(message).toMatch(/encoder_model_quantized\.onnx/)

    // The session is still alive (fatal=false) — feeding/finalizing afterward
    // must not throw, even though there is no engine to run.
    expect(() => mgr.feed('s1', synthPcm(1600))).not.toThrow()
    expect(() => mgr.finalize('s1')).not.toThrow()
    expect(deps.createEngine).not.toHaveBeenCalled()

    mgr.stop('s1')
  })

  // Main error path 2: inference itself fails on an otherwise-ready session.
  it('surfaces a non-fatal error when transcription fails, and recovers on the next flush', async () => {
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new Error('onnxruntime crashed'))
      .mockResolvedValueOnce({ text: 'recovered' })
    const deps = makeDeps(fakeEngine(transcribe))
    const mgr = createLocalAsrManager({ onSegments, onError }, deps)

    mgr.start('s1')
    await Promise.resolve()
    await Promise.resolve()

    mgr.feed('s1', synthPcm(1600))
    mgr.finalize('s1')
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError).toHaveBeenCalledWith('s1', expect.stringMatching(/onnxruntime crashed/), false)
    expect(onSegments).not.toHaveBeenCalled()

    // The buffer was cleared after the failed flush, so this is fresh audio, not
    // a re-send of the audio that failed.
    mgr.feed('s1', synthPcm(1600))
    mgr.finalize('s1')
    await vi.waitFor(() => expect(onSegments).toHaveBeenCalledTimes(1))

    mgr.stop('s1')
  })

  it('start is idempotent for an already-running session id', async () => {
    const deps = makeDeps(fakeEngine(vi.fn(async () => ({ text: 'x' }))))
    const mgr = createLocalAsrManager({ onSegments, onError }, deps)
    mgr.start('s1')
    mgr.start('s1')
    expect(deps.ensureModelReady).toHaveBeenCalledTimes(1)
    mgr.stop('s1')
  })

  it('stop tears the session down: later feed/finalize are no-ops', async () => {
    const transcribe = vi.fn(async () => ({ text: 'x' }))
    const deps = makeDeps(fakeEngine(transcribe))
    const mgr = createLocalAsrManager({ onSegments, onError }, deps)
    mgr.start('s1')
    await Promise.resolve()
    await Promise.resolve()
    mgr.stop('s1')

    mgr.feed('s1', synthPcm(1600))
    mgr.finalize('s1')
    await Promise.resolve()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('an empty transcription (silence) is dropped, not emitted as a blank segment', async () => {
    const transcribe = vi.fn(async () => ({ text: '' }))
    const deps = makeDeps(fakeEngine(transcribe))
    const mgr = createLocalAsrManager({ onSegments, onError }, deps)
    mgr.start('s1')
    await Promise.resolve()
    await Promise.resolve()
    mgr.feed('s1', synthPcm(1600))
    mgr.finalize('s1')
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1))
    expect(onSegments).not.toHaveBeenCalled()
    mgr.stop('s1')
  })

  it('flushes automatically once the buffer crosses the periodic-flush cadence', async () => {
    vi.useFakeTimers()
    const transcribe = vi.fn(async () => ({ text: 'periodic' }))
    const deps = makeDeps(fakeEngine(transcribe))
    const mgr = createLocalAsrManager({ onSegments, onError }, deps)

    mgr.start('s1')
    // Flush ensureModelReady's microtask under fake timers.
    await vi.advanceTimersByTimeAsync(0)
    mgr.feed('s1', synthPcm(1600))
    await vi.advanceTimersByTimeAsync(4000)

    expect(transcribe).toHaveBeenCalledTimes(1)
    mgr.stop('s1')
  })
})
