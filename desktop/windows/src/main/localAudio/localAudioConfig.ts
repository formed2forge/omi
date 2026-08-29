// Retention policy for locally-persisted raw audio.
//
// Context: Omi's "Core" free tier will keep users' raw audio recordings
// on-device instead of uploading them to cloud storage. That tier's catalog
// doesn't exist in this codebase yet (see AppSettings.localAudioPersistenceEnabled
// for the standalone dev toggle this policy is gated behind in the meantime), and
// product has not finalized the exact retention numbers. Keeping the policy as
// ONE small, swappable config object — instead of hardcoding maxAgeMs/
// maxTotalBytes deep inside the write/cleanup logic — means a future PR can
// change the numbers (or make them a user preference) without touching
// localAudioRetention.ts or localAudioStore.ts at all.
export type LocalAudioRetentionPolicy = {
  /** A file older than this (by mtime) is deleted outright, regardless of total
   *  size. */
  maxAgeMs: number
  /** Once the total bytes of files under the local-audio root exceed this
   *  (after the age sweep), the oldest files are deleted until back under
   *  budget. */
  maxTotalBytes: number
}

/** Placeholder defaults — NOT a finalized product decision. 14 days / 2 GiB is
 *  a conservative "don't fill the user's disk" starting point. */
export const DEFAULT_LOCAL_AUDIO_RETENTION: LocalAudioRetentionPolicy = {
  maxAgeMs: 14 * 24 * 60 * 60 * 1000, // 14 days
  maxTotalBytes: 2 * 1024 * 1024 * 1024 // 2 GiB
}
