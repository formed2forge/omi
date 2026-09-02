import type { ScanDirEntry } from './scanPlan'

export type DirEntLike = {
  name: string
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}

export type StatLike = {
  isDirectory(): boolean
  isFile(): boolean
}

/** Map a readdir dirent (+ optional stat for symlinks) into a planner entry. */
export function mapScanDirEntry(ent: DirEntLike, stat?: StatLike): ScanDirEntry | null {
  if (ent.isDirectory()) return { name: ent.name, isDirectory: true, isFile: false }
  if (ent.isFile()) return { name: ent.name, isDirectory: false, isFile: true }
  if (ent.isSymbolicLink() && stat) {
    if (stat.isDirectory()) return { name: ent.name, isDirectory: true, isFile: false }
    if (stat.isFile()) return { name: ent.name, isDirectory: false, isFile: true }
  }
  return null
}
