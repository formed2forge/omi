import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    setActivationToken: vi.fn()
  }
}))

const moveTop = vi.fn()
const show = vi.fn()
const focus = vi.fn()
const setFocusable = vi.fn()
const isFocusable = vi.fn(() => false)
const win = { isDestroyed: () => false, isVisible: () => false, show, moveTop, focus, setFocusable, isFocusable }

import { app } from 'electron'
import {
  applyLinuxActivationToken,
  raiseWaylandBarWindow,
  stashLinuxActivationFromEnv,
  stashLinuxActivationFromSecondInstance
} from './waylandActivation'

const appWithToken = app as typeof app & { setActivationToken: ReturnType<typeof vi.fn> }

vi.mock('./nativeWayland', () => ({
  isNativeWaylandLinux: () => true
}))

describe('waylandActivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.XDG_ACTIVATION_TOKEN
  })

  afterEach(() => {
    delete process.env.XDG_ACTIVATION_TOKEN
  })

  it('stashes XDG_ACTIVATION_TOKEN from the environment', () => {
    process.env.XDG_ACTIVATION_TOKEN = 'token-from-env'
    stashLinuxActivationFromEnv()
    expect(applyLinuxActivationToken()).toBe(true)
    expect(appWithToken.setActivationToken).toHaveBeenCalledWith('token-from-env')
    expect(process.env.XDG_ACTIVATION_TOKEN).toBeUndefined()
  })

  it('parses --xdg-activation-token from second-instance argv', () => {
    stashLinuxActivationFromSecondInstance(['omi-windows', '--xdg-activation-token=abc123'])
    expect(applyLinuxActivationToken()).toBe(true)
    expect(appWithToken.setActivationToken).toHaveBeenCalledWith('abc123')
  })

  it('raises the bar with show + moveTop and consumes the token via focus', () => {
    process.env.XDG_ACTIVATION_TOKEN = 'raise-me'
    raiseWaylandBarWindow(win as never)
    expect(show).toHaveBeenCalled()
    expect(moveTop).toHaveBeenCalled()
    expect(setFocusable).toHaveBeenCalledWith(true)
    expect(focus).toHaveBeenCalled()
    expect(setFocusable).toHaveBeenCalledWith(false)
  })
})
