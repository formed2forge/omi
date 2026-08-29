// Where the local-LLM weights live on disk. Deliberately NOT under the app's
// install/resources dir — the model is never bundled into the installer (task
// requirement); it only ever exists here after a successful, sha256-verified
// on-demand download (see modelDownloader.ts).
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalLlmModelSpec } from './localLlmConfig'

/** <userData>/models/local-llm — per-user cache dir, survives across app
 *  updates, cleared only by a user wiping their profile (same lifecycle as
 *  the rest of <userData>). */
export function localLlmModelsDir(): string {
  return join(app.getPath('userData'), 'models', 'local-llm')
}

/** Absolute path a given model spec's weights would live at. `baseDir` is an
 *  override for tests — production callers should omit it. */
export function localLlmModelPath(spec: LocalLlmModelSpec, baseDir?: string): string {
  return join(baseDir ?? localLlmModelsDir(), spec.fileName)
}

/**
 * Whether a verified copy of `spec`'s weights is already on disk.
 *
 * This is a cheap existence check ONLY — it does not re-hash the file (that
 * would mean hashing a several-hundred-MB file on every summarizeTranscript()
 * call). That's safe because modelDownloader.ensureModelDownloaded() only ever
 * materializes the FINAL file name after a successful sha256 verification (it
 * downloads to a `.part` sibling and renames on success), so existence at the
 * real name already implies integrity — a crash or kill mid-download can never
 * leave a corrupt/partial file masquerading as complete here.
 */
export function isModelDownloaded(spec: LocalLlmModelSpec, baseDir?: string): boolean {
  return existsSync(localLlmModelPath(spec, baseDir))
}
