import { beforeEach, describe, expect, it, vi } from 'vitest'

const { searchIndexedFiles, execSafeSelect } = vi.hoisted(() => ({
  searchIndexedFiles: vi.fn(),
  execSafeSelect: vi.fn()
}))

vi.mock('../ipc/db', () => ({
  searchIndexedFiles,
  execSafeSelect
}))

import { resolveSpawnCwd } from './resolveSpawnCwd'

describe('resolveSpawnCwd', () => {
  beforeEach(() => {
    searchIndexedFiles.mockReset()
    execSafeSelect.mockReset()
  })

  it('returns an explicit path without querying the index', async () => {
    expect(await resolveSpawnCwd('fix /home/me/projects/omi now')).toBe('/home/me/projects/omi')
    expect(searchIndexedFiles).not.toHaveBeenCalled()
    expect(execSafeSelect).not.toHaveBeenCalled()
  })

  it('uses searchIndexedFiles for a folder hint', async () => {
    searchIndexedFiles.mockReturnValue([{ folder: '/home/me/projects/omi' }])
    expect(await resolveSpawnCwd('fix the failing test in my omi repo')).toBe(
      '/home/me/projects/omi'
    )
    expect(searchIndexedFiles).toHaveBeenCalledWith('omi')
    expect(execSafeSelect).not.toHaveBeenCalled()
  })

  it('falls back to the most recent indexed folder', async () => {
    execSafeSelect.mockReturnValue({
      columns: ['folder', 'last_modified'],
      rows: [{ folder: '/home/me/recent-project', last_modified: 123 }]
    })
    expect(await resolveSpawnCwd('fix the failing test')).toBe('/home/me/recent-project')
    expect(execSafeSelect).toHaveBeenCalledWith(expect.stringContaining("file_type != 'application'"))
  })
})
