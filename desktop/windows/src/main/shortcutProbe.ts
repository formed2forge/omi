// Probe whether the OS will accept a global accelerator without changing Omi's
// live bindings. Callers must suspend active shortcut slots first so a chord Omi
// already owns does not read as "taken".
import { globalShortcut } from 'electron'

export function probeGlobalAccelerator(accelerator: string): boolean {
  const trimmed = accelerator.trim()
  if (!trimmed) return false
  const noop = (): void => {}
  try {
    const ok = globalShortcut.register(trimmed, noop)
    const claimed = ok && globalShortcut.isRegistered(trimmed)
    try {
      globalShortcut.unregister(trimmed)
    } catch {
      // Unregistering an unregistered accelerator is a no-op.
    }
    return claimed
  } catch {
    return false
  }
}
