// First-run / on-demand download of the local-LLM weights (task requirement:
// the model must NOT be bundled into the installer). Streams straight to disk
// so a ~sub-GB file never sits fully in memory, verifies sha256 before the
// file is trusted, and writes via a `.part` sibling + atomic rename so a
// crash/kill mid-download can never leave a corrupt file at the real path
// (modelStore.isModelDownloaded only ever looks at the final name) — the same
// pattern scripts/copy-vad-assets.mjs already uses for the VAD's yamnet.tflite.
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { localLlmModelPath, isModelDownloaded } from './modelStore'
import { UNVERIFIED_SHA256, type LocalLlmModelSpec } from './localLlmConfig'

/** The model spec isn't ready to download (e.g. sha256 still a placeholder). A
 *  config problem, not a network/runtime one — never retryable as-is. */
export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelConfigError'
  }
}

/** Network failure, non-2xx response, stream error, or sha256 mismatch. */
export class ModelDownloadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'ModelDownloadError'
  }
}

export interface DownloadProgress {
  receivedBytes: number
  /** Best-known total; null if the server didn't send Content-Length and the
   *  spec has no approxSizeBytes fallback. */
  totalBytes: number | null
}
export type DownloadProgressCallback = (progress: DownloadProgress) => void

export interface DownloadModelOptions {
  onProgress?: DownloadProgressCallback
  signal?: AbortSignal
  /** Override the model cache dir — tests only; production omits this. */
  baseDir?: string
  /** Injectable fetch — tests only; production omits this (defaults to the
   *  Node/Electron global fetch), matching the fetchImpl convention used
   *  elsewhere in src/main (e.g. auth/firebaseIdToken.ts). */
  fetchImpl?: typeof fetch
}

/**
 * Ensure `spec`'s weights are present and sha256-verified on disk, downloading
 * them first if needed. Idempotent: a no-op returning the existing path if a
 * verified copy is already there.
 *
 * Throws `ModelConfigError` if the spec isn't ready to download (placeholder
 * hash), or `ModelDownloadError` for any network/stream/integrity failure —
 * callers should treat both as "local processing unavailable right now" and
 * degrade accordingly (this module does not decide that policy).
 */
export async function ensureModelDownloaded(
  spec: LocalLlmModelSpec,
  options: DownloadModelOptions = {}
): Promise<string> {
  const finalPath = localLlmModelPath(spec, options.baseDir)
  if (isModelDownloaded(spec, options.baseDir)) return finalPath

  if (!spec.sha256 || spec.sha256 === UNVERIFIED_SHA256) {
    throw new ModelConfigError(
      `Refusing to download "${spec.id}": its sha256 is still the UNVERIFIED_SHA256 placeholder. ` +
        'Download the file once out of band, verify it against the model card / a second source, ' +
        'and pin the real hash in localLlmConfig.ts before enabling downloads.'
    )
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const partPath = `${finalPath}.part`
  await mkdir(dirname(finalPath), { recursive: true })

  let res: Response
  try {
    res = await fetchImpl(spec.url, { signal: options.signal })
  } catch (e) {
    throw new ModelDownloadError(`Model download request failed: ${(e as Error).message}`, e)
  }
  if (!res.ok || !res.body) {
    throw new ModelDownloadError(`Model download failed: HTTP ${res.status} ${spec.url}`)
  }

  const contentLength = Number(res.headers.get('content-length'))
  const totalBytes =
    Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : (spec.approxSizeBytes ?? null)

  const hash = createHash('sha256')
  let receivedBytes = 0
  // A pass-through Transform (not a `data` listener on the raw source) so
  // hashing/progress happen exactly once per chunk under pipeline()'s own
  // backpressure — a `data` listener would put the source into flowing mode
  // independently of pipeline's internal consumption and risks dropped or
  // double-counted chunks.
  const measure = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      hash.update(chunk)
      receivedBytes += chunk.length
      options.onProgress?.({ receivedBytes, totalBytes })
      callback(null, chunk)
    }
  })

  try {
    const source = Readable.fromWeb(res.body as never)
    await pipeline(source, measure, createWriteStream(partPath), { signal: options.signal })
  } catch (e) {
    await rm(partPath, { force: true })
    throw new ModelDownloadError(`Model download stream failed: ${(e as Error).message}`, e)
  }

  const gotHash = hash.digest('hex')
  if (gotHash !== spec.sha256) {
    await rm(partPath, { force: true })
    throw new ModelDownloadError(
      `Model download sha256 mismatch for "${spec.id}": expected ${spec.sha256}, got ${gotHash}. ` +
        'The downloaded file was discarded — this can mean a corrupted download or a changed upstream file.'
    )
  }

  // Leftover `.part` from a previous crashed attempt at a different size is
  // already overwritten by createWriteStream above; nothing else to clean up.
  await rename(partPath, finalPath)
  return finalPath
}

/** True if `spec`'s weights exist at the expected final path — re-exported
 *  here (from modelStore) so callers of ensureModelDownloaded don't also need
 *  to import modelStore just to check first. */
export { isModelDownloaded }

/** Best-effort delete of any downloaded weights + leftover partial download,
 *  for tests and for a future "free up disk space" settings action. */
export async function deleteDownloadedModel(
  spec: LocalLlmModelSpec,
  baseDir?: string
): Promise<void> {
  const finalPath = localLlmModelPath(spec, baseDir)
  if (existsSync(finalPath)) await rm(finalPath, { force: true })
  if (existsSync(`${finalPath}.part`)) await rm(`${finalPath}.part`, { force: true })
}
