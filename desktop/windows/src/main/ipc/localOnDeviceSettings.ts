// IPC for the Windows on-device prototype toggles — local ASR
// (main/localAsr/) and its post-hoc local-LLM summarization
// (main/inference/localLlmService.ts) — that live in main's app settings.
// Mirrors chatPrivacy.ts's single-flag get/set shape: read/write a persisted
// flag, returning the sanitized value so the renderer stays in sync with what
// was actually stored. Both default OFF and are purely additive — turning
// either on never replaces or disables the existing cloud STT/chat pipeline.
//
// EXTENSION POINT (plan/tier gating): neither toggle is plan-aware yet — the
// Core/Plus/Max catalog these will eventually gate against has not landed
// (see formed2forge/handoffs/omi-pricing.md §24). Whoever wires that in
// should branch here (and in main/ipc/omiLocalAsr.ts's localLlmSummarizeIfEnabled
// / renderer lib/omiListenClient.ts's local-ASR gate), not add a second toggle.
import { ipcMain } from 'electron'
import { getAppSettings, setAppSettings } from '../appSettings'

export function registerLocalOnDeviceSettingsHandlers(): void {
  ipcMain.handle('local-ondevice:getAsrEnabled', async () => getAppSettings().localAsrEnabled)
  ipcMain.handle(
    'local-ondevice:setAsrEnabled',
    async (_e, enabled: boolean) =>
      setAppSettings({ localAsrEnabled: enabled === true }).localAsrEnabled
  )
  ipcMain.handle(
    'local-ondevice:getLlmSummaryEnabled',
    async () => getAppSettings().localLlmSummaryEnabled
  )
  ipcMain.handle(
    'local-ondevice:setLlmSummaryEnabled',
    async (_e, enabled: boolean) =>
      setAppSettings({ localLlmSummaryEnabled: enabled === true }).localLlmSummaryEnabled
  )
}
