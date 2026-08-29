import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { WAV_HEADER_BYTES } from './wavFile'
import {
  _resetLocalAudioStoreForTests,
  isLocalAudioRecordingActive,
  localAudioFilePath,
  sanitizeAudioFileId,
  startLocalAudioRecording,
  stopLocalAudioRecording,
  writeLocalAudioChunk
} from './localAudioStore'

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omi-local-audio-store-'))
  tempDirs.push(dir)
  return dir
}

beforeEach(() => _resetLocalAudioStoreForTests())
afterEach(() => {
  _resetLocalAudioStoreForTests()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('sanitizeAudioFileId', () => {
  it('keeps a well-formed id unchanged', () => {
    expect(sanitizeAudioFileId('conv-abc_123')).toBe('conv-abc_123')
  })

  it('strips path-traversal / separator characters (and every other non alnum/_/- char) instead of passing them through', () => {
    // Every char outside [a-zA-Z0-9_-] — including '.' and both slash styles —
    // becomes '_', so a ".." traversal segment can never survive into the
    // filename in any form.
    expect(sanitizeAudioFileId('../../etc/passwd')).toBe('../../etc/passwd'.replace(/[^a-zA-Z0-9_-]/g, '_'))
    expect(sanitizeAudioFileId('../../etc/passwd')).not.toMatch(/[./\\]/)
    expect(sanitizeAudioFileId('a/b\\c')).toBe('a_b_c')
  })

  it('falls back to a fixed placeholder only for a truly empty id', () => {
    expect(sanitizeAudioFileId('')).toBe('unknown')
    // Non-empty junk still sanitizes to a non-empty (if ugly) name — it is not
    // "empty enough" to hit the fallback, and does not need to be: the
    // dedicated slash/dot test above already proves it can't escape the root.
    expect(sanitizeAudioFileId('///')).toBe('___')
  })

  it('bounds an absurdly long id', () => {
    expect(sanitizeAudioFileId('a'.repeat(500)).length).toBeLessThanOrEqual(128)
  })
})

describe('localAudioFilePath', () => {
  it('namespaces the file by conversationId then sessionId, under root', () => {
    const path = localAudioFilePath('/root', 'conv-1', 'sess-1')
    expect(path).toBe(join('/root', 'conv-1__sess-1.wav'))
  })
})

describe('local audio recording lifecycle', () => {
  it('start → write → stop produces a WAV file with the fed PCM bytes, named by conversation', () => {
    const root = tempDir()
    const started = startLocalAudioRecording('sess-1', 'conv-1', root)
    expect(started).toBe(true)
    expect(isLocalAudioRecordingActive('sess-1')).toBe(true)

    const chunk = Buffer.from(new Int16Array([10, 20, 30]).buffer)
    writeLocalAudioChunk('sess-1', chunk)

    const path = stopLocalAudioRecording('sess-1')
    expect(path).toBe(localAudioFilePath(root, 'conv-1', 'sess-1'))
    expect(isLocalAudioRecordingActive('sess-1')).toBe(false)

    const onDisk = readFileSync(path!)
    expect(onDisk.byteLength).toBe(WAV_HEADER_BYTES + chunk.byteLength)
    expect(onDisk.subarray(WAV_HEADER_BYTES)).toEqual(chunk)
  })

  it('creates the root directory if it does not exist yet', () => {
    const root = join(tempDir(), 'nested', 'local-audio')
    expect(existsSync(root)).toBe(false)
    expect(startLocalAudioRecording('sess-2', 'conv-2', root)).toBe(true)
    expect(existsSync(root)).toBe(true)
    stopLocalAudioRecording('sess-2')
  })

  it('refuses to double-start a recording for the same sessionId', () => {
    const root = tempDir()
    expect(startLocalAudioRecording('sess-3', 'conv-3', root)).toBe(true)
    expect(startLocalAudioRecording('sess-3', 'conv-3', root)).toBe(false)
    stopLocalAudioRecording('sess-3')
  })

  it('writeLocalAudioChunk is a no-op when no recording is active', () => {
    expect(() => writeLocalAudioChunk('never-started', Buffer.from([1, 2, 3]))).not.toThrow()
  })

  it('stopLocalAudioRecording is idempotent and returns null the second time', () => {
    const root = tempDir()
    startLocalAudioRecording('sess-4', 'conv-4', root)
    expect(stopLocalAudioRecording('sess-4')).not.toBeNull()
    expect(stopLocalAudioRecording('sess-4')).toBeNull()
  })

  it('falls back to sessionId as the namespace when no conversationId is available (e.g. PTT)', () => {
    const root = tempDir()
    startLocalAudioRecording('ptt-hold-9', 'ptt-hold-9', root)
    const path = stopLocalAudioRecording('ptt-hold-9')
    expect(path).toBe(join(root, 'ptt-hold-9__ptt-hold-9.wav'))
  })
})
