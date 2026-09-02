// Spawn working-directory inference shared between renderer chat delegation and
// main-process control-tool spawns. Priority: explicit path in the message,
// indexed folder matching a "in my X repo" hint, most recently modified indexed
// working folder, then undefined (kernel falls back to homedir).

export type SpawnCwdDeps = {
  searchFiles: (q: string) => Promise<Array<{ folder: string }>>
  executeSql: (sql: string) => Promise<{ columns: string[]; rows: Record<string, unknown>[] }>
}

/** An explicit absolute path anywhere in the message (Windows or Unix). */
export function explicitPathIn(text: string): string | undefined {
  const windows = text.match(/(?:^|[\s"'(])([A-Za-z]:[\\/][^\s"')]+)/)
  if (windows?.[1]) return windows[1]
  const unix = text.match(/(?:^|[\s"'(])(\/[^\s"')]+)/)
  return unix?.[1]
}

/** A "in my omi repo" / "in the desktop folder" style folder-name hint. */
export function folderHintIn(text: string): string | undefined {
  const match = text.match(
    /\b(?:in|inside|under|to)\s+(?:my|the|our)\s+([\w][\w .-]{0,40}?)\s+(?:repo|repository|project|folder|directory|codebase)\b/i
  )
  return match?.[1]?.trim()
}

const RECENT_INDEXED_FOLDER_SQL =
  "SELECT folder, MAX(modified_at) AS last_modified FROM indexed_files WHERE file_type != 'application' GROUP BY folder ORDER BY last_modified DESC LIMIT 1"

/**
 * Resolve the working directory for a spawn/delegation message. Undefined lets
 * the kernel fall back to the user's home directory. Best-effort — any failure
 * returns undefined.
 */
export async function resolveSpawnCwdFromText(
  text: string,
  deps: SpawnCwdDeps
): Promise<string | undefined> {
  const explicit = explicitPathIn(text)
  if (explicit) return explicit

  try {
    const hint = folderHintIn(text)
    if (hint) {
      const files = await deps.searchFiles(hint)
      const folder = files.find((f) => f.folder.toLowerCase().includes(hint.toLowerCase()))?.folder
      if (folder) return folder
    }
    // Exclude app shortcuts: the index also scans Start-Menu folders (kind
    // 'apps'), and without the filter "most recent folder" can resolve to
    // C:\ProgramData\...\Start Menu\Programs\<vendor> (seen live).
    const recent = await deps.executeSql(RECENT_INDEXED_FOLDER_SQL)
    const folder = recent.rows[0]?.folder
    return typeof folder === 'string' && folder ? folder : undefined
  } catch {
    return undefined
  }
}
