// IPC surface for the local (on-device) ASR path — structurally parallel to
// omiListen.ts's start/feed/stop/message shape, but backed by localAsrSession's
// buffer-and-run-inference loop instead of a cloud WebSocket. Feed is `on` (not
// `handle`), matching omi-listen:feed, to keep the hot audio path fire-and-forget.
import { ipcMain, webContents } from 'electron'
import {
  createLocalAsrManager,
  defaultDeps,
  type LocalAsrManager
} from '../localAsr/localAsrSession'
import { getAppSettings } from '../appSettings'
import { summarizeTranscript } from '../inference/localLlmService'
import type { LocalAsrMessage } from '../../shared/types'

const sessionOwners = new Map<string, number>()

function emit(ownerId: number, msg: LocalAsrMessage): void {
  const wc = webContents.fromId(ownerId)
  if (wc && !wc.isDestroyed()) {
    wc.send('omi-local-asr:message', msg)
  }
}

/** Authorization seam mirroring isListenSessionOwnedBy: a command may only touch
 *  the session its own renderer started. */
export function isLocalAsrSessionOwnedBy(sessionId: string, ownerId: number): boolean {
  return sessionOwners.get(sessionId) === ownerId
}

/**
 * The post-hoc "basic processing" step, gated live on the Settings toggle
 * (main/ipc/localOnDeviceSettings.ts's localLlmSummaryEnabled) — checked at
 * CALL time (once per session's stop()), not baked into the manager at
 * construction time, so flipping the toggle takes effect on the very next
 * session without an app restart. Returning `null` (not throwing) when the
 * toggle is off is the localAsrSession.ts contract for "nothing to report,
 * not an error" — a disabled feature must never surface as a user-visible
 * error message.
 *
 * EXTENSION POINT (plan/tier gating): whether a given Core/Plus/Max plan may
 * use this at all is not decided or implemented here — see
 * formed2forge/handoffs/omi-pricing.md §24 for the not-yet-landed catalog
 * this would eventually gate against. Whoever wires that in should add the
 * check here, alongside the Settings-toggle check, not as a second gate
 * elsewhere.
 */
async function localLlmSummarizeIfEnabled(text: string): Promise<string | null> {
  if (!getAppSettings().localLlmSummaryEnabled) return null
  return summarizeTranscript(text)
}

let manager: LocalAsrManager | null = null

function getManager(): LocalAsrManager {
  if (!manager) {
    manager = createLocalAsrManager(
      {
        onSegments: (sessionId, segments) => {
          const ownerId = sessionOwners.get(sessionId)
          if (ownerId === undefined) return
          emit(ownerId, { sessionId, kind: 'segments', segments })
        },
        onError: (sessionId, message, fatal) => {
          const ownerId = sessionOwners.get(sessionId)
          if (ownerId === undefined) return
          emit(ownerId, { sessionId, kind: 'error', message, fatal })
          if (fatal) sessionOwners.delete(sessionId)
        },
        onSummary: (sessionId, summary) => {
          const ownerId = sessionOwners.get(sessionId)
          if (ownerId === undefined) return
          emit(ownerId, { sessionId, kind: 'summary', summary })
        }
      },
      { ...defaultDeps, summarizeTranscript: localLlmSummarizeIfEnabled }
    )
  }
  return manager
}

export function registerOmiLocalAsrHandlers(canStartSession: (ownerId: number) => boolean): void {
  ipcMain.handle('omi-local-asr:start', (e: Electron.IpcMainInvokeEvent, sessionId: string) => {
    if (!canStartSession(e.sender.id)) {
      throw new Error('local ASR session is not allowed from this window')
    }
    sessionOwners.set(sessionId, e.sender.id)
    getManager().start(sessionId)
  })
  ipcMain.handle(
    'omi-local-asr:stop',
    async (e: Electron.IpcMainInvokeEvent, sessionId: string) => {
      if (!isLocalAsrSessionOwnedBy(sessionId, e.sender.id)) return
      // Await stop() BEFORE clearing the owner mapping: stop() may still emit
      // one final onSummary/onError asynchronously (post-hoc LLM
      // summarization runs after the session itself is torn down), and the
      // onSummary/onError handlers above route by sessionOwners — deleting it
      // first would silently drop that final event.
      await getManager().stop(sessionId)
      sessionOwners.delete(sessionId)
    }
  )
  ipcMain.on(
    'omi-local-asr:feed',
    (e: Electron.IpcMainEvent, sessionId: string, pcm: ArrayBuffer) => {
      if (!isLocalAsrSessionOwnedBy(sessionId, e.sender.id)) return
      getManager().feed(sessionId, new Int16Array(pcm))
    }
  )
  ipcMain.on('omi-local-asr:finalize', (e: Electron.IpcMainEvent, sessionId: string) => {
    if (!isLocalAsrSessionOwnedBy(sessionId, e.sender.id)) return
    getManager().finalize(sessionId)
  })
}

/** Close every session owned by a webContents that no longer exists — mirrors
 *  killSessionsForOwner in omiListen.ts (called by captureWindow on respawn).
 *  Async for the same reason the IPC stop handler above is: stop() may still
 *  emit one final summary/error after the session map itself is cleared. */
export async function killLocalAsrSessionsForOwner(ownerId: number): Promise<void> {
  const ids = [...sessionOwners].filter(([, owner]) => owner === ownerId).map(([id]) => id)
  for (const id of ids) {
    await getManager().stop(id)
    sessionOwners.delete(id)
  }
}
