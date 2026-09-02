// Single compositor/DE detector for session diagnostics and ozone defaults.
//
// Full desktop environments (KDE/GNOME) are identified from XDG_* and win over
// leftover compositor socket env (NIRI_SOCKET / SWAYSOCK / …) from a previous
// login — seen on Plasma Wayland where a stale NIRI_SOCKET made Omi report
// compositor=niri and default ozone=wayland.

export type LinuxCompositorKind = 'niri' | 'sway' | 'hyprland' | 'gnome' | 'kde' | 'unknown'

function desktopBlob(env: NodeJS.ProcessEnv): string {
  return `${env.XDG_CURRENT_DESKTOP ?? ''}:${env.DESKTOP_SESSION ?? ''}`.toLowerCase()
}

export function detectLinuxCompositor(env: NodeJS.ProcessEnv = process.env): LinuxCompositorKind {
  const blob = desktopBlob(env)
  const namesNiri = blob.includes('niri')
  const namesSway = blob.includes('sway')
  const namesHypr = blob.includes('hyprland') || blob.includes('hypr')
  const hasKde = blob.includes('kde') || blob.includes('plasma')
  const hasGnome = blob.includes('gnome') || blob.includes('unity')

  // Plasma/GNOME session identity beats stale wlroots socket markers.
  if (hasKde && !namesNiri && !namesSway && !namesHypr) return 'kde'
  if (hasGnome && !namesNiri && !namesSway && !namesHypr) return 'gnome'

  if (namesNiri || env.NIRI_SOCKET?.trim()) return 'niri'
  if (namesSway || env.SWAYSOCK?.trim()) return 'sway'
  if (namesHypr || env.HYPRLAND_INSTANCE_SIGNATURE?.trim()) return 'hyprland'
  return 'unknown'
}

/** Wlroots-only view used by ozone defaults (`undefined` → keep XWayland default). */
export function detectWlrootsCompositor(
  env: NodeJS.ProcessEnv = process.env
): 'niri' | 'sway' | 'hyprland' | undefined {
  const kind = detectLinuxCompositor(env)
  if (kind === 'niri' || kind === 'sway' || kind === 'hyprland') return kind
  return undefined
}
