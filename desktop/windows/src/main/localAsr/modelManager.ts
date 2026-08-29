// First-run/on-demand model download for local ASR. The model is NOT bundled
// into the installer (task requirement — keeps the installer small and the model
// choice swappable without a release); it is fetched once, on first use, into
// userData, and reused on every later start. Mirrors the shape of the existing
// win-audio-helper "missing binary degrades gracefully, never blocks the caller"
// pattern, but for a downloaded asset instead of a built one.
import { app } from 'electron'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { MODEL_FILES, MODEL_ID, modelFileName, modelFileUrl } from './model'

/** Thrown by ensureModelReady on any download failure. Callers (localAsrSession)
 *  catch this specifically to surface a clean "model not ready" error instead of
 *  crashing the session. */
export class ModelDownloadError extends Error {
  constructor(
    public readonly file: string,
    cause: string
  ) {
    super(`local ASR model download failed for ${file}: ${cause}`)
    this.name = 'ModelDownloadError'
  }
}

// Injected in tests so no real network/filesystem is exercised. Production
// callers never pass this — see ensureModelReady's default parameter.
export type Downloader = (url: string, destPath: string) => Promise<void>

/** Default downloader: streams the HTTP response body straight to a `.part` file
 *  (renamed to its final name only once the write completes — see
 *  ensureModelReady) via global fetch, which Electron's bundled Node provides. */
async function fetchToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`)
  }
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destPath))
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

/** Directory the model's files live in once downloaded. Deterministic — callers
 *  can compute it without awaiting ensureModelReady (e.g. to check readiness). */
export function getModelDir(): string {
  return join(app.getPath('userData'), 'models', 'local-asr', sanitize(MODEL_ID))
}

/** Every expected file present and non-empty. A partial download never leaves a
 *  final-named file behind (see ensureModelReady's temp-then-rename), so this is
 *  a reliable readiness check even after a crash mid-download. */
export async function isModelReady(dir = getModelDir()): Promise<boolean> {
  for (const file of MODEL_FILES) {
    const path = join(dir, modelFileName(file))
    if (!existsSync(path)) return false
    try {
      const st = await stat(path)
      if (st.size <= 0) return false
    } catch {
      return false
    }
  }
  return true
}

// Coalesce concurrent callers onto a single in-flight download rather than
// racing multiple downloads of the same files.
let inflight: Promise<string> | null = null

/**
 * Ensure every model file is present in the model directory, downloading any
 * that are missing, and return the directory. Downloads are atomic per-file
 * (write to `<name>.part`, rename on success) so a killed process never leaves a
 * file that `isModelReady` mistakes for a complete one. Throws ModelDownloadError
 * on any failure (network down, HTTP error, disk full) — callers should treat
 * that as "local ASR unavailable right now", not a fatal condition.
 */
export async function ensureModelReady(
  onProgress?: (file: string, index: number, total: number) => void,
  downloader: Downloader = fetchToFile
): Promise<string> {
  if (inflight) return inflight
  inflight = (async () => {
    const dir = getModelDir()
    await mkdir(dir, { recursive: true })
    for (let i = 0; i < MODEL_FILES.length; i++) {
      const repoFile = MODEL_FILES[i]
      const name = modelFileName(repoFile)
      const finalPath = join(dir, name)
      if (existsSync(finalPath)) {
        try {
          const st = await stat(finalPath)
          if (st.size > 0) continue
        } catch {
          /* fall through to re-download */
        }
      }
      onProgress?.(name, i, MODEL_FILES.length)
      const tmpPath = `${finalPath}.part`
      try {
        await downloader(modelFileUrl(repoFile), tmpPath)
        await rename(tmpPath, finalPath)
      } catch (e) {
        await rm(tmpPath, { force: true }).catch(() => {})
        throw new ModelDownloadError(name, (e as Error).message)
      }
    }
    return dir
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}
