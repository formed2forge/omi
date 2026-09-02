// Linux desktop session facts for global-shortcut portal identity and runtime
// capability hints. Phase 0 of the Linux shortcuts work: give Electron a stable
// portal app ID (desktopName + .desktop) and centralize session detection so
// later phases (conflict scanners, Settings UX) read one source of truth.
import { formatLinuxCliSpawnCommand } from './linuxCliAction'
import {
  detectLinuxCompositor,
  type LinuxCompositorKind
} from './compositorDetect'
import { defaultOzonePlatform } from '../linuxCompositor'

export type { LinuxCompositorKind }

/** Reverse-DNS portal identity — must match appId, package.json desktopName, and
 *  the installed .desktop basename (com.omiwindows.app.desktop). */
export const LINUX_PORTAL_APP_ID = 'com.omiwindows.app'

export const LINUX_DESKTOP_FILE_BASENAME = `${LINUX_PORTAL_APP_ID}.desktop`

/** WM_CLASS / StartupWMClass written into the shipped .desktop entry. */
export const LINUX_STARTUP_WM_CLASS = 'omi-windows'

export type LinuxSessionType = 'wayland' | 'x11' | 'unknown'

export type LinuxOzonePlatform = 'x11' | 'wayland'

export type LinuxCompositorKeybindWorkaround = {
  compositor: LinuxCompositorKind
  summonCommand: string
  recordMicCommand: string
  /** niri/sway `binds { … }` example (omit for Plasma). */
  niriConfigExample?: string
  /** Plasma System Settings steps (omit for niri/sway). */
  plasmaSettingsSteps?: string
}

export type LinuxGlobalShortcutsCapability =
  | {
      available: true
      mechanism: 'x11-grab' | 'wayland-portal'
      /** false when register() may succeed but key events never reach the app. */
      deliveryReliable: boolean
      compositorWorkaround: LinuxCompositorKeybindWorkaround | null
    }
  | {
      available: false
      reason: string
      compositorWorkaround: LinuxCompositorKeybindWorkaround | null
    }

export type LinuxSessionInfo = {
  sessionType: LinuxSessionType
  compositor: LinuxCompositorKind
  /** Raw XDG_CURRENT_DESKTOP (colon-separated when multiple). */
  currentDesktop: string | null
  /** DESKTOP_SESSION when set (some distros only populate this). */
  desktopSession: string | null
  ozonePlatform: LinuxOzonePlatform
  portalAppId: string
  globalShortcuts: LinuxGlobalShortcutsCapability
}

function normalizeSessionType(raw: string | undefined): LinuxSessionType {
  const v = raw?.trim().toLowerCase()
  if (v === 'wayland') return 'wayland'
  if (v === 'x11' || v === 'tty') return 'x11'
  return 'unknown'
}

/** Resolve ozone platform: explicit OMI_OZONE wins; else compositor auto-detect. */
export function resolveLinuxOzonePlatform(env: NodeJS.ProcessEnv = process.env): LinuxOzonePlatform {
  const raw = env.OMI_OZONE?.trim().toLowerCase()
  if (raw === 'wayland' || raw === 'x11') return raw
  if (raw) return 'x11'
  return defaultOzonePlatform(env)
}

export function isLinuxWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return normalizeSessionType(env.XDG_SESSION_TYPE) === 'wayland'
}

export { detectLinuxCompositor }

function buildCompositorWorkaround(
  compositor: LinuxCompositorKind,
  ozonePlatform: LinuxOzonePlatform
): LinuxCompositorKeybindWorkaround | null {
  const summonCommand = formatLinuxCliSpawnCommand('summon')
  const recordMicCommand = formatLinuxCliSpawnCommand('record-mic')

  if (compositor === 'niri' || compositor === 'sway') {
    return {
      compositor,
      summonCommand,
      recordMicCommand,
      niriConfigExample: `binds {
    Mod+Shift+Space { spawn "${summonCommand}"; }
    Mod+Ctrl+Space { spawn "${recordMicCommand}"; }
}`
    }
  }

  // Plasma Wayland: Electron register() can succeed via the portal while Activated
  // never fires. Bypass with System Settings command shortcuts → --omi-action.
  if (compositor === 'kde' && ozonePlatform === 'wayland') {
    return {
      compositor,
      summonCommand,
      recordMicCommand,
      plasmaSettingsSteps: [
        'System Settings → Shortcuts → Add New → Command or Script',
        'Command (one line, no line breaks) — must include --omi-action summon:',
        `/path/to/omi-windows.AppImage --omi-action summon`,
        'A bare AppImage path (no --omi-action) surfaces the main chat window, not the bar.',
        'Plasma Command/Script does not pass XDG_ACTIVATION_TOKEN — summon cannot raise over other apps without',
        'System Settings → Window Management → Focus → Focus Stealing Prevention → Low.',
        'Keep Omi running in the tray (close window ≠ quit). Test from a terminal:',
        '/path/to/omi-windows.AppImage --omi-action summon',
        'Assign the same chord in Plasma and in Omi. Log out/in once if Plasma ignores the bind.'
      ].join('\n')
    }
  }

  return null
}

/** Compositors / ozone combos where in-app globalShortcut does not deliver events. */
export function compositorNeedsKeybindWorkaround(
  compositor: LinuxCompositorKind,
  ozonePlatform: LinuxOzonePlatform = 'x11'
): boolean {
  if (compositor === 'niri' || compositor === 'sway') return true
  // Plasma + native Wayland: portal register can succeed without key delivery.
  if (compositor === 'kde' && ozonePlatform === 'wayland') return true
  return false
}

export function detectLinuxSession(env: NodeJS.ProcessEnv = process.env): LinuxSessionInfo {
  const sessionType = normalizeSessionType(env.XDG_SESSION_TYPE)
  const compositor = detectLinuxCompositor(env)
  const currentDesktop = env.XDG_CURRENT_DESKTOP?.trim() || null
  const desktopSession = env.DESKTOP_SESSION?.trim() || null
  const ozonePlatform = resolveLinuxOzonePlatform(env)

  return {
    sessionType,
    compositor,
    currentDesktop,
    desktopSession,
    ozonePlatform,
    portalAppId: LINUX_PORTAL_APP_ID,
    globalShortcuts: resolveGlobalShortcutsCapability(sessionType, ozonePlatform, compositor)
  }
}

export function resolveGlobalShortcutsCapability(
  sessionType: LinuxSessionType,
  ozonePlatform: LinuxOzonePlatform,
  compositor: LinuxCompositorKind = 'unknown'
): LinuxGlobalShortcutsCapability {
  const compositorWorkaround = buildCompositorWorkaround(compositor, ozonePlatform)
  const needsWorkaround = compositorNeedsKeybindWorkaround(compositor, ozonePlatform)

  if (ozonePlatform === 'x11') {
    // Default path: XWayland on a Wayland host still uses X11 grabs for
    // Electron globalShortcut; native X11 sessions do too. On niri/sway the grab
    // can register without ever delivering key events — compositor binds are required.
    return {
      available: true,
      mechanism: 'x11-grab',
      deliveryReliable: !needsWorkaround,
      compositorWorkaround
    }
  }
  // Native Wayland (OMI_OZONE=wayland): Electron binds through the
  // org.freedesktop.portal.GlobalShortcuts portal when desktop identity is valid.
  if (sessionType === 'wayland' || sessionType === 'unknown') {
    return {
      available: true,
      mechanism: 'wayland-portal',
      deliveryReliable: !needsWorkaround,
      compositorWorkaround
    }
  }
  return {
    available: false,
    reason: 'Native Wayland ozone on an X11 session is unsupported for global shortcuts.',
    compositorWorkaround
  }
}

/** Must run before app.ready on Linux so Wayland globalShortcut portal binds work. */
export function applyLinuxPortalIdentity(
  setDesktopName: (name: string) => void,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'linux') return
  setDesktopName(LINUX_PORTAL_APP_ID)
}

/** One-line summary for startup logs and future Settings diagnostics. */
export function formatLinuxSessionSummary(info: LinuxSessionInfo): string {
  const parts = [
    `session=${info.sessionType}`,
    `ozone=${info.ozonePlatform}`,
    `portal=${info.portalAppId}`
  ]
  if (info.currentDesktop) parts.push(`desktop=${info.currentDesktop}`)
  if (info.globalShortcuts.available) {
    const delivery = info.globalShortcuts.deliveryReliable ? 'ok' : 'compositor-keybind'
    parts.push(`shortcuts=${info.globalShortcuts.mechanism} delivery=${delivery}`)
  } else {
    parts.push(`shortcuts=unavailable (${info.globalShortcuts.reason})`)
  }
  if (info.compositor !== 'unknown') parts.push(`compositor=${info.compositor}`)
  return parts.join(' ')
}

export type LinuxSessionDiagnostics = LinuxSessionInfo & {
  summary: string
}

/** Serializable session facts for Settings → Shortcuts (Linux only). */
export function getLinuxSessionDiagnostics(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): LinuxSessionDiagnostics | null {
  if (platform !== 'linux') return null
  const info = detectLinuxSession(env)
  return { ...info, summary: formatLinuxSessionSummary(info) }
}
