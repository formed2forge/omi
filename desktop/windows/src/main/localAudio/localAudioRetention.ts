// Retention cleanup for locally-persisted raw audio (localAudioStore.ts).
// Split into a pure selection function (unit-testable with synthetic stats, no
// filesystem) and a thin real-fs sweep runner, mirroring this codebase's
// existing rewind/retentionSelection.ts + rewind/retentionRunner.ts split.
import { readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { DEFAULT_LOCAL_AUDIO_RETENTION, type LocalAudioRetentionPolicy } from './localAudioConfig'

export type LocalAudioFileStat = {
  path: string
  sizeBytes: number
  mtimeMs: number
}

/**
 * Pure selection: given every local-audio file's stat, decide which absolute
 * paths to delete under `policy` as of `nowMs`. Two passes, in order:
 *   1. Age — any file older than `maxAgeMs` is deleted outright.
 *   2. Total size — of what's left after the age pass, oldest-first until the
 *      remaining total is back under `maxTotalBytes`.
 * Never mutates `files`; returns absolute paths only (no I/O).
 */
export function selectLocalAudioFilesToDelete(
  files: readonly LocalAudioFileStat[],
  policy: LocalAudioRetentionPolicy,
  nowMs: number
): string[] {
  const toDelete = new Set<string>()
  const survivors: LocalAudioFileStat[] = []
  for (const f of files) {
    if (nowMs - f.mtimeMs > policy.maxAgeMs) toDelete.add(f.path)
    else survivors.push(f)
  }

  survivors.sort((a, b) => a.mtimeMs - b.mtimeMs) // oldest first
  let total = survivors.reduce((sum, f) => sum + f.sizeBytes, 0)
  for (const f of survivors) {
    if (total <= policy.maxTotalBytes) break
    toDelete.add(f.path)
    total -= f.sizeBytes
  }

  return [...toDelete]
}

/**
 * Real-fs sweep: list `.wav` files directly under `root`, apply
 * selectLocalAudioFilesToDelete, and delete the selected files. Returns the
 * count actually deleted. A missing root (feature never used / already fully
 * cleaned) is not an error — returns 0. A single file that vanishes or fails
 * to delete between listing and unlink is logged and skipped rather than
 * aborting the whole sweep.
 */
export function runLocalAudioRetentionSweep(
  root: string,
  policy: LocalAudioRetentionPolicy = DEFAULT_LOCAL_AUDIO_RETENTION,
  nowMs: number = Date.now()
): number {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return 0
  }

  const stats: LocalAudioFileStat[] = []
  for (const name of entries) {
    if (!name.endsWith('.wav')) continue
    const path = join(root, name)
    try {
      const st = statSync(path)
      if (st.isFile()) stats.push({ path, sizeBytes: st.size, mtimeMs: st.mtimeMs })
    } catch {
      // Vanished between readdir and stat (e.g. concurrent finalize) — ignore.
    }
  }

  let deleted = 0
  for (const path of selectLocalAudioFilesToDelete(stats, policy, nowMs)) {
    try {
      unlinkSync(path)
      deleted++
    } catch (e) {
      console.warn('[local-audio] retention failed to delete', path, e)
    }
  }
  return deleted
}
