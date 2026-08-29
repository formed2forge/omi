import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Point app.getPath('userData') at a throwaway dir so this test never touches a
// real profile or the network (the downloader itself is always injected below).
const userDataDir = mkdtempSync(join(tmpdir(), 'omi-local-asr-model-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => userDataDir }
}))

import { MODEL_FILES, modelFileName } from './model'
import { ensureModelReady, getModelDir, isModelReady, ModelDownloadError } from './modelManager'

afterAll(() => rmSync(userDataDir, { recursive: true, force: true }))

beforeEach(() => {
  rmSync(getModelDir(), { recursive: true, force: true })
})

describe('modelManager', () => {
  it('is not ready before any download', async () => {
    expect(await isModelReady()).toBe(false)
  })

  it('downloads every missing file and becomes ready', async () => {
    const downloaded: string[] = []
    const downloader = vi.fn(async (url: string, destPath: string) => {
      downloaded.push(url)
      writeFileSync(destPath, 'fixture-bytes')
    })

    const dir = await ensureModelReady(undefined, downloader)

    expect(dir).toBe(getModelDir())
    expect(downloader).toHaveBeenCalledTimes(MODEL_FILES.length)
    for (const file of MODEL_FILES) {
      expect(existsSync(join(dir, modelFileName(file)))).toBe(true)
    }
    expect(await isModelReady()).toBe(true)
  })

  it('skips files that already exist with content (no re-download)', async () => {
    const dir = getModelDir()
    await ensureModelReady(undefined, async (_url, dest) => writeFileSync(dest, 'x'))

    const downloader = vi.fn(async (_url: string, dest: string) => writeFileSync(dest, 'y'))
    await ensureModelReady(undefined, downloader)

    expect(downloader).not.toHaveBeenCalled()
    // Original content untouched.
    const { readFileSync } = await import('fs')
    expect(readFileSync(join(dir, modelFileName(MODEL_FILES[0])), 'utf8')).toBe('x')
  })

  // Main error path: a download failure must surface as ModelDownloadError and
  // must not leave a partial/final file behind that a later isModelReady check
  // could mistake for a complete download.
  it('throws ModelDownloadError on a failed download and cleans up the partial file', async () => {
    const downloader = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })

    await expect(ensureModelReady(undefined, downloader)).rejects.toThrow(ModelDownloadError)
    expect(await isModelReady()).toBe(false)
    const partial = join(getModelDir(), `${modelFileName(MODEL_FILES[0])}.part`)
    expect(existsSync(partial)).toBe(false)
  })

  it('coalesces concurrent calls onto a single download pass', async () => {
    let calls = 0
    const downloader = vi.fn(async (_url: string, dest: string) => {
      calls++
      writeFileSync(dest, 'x')
    })

    const [a, b] = await Promise.all([
      ensureModelReady(undefined, downloader),
      ensureModelReady(undefined, downloader)
    ])

    expect(a).toBe(b)
    expect(calls).toBe(MODEL_FILES.length)
  })
})
