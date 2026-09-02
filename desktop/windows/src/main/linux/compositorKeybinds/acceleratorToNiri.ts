// Electron accelerator ↔ niri bind chord helpers for compositor-keybind install.

const MOD_MAP: Record<string, string> = {
  CTRL: 'Ctrl',
  CONTROL: 'Ctrl',
  CMDORCTRL: 'Ctrl',
  COMMANDORCONTROL: 'Ctrl',
  ALT: 'Alt',
  ALTGR: 'Alt',
  OPTION: 'Alt',
  SHIFT: 'Shift',
  SUPER: 'Mod',
  META: 'Mod',
  CMD: 'Mod',
  COMMAND: 'Mod'
}

const KEY_MAP: Record<string, string> = {
  SPACE: 'Space',
  TAB: 'Tab',
  ENTER: 'Return',
  RETURN: 'Return',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  BACKSPACE: 'BackSpace',
  DELETE: 'Delete',
  INSERT: 'Insert',
  HOME: 'Home',
  END: 'End',
  PAGEUP: 'Page_Up',
  PAGEDOWN: 'Page_Down',
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  PLUS: 'equal',
  MINUS: 'minus'
}

/** Convert an Electron accelerator (e.g. `Shift+Space`) to a niri bind chord. */
export function electronAcceleratorToNiriChord(accelerator: string): string | null {
  const parts = accelerator
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  const mods: string[] = []
  let main: string | null = null
  for (const part of parts) {
    const upper = part.toUpperCase()
    if (MOD_MAP[upper]) {
      mods.push(MOD_MAP[upper])
      continue
    }
    if (main) return null
    if (KEY_MAP[upper]) {
      main = KEY_MAP[upper]
    } else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(part)) {
      main = part.toUpperCase()
    } else if (/^[A-Z0-9]$/i.test(part)) {
      main = part.toUpperCase()
    } else {
      main = part
    }
  }
  if (!main) return null
  // Stable mod order for comparisons: Mod, Ctrl, Alt, Shift
  const order = ['Mod', 'Ctrl', 'Alt', 'Shift']
  const uniqueMods = [...new Set(mods)].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...uniqueMods, main].join('+')
}

/** Normalize a niri chord string for equality checks (Mod+Shift+Space == Shift+Mod+Space). */
export function normalizeNiriChord(chord: string): string {
  const parts = chord
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return ''
  const order = ['Mod', 'Ctrl', 'Alt', 'Shift']
  const mods: string[] = []
  const keys: string[] = []
  for (const p of parts) {
    if (order.includes(p) || p === 'Super' || p === 'Meta') {
      mods.push(p === 'Super' || p === 'Meta' ? 'Mod' : p)
    } else {
      keys.push(p)
    }
  }
  const uniqueMods = [...new Set(mods)].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...uniqueMods, ...keys].join('+')
}
