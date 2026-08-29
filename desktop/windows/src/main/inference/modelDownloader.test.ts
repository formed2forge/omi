// Hermetic tests for the on-demand model download: no real network call and no
// real multi-GB model file — `fetchImpl` is injected with a fake Response over
// an in-memory body, and everything is written under a throwaway tmpdir.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  ensureModelDownloaded,
  ModelConfigError,
  ModelDownloadError,
  deleteDownloadedModel
} from './modelDownloader'
import { isModelDownloaded, localLlmModelPath } from './modelStore'
import { UNVERIFIED_SHA256, type LocalLlmModelSpec } from './localLlmConfig'

const dir = mkdtempSync(join(tmpdir(), 'omi-local-llm-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** A small fake "model file" body, plus the spec that matches it. */
const FAKE_MODEL_BYTES = Buffer.from('fake-gguf-weights-not-a-real-model')

function makeSpec(overrides: Partial<LocalLlmModelSpec> = {}): LocalLlmModelSpec {
  return {
    id: 'test-model',
    displayName: 'Test Model',
    fileName: 'test-model.gguf',
    url: 'https://example.invalid/test-model.gguf',
    sha256: sha256Hex(FAKE_MODEL_BYTES),
    approxSizeBytes: FAKE_MODEL_BYTES.length,
    contextSize: 2048,
    ...overrides
  }
}

/** Build a fetch stand-in returning `body` with the given ok/status, matching
 *  the subset of the Response shape ensureModelDownloaded reads. */
function fakeFetch(body: Buffer, opts: { ok?: boolean; status?: number } = {}): typeof fetch {
  const ok = opts.ok ?? true
  const status = opts.status ?? (ok ? 200 : 500)
  return vi.fn(async () => ({
    ok,
    status,
    headers: new Headers({ 'content-length': String(body.length) }),
    body: ok
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(body))
            controller.close()
          }
        })
      : null
  })) as unknown as typeof fetch
}

describe('ensureModelDownloaded', () => {
  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is a no-op and never calls fetch when a verified copy already exists', async () => {
    const spec = makeSpec()
    const path = localLlmModelPath(spec, dir)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, FAKE_MODEL_BYTES)

    const fetchImpl = vi.fn()
    const result = await ensureModelDownloaded(spec, {
      baseDir: dir,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result).toBe(path)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('downloads, verifies sha256, and atomically materializes the final file', async () => {
    const spec = makeSpec()
    const progressEvents: Array<{ receivedBytes: number; totalBytes: number | null }> = []

    const result = await ensureModelDownloaded(spec, {
      baseDir: dir,
      fetchImpl: fakeFetch(FAKE_MODEL_BYTES),
      onProgress: (p) => progressEvents.push(p)
    })

    expect(result).toBe(localLlmModelPath(spec, dir))
    expect(existsSync(result)).toBe(true)
    expect(readFileSync(result)).toEqual(FAKE_MODEL_BYTES)
    expect(existsSync(`${result}.part`)).toBe(false) // temp file renamed away, not left behind
    expect(isModelDownloaded(spec, dir)).toBe(true)
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents.at(-1)?.receivedBytes).toBe(FAKE_MODEL_BYTES.length)
  })

  it('rejects a config with the UNVERIFIED_SHA256 placeholder before touching the network', async () => {
    const spec = makeSpec({ sha256: UNVERIFIED_SHA256 })
    const fetchImpl = vi.fn()

    await expect(
      ensureModelDownloaded(spec, { baseDir: dir, fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow(ModelConfigError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('discards the file and throws on a sha256 mismatch (corrupted/tampered download)', async () => {
    const spec = makeSpec() // sha256 pinned to FAKE_MODEL_BYTES
    const wrongBytes = Buffer.from('this-is-not-the-expected-content-at-all')

    await expect(
      ensureModelDownloaded(spec, { baseDir: dir, fetchImpl: fakeFetch(wrongBytes) })
    ).rejects.toThrow(ModelDownloadError)

    const path = localLlmModelPath(spec, dir)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(`${path}.part`)).toBe(false)
  })

  it('throws ModelDownloadError on a non-2xx response, writing nothing', async () => {
    const spec = makeSpec()

    await expect(
      ensureModelDownloaded(spec, {
        baseDir: dir,
        fetchImpl: fakeFetch(FAKE_MODEL_BYTES, { ok: false, status: 404 })
      })
    ).rejects.toThrow(ModelDownloadError)

    expect(existsSync(localLlmModelPath(spec, dir))).toBe(false)
  })

  it('throws ModelDownloadError when the network request itself fails', async () => {
    const spec = makeSpec()
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND example.invalid')
    }) as unknown as typeof fetch

    await expect(ensureModelDownloaded(spec, { baseDir: dir, fetchImpl })).rejects.toThrow(
      ModelDownloadError
    )
  })

  it('deleteDownloadedModel removes both the final file and a stray .part', async () => {
    const spec = makeSpec()
    const path = localLlmModelPath(spec, dir)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, FAKE_MODEL_BYTES)
    writeFileSync(`${path}.part`, Buffer.from('leftover'))

    await deleteDownloadedModel(spec, dir)

    expect(existsSync(path)).toBe(false)
    expect(existsSync(`${path}.part`)).toBe(false)
  })
})
