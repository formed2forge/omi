// Native Wayland session detection and overlay policy for the Linux desktop build.
//
// Omi defaults to XWayland (`ozone-platform=x11`) for global shortcuts and
// active-window tracking. On compositors with limited XWayland (niri/Sway/
// Hyprland), `resolveLinuxOzonePlatform` auto-selects native Wayland (override
// with `OMI_OZONE`). That path cannot honor client `setBounds` off-screen
// parking or `setAlwaysOnTop` the way Windows/X11 do — see
// desktop/windows/docs/multi-worktree-dev.md.

import { resolveLinuxOzonePlatform } from './linuxSession'

/** True when Electron is running as a native Wayland client on Linux. */
export function isNativeWaylandLinux(): boolean {
  if (process.platform !== 'linux') return false
  return resolveLinuxOzonePlatform() === 'wayland'
}

/** How the bar hides while logically dismissed on Linux. */
export type LinuxBarParkStrategy = 'offscreen' | 'hide'

/** Off-screen park for Windows/XWayland; real hide on native Wayland. */
export function linuxBarParkStrategy(): LinuxBarParkStrategy {
  return isNativeWaylandLinux() ? 'hide' : 'offscreen'
}

/** Full-width top shell so the pill stays at the screen top even when the compositor ignores x/y. */
export function linuxBarUsesShellBounds(): boolean {
  return isNativeWaylandLinux()
}

/** `setAlwaysOnTop` is unsupported on native Wayland and reads as an intrusive float on tiling WMs. */
export function linuxBarSkipAlwaysOnTop(): boolean {
  return isNativeWaylandLinux()
}

/** Focus halo needs Win32 DWM frame bounds; skip the extra always-on-top window on native Wayland. */
export function shouldCreateGlowOnLinux(): boolean {
  return !isNativeWaylandLinux()
}
