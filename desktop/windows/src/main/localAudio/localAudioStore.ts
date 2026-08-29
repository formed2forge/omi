// Per-session lifecycle for locally-persisted raw audio (the "Core" free-tier
// on-device audio storage mechanism — see appSettings.ts's
// `localAudioPersistenceEnabled` dev toggle for the gate, and
// localAudioConfig.ts for the retention policy this store's files are later
// swept under). This is ADDITIVE to, and fully independent of, the existing
// omi-listen.ts cloud-STT WebSocket lane: the same PCM chunks fed to that
// socket are optionally also appended here, to a durable on-disk WAV file.
//
// Root layout: <userData>/local-audio/<conversationId>__<sessionId>.wav
// Namespacing by conversationId (falling back to sessionId for lanes with no
// server-side conversation, e.g. PTT) lets a future "play back this
// conversation's local recording" feature find the file directly.
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { WavFileWriter } from './wavFile'

/** Root dir for locally-persisted raw audio: <userData>/local-audio. */
export function localAudioRoot(): string {
  return join(app.getPath('userData'), 'local-audio')
}

/** Conversation/session ids are UUID-ish already, but sanitize defensively so a
 *  malformed id can never (a) escape the local-audio root via a path-traversal
 *  segment or (b) break the retention sweep's filename parsing. */
export function sanitizeAudioFileId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
  return cleaned || 'unknown'
}

/** Absolute path for one session's local recording under `root`. */
export function localAudioFilePath(root: string, conversationId: string, sessionId: string): string {
  const name = `${sanitizeAudioFileId(conversationId)}__${sanitizeAudioFileId(sessionId)}.wav`
  return join(root, name)
}

type ActiveRecording = { writer: WavFileWriter; path: string }

// Keyed by listen sessionId (one WebSocket session = one local recording).
const active = new Map<string, ActiveRecording>()

/**
 * Begin persisting raw PCM for `sessionId` to a local WAV file under `root`
 * (defaults to the real userData dir; tests pass a temp dir). Returns false
 * without starting a second writer if a recording is already active for this
 * sessionId (the caller — omiListen.ts's startSession — always stops/finalizes
 * an existing session under the same id before starting a new one, so this is
 * a safety net, not the primary guard) or if the file couldn't be opened.
 */
export function startLocalAudioRecording(
  sessionId: string,
  conversationId: string,
  root: string = localAudioRoot()
): boolean {
  if (active.has(sessionId)) return false
  try {
    mkdirSync(root, { recursive: true })
    const path = localAudioFilePath(root, conversationId, sessionId)
    active.set(sessionId, { writer: new WavFileWriter(path), path })
    return true
  } catch (e) {
    console.warn('[local-audio] failed to open recording file:', e)
    return false
  }
}

/** Append one PCM16 chunk to the session's local recording. No-op (and no
 *  allocation on the caller's side is required — this itself does nothing) if
 *  no recording is active for this sessionId. A write failure drops the
 *  recording for the rest of the session rather than throwing — a local-disk
 *  problem must never take down the (independent) cloud-STT lane. */
export function writeLocalAudioChunk(sessionId: string, pcm: Buffer): void {
  const rec = active.get(sessionId)
  if (!rec) return
  try {
    rec.writer.write(pcm)
  } catch (e) {
    console.warn('[local-audio] failed to write chunk, dropping local recording:', e)
    active.delete(sessionId)
  }
}

/** Finalize (patch the WAV header with the real size, close the fd) and drop
 *  bookkeeping for `sessionId`. Idempotent/safe to call with no active
 *  recording (returns null). Returns the finalized file's path otherwise. */
export function stopLocalAudioRecording(sessionId: string): string | null {
  const rec = active.get(sessionId)
  if (!rec) return null
  active.delete(sessionId)
  try {
    rec.writer.close()
  } catch (e) {
    console.warn('[local-audio] failed to finalize local recording:', e)
  }
  return rec.path
}

/** Whether a recording is currently active for this session — lets callers
 *  skip a wasted PCM-chunk copy when the feature is off (the common case). */
export function isLocalAudioRecordingActive(sessionId: string): boolean {
  return active.has(sessionId)
}

/** Test-only: drop all in-memory bookkeeping without closing fds. Use
 *  stopLocalAudioRecording per-session in real teardown paths instead. */
export function _resetLocalAudioStoreForTests(): void {
  active.clear()
}
