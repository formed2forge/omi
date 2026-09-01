// Compositor-keybind workaround for Linux compositors that do not deliver global
// shortcut events to Electron (niri, sway, etc.). A niri/sway config bind spawns
// a second `omi-windows` process with `--omi-action …`; the running instance
// receives `second-instance` and dispatches the action.

export const LINUX_CLI_ACTION_FLAG = '--omi-action'

export type LinuxCliAction = 'summon' | 'record-mic'

const ACTIONS = new Set<LinuxCliAction>(['summon', 'record-mic'])

/** Parse `--omi-action summon|record-mic` from a process argv vector. */
export function parseLinuxCliAction(argv: readonly string[]): LinuxCliAction | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== LINUX_CLI_ACTION_FLAG) continue
    const raw = argv[i + 1]?.trim()
    if (raw && ACTIONS.has(raw as LinuxCliAction)) return raw as LinuxCliAction
    return null
  }
  return null
}

/** Spawn command shown in Settings / LINUX.md for compositor keybinds. */
export function formatLinuxCliSpawnCommand(action: LinuxCliAction): string {
  return `omi-windows ${LINUX_CLI_ACTION_FLAG} ${action}`
}

export type LinuxCliActionHandlers = {
  summon: () => void
  recordMic: () => void
}

export function dispatchLinuxCliAction(action: LinuxCliAction, handlers: LinuxCliActionHandlers): void {
  if (action === 'summon') handlers.summon()
  else handlers.recordMic()
}
