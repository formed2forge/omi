// Write / replace the Omi managed shortcuts block inside a niri config file.
import { copyFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { LINUX_CLI_ACTION_FLAG } from '../linuxCliAction'
import { findTopLevelBindsRange } from './kdlBraces'
import { OMI_MANAGED_BEGIN, OMI_MANAGED_END, type NiriChordPlan } from './types'

export function buildManagedBlock(binaryPath: string, plans: NiriChordPlan[]): string {
  const lines = plans.map(
    (p) =>
      `    ${p.niriChord} { spawn "${binaryPath}" "${LINUX_CLI_ACTION_FLAG}" "${p.action}"; }`
  )
  return [`    ${OMI_MANAGED_BEGIN}`, ...lines, `    ${OMI_MANAGED_END}`].join('\n')
}

/** Remove every Omi managed block (including misplaced ones under recent-windows). */
export function stripManagedBlocks(text: string): string {
  let out = text
  for (;;) {
    const begin = out.indexOf(OMI_MANAGED_BEGIN)
    if (begin < 0) break
    const end = out.indexOf(OMI_MANAGED_END, begin)
    if (end < 0) {
      // Incomplete marker — drop from BEGIN through EOL to avoid leaving a half-block.
      const lineStart = out.lastIndexOf('\n', begin - 1) + 1
      const lineEnd = out.indexOf('\n', begin)
      out = out.slice(0, lineStart) + (lineEnd >= 0 ? out.slice(lineEnd + 1) : '')
      break
    }
    const lineStart = out.lastIndexOf('\n', begin - 1) + 1
    const endLineEnd = out.indexOf('\n', end)
    const replaceEnd = endLineEnd >= 0 ? endLineEnd + 1 : out.length
    out = out.slice(0, lineStart) + out.slice(replaceEnd)
  }
  return out
}

/** Insert or replace the managed block in the top-level `binds {}` only. */
export function applyManagedBlockToText(
  text: string,
  binaryPath: string,
  plans: NiriChordPlan[]
): string {
  const block = buildManagedBlock(binaryPath, plans)
  // Always strip first so a prior write into `recent-windows { binds {…} }` is relocated.
  let next = stripManagedBlocks(text)

  const range = findTopLevelBindsRange(next)
  if (range) {
    const before = next.slice(0, range.closeBrace)
    const after = next.slice(range.closeBrace)
    const needsNl = !before.endsWith('\n')
    return `${before}${needsNl ? '\n' : ''}${block}\n${after}`
  }

  // No top-level binds block — append one (niri users almost always have one).
  const suffix = `\n\nbinds {\n${block}\n}\n`
  return next.endsWith('\n') ? next + suffix.trimStart() : next + suffix
}

export type WriteNiriConfigResult =
  | { ok: true; path: string; backupPath: string }
  | { ok: false; error: string }

export function writeNiriConfigAtomic(
  path: string,
  nextText: string,
  opts?: {
    writeFile?: (path: string, data: string) => void
    copyFile?: (src: string, dest: string) => void
    rename?: (src: string, dest: string) => void
    now?: () => number
  }
): WriteNiriConfigResult {
  const write = opts?.writeFile ?? writeFileSync
  const copy = opts?.copyFile ?? copyFileSync
  const rename = opts?.rename ?? renameSync
  const now = opts?.now ?? Date.now
  const backupPath = join(dirname(path), `config.kdl.omi-backup-${now()}`)
  const tmpPath = `${path}.omi-tmp`
  try {
    copy(path, backupPath)
  } catch (e) {
    return { ok: false, error: `Could not back up niri config: ${String(e)}` }
  }
  try {
    write(tmpPath, nextText)
    rename(tmpPath, path)
    return { ok: true, path, backupPath }
  } catch (e) {
    try {
      copy(backupPath, path)
    } catch {
      // Best-effort restore.
    }
    return { ok: false, error: `Could not write niri config: ${String(e)}` }
  }
}
