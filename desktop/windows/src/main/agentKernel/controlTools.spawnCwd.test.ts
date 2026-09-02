import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveSpawnCwd = vi.fn()

vi.mock('./resolveSpawnCwd', () => ({
  resolveSpawnCwd: (...args: unknown[]) => resolveSpawnCwd(...args)
}))

import { AgentRuntimeKernel } from './kernel'
import { AdapterRegistry } from './adapterRegistry'
import { SqliteAgentStore, type DatabaseFactory } from './store'
import { handleAgentControlToolCall, type AgentControlToolContext } from './controlTools'
import { adapterCapabilitiesFor, type RuntimeAdapter } from '../codingAgent/interface'

const nodeSqliteFactory = DatabaseSync as unknown as DatabaseFactory
const createdDirs: string[] = []
const openStores: SqliteAgentStore[] = []
const OWNER = 'owner-1'

afterEach(() => {
  for (const store of openStores.splice(0)) {
    try {
      store.close()
    } catch {
      // already closed
    }
  }
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function fakeAdapter(adapterId: 'acp'): RuntimeAdapter {
  return {
    adapterId,
    capabilities: adapterCapabilitiesFor(adapterId),
    async start() {
      /* no-op fake */
    },
    async stop() {
      /* no-op fake */
    },
    async openBinding(input) {
      return {
        sessionId: input.sessionId,
        adapterId,
        adapterNativeSessionId: `native-${input.sessionId}`,
        resumeFidelity: 'none',
        cwd: input.cwd
      }
    },
    async resumeBinding(input) {
      return {
        sessionId: input.sessionId,
        adapterId,
        adapterNativeSessionId: input.adapterNativeSessionId,
        resumeFidelity: 'none',
        cwd: input.cwd
      }
    },
    async executeAttempt(context) {
      return {
        text: 'ok',
        adapterSessionId: context.binding.adapterNativeSessionId,
        terminalStatus: 'succeeded'
      }
    },
    async cancelAttempt() {
      return { accepted: true, dispatchAttempted: true, adapterAcknowledged: false }
    }
  }
}

function newKernel(): AgentRuntimeKernel {
  const dir = mkdtempSync(join(tmpdir(), 'omi-spawn-cwd-control-'))
  createdDirs.push(dir)
  const store = new SqliteAgentStore({
    databaseFactory: nodeSqliteFactory,
    databasePath: join(dir, 'omi-agentd.sqlite3')
  })
  openStores.push(store)
  const registry = new AdapterRegistry()
  registry.register('acp', () => fakeAdapter('acp'))
  return new AgentRuntimeKernel({ store, registry })
}

async function call(
  context: AgentControlToolContext,
  name: string,
  input: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  return JSON.parse(await handleAgentControlToolCall(context, name, input)) as Record<string, unknown>
}

describe('spawn cwd inference on control-tool spawns', () => {
  it('infers cwd for spawn_agent when the model omits cwd', async () => {
    resolveSpawnCwd.mockReset()
    resolveSpawnCwd.mockResolvedValue('/home/me/projects/omi')
    const kernel = newKernel()
    const context: AgentControlToolContext = {
      kernel,
      trustedUserControl: false,
      executionRole: 'coordinator',
      defaultAdapterId: 'pi-mono',
      providerBoundary: 'managed_cloud',
      getOwnerId: () => OWNER,
      resolveSpawnableAdapterId: async () => 'acp'
    }

    const result = await call(context, 'spawn_agent', {
      objective: 'fix the failing test in my omi repo'
    })

    expect(result.ok).toBe(true)
    expect(resolveSpawnCwd).toHaveBeenCalledWith('fix the failing test in my omi repo')
    expect((result.run as { cwd?: string }).cwd).toBe('/home/me/projects/omi')
  })

  it('keeps an explicit cwd and does not infer from the message', async () => {
    resolveSpawnCwd.mockReset()
    const kernel = newKernel()
    const context: AgentControlToolContext = {
      kernel,
      trustedUserControl: true,
      executionRole: 'coordinator',
      getOwnerId: () => OWNER
    }

    const result = await call(context, 'spawn_background_agent', {
      prompt: 'fix the failing test in my omi repo',
      cwd: '/explicit/cwd'
    })

    expect(result.ok).toBe(true)
    expect(resolveSpawnCwd).not.toHaveBeenCalled()
    expect((result.run as { cwd?: string }).cwd).toBe('/explicit/cwd')
  })
})
