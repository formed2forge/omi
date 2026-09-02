// Wlroots-family compositors known to ship without reliable XWayland support
// (confirmed on niri — see docs/multi-worktree-dev.md). Ozone defaults use the
// shared detector so a stale NIRI_SOCKET under Plasma/GNOME does not force
// native Wayland.
import { detectWlrootsCompositor } from './linux/compositorDetect'

/** @deprecated Prefer detectLinuxCompositor from linux/compositorDetect — kept
 *  as a thin alias for existing callers (returns wlroots name or undefined). */
export function detectLinuxCompositor(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return detectWlrootsCompositor(env)
}

// XWayland (ozone-platform=x11) is the default because it's the only path
// with working global shortcuts (push-to-talk/overlay summon) and the X11
// active-window query — see index.ts. That default only holds up on
// compositors that actually provide XWayland; on ones that don't, it leaves
// the main window unmapped instead of just degraded, so native Wayland (with
// its own, lesser limitations) is the better default there. OMI_OZONE stays
// available as an explicit override in either direction.
export function defaultOzonePlatform(env: NodeJS.ProcessEnv = process.env): 'wayland' | 'x11' {
  // Known Wayland-native compositors: detected after DE identity, so Plasma
  // with a leftover NIRI_SOCKET still gets the XWayland default.
  if (detectWlrootsCompositor(env)) return 'wayland'
  // Generic Wayland or X11 session without a recognized compositor (GNOME, KDE,
  // etc.): default to XWayland for global shortcuts + active-window detection.
  if (env.XDG_SESSION_TYPE !== 'wayland') return 'x11'
  return 'x11'
}
