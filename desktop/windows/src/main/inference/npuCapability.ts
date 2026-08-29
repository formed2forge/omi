import { execFile } from 'child_process'

// NPU (Copilot+ PC neural processor) capability. There is no Node/Electron API
// for this — unlike the GPU, Chromium's process has no reason to ever touch
// an NPU. The closest thing Windows offers is enumerable PnP hardware, so this
// shells out to the `PnpDevice` PowerShell module (built into Windows 10+,
// no install needed) the same way `src/main/ipc/micPermission.ts` shells out
// to `reg.exe` for the mic consent store — a small, targeted OS query via
// `execFile`, not a new native toolchain or a compiled helper. A compiled
// C#/.NET stdio helper (this repo's pattern for anything heavier, see
// `src/main/ocr/win-ocr-helper`) would be overkill for a single, infrequent,
// already-textual query.
//
// Two signals are combined because Windows' own "Neural processors" PnP class
// (surfaced by `Get-PnpDevice -Class NeuralProcessors`) is new (Copilot+ PC
// era) and not guaranteed to be populated by every OEM/driver combination —
// some NPUs still enumerate under a generic class with an identifying
// FriendlyName instead (Intel AI Boost, AMD XDNA/Ryzen AI, Qualcomm Hexagon).

export type NpuCapability = {
  available: boolean
  /** Friendly names of matched devices, for diagnostics/telemetry. */
  devices: string[]
  /** True when detection could not run at all (timeout, PowerShell missing,
   *  unexpected output) — distinct from "ran fine, found nothing". Callers
   *  should not treat this as proof there is no NPU. */
  detectionFailed: boolean
}

const UNAVAILABLE: NpuCapability = { available: false, devices: [], detectionFailed: false }

// Matches known NPU product names as a fallback for devices not (yet) tagged
// with the dedicated PnP class.
const NPU_NAME_PATTERN = /NPU|Neural Processing|AI Boost|Hexagon|XDNA/i

const NPU_QUERY_SCRIPT = [
  '$byClass = @(Get-PnpDevice -PresentOnly -Class NeuralProcessors -ErrorAction SilentlyContinue)',
  '$byName = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |' +
    ` Where-Object { $_.FriendlyName -match '${NPU_NAME_PATTERN.source}' })`,
  '$names = @($byClass + $byName | Select-Object -ExpandProperty FriendlyName -Unique)',
  'ConvertTo-Json -InputObject $names -Compress'
].join('; ')

/**
 * Parse the query script's stdout. `ConvertTo-Json -InputObject @(...)`
 * always emits a JSON array (even `[]` for zero matches, unlike piping a bare
 * collection through `ConvertTo-Json`, which collapses a single match to a
 * bare string) — but stdout is still untrusted external output, so this stays
 * defensive rather than assuming the shape.
 */
export function parseNpuDeviceNames(stdout: string): string[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.filter((n): n is string => typeof n === 'string')
    if (typeof parsed === 'string') return [parsed]
    return []
  } catch {
    return []
  }
}

export type NpuQueryRunner = (args: string[]) => Promise<string>

function defaultRunner(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // windowsHide: powershell.exe is a console-subsystem process; without this
    // a stray console window can flash when spawned from the GUI main process
    // (same reasoning as the OCR/automation helpers' windowsHide).
    execFile('powershell.exe', args, { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/** Detect NPU-class hardware. Off-Windows this is a no-op (not a failure —
 *  there is nothing to query). Never throws: any PowerShell/parse failure
 *  degrades to `detectionFailed: true`, `available: false`. */
export async function detectNpu(
  platform: NodeJS.Platform = process.platform,
  runner: NpuQueryRunner = defaultRunner
): Promise<NpuCapability> {
  if (platform !== 'win32') return UNAVAILABLE
  try {
    const stdout = await runner(['-NoProfile', '-NonInteractive', '-Command', NPU_QUERY_SCRIPT])
    const devices = parseNpuDeviceNames(stdout)
    return { available: devices.length > 0, devices, detectionFailed: false }
  } catch {
    return { available: false, devices: [], detectionFailed: true }
  }
}
