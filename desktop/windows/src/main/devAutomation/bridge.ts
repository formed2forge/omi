import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { getPiMonoSession } from '../codingAgent/piMonoSession'
import { hasKnownControlPlaneOwner, controlPlaneOwnerId } from '../agentKernel/controlPlane'
import {
  generateAutomationToken,
  parseBearerToken,
  writeAutomationTokenFile
} from './token'
import { buildNavigateScript, resolveNavigateRequest } from './navigate'
import { listDevAutomationActions, runDevAutomationAction, isMainChatBusy } from './actions'

export const DEV_AUTOMATION_BRIDGE_NAME = 'omi-windows-dev-automation'

export interface DevAutomationHealth {
  ok: true
  name: string
  appName: string
  appVersion: string
  processID: number
  logFilePath: string
  bridgePort: number
  requiresAuth: true
  desktopApiBase: string | null
  ownerReady: boolean
  devInstanceName: string
  rendererOrigin: string
}

export interface DevAutomationSnapshot {
  appState: 'main' | 'onboarding' | 'sign-in' | 'loading'
  isSignedIn: boolean
  hasCompletedOnboarding: boolean
  isRestoringAuth: boolean
  snapshotStale: boolean
  pathname: string
  ownerId: string
  isMainChatBusy: boolean
}

export interface DevAutomationEnvelope<T> {
  ok: boolean
  result?: T
  error?: string
}

export interface DevAutomationBridgeOptions {
  port: number
  userDataPath: string
  appName: string
  appVersion: string
  devInstanceName: string
  rendererOrigin: string
  getMainWindow: () => BrowserWindow | null
}

type RouteRequest = {
  method: string
  path: string
  headers: Record<string, string | undefined>
  body: string
}

let activeToken: string | null = null
let activeServer: Server | null = null

export function getDevAutomationTokenForTests(): string | null {
  return activeToken
}

export function resetDevAutomationBridgeForTests(): void {
  activeToken = null
  if (activeServer) {
    activeServer.close()
    activeServer = null
  }
}

export function mainLogFilePath(userDataPath: string): string {
  return join(userDataPath, 'logs', 'main.log')
}

export async function readRendererAutomationSnapshot(
  getMainWindow: () => BrowserWindow | null
): Promise<Pick<
  DevAutomationSnapshot,
  'appState' | 'hasCompletedOnboarding' | 'isRestoringAuth' | 'pathname'
> | null> {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return null
  try {
    const raw = await win.webContents.executeJavaScript(
      `(function () {
        const hash = (window.location.hash || '').replace(/^#/, '') || '/home';
        let prefs = {};
        try {
          prefs = JSON.parse(localStorage.getItem('omi-windows-prefs-v1') || '{}');
        } catch (_) {}
        const onboarded = typeof prefs.onboardingCompletedAt === 'number';
        const authLoading = !!document.querySelector('[aria-label="Loading Omi…"], [aria-label="Loading Omi..."]');
        const onboardingVisible = !!document.querySelector('[data-testid="onboarding-root"]');
        const signedOut = !!document.querySelector('[data-testid="sign-in-screen"]');
        let appState = 'main';
        if (authLoading) appState = 'loading';
        else if (!onboarded && onboardingVisible) appState = 'onboarding';
        else if (signedOut) appState = 'sign-in';
        return {
          pathname: hash.startsWith('/') ? hash : '/' + hash,
          hasCompletedOnboarding: onboarded,
          isRestoringAuth: authLoading,
          appState
        };
      })()`,
      true
    )
    if (!raw || typeof raw !== 'object') return null
    const snapshot = raw as Record<string, unknown>
    const pathname = typeof snapshot.pathname === 'string' ? snapshot.pathname : '/home'
    const hasCompletedOnboarding = snapshot.hasCompletedOnboarding === true
    const isRestoringAuth = snapshot.isRestoringAuth === true
    const appStateRaw = snapshot.appState
    const appState =
      appStateRaw === 'onboarding' ||
      appStateRaw === 'sign-in' ||
      appStateRaw === 'loading' ||
      appStateRaw === 'main'
        ? appStateRaw
        : 'main'
    return { pathname, hasCompletedOnboarding, isRestoringAuth, appState }
  } catch {
    return null
  }
}

export async function buildAutomationSnapshot(
  options: Pick<DevAutomationBridgeOptions, 'getMainWindow' | 'userDataPath'>
): Promise<DevAutomationSnapshot> {
  const renderer = await readRendererAutomationSnapshot(options.getMainWindow)
  const ownerReady = hasKnownControlPlaneOwner()
  return {
    appState: renderer?.appState ?? (ownerReady ? 'main' : 'loading'),
    isSignedIn: ownerReady,
    hasCompletedOnboarding: renderer?.hasCompletedOnboarding ?? false,
    isRestoringAuth: renderer?.isRestoringAuth ?? false,
    snapshotStale: renderer == null,
    pathname: renderer?.pathname ?? '/home',
    ownerId: controlPlaneOwnerId(),
    isMainChatBusy: isMainChatBusy()
  }
}

export function buildHealthPayload(options: DevAutomationBridgeOptions): DevAutomationHealth {
  const session = getPiMonoSession()
  return {
    ok: true,
    name: DEV_AUTOMATION_BRIDGE_NAME,
    appName: options.appName,
    appVersion: options.appVersion,
    processID: process.pid,
    logFilePath: mainLogFilePath(options.userDataPath),
    bridgePort: options.port,
    requiresAuth: true,
    desktopApiBase: session?.desktopApiBase ?? null,
    ownerReady: hasKnownControlPlaneOwner(),
    devInstanceName: options.devInstanceName,
    rendererOrigin: options.rendererOrigin
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

async function readBody(req: IncomingMessage, maxBytes = 8 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) throw new Error('request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function headerMap(req: IncomingMessage): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value[0] : value
  }
  return out
}

function parseJsonBody(body: string): Record<string, unknown> {
  if (!body.trim()) return {}
  const parsed: unknown = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('expected JSON object body')
  }
  return parsed as Record<string, unknown>
}

function requireToken(headers: Record<string, string | undefined>): boolean {
  const token = parseBearerToken(headers.authorization)
  return !!activeToken && token === activeToken
}

export async function routeDevAutomationRequest(
  request: RouteRequest,
  options: DevAutomationBridgeOptions
): Promise<{ status: number; body: DevAutomationEnvelope<unknown> }> {
  const host = request.headers.host ?? ''
  if (!host.startsWith('127.0.0.1:') && host !== 'localhost' && !host.startsWith('localhost:')) {
    return { status: 403, body: { ok: false, error: 'invalid_host_or_origin' } }
  }

  if (request.method === 'GET' && request.path === '/health' && !request.headers.authorization) {
    return { status: 200, body: buildHealthPayload(options) }
  }

  if (!requireToken(request.headers)) {
    return { status: 401, body: { ok: false, error: 'invalid_or_missing_automation_token' } }
  }

  if (request.method === 'GET' && request.path === '/health') {
    const snapshot = await buildAutomationSnapshot(options)
    return { status: 200, body: { ok: true, result: snapshot } }
  }

  if (request.method === 'GET' && request.path === '/state') {
    const snapshot = await buildAutomationSnapshot(options)
    return { status: 200, body: { ok: true, result: snapshot } }
  }

  if (request.method === 'GET' && request.path === '/actions') {
    return { status: 200, body: { ok: true, result: listDevAutomationActions() } }
  }

  if (request.method === 'POST' && request.path === '/navigate') {
    try {
      const payload = parseJsonBody(request.body)
      const activateApp =
        payload.activateApp === true ||
        payload.activateApp === 'true' ||
        payload.activateApp === 1
      const resolved = resolveNavigateRequest({
        target: String(payload.target ?? ''),
        settingsSection:
          typeof payload.settingsSection === 'string' ? payload.settingsSection : undefined,
        activateApp
      })
      const win = options.getMainWindow()
      if (!win || win.isDestroyed()) throw new Error('main window is not available')
      await win.webContents.executeJavaScript(buildNavigateScript(resolved), true)
      if (activateApp) {
        if (!win.isVisible()) win.show()
        win.focus()
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
      const snapshot = await buildAutomationSnapshot(options)
      return { status: 200, body: { ok: true, result: snapshot } }
    } catch (error) {
      return {
        status: 400,
        body: { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  }

  if (request.method === 'POST' && request.path === '/action') {
    try {
      const payload = parseJsonBody(request.body)
      const name = String(payload.name ?? '').trim()
      const params =
        payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)
          ? Object.fromEntries(
              Object.entries(payload.params as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v)
              ])
            )
          : {}
      const result = await runDevAutomationAction(name, params)
      if (result.error && !result.accepted) {
        return { status: 400, body: { ok: false, error: result.error, result } }
      }
      const snapshot = await buildAutomationSnapshot(options)
      return { status: 200, body: { ok: true, result: { action: result, state: snapshot } } }
    } catch (error) {
      return {
        status: 400,
        body: { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  }

  return { status: 404, body: { ok: false, error: 'not_found' } }
}

export function startDevAutomationBridge(options: DevAutomationBridgeOptions): Server | null {
  if (activeServer) return activeServer
  activeToken = generateAutomationToken()
  writeAutomationTokenFile(options.port, activeToken)

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      const body =
        req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : ''
      const routed = await routeDevAutomationRequest(
        {
          method: req.method ?? 'GET',
          path: url.pathname,
          headers: headerMap(req),
          body
        },
        options
      )
      sendJson(res, routed.status, routed.body)
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  server.listen(options.port, '127.0.0.1', () => {
    console.log(
      `[devAutomation] listening on http://127.0.0.1:${options.port} (token file written)`
    )
  })
  activeServer = server
  return server
}

export function isDevAutomationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OMI_DEV_AUTOMATION !== '0'
}
