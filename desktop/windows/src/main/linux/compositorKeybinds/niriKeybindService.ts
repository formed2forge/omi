// Orchestrate niri compositor-keybind status + install (packaged binary only).
import { app } from 'electron'
import { accessSync, constants, copyFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { electronAcceleratorToNiriChord } from './acceleratorToNiri'
import { resolveNiriConfigPath } from './resolveNiriConfigPath'
import { decideChord, scanNiriConfigTree } from './scanNiriConfig'
import { applyManagedBlockToText, writeNiriConfigAtomic } from './writeNiriConfig'
import type { NiriChordPlan, NiriScanResult } from './types'
import { detectLinuxCompositor } from '../linuxSession'
import { getAppSettings, setAppSettings } from '../../appSettings'
import type {
  NiriCompositorKeybindConflict,
  NiriCompositorKeybindInstallResult,
  NiriCompositorKeybindStatus
} from '../../../shared/types'

function packagedBinaryPath(): string | null {
  if (!app.isPackaged) return null
  return process.execPath
}

function buildPlans(summonAccel: string, recordAccel: string | null): NiriChordPlan[] | { error: string } {
  const summonChord = electronAcceleratorToNiriChord(summonAccel)
  if (!summonChord) return { error: `Cannot map summon accelerator "${summonAccel}" to a niri chord.` }
  const plans: NiriChordPlan[] = [
    { electronAccelerator: summonAccel, niriChord: summonChord, action: 'summon' }
  ]
  if (recordAccel) {
    const recordChord = electronAcceleratorToNiriChord(recordAccel)
    if (!recordChord) {
      return { error: `Cannot map record accelerator "${recordAccel}" to a niri chord.` }
    }
    plans.push({
      electronAccelerator: recordAccel,
      niriChord: recordChord,
      action: 'record-mic'
    })
  }
  return plans
}

function conflictsFromScan(
  scan: NiriScanResult,
  plans: NiriChordPlan[]
): NiriCompositorKeybindConflict[] {
  const conflicts: NiriCompositorKeybindConflict[] = []
  for (const plan of plans) {
    const decision = decideChord(scan, plan)
    if (decision.status === 'chord-conflict') {
      conflicts.push({
        action: plan.action,
        electronAccelerator: plan.electronAccelerator,
        niriChord: plan.niriChord,
        existingBind: decision.hit.line,
        filePath: decision.hit.filePath
      })
    }
  }
  return conflicts
}

function allInstalled(scan: NiriScanResult, plans: NiriChordPlan[]): boolean {
  return plans.every((plan) => {
    const d = decideChord(scan, plan)
    return d.status === 'omi-installed'
  })
}

export function getNiriCompositorKeybindStatus(
  env: NodeJS.ProcessEnv = process.env
): NiriCompositorKeybindStatus {
  const settings = getAppSettings()
  const base = {
    autoApply: settings.niriKeybindAutoApply !== false,
    consentGranted: settings.niriKeybindConsentGranted === true,
    consentConfigPath: settings.niriKeybindConsentConfigPath
  }

  if (process.platform !== 'linux') {
    return { ...base, state: 'unsupported', reason: 'Not a Linux session.' }
  }
  if (detectLinuxCompositor(env) !== 'niri') {
    return { ...base, state: 'unsupported', reason: 'Active compositor is not niri.' }
  }
  if (!app.isPackaged) {
    return {
      ...base,
      state: 'dev-unsupported',
      reason:
        'Automatic niri keybind install requires a packaged Omi build. Use the manual config note for pnpm dev.'
    }
  }

  const configPath = resolveNiriConfigPath(env)
  if (!configPath) {
    return {
      ...base,
      state: 'config-missing',
      reason: 'Could not resolve a niri config path (NIRI_CONFIG / ~/.config/niri/config.kdl).'
    }
  }

  let scan: NiriScanResult
  try {
    scan = scanNiriConfigTree(configPath)
  } catch (e) {
    return {
      ...base,
      state: 'scan-failed',
      configPath,
      reason: String(e)
    }
  }

  if (!scan.scanComplete) {
    return {
      ...base,
      state: 'scan-incomplete',
      configPath,
      unreadableIncludes: scan.unreadableIncludes,
      reason:
        'One or more included KDL files could not be read. Fix those paths before installing, so conflicts are not missed.'
    }
  }

  const recordAccel =
    settings.recordHotkeyEnabled === false ? null : settings.recordHotkey
  const plansOrErr = buildPlans(settings.summonHotkey, recordAccel)
  if ('error' in plansOrErr) {
    return { ...base, state: 'scan-failed', configPath, reason: plansOrErr.error }
  }
  const plans = plansOrErr
  const conflicts = conflictsFromScan(scan, plans)
  if (conflicts.length > 0) {
    return {
      ...base,
      state: 'conflict',
      configPath,
      conflicts,
      reason:
        'One or more chords are already bound in your niri config (including included files). Choose a different chord in Omi, or change that bind in niri.'
    }
  }
  if (allInstalled(scan, plans)) {
    return { ...base, state: 'installed', configPath }
  }
  return { ...base, state: 'not-installed', configPath }
}

export function installNiriCompositorKeybinds(opts: {
  grantConsent: boolean
  env?: NodeJS.ProcessEnv
  validate?: boolean
}): NiriCompositorKeybindInstallResult {
  const env = opts.env ?? process.env
  const status = getNiriCompositorKeybindStatus(env)
  if (
    status.state === 'unsupported' ||
    status.state === 'dev-unsupported' ||
    status.state === 'config-missing' ||
    status.state === 'scan-failed' ||
    status.state === 'scan-incomplete'
  ) {
    return { ok: false, status }
  }

  const configPath = status.configPath
  if (!configPath) return { ok: false, status }

  if (opts.grantConsent) {
    setAppSettings({
      niriKeybindConsentGranted: true,
      niriKeybindConsentConfigPath: configPath,
      niriKeybindAutoApply: true
    })
  } else if (!getAppSettings().niriKeybindConsentGranted) {
    return {
      ok: false,
      status: {
        ...status,
        state: 'needs-consent',
        reason: 'Consent required before editing the niri config.'
      }
    }
  } else if (
    getAppSettings().niriKeybindConsentConfigPath &&
    getAppSettings().niriKeybindConsentConfigPath !== configPath
  ) {
    return {
      ok: false,
      status: {
        ...status,
        state: 'needs-consent',
        reason: 'niri config path changed since last consent — Apply again to confirm.'
      }
    }
  }

  if (status.state === 'conflict') {
    return { ok: false, status }
  }
  if (status.state === 'installed') {
    return { ok: true, status }
  }

  const binary = packagedBinaryPath()
  if (!binary) {
    return {
      ok: false,
      status: {
        ...getNiriCompositorKeybindStatus(env),
        state: 'dev-unsupported',
        reason: 'Packaged binary path unavailable.'
      }
    }
  }

  try {
    accessSync(configPath, constants.W_OK)
  } catch {
    return {
      ok: false,
      status: {
        ...status,
        state: 'write-failed',
        reason: `niri config is not writable: ${configPath}`
      }
    }
  }

  const settings = getAppSettings()
  const recordAccel =
    settings.recordHotkeyEnabled === false ? null : settings.recordHotkey
  const plansOrErr = buildPlans(settings.summonHotkey, recordAccel)
  if ('error' in plansOrErr) {
    return {
      ok: false,
      status: { ...status, state: 'scan-failed', reason: plansOrErr.error }
    }
  }

  let scan: NiriScanResult
  try {
    scan = scanNiriConfigTree(configPath)
  } catch (e) {
    return {
      ok: false,
      status: { ...status, state: 'scan-failed', reason: String(e) }
    }
  }

  // Re-check conflicts immediately before write.
  const conflicts = conflictsFromScan(scan, plansOrErr)
  if (conflicts.length > 0) {
    return {
      ok: false,
      status: {
        ...status,
        state: 'conflict',
        conflicts,
        reason:
          'One or more chords are already bound in your niri config (including included files).'
      }
    }
  }

  const writePath = scan.managedBlockFile ?? scan.primaryPath
  const file = scan.files.find((f) => f.path === writePath)
  if (!file) {
    return {
      ok: false,
      status: { ...status, state: 'write-failed', reason: 'Target config file missing from scan.' }
    }
  }

  const nextText = applyManagedBlockToText(file.text, binary, plansOrErr)
  const written = writeNiriConfigAtomic(writePath, nextText)
  if (!written.ok) {
    return {
      ok: false,
      status: { ...status, state: 'write-failed', reason: written.error }
    }
  }

  if (opts.validate !== false) {
    try {
      execFileSync('niri', ['validate', '--config', writePath], {
        encoding: 'utf8',
        timeout: 5000
      })
    } catch (e) {
      // Restore backup on validate failure.
      try {
        copyFileSync(written.backupPath, writePath)
      } catch {
        // ignore
      }
      return {
        ok: false,
        status: {
          ...status,
          state: 'write-failed',
          reason: `niri validate failed after write; config restored from backup. ${String(e)}`
        }
      }
    }
  }

  return { ok: true, status: getNiriCompositorKeybindStatus(env) }
}

/** After a successful prior consent + auto-apply, re-sync managed binds on chord change. */
export function maybeAutoSyncNiriKeybinds(): NiriCompositorKeybindInstallResult | null {
  const settings = getAppSettings()
  if (settings.niriKeybindAutoApply === false) return null
  if (!settings.niriKeybindConsentGranted) return null
  if (detectLinuxCompositor() !== 'niri') return null
  if (!app.isPackaged) return null
  return installNiriCompositorKeybinds({ grantConsent: false })
}

export function setNiriKeybindAutoApply(enabled: boolean): boolean {
  return setAppSettings({ niriKeybindAutoApply: enabled === true }).niriKeybindAutoApply !== false
}

export function clearNiriKeybindConsent(): void {
  setAppSettings({ niriKeybindConsentGranted: false, niriKeybindConsentConfigPath: null })
}
