// Read-only scan of Plasma's ~/.config/kglobalshortcutsrc for chord conflicts.
import { homedir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'
import { linuxChordsMatch, normalizeLinuxChord } from './normalizeLinuxChord'
import type { LinuxDeConflictScanResult, LinuxDeShortcutConflict } from '../../../shared/types'

export type KdeAccelBinding = {
  componentId: string
  componentLabel: string
  actionId: string
  label: string
  /** Active chords (Qt sequences), excluding `none`. */
  chords: string[]
  line: string
}

/** Resolve kglobalshortcutsrc path (XDG_CONFIG_HOME or ~/.config). */
export function resolveKdeGlobalShortcutsPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim()
  if (xdg) return join(xdg, 'kglobalshortcutsrc')
  const home = env.HOME?.trim() || homedir()
  return join(home, '.config', 'kglobalshortcutsrc')
}

/**
 * Parse one KConfig QStringList value:
 *   current[\tdefaultAlt...],default[\t...],friendly name
 * Current/default use tabs between alternate key sequences.
 */
export function parseKdeShortcutValue(raw: string): {
  current: string[]
  defaults: string[]
  label: string
} {
  const trimmed = raw.trim()
  if (!trimmed) return { current: [], defaults: [], label: '' }

  // Split on commas that separate the three KConfig list fields. Key sequences
  // use '+' / tabs, not commas, so a simple split is safe; friendly names may
  // contain commas → rejoin the tail.
  const parts = trimmed.split(',')
  if (parts.length === 1) {
    const only = parts[0]!.trim()
    if (!only || only.toLowerCase() === 'none') return { current: [], defaults: [], label: '' }
    return { current: [only], defaults: [], label: '' }
  }
  const currentField = parts[0] ?? ''
  const defaultField = parts[1] ?? ''
  const label = parts.slice(2).join(',').trim()

  const splitAlts = (field: string): string[] =>
    field
      .split(/\t/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.toLowerCase() !== 'none')

  return {
    current: splitAlts(currentField),
    defaults: splitAlts(defaultField),
    label
  }
}

/** Parse full kglobalshortcutsrc text into bindings (active chords only). */
export function parseKdeGlobalShortcuts(text: string): KdeAccelBinding[] {
  const out: KdeAccelBinding[] = []
  let componentId = ''
  let componentLabel = ''
  const lines = text.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue

    const section = /^\[([^\]]+)\]$/.exec(trimmed)
    if (section) {
      componentId = section[1]!.trim()
      componentLabel = componentId
      continue
    }
    if (!componentId) continue

    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const actionId = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1)
    if (actionId === '_k_friendly_name') {
      componentLabel = value.trim() || componentId
      continue
    }
    if (actionId.startsWith('_k_')) continue

    const parsed = parseKdeShortcutValue(value)
    if (parsed.current.length === 0) continue
    out.push({
      componentId,
      componentLabel,
      actionId,
      label: parsed.label || actionId,
      chords: parsed.current,
      line: trimmed
    })
  }
  return out
}

export type KdeConflictPlan = {
  action: 'summon' | 'record-mic'
  electronAccelerator: string
}

/** Find Plasma bindings that collide with the given Electron accelerators. */
export function findKdeConflicts(
  bindings: KdeAccelBinding[],
  plans: KdeConflictPlan[],
  sourcePath: string
): LinuxDeShortcutConflict[] {
  const conflicts: LinuxDeShortcutConflict[] = []
  for (const plan of plans) {
    if (!normalizeLinuxChord(plan.electronAccelerator)) continue
    for (const bind of bindings) {
      for (const chord of bind.chords) {
        if (!linuxChordsMatch(plan.electronAccelerator, chord)) continue
        conflicts.push({
          action: plan.action,
          electronAccelerator: plan.electronAccelerator,
          deChord: chord,
          component: bind.componentLabel || bind.componentId,
          actionId: bind.actionId,
          label: bind.label,
          sourcePath,
          existingBind: bind.line
        })
      }
    }
  }
  return conflicts
}

export function scanKdeGlobalAccelConflicts(
  plans: KdeConflictPlan[],
  opts?: {
    env?: NodeJS.ProcessEnv
    readFile?: (path: string) => string
  }
): LinuxDeConflictScanResult {
  const env = opts?.env ?? process.env
  const read = opts?.readFile ?? ((p: string) => readFileSync(p, 'utf8'))
  const sourcePath = resolveKdeGlobalShortcutsPath(env)

  let text: string
  try {
    text = read(sourcePath)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') {
      return {
        compositor: 'kde',
        state: 'ok',
        sourcePath,
        conflicts: [],
        reason: 'No kglobalshortcutsrc yet — Plasma has not written global shortcuts.'
      }
    }
    return {
      compositor: 'kde',
      state: 'scan-failed',
      sourcePath,
      reason: `Could not read ${sourcePath}: ${String(e)}`
    }
  }

  try {
    const bindings = parseKdeGlobalShortcuts(text)
    const conflicts = findKdeConflicts(bindings, plans, sourcePath)
    return {
      compositor: 'kde',
      state: conflicts.length > 0 ? 'conflicts' : 'ok',
      sourcePath,
      conflicts
    }
  } catch (e) {
    return {
      compositor: 'kde',
      state: 'scan-failed',
      sourcePath,
      reason: `Failed to parse kglobalshortcutsrc: ${String(e)}`
    }
  }
}
