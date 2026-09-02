// XDG activation token handling for native-Wayland compositor summons (KDE Plasma
// command shortcuts, niri/sway spawns, etc.). Wayland compositors require a
// one-shot activation token to raise a surface above other clients; without it
// app.focus() only flashes the taskbar entry.

import { app, type BrowserWindow } from 'electron'
import { isNativeWaylandLinux } from './nativeWayland'

const XDG_TOKEN_ENV = 'XDG_ACTIVATION_TOKEN'
const XDG_TOKEN_SWITCH = '--xdg-activation-token='

let pendingActivationToken: string | null = null

function normalizeToken(raw: string | undefined | null): string | null {
  const token = raw?.trim()
  return token ? token : null
}

/** Capture a token from argv (second-instance handoff) or additionalData. */
export function stashLinuxActivationFromSecondInstance(
  argv: readonly string[],
  additionalData?: unknown
): void {
  for (const arg of argv) {
    if (arg.startsWith(XDG_TOKEN_SWITCH)) {
      pendingActivationToken = normalizeToken(arg.slice(XDG_TOKEN_SWITCH.length))
      return
    }
  }
  if (additionalData && typeof additionalData === 'object') {
    const record = additionalData as Record<string, unknown>
    const fromData =
      normalizeToken(typeof record.activationToken === 'string' ? record.activationToken : null) ??
      normalizeToken(typeof record[XDG_TOKEN_ENV] === 'string' ? (record[XDG_TOKEN_ENV] as string) : null)
    if (fromData) {
      pendingActivationToken = fromData
      return
    }
  }
  stashLinuxActivationFromEnv()
}

/** Capture a token from the process environment (cold compositor spawn). */
export function stashLinuxActivationFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const fromEnv = normalizeToken(env[XDG_TOKEN_ENV])
  if (fromEnv) pendingActivationToken = fromEnv
}

function consumeActivationToken(): string | null {
  const token = pendingActivationToken ?? normalizeToken(process.env[XDG_TOKEN_ENV])
  pendingActivationToken = null
  if (token) delete process.env[XDG_TOKEN_ENV]
  return token
}

/** Apply a pending XDG activation token before the next window raise/focus. */
export function applyLinuxActivationToken(): boolean {
  if (!isNativeWaylandLinux()) return false
  const token = consumeActivationToken()
  if (!token) return false
  const appWithToken = app as typeof app & { setActivationToken?: (value: string) => void }
  if (typeof appWithToken.setActivationToken === 'function') {
    appWithToken.setActivationToken(token)
  } else {
    // Chromium consumes XDG_ACTIVATION_TOKEN on the next activation request.
    process.env[XDG_TOKEN_ENV] = token
  }
  return true
}

/** Raise the bar above other Wayland clients; consume an activation token on the
 *  bar surface when Plasma/KDE supplied one. */
export function raiseWaylandBarWindow(win: BrowserWindow): void {
  if (!isNativeWaylandLinux() || win.isDestroyed()) return
  const hadToken = applyLinuxActivationToken()
  if (!win.isVisible()) win.show()
  else win.show()
  win.moveTop()
  if (!hadToken) return
  const wasFocusable = win.isFocusable()
  if (!wasFocusable) win.setFocusable(true)
  win.focus()
  if (!wasFocusable) win.setFocusable(false)
}
