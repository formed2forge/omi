// Ozone platform defaults for Linux.
//
// XWayland (ozone-platform=x11) keeps global shortcuts + X11 active-window on
// many desktops, but on some Wayland compositors it fails to map windows at all
// (XGetWindowAttributes errors, blank/missing UI). Those sessions default to
// native Wayland instead; OMI_OZONE still overrides either way.
import {
  detectLinuxCompositor as detectSessionCompositor,
  detectWlrootsCompositor
} from './linux/compositorDetect'

/** @deprecated Prefer detectLinuxCompositor from linux/compositorDetect — kept
 *  as a thin alias for existing callers (returns wlroots name or undefined). */
export function detectLinuxCompositor(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return detectWlrootsCompositor(env)
}

export function defaultOzonePlatform(env: NodeJS.ProcessEnv = process.env): 'wayland' | 'x11' {
  // niri / sway / hyprland: XWayland often cannot map the main window.
  if (detectWlrootsCompositor(env)) return 'wayland'

  const session = env.XDG_SESSION_TYPE?.trim().toLowerCase()
  // Plasma Wayland: same class of XWayland map failure (seen on Fedora Asahi /
  // Plasma 6 — XGetWindowAttributes fails; UI never appears). Native Wayland +
  // portal shortcuts is the working default; OMI_OZONE=x11 forces XWayland.
  if (session === 'wayland' && detectSessionCompositor(env) === 'kde') return 'wayland'

  if (session !== 'wayland') return 'x11'
  return 'x11'
}
