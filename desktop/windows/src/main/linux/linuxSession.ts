// Linux desktop session facts for global-shortcut portal identity and runtime
// capability hints. Phase 0 of the Linux shortcuts work: give Electron a stable
// portal app ID (desktopName + .desktop) and centralize session detection so
// later phases (conflict scanners, Settings UX) read one source of truth.

/** Reverse-DNS portal identity — must match appId, package.json desktopName, and
 *  the installed .desktop basename (com.omiwindows.app.desktop). */
export const LINUX_PORTAL_APP_ID = 'com.omiwindows.app'

export const LINUX_DESKTOP_FILE_BASENAME = `${LINUX_PORTAL_APP_ID}.desktop`

/** WM_CLASS / StartupWMClass written into the shipped .desktop entry. */
export const LINUX_STARTUP_WM_CLASS = 'omi-windows'

export type LinuxSessionType = 'wayland' | 'x11' | 'unknown'

export type LinuxOzonePlatform = 'x11' | 'wayland'

export type LinuxGlobalShortcutsCapability =
  | { available: true; mechanism: 'x11-grab' | 'wayland-portal' }
  | { available: false; reason: string }

export type LinuxSessionInfo = {
  sessionType: LinuxSessionType
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

/** Resolve ozone platform from OMI_OZONE (dev override) — default x11 / XWayland. */
export function resolveLinuxOzonePlatform(env: NodeJS.ProcessEnv = process.env): LinuxOzonePlatform {
  const raw = env.OMI_OZONE?.trim().toLowerCase()
  return raw === 'wayland' ? 'wayland' : 'x11'
}

export function isLinuxWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return normalizeSessionType(env.XDG_SESSION_TYPE) === 'wayland'
}

export function detectLinuxSession(env: NodeJS.ProcessEnv = process.env): LinuxSessionInfo {
  const sessionType = normalizeSessionType(env.XDG_SESSION_TYPE)
  const currentDesktop = env.XDG_CURRENT_DESKTOP?.trim() || null
  const desktopSession = env.DESKTOP_SESSION?.trim() || null
  const ozonePlatform = resolveLinuxOzonePlatform(env)

  return {
    sessionType,
    currentDesktop,
    desktopSession,
    ozonePlatform,
    portalAppId: LINUX_PORTAL_APP_ID,
    globalShortcuts: resolveGlobalShortcutsCapability(sessionType, ozonePlatform)
  }
}

export function resolveGlobalShortcutsCapability(
  sessionType: LinuxSessionType,
  ozonePlatform: LinuxOzonePlatform
): LinuxGlobalShortcutsCapability {
  if (ozonePlatform === 'x11') {
    // Default path: XWayland on a Wayland host still uses X11 grabs for
    // Electron globalShortcut; native X11 sessions do too.
    return { available: true, mechanism: 'x11-grab' }
  }
  // Native Wayland (OMI_OZONE=wayland): Electron binds through the
  // org.freedesktop.portal.GlobalShortcuts portal when desktop identity is valid.
  if (sessionType === 'wayland' || sessionType === 'unknown') {
    return { available: true, mechanism: 'wayland-portal' }
  }
  return {
    available: false,
    reason: 'Native Wayland ozone on an X11 session is unsupported for global shortcuts.'
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
    parts.push(`shortcuts=${info.globalShortcuts.mechanism}`)
  } else {
    parts.push(`shortcuts=unavailable (${info.globalShortcuts.reason})`)
  }
  return parts.join(' ')
}
