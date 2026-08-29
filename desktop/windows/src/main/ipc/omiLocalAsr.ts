// IPC surface for the local (on-device) ASR path — structurally parallel to
// omiListen.ts's start/feed/stop/message shape, but backed by localAsrSession's
// buffer-and-run-inference loop instead of a cloud WebSocket. Feed is `on` (not
// `handle`), matching omi-listen:feed, to keep the hot audio path fire-and-forget.
import { ipcMain, webContents } from 'electron'
import { createLocalAsrManager, type LocalAsrManager } from '../localAsr/localAsrSession'
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

let manager: LocalAsrManager | null = null

function getManager(): LocalAsrManager {
  if (!manager) {
    manager = createLocalAsrManager({
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
      }
    })
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
  ipcMain.handle('omi-local-asr:stop', (e: Electron.IpcMainInvokeEvent, sessionId: string) => {
    if (!isLocalAsrSessionOwnedBy(sessionId, e.sender.id)) return
    getManager().stop(sessionId)
    sessionOwners.delete(sessionId)
  })
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
 *  killSessionsForOwner in omiListen.ts (called by captureWindow on respawn). */
export function killLocalAsrSessionsForOwner(ownerId: number): void {
  for (const [id, owner] of sessionOwners) {
    if (owner === ownerId) {
      getManager().stop(id)
      sessionOwners.delete(id)
    }
  }
}
