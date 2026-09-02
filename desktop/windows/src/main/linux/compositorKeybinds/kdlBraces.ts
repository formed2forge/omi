// String/comment-aware brace matching for niri KDL configs.

/** Skip a `//` line comment, `/- … -/` block comment, or `"…"` string at `i`. */
export function skipKdlTrivia(text: string, i: number): number {
  if (text.startsWith('//', i)) {
    const nl = text.indexOf('\n', i)
    return nl < 0 ? text.length : nl
  }
  if (text.startsWith('/-', i)) {
    const end = text.indexOf('-/', i + 2)
    return end < 0 ? text.length : end + 2
  }
  if (text[i] === '"') {
    let j = i + 1
    while (j < text.length) {
      if (text[j] === '\\') {
        j += 2
        continue
      }
      if (text[j] === '"') return j + 1
      j++
    }
    return text.length
  }
  return i
}

/** Index of the `}` that closes the `{` at `openBrace`, or null if unbalanced. */
export function findMatchingCloseBrace(text: string, openBrace: number): number | null {
  let depth = 0
  for (let i = openBrace; i < text.length; ) {
    const skipped = skipKdlTrivia(text, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return null
}

export type BindsBraceRange = { openBrace: number; closeBrace: number }

/**
 * Top-level `binds { … }` only (document depth 0).
 * Skips nested blocks such as `recent-windows { binds { … } }` where only
 * `next-window` / `previous-window` are legal.
 */
export function findTopLevelBindsRange(text: string): BindsBraceRange | null {
  let depth = 0
  for (let i = 0; i < text.length; ) {
    const skipped = skipKdlTrivia(text, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    const ch = text[i]
    if (ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1)
      i++
      continue
    }
    if (depth === 0) {
      const m = /^binds\s*\{/.exec(text.slice(i))
      if (m && (i === 0 || !/[A-Za-z0-9_-]/.test(text[i - 1]!))) {
        const openBrace = i + m[0].length - 1
        const closeBrace = findMatchingCloseBrace(text, openBrace)
        if (closeBrace == null) return null
        return { openBrace, closeBrace }
      }
    }
    i++
  }
  return null
}

/** Every `binds { … }` range (including nested), trivia-aware. */
export function findAllBindsRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  for (let i = 0; i < text.length; ) {
    const skipped = skipKdlTrivia(text, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    const m = /^binds\s*\{/.exec(text.slice(i))
    if (m && (i === 0 || !/[A-Za-z0-9_-]/.test(text[i - 1]!))) {
      const openBrace = i + m[0].length - 1
      const closeBrace = findMatchingCloseBrace(text, openBrace)
      if (closeBrace != null) {
        ranges.push({ start: openBrace + 1, end: closeBrace })
        i = closeBrace + 1
        continue
      }
    }
    i++
  }
  return ranges
}
