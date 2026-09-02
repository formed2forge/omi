import { describe, expect, it } from 'vitest'
import {
  electronAcceleratorToNiriChord,
  normalizeNiriChord
} from './acceleratorToNiri'
import { decideChord, scanNiriConfigTree } from './scanNiriConfig'
import { applyManagedBlockToText, buildManagedBlock } from './writeNiriConfig'
import { OMI_MANAGED_BEGIN, OMI_MANAGED_END } from './types'

describe('electronAcceleratorToNiriChord', () => {
  it('maps common Electron accelerators', () => {
    expect(electronAcceleratorToNiriChord('Shift+Space')).toBe('Shift+Space')
    expect(electronAcceleratorToNiriChord('Ctrl+Space')).toBe('Ctrl+Space')
    expect(electronAcceleratorToNiriChord('CommandOrControl+Alt+K')).toBe('Ctrl+Alt+K')
    expect(electronAcceleratorToNiriChord('Super+Shift+A')).toBe('Mod+Shift+A')
  })

  it('normalizes chord mod order', () => {
    expect(normalizeNiriChord('Shift+Mod+Space')).toBe('Mod+Shift+Space')
    expect(normalizeNiriChord('Mod+Shift+Space')).toBe('Mod+Shift+Space')
  })
})

describe('scanNiriConfigTree', () => {
  it('finds binds in the primary file', () => {
    const files = new Map<string, string>([
      [
        '/home/u/.config/niri/config.kdl',
        `binds {
    Mod+T { spawn "alacritty"; }
    Shift+Space { spawn "wofi"; }
}`
      ]
    ])
    const scan = scanNiriConfigTree('/home/u/.config/niri/config.kdl', (p) => {
      const t = files.get(p)
      if (t == null) throw new Error(`missing ${p}`)
      return t
    })
    expect(scan.scanComplete).toBe(true)
    expect(scan.binds.map((b) => b.normalizedChord).sort()).toEqual([
      'Mod+T',
      'Shift+Space'
    ])
    const decision = decideChord(scan, {
      electronAccelerator: 'Shift+Space',
      niriChord: 'Shift+Space',
      action: 'summon'
    })
    expect(decision.status).toBe('chord-conflict')
    if (decision.status === 'chord-conflict') {
      expect(decision.hit.line).toContain('wofi')
    }
  })

  it('scans included KDL files for conflicts', () => {
    const files = new Map<string, string>([
      [
        '/home/u/.config/niri/config.kdl',
        `include "extra.kdl"
binds {
    Mod+T { spawn "alacritty"; }
}`
      ],
      [
        '/home/u/.config/niri/extra.kdl',
        `binds {
    Shift+Space { spawn "fuzzel"; }
}`
      ]
    ])
    const scan = scanNiriConfigTree('/home/u/.config/niri/config.kdl', (p) => {
      const t = files.get(p)
      if (t == null) throw new Error(`missing ${p}`)
      return t
    })
    expect(scan.files).toHaveLength(2)
    const decision = decideChord(scan, {
      electronAccelerator: 'Shift+Space',
      niriChord: 'Shift+Space',
      action: 'summon'
    })
    expect(decision.status).toBe('chord-conflict')
    if (decision.status === 'chord-conflict') {
      expect(decision.hit.filePath).toContain('extra.kdl')
      expect(decision.hit.line).toContain('fuzzel')
    }
  })

  it('fail-closes when an include is unreadable', () => {
    const scan = scanNiriConfigTree('/home/u/.config/niri/config.kdl', (p) => {
      if (p.endsWith('config.kdl')) {
        return `include "missing.kdl"
binds {
    Mod+T { spawn "x"; }
}`
      }
      throw new Error('ENOENT')
    })
    expect(scan.scanComplete).toBe(false)
    expect(scan.unreadableIncludes.some((p) => p.endsWith('missing.kdl'))).toBe(true)
  })

  it('detects existing Omi managed binds as installed', () => {
    const block = buildManagedBlock('/usr/bin/omi-windows', [
      { electronAccelerator: 'Shift+Space', niriChord: 'Shift+Space', action: 'summon' },
      { electronAccelerator: 'Ctrl+Space', niriChord: 'Ctrl+Space', action: 'record-mic' }
    ])
    const text = `binds {\n${block}\n}\n`
    const scan = scanNiriConfigTree('/cfg/config.kdl', () => text)
    expect(
      decideChord(scan, {
        electronAccelerator: 'Shift+Space',
        niriChord: 'Shift+Space',
        action: 'summon'
      }).status
    ).toBe('omi-installed')
    expect(scan.managedBlockFile).toBe('/cfg/config.kdl')
  })
})

describe('applyManagedBlockToText', () => {
  it('appends a managed block inside binds {}', () => {
    const input = `binds {
    Mod+T { spawn "alacritty"; }
}
`
    const out = applyManagedBlockToText(input, '/usr/bin/omi-windows', [
      { electronAccelerator: 'Shift+Space', niriChord: 'Shift+Space', action: 'summon' }
    ])
    expect(out).toContain(OMI_MANAGED_BEGIN)
    expect(out).toContain(OMI_MANAGED_END)
    expect(out).toContain('Shift+Space { spawn "/usr/bin/omi-windows" "--omi-action" "summon"; }')
    expect(out).toContain('Mod+T { spawn "alacritty"; }')
  })

  it('replaces an existing managed block idempotently', () => {
    const first = applyManagedBlockToText(
      `binds {\n}\n`,
      '/usr/bin/omi-windows',
      [{ electronAccelerator: 'Shift+Space', niriChord: 'Shift+Space', action: 'summon' }]
    )
    const second = applyManagedBlockToText(first, '/usr/bin/omi-windows', [
      { electronAccelerator: 'Alt+Space', niriChord: 'Alt+Space', action: 'summon' },
      { electronAccelerator: 'Ctrl+Space', niriChord: 'Ctrl+Space', action: 'record-mic' }
    ])
    expect(second.match(new RegExp(OMI_MANAGED_BEGIN, 'g'))).toHaveLength(1)
    expect(second).toContain('Alt+Space')
    expect(second).not.toContain('Shift+Space { spawn')
  })
})
