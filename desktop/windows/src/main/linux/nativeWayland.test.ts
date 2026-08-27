import { afterEach, describe, expect, it, vi } from 'vitest'

const env = { ...process.env }

afterEach(() => {
  process.env = { ...env }
  vi.unstubAllGlobals()
})

describe('isNativeWaylandLinux', () => {
  it('is false off Linux', async () => {
    vi.resetModules()
    vi.stubGlobal('process', { ...process, platform: 'win32', env: { ...process.env } })
    const { isNativeWaylandLinux } = await import('./nativeWayland')
    expect(isNativeWaylandLinux()).toBe(false)
  })

  it('is false on Linux XWayland (default ozone)', async () => {
    vi.resetModules()
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
      env: { ...process.env, XDG_SESSION_TYPE: 'wayland', OMI_OZONE: 'x11' }
    })
    const { isNativeWaylandLinux } = await import('./nativeWayland')
    expect(isNativeWaylandLinux()).toBe(false)
  })

  it('is true on native Wayland ozone', async () => {
    vi.resetModules()
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
      env: { ...process.env, XDG_SESSION_TYPE: 'wayland', OMI_OZONE: 'wayland' }
    })
    const { isNativeWaylandLinux, linuxBarParkStrategy, shouldCreateGlowOnLinux } =
      await import('./nativeWayland')
    expect(isNativeWaylandLinux()).toBe(true)
    expect(linuxBarParkStrategy()).toBe('hide')
    expect(shouldCreateGlowOnLinux()).toBe(false)
  })

  it('is true on niri auto-detect without OMI_OZONE', async () => {
    vi.resetModules()
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
      env: {
        ...process.env,
        XDG_SESSION_TYPE: 'tty',
        NIRI_SOCKET: '/run/user/1000/niri.sock'
      }
    })
    delete (process as { env: NodeJS.ProcessEnv }).env.OMI_OZONE
    const { isNativeWaylandLinux } = await import('./nativeWayland')
    expect(isNativeWaylandLinux()).toBe(true)
  })
})
