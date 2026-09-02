import { execSafeSelect, searchIndexedFiles } from '../ipc/db'
import { guardSelect } from '../../shared/sqlGuard'
import { resolveSpawnCwdFromText } from '../../shared/spawnCwd'

/** Main-process spawn cwd inference from objective/prompt text. */
export async function resolveSpawnCwd(text: string): Promise<string | undefined> {
  return resolveSpawnCwdFromText(text, {
    searchFiles: async (q) => searchIndexedFiles(q).map((f) => ({ folder: f.folder })),
    executeSql: async (sql) => execSafeSelect(guardSelect(sql))
  })
}
