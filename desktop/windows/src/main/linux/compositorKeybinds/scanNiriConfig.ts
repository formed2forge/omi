// Scan niri config.kdl (and recursive includes) for bind chords.
import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { normalizeNiriChord } from './acceleratorToNiri'
import {
  OMI_MANAGED_BEGIN,
  OMI_MANAGED_END,
  type NiriBindAction,
  type NiriBindHit,
  type NiriChordDecision,
  type NiriChordPlan,
  type NiriConfigFile,
  type NiriScanResult
} from './types'

const MAX_INCLUDE_DEPTH = 8

const INCLUDE_RE = /^\s*include\s+"([^"]+)"\s*$/gm
// Chord line inside binds{} — e.g. `Mod+Shift+Space { spawn "…"; }` or with props.
const BIND_LINE_RE =
  /^\s*([A-Za-z0-9_+]+(?:\s+[A-Za-z0-9_-]+=\S+)*)\s*\{([^}]*)\}\s*$/

function classifyAction(body: string): NiriBindAction {
  if (/--omi-action["\s]+summon\b/.test(body) || /"--omi-action"\s+"summon"/.test(body)) {
    return 'summon'
  }
  if (
    /--omi-action["\s]+record-mic\b/.test(body) ||
    /"--omi-action"\s+"record-mic"/.test(body)
  ) {
    return 'record-mic'
  }
  return 'other'
}

function extractChordToken(prefix: string): string | null {
  const chord = prefix.trim().split(/\s+/)[0]
  if (!chord) return null
  if (!/^[A-Za-z0-9_+]+$/.test(chord)) return null
  return chord
}

function expandIncludeGlob(pattern: string, baseDir: string): string[] {
  // Support simple `dir/*.kdl` globs; literal paths otherwise.
  if (!pattern.includes('*')) {
    const abs = isAbsolute(pattern) ? pattern : resolve(baseDir, pattern)
    return [abs]
  }
  const slash = pattern.lastIndexOf('/')
  const dirPart = slash >= 0 ? pattern.slice(0, slash) : '.'
  const filePart = slash >= 0 ? pattern.slice(slash + 1) : pattern
  const absDir = isAbsolute(dirPart) ? dirPart : resolve(baseDir, dirPart)
  if (!filePart.endsWith('.kdl') && filePart !== '*.kdl') {
    // Only support *.kdl style for v1.
    return []
  }
  try {
    if (!statSync(absDir).isDirectory()) return []
    return readdirSync(absDir)
      .filter((name) => name.endsWith('.kdl'))
      .map((name) => join(absDir, name))
      .sort()
  } catch {
    return []
  }
}

function parseIncludes(text: string, baseDir: string): string[] {
  const out: string[] = []
  INCLUDE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INCLUDE_RE.exec(text)) !== null) {
    out.push(...expandIncludeGlob(m[1], baseDir))
  }
  return out
}

function findBindsBlockRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const re = /\bbinds\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1
    let depth = 0
    for (let i = open; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          ranges.push({ start: open + 1, end: i })
          break
        }
      }
    }
  }
  return ranges
}

function managedRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let from = 0
  while (from < text.length) {
    const begin = text.indexOf(OMI_MANAGED_BEGIN, from)
    if (begin < 0) break
    const endMarker = text.indexOf(OMI_MANAGED_END, begin)
    if (endMarker < 0) break
    ranges.push({ start: begin, end: endMarker + OMI_MANAGED_END.length })
    from = endMarker + OMI_MANAGED_END.length
  }
  return ranges
}

function inAnyRange(index: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((r) => index >= r.start && index < r.end)
}

function parseBindsInFile(filePath: string, text: string): NiriBindHit[] {
  const hits: NiriBindHit[] = []
  const bindRanges = findBindsBlockRanges(text)
  const managed = managedRanges(text)
  if (bindRanges.length === 0) return hits

  for (const range of bindRanges) {
    const block = text.slice(range.start, range.end)
    const lines = block.split(/\r?\n/)
    let offset = range.start
    for (const line of lines) {
      const lineStart = offset
      offset += line.length + 1
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/-')) continue
      const m = BIND_LINE_RE.exec(line)
      if (!m) continue
      const chord = extractChordToken(m[1])
      if (!chord) continue
      const body = m[2]
      hits.push({
        chord,
        normalizedChord: normalizeNiriChord(chord),
        filePath,
        line: trimmed,
        action: classifyAction(body),
        inManagedBlock: inAnyRange(lineStart, managed)
      })
    }
  }
  return hits
}

/** Load primary config + recursive includes into a scan result. */
export function scanNiriConfigTree(
  primaryPath: string,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')
): NiriScanResult {
  const files: NiriConfigFile[] = []
  const unreadableIncludes: string[] = []
  const visited = new Set<string>()
  const queue: Array<{ path: string; depth: number }> = [{ path: primaryPath, depth: 0 }]

  while (queue.length > 0) {
    const next = queue.shift()!
    const abs = resolve(next.path)
    if (visited.has(abs)) continue
    visited.add(abs)
    let text: string
    try {
      text = readFile(abs)
    } catch {
      if (abs === resolve(primaryPath)) {
        throw new Error(`Cannot read niri config: ${abs}`)
      }
      unreadableIncludes.push(abs)
      continue
    }
    files.push({ path: abs, text })
    if (next.depth >= MAX_INCLUDE_DEPTH) continue
    for (const includePath of parseIncludes(text, dirname(abs))) {
      if (!visited.has(resolve(includePath))) {
        queue.push({ path: includePath, depth: next.depth + 1 })
      }
    }
  }

  const binds = files.flatMap((f) => parseBindsInFile(f.path, f.text))
  const managedBlockFile =
    files.find((f) => f.text.includes(OMI_MANAGED_BEGIN) && f.text.includes(OMI_MANAGED_END))
      ?.path ?? null

  return {
    primaryPath: resolve(primaryPath),
    files,
    unreadableIncludes,
    scanComplete: unreadableIncludes.length === 0,
    binds,
    managedBlockFile
  }
}

export function decideChord(scan: NiriScanResult, plan: NiriChordPlan): NiriChordDecision {
  const normalized = normalizeNiriChord(plan.niriChord)
  const matches = scan.binds.filter((b) => b.normalizedChord === normalized)
  if (matches.length === 0) return { status: 'chord-free' }

  // Foreign = non-Omi bind, or an Omi bind for a different action outside the managed block.
  // Managed-block lines are replaced wholesale on install, so they are never conflicts.
  const foreign = matches.find(
    (b) =>
      !b.inManagedBlock &&
      (b.action === 'other' || b.action !== plan.action)
  )
  if (foreign) return { status: 'chord-conflict', hit: foreign }

  const exact = matches.find((b) => b.action === plan.action)
  if (exact && !exact.inManagedBlock) return { status: 'omi-installed', hit: exact }
  if (exact && exact.inManagedBlock) {
    // Still "installed" if the managed block already has the right action+chord.
    return { status: 'omi-installed', hit: exact }
  }

  // Only leftover managed-block lines for a different action on this chord.
  const managed = matches.find((b) => b.inManagedBlock)
  if (managed) return { status: 'omi-stale', hit: managed }

  return { status: 'chord-free' }
}
