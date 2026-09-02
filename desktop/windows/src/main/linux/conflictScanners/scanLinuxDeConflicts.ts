// Orchestrate DE shortcut conflict scans (KDE first; GNOME later).
import { detectLinuxCompositor } from '../linuxSession'
import { getAppSettings } from '../../appSettings'
import { scanKdeGlobalAccelConflicts, type KdeConflictPlan } from './kdeGlobalAccel'
import type { LinuxDeConflictScanResult } from '../../../shared/types'

function buildPlansFromSettings(): KdeConflictPlan[] {
  const settings = getAppSettings()
  const plans: KdeConflictPlan[] = [
    { action: 'summon', electronAccelerator: settings.summonHotkey }
  ]
  if (settings.recordHotkeyEnabled !== false && settings.recordHotkey) {
    plans.push({ action: 'record-mic', electronAccelerator: settings.recordHotkey })
  }
  return plans
}

export function scanLinuxDeConflicts(
  env: NodeJS.ProcessEnv = process.env,
  opts?: {
    plans?: KdeConflictPlan[]
    readFile?: (path: string) => string
  }
): LinuxDeConflictScanResult {
  const hermetic = opts?.readFile != null || opts?.plans != null
  if (process.platform !== 'linux' && !hermetic) {
    return {
      compositor: 'unknown',
      state: 'unsupported',
      reason: 'Not a Linux session.'
    }
  }

  const compositor = detectLinuxCompositor(env)
  const plans = opts?.plans ?? buildPlansFromSettings()

  if (compositor === 'kde') {
    return scanKdeGlobalAccelConflicts(plans, { env, readFile: opts?.readFile })
  }

  if (compositor === 'gnome') {
    return {
      compositor: 'gnome',
      state: 'unsupported',
      reason: 'GNOME gsettings conflict scan is not implemented yet.'
    }
  }

  return {
    compositor,
    state: 'unsupported',
    reason: `No DE shortcut conflict scanner for compositor "${compositor}".`
  }
}
