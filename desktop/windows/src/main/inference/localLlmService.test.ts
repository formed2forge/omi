// Hermetic tests for the core inference-invocation logic. The real
// node-llama-cpp native binding is never imported/exercised here — a fake
// `EngineFactory`/`LlmEngine` stands in for it, per this repo's Definition of
// Done ("mock/stub the actual model inference call rather than requiring a
// real multi-GB model file and real compute in CI").
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  summarizeTranscript,
  ModelNotDownloadedError,
  InferenceError,
  InferenceTimeoutError,
  type LlmEngine,
  type EngineFactory
} from './localLlmService'
import type { LocalLlmModelSpec } from './localLlmConfig'

const dir = mkdtempSync(join(tmpdir(), 'omi-local-llm-service-'))

function makeSpec(): LocalLlmModelSpec {
  return {
    id: 'test-model',
    displayName: 'Test Model',
    fileName: 'test-model.gguf',
    url: 'https://example.invalid/test-model.gguf',
    sha256: 'irrelevant-for-this-suite',
    approxSizeBytes: 123,
    contextSize: 2048
  }
}

/** Mark `spec`'s weights as "downloaded" by dropping a placeholder file at the
 *  path modelStore.isModelDownloaded checks — no real model bytes needed. */
function markDownloaded(spec: LocalLlmModelSpec): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, spec.fileName), 'placeholder')
}

function fakeEngineFactory(engine: LlmEngine): EngineFactory {
  return vi.fn(async () => engine) as unknown as EngineFactory
}

describe('summarizeTranscript', () => {
  it('throws ModelNotDownloadedError, without constructing an engine, when the model is missing', async () => {
    const spec = makeSpec() // nothing written to `dir` for this spec's fileName
    rmSync(join(dir, spec.fileName), { force: true })
    const engineFactory = vi.fn()

    await expect(
      summarizeTranscript('hello', {
        modelSpec: spec,
        baseDir: dir,
        engineFactory: engineFactory as unknown as EngineFactory
      })
    ).rejects.toThrow(ModelNotDownloadedError)
    expect(engineFactory).not.toHaveBeenCalled()
  })

  it('runs the core path: builds a prompt from the transcript, generates, trims, and disposes the engine', async () => {
    const spec = makeSpec()
    markDownloaded(spec)
    const generate = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('hello world transcript') // the transcript reaches the prompt
      return '  A short summary.  \n'
    })
    const dispose = vi.fn()
    const engineFactory = fakeEngineFactory({ generate, dispose })

    const result = await summarizeTranscript('hello world transcript', {
      modelSpec: spec,
      baseDir: dir,
      engineFactory
    })

    expect(result).toBe('A short summary.') // trimmed
    expect(generate).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('wraps an engine/generation failure in InferenceError and still disposes the engine', async () => {
    const spec = makeSpec()
    markDownloaded(spec)
    const dispose = vi.fn()
    const engineFactory = fakeEngineFactory({
      generate: async () => {
        throw new Error('native generation crashed')
      },
      dispose
    })

    await expect(
      summarizeTranscript('t', { modelSpec: spec, baseDir: dir, engineFactory })
    ).rejects.toThrow(InferenceError)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('throws InferenceTimeoutError when generation does not finish in time, and still disposes the engine', async () => {
    const spec = makeSpec()
    markDownloaded(spec)
    const dispose = vi.fn()
    const engineFactory = fakeEngineFactory({
      // Never resolves on its own — only settles if the signal is aborted, so a
      // dropped abort() would hang this test instead of silently "passing".
      generate: (_prompt, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      dispose
    })

    await expect(
      summarizeTranscript('t', { modelSpec: spec, baseDir: dir, engineFactory, timeoutMs: 10 })
    ).rejects.toThrow(InferenceTimeoutError)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('still returns the result even when the engine fails to dispose cleanly', async () => {
    const spec = makeSpec()
    markDownloaded(spec)
    const engineFactory = fakeEngineFactory({
      generate: async () => 'fine',
      dispose: () => {
        throw new Error('dispose blew up')
      }
    })

    await expect(
      summarizeTranscript('t', { modelSpec: spec, baseDir: dir, engineFactory })
    ).resolves.toBe('fine')
  })
})
