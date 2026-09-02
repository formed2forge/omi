import { describe, expect, it } from 'vitest'
import { linuxChordsMatch, normalizeLinuxChord } from './normalizeLinuxChord'
import {
  findKdeConflicts,
  parseKdeGlobalShortcuts,
  parseKdeShortcutValue,
  resolveKdeGlobalShortcutsPath,
  scanKdeGlobalAccelConflicts
} from './kdeGlobalAccel'
import { scanLinuxDeConflicts } from './scanLinuxDeConflicts'

describe('normalizeLinuxChord', () => {
  it('equates Electron and Qt Meta/Super chords', () => {
    expect(normalizeLinuxChord('Shift+Space')).toBe('Shift+Space')
    expect(normalizeLinuxChord('Meta+Shift+Space')).toBe('Super+Shift+Space')
    expect(normalizeLinuxChord('Super+Shift+Space')).toBe('Super+Shift+Space')
    expect(linuxChordsMatch('CommandOrControl+Space', 'Ctrl+Space')).toBe(true)
    expect(linuxChordsMatch('Ctrl+Space', 'Meta+Space')).toBe(false)
  })
})

describe('parseKdeShortcutValue', () => {
  it('parses current/default/label with tab alternates', () => {
    const parsed = parseKdeShortcutValue(
      'Meta+L\tCtrl+Alt+L\tScreensaver,Meta+L\tCtrl+Alt+L\tScreensaver,Lock Session'
    )
    expect(parsed.current).toEqual(['Meta+L', 'Ctrl+Alt+L', 'Screensaver'])
    expect(parsed.defaults[0]).toBe('Meta+L')
    expect(parsed.label).toBe('Lock Session')
  })

  it('treats none as unbound', () => {
    expect(parseKdeShortcutValue('none,Alt+Space,KRunner').current).toEqual([])
  })
})

describe('parseKdeGlobalShortcuts', () => {
  const FIXTURE = `[kwin]
_k_friendly_name=KWin
Show Desktop=Meta+D,Meta+D,Show Desktop
something empty=none,none,Unused

[krunner.desktop]
_k_friendly_name=KRunner
_launch=Alt+Space,Alt+Space,KRunner

[services][com.example.desktop]
_k_friendly_name=Example
_launch=Shift+Space,none,Example summon
`

  it('reads active bindings with component labels', () => {
    const binds = parseKdeGlobalShortcuts(FIXTURE)
    expect(binds.map((b) => b.actionId).sort()).toEqual(['Show Desktop', '_launch', '_launch'])
    const shiftSpace = binds.find((b) => b.chords.includes('Shift+Space'))
    expect(shiftSpace?.componentLabel).toBe('Example')
    expect(binds.some((b) => b.actionId === 'something empty')).toBe(false)
  })

  it('finds conflicts against Omi accelerators', () => {
    const binds = parseKdeGlobalShortcuts(FIXTURE)
    const conflicts = findKdeConflicts(
      binds,
      [
        { action: 'summon', electronAccelerator: 'Shift+Space' },
        { action: 'record-mic', electronAccelerator: 'Ctrl+Space' }
      ],
      '/home/u/.config/kglobalshortcutsrc'
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.action).toBe('summon')
    expect(conflicts[0]?.deChord).toBe('Shift+Space')
    expect(conflicts[0]?.component).toBe('Example')
  })
})

describe('scanKdeGlobalAccelConflicts', () => {
  it('returns ok when file is missing', () => {
    const res = scanKdeGlobalAccelConflicts(
      [{ action: 'summon', electronAccelerator: 'Shift+Space' }],
      {
        env: { XDG_CONFIG_HOME: '/tmp/omi-kde-missing-config' },
        readFile: () => {
          const err = new Error('ENOENT') as NodeJS.ErrnoException
          err.code = 'ENOENT'
          throw err
        }
      }
    )
    expect(res.state).toBe('ok')
    expect(res.conflicts).toEqual([])
  })

  it('reports conflicts from injected file text', () => {
    const res = scanKdeGlobalAccelConflicts(
      [{ action: 'summon', electronAccelerator: 'Shift+Space' }],
      {
        env: { XDG_CONFIG_HOME: '/cfg' },
        readFile: () => `[app]
_k_friendly_name=App
_launch=Shift+Space,none,Launch
`
      }
    )
    expect(resolveKdeGlobalShortcutsPath({ XDG_CONFIG_HOME: '/cfg' })).toBe(
      '/cfg/kglobalshortcutsrc'
    )
    expect(res.state).toBe('conflicts')
    expect(res.conflicts?.[0]?.label).toBe('Launch')
  })
})

describe('scanLinuxDeConflicts', () => {
  it('routes kde desktop to the Plasma scanner', () => {
    const res = scanLinuxDeConflicts(
      { XDG_CURRENT_DESKTOP: 'KDE', XDG_CONFIG_HOME: '/cfg' },
      {
        plans: [{ action: 'summon', electronAccelerator: 'Ctrl+Space' }],
        readFile: () => `[x]
_launch=Ctrl+Space,none,Mic
`
      }
    )
    expect(res.compositor).toBe('kde')
    expect(res.state).toBe('conflicts')
  })

  it('marks gnome unsupported until gsettings scanner lands', () => {
    const res = scanLinuxDeConflicts(
      { XDG_CURRENT_DESKTOP: 'GNOME' },
      { plans: [{ action: 'summon', electronAccelerator: 'Shift+Space' }], readFile: () => '' }
    )
    expect(res.compositor).toBe('gnome')
    expect(res.state).toBe('unsupported')
  })
})
