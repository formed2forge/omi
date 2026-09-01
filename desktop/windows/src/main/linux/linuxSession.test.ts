import { describe, expect, it } from 'vitest'
import {
  applyLinuxPortalIdentity,
  compositorNeedsKeybindWorkaround,
  detectLinuxCompositor,
  detectLinuxSession,
  formatLinuxSessionSummary,
  getLinuxSessionDiagnostics,
  isLinuxWaylandSession,
  LINUX_PORTAL_APP_ID,
  resolveGlobalShortcutsCapability,
  resolveLinuxOzonePlatform
} from './linuxSession'

describe('getLinuxSessionDiagnostics', () => {
  it('returns null off linux', () => {
    expect(getLinuxSessionDiagnostics({}, 'win32')).toBeNull()
  })

  it('returns summary + structured facts on linux', () => {
    const diag = getLinuxSessionDiagnostics(
      { XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'GNOME', OMI_OZONE: 'x11' },
      'linux'
    )
    expect(diag?.sessionType).toBe('wayland')
    expect(diag?.summary).toContain('session=wayland')
    expect(diag?.globalShortcuts).toEqual({
      available: true,
      mechanism: 'x11-grab',
      deliveryReliable: true,
      compositorWorkaround: null
    })
  })
})

describe('applyLinuxPortalIdentity', () => {
  it('sets desktop name on linux only', () => {
    let name: string | null = null
    applyLinuxPortalIdentity((n) => {
      name = n
    }, 'linux')
    expect(name).toBe(LINUX_PORTAL_APP_ID)

    name = null
    applyLinuxPortalIdentity((n) => {
      name = n
    }, 'win32')
    expect(name).toBeNull()
  })
})

describe('resolveLinuxOzonePlatform', () => {
  it('defaults to x11 when OMI_OZONE is unset', () => {
    expect(resolveLinuxOzonePlatform({})).toBe('x11')
  })

  it('honors OMI_OZONE=wayland', () => {
    expect(resolveLinuxOzonePlatform({ OMI_OZONE: 'wayland' })).toBe('wayland')
  })

  it('treats any other OMI_OZONE value as x11', () => {
    expect(resolveLinuxOzonePlatform({ OMI_OZONE: 'auto' })).toBe('x11')
  })

  it('auto-detects niri even when XDG_SESSION_TYPE is unset', () => {
    expect(resolveLinuxOzonePlatform({ NIRI_SOCKET: '/run/user/1000/niri.sock' })).toBe('wayland')
  })

  it('lets OMI_OZONE=x11 override niri auto-detect', () => {
    expect(
      resolveLinuxOzonePlatform({
        NIRI_SOCKET: '/run/user/1000/niri.sock',
        OMI_OZONE: 'x11'
      })
    ).toBe('x11')
  })
})

describe('isLinuxWaylandSession', () => {
  it('is true only for XDG_SESSION_TYPE=wayland', () => {
    expect(isLinuxWaylandSession({ XDG_SESSION_TYPE: 'wayland' })).toBe(true)
    expect(isLinuxWaylandSession({ XDG_SESSION_TYPE: 'x11' })).toBe(false)
    expect(isLinuxWaylandSession({})).toBe(false)
  })
})

describe('detectLinuxCompositor', () => {
  it('detects niri from NIRI_SOCKET', () => {
    expect(detectLinuxCompositor({ NIRI_SOCKET: '/run/niri/0' })).toBe('niri')
  })

  it('detects sway from SWAYSOCK', () => {
    expect(detectLinuxCompositor({ SWAYSOCK: '/run/user/1000/sway-ipc.0' })).toBe('sway')
  })
})

describe('resolveGlobalShortcutsCapability', () => {
  it('uses x11-grab on the default XWayland path', () => {
    expect(resolveGlobalShortcutsCapability('wayland', 'x11', 'gnome')).toEqual({
      available: true,
      mechanism: 'x11-grab',
      deliveryReliable: true,
      compositorWorkaround: null
    })
  })

  it('marks niri delivery unreliable with compositor workaround', () => {
    const cap = resolveGlobalShortcutsCapability('wayland', 'x11', 'niri')
    expect(cap).toMatchObject({
      available: true,
      mechanism: 'x11-grab',
      deliveryReliable: false
    })
    if (cap.available) {
      expect(cap.compositorWorkaround?.summonCommand).toContain('--omi-action summon')
      expect(cap.compositorWorkaround?.niriConfigExample).toContain('Mod+Shift+Space')
    }
  })

  it('uses wayland-portal on native Wayland ozone', () => {
    expect(resolveGlobalShortcutsCapability('wayland', 'wayland', 'gnome')).toEqual({
      available: true,
      mechanism: 'wayland-portal',
      deliveryReliable: true,
      compositorWorkaround: null
    })
  })

  it('still expects portal on unknown session type with native Wayland ozone', () => {
    expect(resolveGlobalShortcutsCapability('unknown', 'wayland', 'unknown')).toEqual({
      available: true,
      mechanism: 'wayland-portal',
      deliveryReliable: true,
      compositorWorkaround: null
    })
  })
})

describe('compositorNeedsKeybindWorkaround', () => {
  it('is true for niri and sway only', () => {
    expect(compositorNeedsKeybindWorkaround('niri')).toBe(true)
    expect(compositorNeedsKeybindWorkaround('sway')).toBe(true)
    expect(compositorNeedsKeybindWorkaround('gnome')).toBe(false)
  })
})

describe('detectLinuxSession', () => {
  it('collects desktop env vars and capability', () => {
    const info = detectLinuxSession({
      XDG_SESSION_TYPE: 'wayland',
      XDG_CURRENT_DESKTOP: 'GNOME',
      DESKTOP_SESSION: 'ubuntu',
      OMI_OZONE: 'x11'
    })
    expect(info.sessionType).toBe('wayland')
    expect(info.compositor).toBe('gnome')
    expect(info.currentDesktop).toBe('GNOME')
    expect(info.desktopSession).toBe('ubuntu')
    expect(info.ozonePlatform).toBe('x11')
    expect(info.portalAppId).toBe('com.omiwindows.app')
    expect(info.globalShortcuts).toEqual({
      available: true,
      mechanism: 'x11-grab',
      deliveryReliable: true,
      compositorWorkaround: null
    })
  })

  it('formats a stable one-line summary', () => {
    const summary = formatLinuxSessionSummary(
      detectLinuxSession({
        XDG_SESSION_TYPE: 'wayland',
        XDG_CURRENT_DESKTOP: 'KDE',
        OMI_OZONE: 'wayland',
        NIRI_SOCKET: '/run/niri/0'
      })
    )
    expect(summary).toContain('session=wayland')
    expect(summary).toContain('ozone=wayland')
    expect(summary).toContain('shortcuts=wayland-portal')
    expect(summary).toContain('delivery=compositor-keybind')
    expect(summary).toContain('compositor=niri')
    expect(summary).toContain('desktop=KDE')
  })
})
