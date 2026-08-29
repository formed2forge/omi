import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LocalAudioRetentionPolicy } from './localAudioConfig'
import {
  runLocalAudioRetentionSweep,
  selectLocalAudioFilesToDelete,
  type LocalAudioFileStat
} from './localAudioRetention'

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omi-local-audio-retention-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const DAY_MS = 24 * 60 * 60 * 1000

describe('selectLocalAudioFilesToDelete (pure)', () => {
  const policy: LocalAudioRetentionPolicy = { maxAgeMs: 7 * DAY_MS, maxTotalBytes: 1000 }

  it('deletes nothing when everything is young and under budget', () => {
    const now = 1_000_000
    const files: LocalAudioFileStat[] = [
      { path: '/a.wav', sizeBytes: 100, mtimeMs: now - DAY_MS },
      { path: '/b.wav', sizeBytes: 100, mtimeMs: now - 2 * DAY_MS }
    ]
    expect(selectLocalAudioFilesToDelete(files, policy, now)).toEqual([])
  })

  it('deletes files strictly older than maxAgeMs regardless of size budget', () => {
    const now = 100 * DAY_MS
    const files: LocalAudioFileStat[] = [
      { path: '/old.wav', sizeBytes: 10, mtimeMs: now - 8 * DAY_MS },
      { path: '/young.wav', sizeBytes: 10, mtimeMs: now - DAY_MS }
    ]
    expect(selectLocalAudioFilesToDelete(files, policy, now)).toEqual(['/old.wav'])
  })

  it('evicts oldest-first once total size (after the age pass) exceeds maxTotalBytes', () => {
    const now = 100 * DAY_MS
    // All within maxAgeMs, so only the size pass applies. Oldest is /a.wav.
    const files: LocalAudioFileStat[] = [
      { path: '/a.wav', sizeBytes: 600, mtimeMs: now - 3 * DAY_MS },
      { path: '/b.wav', sizeBytes: 600, mtimeMs: now - 2 * DAY_MS },
      { path: '/c.wav', sizeBytes: 600, mtimeMs: now - DAY_MS }
    ]
    // Total = 1800 > 1000. Deleting /a.wav (oldest) brings it to 1200, still
    // over budget — /b.wav (next oldest) must also go, leaving /c.wav (600) alone.
    expect(selectLocalAudioFilesToDelete(files, policy, now)).toEqual(['/a.wav', '/b.wav'])
  })

  it('applies the age pass before the size pass without double-selecting', () => {
    const now = 100 * DAY_MS
    const files: LocalAudioFileStat[] = [
      { path: '/ancient.wav', sizeBytes: 900, mtimeMs: now - 30 * DAY_MS }, // age-deleted
      { path: '/recent.wav', sizeBytes: 900, mtimeMs: now - DAY_MS } // survives (900 <= 1000)
    ]
    const result = selectLocalAudioFilesToDelete(files, policy, now)
    expect(result).toEqual(['/ancient.wav'])
  })

  it('never mutates the input array', () => {
    const now = 100 * DAY_MS
    const files: LocalAudioFileStat[] = [
      { path: '/a.wav', sizeBytes: 600, mtimeMs: now - 3 * DAY_MS },
      { path: '/b.wav', sizeBytes: 600, mtimeMs: now - 2 * DAY_MS }
    ]
    const copy = files.map((f) => ({ ...f }))
    selectLocalAudioFilesToDelete(files, policy, now)
    expect(files).toEqual(copy)
  })
})

describe('runLocalAudioRetentionSweep (real fs)', () => {
  it('returns 0 and does not throw when the root directory does not exist', () => {
    const missingRoot = join(tempDir(), 'never-created')
    expect(runLocalAudioRetentionSweep(missingRoot)).toBe(0)
  })

  it('deletes only .wav files older than maxAgeMs, leaving others untouched', () => {
    const root = tempDir()
    const oldFile = join(root, 'old.wav')
    const newFile = join(root, 'new.wav')
    const nonWav = join(root, 'notes.txt')
    writeFileSync(oldFile, 'x')
    writeFileSync(newFile, 'x')
    writeFileSync(nonWav, 'x')

    const now = Date.now()
    const oldTime = (now - 30 * DAY_MS) / 1000
    utimesSync(oldFile, oldTime, oldTime)

    const policy: LocalAudioRetentionPolicy = { maxAgeMs: 7 * DAY_MS, maxTotalBytes: Infinity }
    const deleted = runLocalAudioRetentionSweep(root, policy, now)

    expect(deleted).toBe(1)
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(newFile)).toBe(true)
    expect(existsSync(nonWav)).toBe(true) // never touched — not a .wav
  })

  it('enforces the total-size budget across real files, oldest first', () => {
    const root = tempDir()
    const now = Date.now()
    const make = (name: string, bytes: number, ageDays: number): string => {
      const path = join(root, name)
      writeFileSync(path, Buffer.alloc(bytes))
      const t = (now - ageDays * DAY_MS) / 1000
      utimesSync(path, t, t)
      return path
    }
    const oldest = make('a.wav', 500, 3)
    const middle = make('b.wav', 500, 2)
    const newest = make('c.wav', 500, 1)

    const policy: LocalAudioRetentionPolicy = { maxAgeMs: 365 * DAY_MS, maxTotalBytes: 1000 }
    const deleted = runLocalAudioRetentionSweep(root, policy, now)

    expect(deleted).toBe(1)
    expect(existsSync(oldest)).toBe(false)
    expect(existsSync(middle)).toBe(true)
    expect(existsSync(newest)).toBe(true)
  })
})
