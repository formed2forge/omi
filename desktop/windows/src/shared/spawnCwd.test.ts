import { describe, expect, it } from 'vitest'
import { explicitPathIn, folderHintIn, resolveSpawnCwdFromText } from './spawnCwd'

describe('explicitPathIn', () => {
  it('finds an explicit absolute Windows path', () => {
    expect(explicitPathIn('ask codex to fix C:\\work\\omi\\app please')).toBe('C:\\work\\omi\\app')
    expect(explicitPathIn('use claude code in D:/projects/site')).toBe('D:/projects/site')
    expect(explicitPathIn('no path here')).toBeUndefined()
  })

  it('finds an explicit absolute Unix path', () => {
    expect(explicitPathIn('fix /home/me/projects/omi now')).toBe('/home/me/projects/omi')
    expect(explicitPathIn('look at /agent/repos/omi/desktop/windows')).toBe(
      '/agent/repos/omi/desktop/windows'
    )
  })

  it('prefers a Windows path when both styles appear', () => {
    expect(explicitPathIn('compare C:\\work\\omi with /tmp/other')).toBe('C:\\work\\omi')
  })
})

describe('folderHintIn', () => {
  it('finds a folder-name hint', () => {
    expect(folderHintIn('fix the failing test in my omi repo')).toBe('omi')
    expect(folderHintIn('add a readme to the desktop-windows project')).toBe('desktop-windows')
    expect(folderHintIn('just chat, no folders')).toBeUndefined()
  })
})

describe('resolveSpawnCwdFromText', () => {
  it('resolves: explicit path > hinted indexed folder > most recent folder > undefined', async () => {
    const sqlQueries: string[] = []
    const deps = {
      searchFiles: async (q: string) =>
        q === 'omi' ? [{ folder: 'C:\\Users\\me\\projects\\omi' }] : [],
      executeSql: async (sql: string) => {
        sqlQueries.push(sql)
        return {
          columns: ['folder', 'last_modified'],
          rows: [{ folder: 'C:\\Users\\me\\recent-project', last_modified: 123 }]
        }
      }
    }
    expect(await resolveSpawnCwdFromText('fix C:\\explicit\\path now', deps)).toBe(
      'C:\\explicit\\path'
    )
    expect(await resolveSpawnCwdFromText('fix the failing test in my omi repo', deps)).toBe(
      'C:\\Users\\me\\projects\\omi'
    )
    expect(await resolveSpawnCwdFromText('fix the failing test', deps)).toBe(
      'C:\\Users\\me\\recent-project'
    )
    expect(sqlQueries.at(-1)).toContain("file_type != 'application'")

    const failing = {
      searchFiles: async () => {
        throw new Error('no index')
      },
      executeSql: async () => {
        throw new Error('no db')
      }
    }
    expect(await resolveSpawnCwdFromText('fix the failing test in my omi repo', failing)).toBeUndefined()
  })
})
