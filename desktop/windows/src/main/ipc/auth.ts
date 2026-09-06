// Electron wiring for the backend-mediated provider sign-in flow. The actual
// flow (loopback listener, authorize URL, token exchange) lives in
// src/main/auth/signInFlow.ts and is Electron-free; this file supplies
// the browser opener, file logging, and window surfacing.
import { app, ipcMain, shell } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { startSignIn } from '../auth/signInFlow'
import { requestLocalDevCustomToken, sanitizeLocalDevUid } from '../auth/localDevAuth'
import { resolveAppProfile } from '../../shared/environmentProfile'
import type { SignInProvider, SignInResult } from '../../shared/types'

// Main-process console.log only reaches the dev-server terminal, which is easy
// to miss. Also append to userData/sign-in.log so a failed field sign-in
// can be traced after the fact (same pattern as integrations/oauth.ts).
function authLog(msg: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`
  console.log('[sign-in]', line)
  try {
    appendFileSync(join(app.getPath('userData'), 'sign-in.log'), line + '\n')
  } catch {
    /* best-effort logging only */
  }
}

function apiBase(): string {
  return import.meta.env.VITE_OMI_API_BASE || 'https://api.omi.me'
}

/** The real gate — the profile check is main-controlled and build-time frozen
 *  (see shared/environmentProfile.ts), so a compromised/stale renderer asking for
 *  this handler outside local_dev is refused here regardless of what UI it shows. */
function isLocalDevProfile(): boolean {
  return resolveAppProfile(import.meta.env.VITE_OMI_APP_PROFILE) === 'local_dev'
}

/**
 * Register the auth IPC. `onSignedIn` surfaces the main window after the
 * loopback callback lands (the browser holds foreground focus at that point —
 * see index.ts for the focus-steal implementation).
 */
export function registerAuthHandlers(onSignedIn: () => void): void {
  ipcMain.handle('auth:signIn', async (_event, provider: unknown): Promise<SignInResult> => {
    if (provider !== 'google' && provider !== 'apple') {
      return { ok: false, error: 'Unsupported sign-in provider' }
    }
    authLog(`${provider} sign-in requested`)
    const result = await startSignIn(provider as SignInProvider, {
      apiBase: apiBase(),
      openExternal: (url) => shell.openExternal(url),
      log: authLog
    })
    if (result.ok) {
      authLog(`${provider} sign-in complete — surfacing window`)
      onSignedIn()
    }
    return result
  })

  // Local-dev harness sign-in: exchanges a seeded emulator uid (e.g. pricing_plus)
  // for a Firebase custom token via the local backend's
  // /v1/auth/local-dev/custom-token, so a Windows tester can run the pricing
  // catalogue without a real OAuth client. Gated on the build-time local_dev
  // profile — outside it this handler always refuses, independent of the
  // renderer's own UI gate. See scripts/dev-harness/PRICING_WINDOWS.md.
  ipcMain.handle('auth:signInLocalDev', async (_event, rawUid: unknown): Promise<SignInResult> => {
    if (!isLocalDevProfile()) {
      return {
        ok: false,
        error: 'Local development sign-in is only available in the local_dev profile.'
      }
    }
    const uid = sanitizeLocalDevUid(typeof rawUid === 'string' ? rawUid : '')
    if (!uid) {
      return { ok: false, error: 'UID must be 1-128 characters: letters, numbers, "_" or "-".' }
    }
    authLog('local-dev sign-in requested', { uid })
    try {
      const token = await requestLocalDevCustomToken(apiBase(), uid)
      authLog('local-dev sign-in complete — surfacing window', { uid: token.uid })
      onSignedIn()
      return { ok: true, customToken: token.customToken }
    } catch (e) {
      const error = (e as Error).message
      authLog('local-dev sign-in failed', { error })
      return { ok: false, error }
    }
  })
}
