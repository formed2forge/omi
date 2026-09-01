// resolveSpawnableCodingAgentAdapterId — the host's connected-coding-agent pick
// behind spawn_agent's managed-cloud fallback (see controlTools.test.ts for the
// dispatch-level regression suite). Hermetic: every impure edge (env, Claude
// OAuth status, kernel registration) is injected, so nothing here reads the real
// credentials file or touches the process-wide kernel singleton.

import { describe, expect, it } from 'vitest'
import {
  availableDirectedProviderIds,
  resolveSpawnableCodingAgentAdapterId,
  ensureDirectedCodingAgentRegistered
} from './controlPlane'

/** No adapter launch commands configured. */
const EMPTY_ENV: NodeJS.ProcessEnv = {}

describe('resolveSpawnableCodingAgentAdapterId', () => {
  it('picks Claude Code (acp) when its OAuth is connected', () => {
    const registered: string[] = []
    const picked = resolveSpawnableCodingAgentAdapterId({
      env: EMPTY_ENV,
      claudeConnected: () => true,
      ensureRegistered: (id) => {
        registered.push(id)
        return true
      }
    })
    expect(picked).toBe('acp')
    expect(registered).toEqual(['acp'])
  })

  it('skips a signed-out Claude Code and falls through to a configured external agent', () => {
    const picked = resolveSpawnableCodingAgentAdapterId({
      env: { OMI_OPENCLAW_ADAPTER_COMMAND: 'openclaw acp' },
      claudeConnected: () => false,
      ensureRegistered: () => true
    })
    expect(picked).toBe('openclaw')
  })

  it('returns null when nothing is connected (signed-out Claude, no external commands)', () => {
    const picked = resolveSpawnableCodingAgentAdapterId({
      env: EMPTY_ENV,
      claudeConnected: () => false,
      ensureRegistered: () => true
    })
    expect(picked).toBeNull()
  })

  it('falls through past an agent whose kernel registration fails', () => {
    const picked = resolveSpawnableCodingAgentAdapterId({
      env: { OMI_HERMES_ADAPTER_COMMAND: 'hermes acp' },
      claudeConnected: () => true,
      ensureRegistered: (id) => id !== 'acp'
    })
    expect(picked).toBe('hermes')
  })
})

describe('availableDirectedProviderIds', () => {
  it('is empty when neither OpenClaw nor Hermes has a launch command', () => {
    expect(availableDirectedProviderIds({ env: EMPTY_ENV })).toEqual([])
  })

  it('lists only the directed providers that have a command configured', () => {
    expect(
      availableDirectedProviderIds({
        env: { OMI_HERMES_ADAPTER_COMMAND: 'hermes acp' }
      })
    ).toEqual(['hermes'])
    expect(
      availableDirectedProviderIds({
        env: {
          OMI_OPENCLAW_ADAPTER_COMMAND: 'openclaw acp',
          OMI_HERMES_ADAPTER_COMMAND: 'hermes acp'
        }
      })
    ).toEqual(['openclaw', 'hermes'])
  })
})

describe('ensureDirectedCodingAgentRegistered', () => {
  it('returns false for hermes when no launch command is configured', () => {
    expect(
      ensureDirectedCodingAgentRegistered('hermes', {
        env: EMPTY_ENV,
        claudeConnected: () => false,
        ensureRegistered: () => true
      })
    ).toBe(false)
  })

  it('registers hermes when its launch command is configured', () => {
    const registered: string[] = []
    expect(
      ensureDirectedCodingAgentRegistered('hermes', {
        env: { OMI_HERMES_ADAPTER_COMMAND: 'hermes acp' },
        claudeConnected: () => false,
        ensureRegistered: (id) => {
          registered.push(id)
          return true
        }
      })
    ).toBe(true)
    expect(registered).toEqual(['hermes'])
  })

  it('returns false for an unknown / managed-cloud adapter id', () => {
    expect(
      ensureDirectedCodingAgentRegistered('pi-mono', {
        env: EMPTY_ENV,
        ensureRegistered: () => true
      })
    ).toBe(false)
  })
})
