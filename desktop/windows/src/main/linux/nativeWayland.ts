// Native Wayland session detection and overlay policy for the Linux desktop build.
//
// Omi defaults to XWayland (`ozone-platform=x11`) for global shortcuts and
// active-window tracking. On compositors with limited XWayland (e.g. niri),
// users set `OMI_OZONE=wayland`. That path cannot honor client `setBounds`
// off-screen parking or `setAlwaysOnTop` the way Windows/X11 do — see
// desktop/windows/docs/multi-worktree-dev.md.

/** True when Electron is running as a native Wayland client on Linux. */
export function isNativeWaylandLinux(): boolean {
  if (process.platform !== 'linux') return false
  if (process.env.XDG_SESSION_TYPE !== 'wayland') return false
  return (process.env.OMI_OZONE ?? 'x11') === 'wayland'
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
