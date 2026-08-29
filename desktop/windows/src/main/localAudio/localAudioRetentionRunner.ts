// Startup/interval wiring for the local-audio retention sweep — mirrors
// rewind/retentionRunner.ts's shape. Runs unconditionally (cheap no-op via
// runLocalAudioRetentionSweep's missing-root short-circuit when the
// localAudioPersistenceEnabled dev toggle has never been turned on), so
// turning the toggle off still lets any previously-recorded files age out
// instead of being orphaned forever.
import { localAudioRoot } from './localAudioStore'
import { runLocalAudioRetentionSweep } from './localAudioRetention'
import { DEFAULT_LOCAL_AUDIO_RETENTION } from './localAudioConfig'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000 // hourly, matching rewind's cadence

function sweepOnce(): void {
  try {
    runLocalAudioRetentionSweep(localAudioRoot(), DEFAULT_LOCAL_AUDIO_RETENTION)
  } catch (e) {
    console.warn('[local-audio] retention sweep failed:', e)
  }
}

/** Sweep once at launch (so a long-off app enforces retention promptly), then
 *  hourly thereafter. The interval is unref'd — it must never keep the process
 *  alive on its own. */
export function startLocalAudioRetention(): void {
  sweepOnce()
  const timer = setInterval(sweepOnce, SWEEP_INTERVAL_MS)
  timer.unref?.()
}
