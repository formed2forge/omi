import { describe, it, expect } from 'vitest'
import { mapScanDirEntry } from './dirEntries'

function ent(opts: {
  name: string
  isDirectory?: boolean
  isFile?: boolean
  isSymbolicLink?: boolean
}) {
  return {
    name: opts.name,
    isDirectory: () => opts.isDirectory ?? false,
    isFile: () => opts.isFile ?? false,
    isSymbolicLink: () => opts.isSymbolicLink ?? false
  }
}

function st(opts: { isDirectory?: boolean; isFile?: boolean }) {
  return {
    isDirectory: () => opts.isDirectory ?? false,
    isFile: () => opts.isFile ?? false
  }
}

describe('mapScanDirEntry', () => {
  it('maps plain files and directories', () => {
    expect(mapScanDirEntry(ent({ name: 'a', isDirectory: true }))).toEqual({
      name: 'a',
      isDirectory: true,
      isFile: false
    })
    expect(mapScanDirEntry(ent({ name: 'b', isFile: true }))).toEqual({
      name: 'b',
      isDirectory: false,
      isFile: true
    })
  })

  it('follows a directory symlink via stat', () => {
    expect(
      mapScanDirEntry(ent({ name: 'omi', isSymbolicLink: true }), st({ isDirectory: true }))
    ).toEqual({ name: 'omi', isDirectory: true, isFile: false })
  })

  it('follows a file symlink via stat', () => {
    expect(
      mapScanDirEntry(ent({ name: 'notes.md', isSymbolicLink: true }), st({ isFile: true }))
    ).toEqual({ name: 'notes.md', isDirectory: false, isFile: true })
  })

  it('returns null for unresolved symlinks and other node kinds', () => {
    expect(mapScanDirEntry(ent({ name: 'pipe', isSymbolicLink: true }))).toBeNull()
    expect(mapScanDirEntry(ent({ name: 'socket' }))).toBeNull()
  })
})
