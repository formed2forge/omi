// Shared Linux chord normalization for DE conflict scans (Electron ↔ Qt/KDE).

const MOD_ALIASES: Record<string, string> = {
  CTRL: 'Ctrl',
  CONTROL: 'Ctrl',
  CMDORCTRL: 'Ctrl',
  COMMANDORCONTROL: 'Ctrl',
  ALT: 'Alt',
  ALTGR: 'Alt',
  OPTION: 'Alt',
  SHIFT: 'Shift',
  SUPER: 'Super',
  META: 'Super',
  CMD: 'Super',
  COMMAND: 'Super',
  MOD: 'Super',
  WIN: 'Super'
}

const KEY_ALIASES: Record<string, string> = {
  SPACE: 'Space',
  TAB: 'Tab',
  ENTER: 'Return',
  RETURN: 'Return',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete',
  DEL: 'Delete',
  INSERT: 'Insert',
  INS: 'Insert',
  HOME: 'Home',
  END: 'End',
  PAGEUP: 'PageUp',
  PGUP: 'PageUp',
  PAGEDOWN: 'PageDown',
  PGDN: 'PageDown',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  PLUS: 'Plus',
  MINUS: 'Minus'
}

const MOD_ORDER = ['Super', 'Ctrl', 'Alt', 'Shift']

function lookupKey(part: string): string | null {
  const upper = part.toUpperCase()
  if (KEY_ALIASES[upper]) return KEY_ALIASES[upper]!
  const compact = upper.replace(/[\s_-]+/g, '')
  if (KEY_ALIASES[compact]) return KEY_ALIASES[compact]!
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(part)) return part.toUpperCase()
  if (/^[A-Z0-9]$/i.test(part)) return part.toUpperCase()
  if (upper === 'NONE') return null
  return part
}

/** Normalize Electron or Qt/KDE chord (`Shift+Space`, `Meta+Shift+Space`) for equality. */
export function normalizeLinuxChord(chord: string): string {
  const parts = chord
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return ''

  const mods: string[] = []
  let main: string | null = null
  for (const part of parts) {
    const upper = part.toUpperCase().replace(/[\s_-]+/g, '')
    const mod = MOD_ALIASES[upper]
    if (mod) {
      mods.push(mod)
      continue
    }
    if (main) return ''
    main = lookupKey(part)
    if (!main) return ''
  }
  if (!main) return ''
  const uniqueMods = [...new Set(mods)].sort(
    (a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b)
  )
  return [...uniqueMods, main].join('+')
}

/** True when two chords collide after normalization. */
export function linuxChordsMatch(a: string, b: string): boolean {
  const na = normalizeLinuxChord(a)
  const nb = normalizeLinuxChord(b)
  return na.length > 0 && na === nb
}
