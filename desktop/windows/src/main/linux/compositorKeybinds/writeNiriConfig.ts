// Write / replace the Omi managed shortcuts block inside a niri config file.
import { copyFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { LINUX_CLI_ACTION_FLAG } from '../linuxCliAction'
import { OMI_MANAGED_BEGIN, OMI_MANAGED_END, type NiriChordPlan } from './types'

function findBindsInnerRange(text: string): { openBrace: number; closeBrace: number } | null {
  const m = /\bbinds\s*\{/.exec(text)
  if (!m) return null
  const openBrace = m.index + m[0].length - 1
  let depth = 0
  for (let i = openBrace; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return { openBrace, closeBrace: i }
    }
  }
  return null
}

export function buildManagedBlock(binaryPath: string, plans: NiriChordPlan[]): string {
  const lines = plans.map(
    (p) =>
      `    ${p.niriChord} { spawn "${binaryPath}" "${LINUX_CLI_ACTION_FLAG}" "${p.action}"; }`
  )
  return [`    ${OMI_MANAGED_BEGIN}`, ...lines, `    ${OMI_MANAGED_END}`].join('\n')
}

/** Insert or replace the managed block in config text. Returns new full text. */
export function applyManagedBlockToText(
  text: string,
  binaryPath: string,
  plans: NiriChordPlan[]
): string {
  const block = buildManagedBlock(binaryPath, plans)
  const begin = text.indexOf(OMI_MANAGED_BEGIN)
  const end = text.indexOf(OMI_MANAGED_END)
  if (begin >= 0 && end > begin) {
    // Replace from start of line containing BEGIN through END marker line.
    const lineStart = text.lastIndexOf('\n', begin - 1) + 1
    const endLineEnd = text.indexOf('\n', end)
    const replaceEnd = endLineEnd >= 0 ? endLineEnd + 1 : text.length
    return text.slice(0, lineStart) + block + '\n' + text.slice(replaceEnd)
  }

  const range = findBindsInnerRange(text)
  if (range) {
    const before = text.slice(0, range.closeBrace)
    const after = text.slice(range.closeBrace)
    const needsNl = !before.endsWith('\n')
    return `${before}${needsNl ? '\n' : ''}${block}\n${after}`
  }

  // No binds block — append one (niri users almost always have one; this is a safety net).
  const suffix = `\n\nbinds {\n${block}\n}\n`
  return text.endsWith('\n') ? text + suffix.trimStart() : text + suffix
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
