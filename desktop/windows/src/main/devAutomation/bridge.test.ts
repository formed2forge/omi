import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveNavigateRequest, buildNavigateScript } from './navigate'
import { parseBearerToken, automationTokenFilePath } from './token'
import {
  routeDevAutomationRequest,
  resetDevAutomationBridgeForTests,
  getDevAutomationTokenForTests,
  startDevAutomationBridge
} from './bridge'
import { resetMainChatBusyForTests, runDevAutomationAction } from './actions'

describe('devAutomation navigate', () => {
  it('maps dashboard and rewind targets to hash routes', () => {
    expect(resolveNavigateRequest({ target: 'dashboard' }).hashPath).toBe('/home')
    expect(resolveNavigateRequest({ target: 'rewind' }).hashPath).toBe('/rewind')
  })

  it('maps settings sections to dev settings tabs', () => {
    const resolved = resolveNavigateRequest({ target: 'settings', settingsSection: 'shortcuts' })
    expect(resolved.hashPath).toBe('/settings')
    expect(resolved.settingsTab).toBe('shortcuts')
    expect(buildNavigateScript(resolved)).toContain('__omiDevSettingsTab')
  })

  it('rejects unknown targets', () => {
    expect(() => resolveNavigateRequest({ target: 'nope' })).toThrow(/unknown navigation target/)
  })
})

describe('devAutomation token', () => {
  it('parses bearer tokens case-insensitively', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123')
    expect(parseBearerToken('bearer xyz')).toBe('xyz')
    expect(parseBearerToken('Basic nope')).toBeNull()
  })

  it('honors OMI_AUTOMATION_TOKEN_FILE', () => {
    expect(automationTokenFilePath(47777, { OMI_AUTOMATION_TOKEN_FILE: '/tmp/custom.token' })).toBe(
      '/tmp/custom.token'
    )
  })
})

describe('devAutomation bridge routes', () => {
  const options = {
    port: 47777,
    userDataPath: '/tmp/omi-userdata',
    appName: 'Omi Dev',
    appVersion: '1.0.0',
    devInstanceName: 'primary',
    rendererOrigin: 'http://localhost:5179',
    getMainWindow: () => null
  }

  it('serves unauthenticated /health', async () => {
    const res = await routeDevAutomationRequest(
      { method: 'GET', path: '/health', headers: { host: '127.0.0.1:47777' }, body: '' },
      options
    )
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect((res.body as { name?: string }).name).toBe('omi-windows-dev-automation')
  })

  it('rejects authenticated routes without a bearer token', async () => {
    const res = await routeDevAutomationRequest(
      { method: 'GET', path: '/state', headers: { host: '127.0.0.1:47777' }, body: '' },
      options
    )
    expect(res.status).toBe(401)
  })

  it('accepts authenticated /state after the bridge starts', async () => {
    startDevAutomationBridge(options)
    const token = getDevAutomationTokenForTests()
    expect(token).toBeTruthy()
    const res = await routeDevAutomationRequest(
      {
        method: 'GET',
        path: '/state',
        headers: { host: '127.0.0.1:47777', authorization: `Bearer ${token}` },
        body: ''
      },
      options
    )
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('devAutomation actions', () => {
  it('rejects ask_main_chat when owner is not ready', async () => {
    const result = await runDevAutomationAction(
      'ask_main_chat',
      { query: 'hello' },
      {
        ownerReady: false,
        isMainChatBusy: () => false,
        setMainChatBusy: () => {}
      }
    )
    expect(result.error).toMatch(/sign-in/)
  })

  it('returns busy when a main-chat turn is already in flight', async () => {
    const result = await runDevAutomationAction(
      'ask_main_chat',
      { query: 'hello' },
      {
        ownerReady: true,
        isMainChatBusy: () => true,
        setMainChatBusy: () => {}
      }
    )
    expect(result.accepted).toBe('false')
    expect(result.busy).toBe('true')
  })

  it('lists the v1 action surface', async () => {
    const mod = await import('./actions')
    expect(mod.listDevAutomationActions()).toEqual([
      'ask_main_chat',
      'ask_main_chat_no_wait',
      'main_chat_busy_state',
      'voice_tool_execute'
    ])
  })
})

afterEach(() => {
  resetDevAutomationBridgeForTests()
  resetMainChatBusyForTests()
  vi.restoreAllMocks()
})
