import { randomUUID } from 'node:crypto'
import { controlPlaneOwnerId, hasKnownControlPlaneOwner } from '../agentKernel/controlPlane'
import { runMainChatTurn } from '../ipc/mainChat'
import { executeVoiceHubTool } from '../ipc/voiceTool'
import type { MainChatEvent } from '../../shared/types'

export type DevAutomationActionResult = Record<string, string>

export interface DevAutomationActionContext {
  ownerReady: boolean
  isMainChatBusy: () => boolean
  setMainChatBusy: (busy: boolean) => void
}

let mainChatInFlight = 0

export function isMainChatBusy(): boolean {
  return mainChatInFlight > 0
}

export function resetMainChatBusyForTests(): void {
  mainChatInFlight = 0
}

export function listDevAutomationActions(): string[] {
  return [
    'ask_main_chat',
    'ask_main_chat_no_wait',
    'main_chat_busy_state',
    'voice_tool_execute'
  ]
}

export async function runDevAutomationAction(
  name: string,
  params: Record<string, string>,
  ctx: DevAutomationActionContext = defaultActionContext()
): Promise<DevAutomationActionResult> {
  switch (name) {
    case 'ask_main_chat':
      return askMainChat(params, ctx, { wait: true })
    case 'ask_main_chat_no_wait':
      return askMainChat(params, ctx, { wait: false })
    case 'main_chat_busy_state':
      return mainChatBusyState(ctx)
    case 'voice_tool_execute':
      return voiceToolExecute(params, ctx)
    default:
      return { error: `unknown action: ${name}` }
  }
}

function defaultActionContext(): DevAutomationActionContext {
  return {
    ownerReady: hasKnownControlPlaneOwner(),
    isMainChatBusy: () => isMainChatBusy(),
    setMainChatBusy: (busy) => {
      if (busy) mainChatInFlight += 1
      else mainChatInFlight = Math.max(0, mainChatInFlight - 1)
    }
  }
}

function mainChatBusyState(ctx: DevAutomationActionContext): DevAutomationActionResult {
  const busy = ctx.isMainChatBusy()
  return {
    busy: busy ? 'true' : 'false',
    is_sending: busy ? 'true' : 'false'
  }
}

async function askMainChat(
  params: Record<string, string>,
  ctx: DevAutomationActionContext,
  opts: { wait: boolean }
): Promise<DevAutomationActionResult> {
  const query = (params.query ?? '').trim()
  if (!query) return { error: "missing 'query'" }
  if (!ctx.ownerReady) return { error: 'sign-in has not completed yet' }
  if (ctx.isMainChatBusy()) {
    return {
      accepted: 'false',
      busy: 'true',
      is_sending: 'true',
      reason: 'already_sending',
      query
    }
  }

  const requestId = randomUUID()
  const sendArgs = {
    requestId,
    prompt: query,
    cleanUserText: query
  }

  const run = async (): Promise<DevAutomationActionResult> => {
    ctx.setMainChatBusy(true)
    try {
      const result = await runMainChatTurn(sendArgs, (_event: MainChatEvent) => {
        /* streaming events are visible in renderer; harness waits on terminal result */
      })
      if (!result.ok) {
        return {
          accepted: 'true',
          ok: 'false',
          requestId,
          runId: result.runId,
          error: result.error ?? 'main chat failed',
          query
        }
      }
      return {
        accepted: 'true',
        ok: 'true',
        requestId,
        runId: result.runId,
        query,
        text: result.text
      }
    } catch (error) {
      return {
        accepted: 'false',
        ok: 'false',
        error: error instanceof Error ? error.message : String(error),
        query
      }
    } finally {
      ctx.setMainChatBusy(false)
    }
  }

  if (!opts.wait) {
    void run()
    return {
      accepted: 'true',
      busy: 'false',
      is_sending: 'false',
      query
    }
  }

  return run()
}

async function voiceToolExecute(
  params: Record<string, string>,
  ctx: DevAutomationActionContext
): Promise<DevAutomationActionResult> {
  if (!ctx.ownerReady) return { error: 'sign-in has not completed yet' }
  const name = (params.name ?? '').trim()
  if (!name) return { error: "missing 'name'" }
  const argumentsJSON = params.argumentsJSON ?? params.arguments ?? '{}'
  const output = await executeVoiceHubTool({ name, argumentsJSON })
  if (output.startsWith('Error:')) return { error: output.slice('Error: '.length), name }
  return { name, output }
}

/** Exposed for tests that need to assert owner gating without a signed-in session. */
export function devAutomationOwnerId(): string {
  return controlPlaneOwnerId()
}
