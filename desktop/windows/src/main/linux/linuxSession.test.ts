import { describe, expect, it } from 'vitest'
import {
  applyLinuxPortalIdentity,
  detectLinuxSession,
  formatLinuxSessionSummary,
  isLinuxWaylandSession,
  LINUX_PORTAL_APP_ID,
  resolveGlobalShortcutsCapability,
  resolveLinuxOzonePlatform
} from './linuxSession'

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
})

describe('isLinuxWaylandSession', () => {
  it('is true only for XDG_SESSION_TYPE=wayland', () => {
    expect(isLinuxWaylandSession({ XDG_SESSION_TYPE: 'wayland' })).toBe(true)
    expect(isLinuxWaylandSession({ XDG_SESSION_TYPE: 'x11' })).toBe(false)
    expect(isLinuxWaylandSession({})).toBe(false)
  })
})

describe('resolveGlobalShortcutsCapability', () => {
  it('uses x11-grab on the default XWayland path', () => {
    expect(resolveGlobalShortcutsCapability('wayland', 'x11')).toEqual({
      available: true,
      mechanism: 'x11-grab'
    })
  })

  it('uses wayland-portal on native Wayland ozone', () => {
    expect(resolveGlobalShortcutsCapability('wayland', 'wayland')).toEqual({
      available: true,
      mechanism: 'wayland-portal'
    })
  })

  it('still expects portal on unknown session type with native Wayland ozone', () => {
    expect(resolveGlobalShortcutsCapability('unknown', 'wayland')).toEqual({
      available: true,
      mechanism: 'wayland-portal'
    })
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
    expect(info.currentDesktop).toBe('GNOME')
    expect(info.desktopSession).toBe('ubuntu')
    expect(info.ozonePlatform).toBe('x11')
    expect(info.portalAppId).toBe('com.omiwindows.app')
    expect(info.globalShortcuts).toEqual({ available: true, mechanism: 'x11-grab' })
  })

  it('formats a stable one-line summary', () => {
    const summary = formatLinuxSessionSummary(
      detectLinuxSession({
        XDG_SESSION_TYPE: 'wayland',
        XDG_CURRENT_DESKTOP: 'KDE',
        OMI_OZONE: 'wayland'
      })
    )
    expect(summary).toContain('session=wayland')
    expect(summary).toContain('ozone=wayland')
    expect(summary).toContain('shortcuts=wayland-portal')
    expect(summary).toContain('desktop=KDE')
  })
})
