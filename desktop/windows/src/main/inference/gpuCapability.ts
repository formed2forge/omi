import { app } from 'electron'

// GPU capability, read from Chromium's own GPU process via Electron's
// `app.getGPUInfo('complete')` — no new dependency, works today on every
// platform this app ships (win32/linux/darwin), and reflects what the very
// process we're running in actually negotiated with the driver (as opposed to
// a separate enumeration path that could disagree with what Chromium picked).
//
// This deliberately does NOT attempt to predict whether a specific ONNX
// Runtime execution provider (DirectML, CUDA, CoreML, …) would work — that
// requires either `onnxruntime-node` (a new, large, per-platform native
// dependency this app does not currently ship — only `onnxruntime-web`/wasm
// is installed, in the renderer) or actually trying to create a session with
// that EP. Both are out of scope for a detection-only primitive; this module
// answers the narrower, honestly-answerable question "is there a real,
// hardware-accelerated GPU behind this process, and whose is it" so later
// work (once the local-ASR/LLM architecture is decided) can use it as one
// input among several.

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'qualcomm' | 'apple' | 'unknown'

export type GpuCapability = {
  /** A real GPU is active and Chromium did NOT fall back to a software
   *  rasterizer (SwiftShader / "Microsoft Basic Render Driver"). */
  available: boolean
  vendor: GpuVendor
  vendorString: string | null
  deviceString: string | null
  driverVersion: string | null
  /** Chromium is compositing on a software rasterizer — treat as "no usable
   *  GPU" regardless of what hardware is physically present. */
  softwareRenderer: boolean
}

const UNAVAILABLE: GpuCapability = {
  available: false,
  vendor: 'unknown',
  vendorString: null,
  deviceString: null,
  driverVersion: null,
  softwareRenderer: false
}

// PCI vendor IDs for the GPU makers relevant to on-device inference triage.
const VENDOR_IDS: Record<number, GpuVendor> = {
  0x10de: 'nvidia',
  0x1002: 'amd',
  0x1022: 'amd', // AMD's other PCI vendor id (APUs)
  0x8086: 'intel',
  0x5143: 'qualcomm', // Snapdragon X (Adreno) devices
  0x106b: 'apple'
}

type RawGpuDevice = {
  active?: boolean
  vendorId?: number
  deviceId?: number
  vendorString?: string
  deviceString?: string
  driverVersion?: string
}

type RawGpuInfo = {
  auxAttributes?: { softwareRendering?: boolean }
  gpuDevice?: RawGpuDevice[]
}

function isRawGpuInfo(value: unknown): value is RawGpuInfo {
  return typeof value === 'object' && value !== null
}

/** Chromium's `gpuDevice` is an array (one entry per adapter on a multi-GPU
 *  machine, e.g. laptop iGPU + dGPU) — prefer the one Chromium marked active;
 *  fall back to the first entry when nothing is marked (older Chromium). */
function pickActiveDevice(devices: RawGpuDevice[] | undefined): RawGpuDevice | null {
  if (!devices || devices.length === 0) return null
  return devices.find((d) => d.active) ?? devices[0]
}

function vendorFromDevice(device: RawGpuDevice): GpuVendor {
  if (typeof device.vendorId === 'number' && VENDOR_IDS[device.vendorId]) {
    return VENDOR_IDS[device.vendorId]
  }
  const s = (device.vendorString ?? '').toLowerCase()
  if (s.includes('nvidia')) return 'nvidia'
  if (s.includes('amd') || s.includes('ati')) return 'amd'
  if (s.includes('intel')) return 'intel'
  if (s.includes('qualcomm')) return 'qualcomm'
  if (s.includes('apple')) return 'apple'
  return 'unknown'
}

/**
 * Parse Chromium's GPUInfo object (electron.d.ts types `getGPUInfo` as
 * `Promise<unknown>` — it does not publish a stable structure) into our typed
 * shape. Defensive by construction: anything unexpected degrades to
 * "unavailable" rather than throwing, since this drives a best-effort
 * capability report, not a critical path.
 */
export function parseGpuInfo(raw: unknown): GpuCapability {
  if (!isRawGpuInfo(raw)) return UNAVAILABLE
  const softwareRenderer = raw.auxAttributes?.softwareRendering === true
  const device = pickActiveDevice(raw.gpuDevice)
  if (!device) return { ...UNAVAILABLE, softwareRenderer }
  return {
    available: !softwareRenderer,
    vendor: vendorFromDevice(device),
    vendorString: device.vendorString ?? null,
    deviceString: device.deviceString ?? null,
    driverVersion: device.driverVersion ?? null,
    softwareRenderer
  }
}

export type GpuInfoFetcher = () => Promise<unknown>

async function defaultFetcher(): Promise<unknown> {
  return app.getGPUInfo('complete')
}

/** Detect the active GPU for this process. Never throws — a failure to reach
 *  Chromium's GPU process (e.g. called before `app.ready`) degrades to
 *  "unavailable" so callers can treat it as "fall back to CPU". */
export async function detectGpu(fetcher: GpuInfoFetcher = defaultFetcher): Promise<GpuCapability> {
  try {
    return parseGpuInfo(await fetcher())
  } catch {
    return UNAVAILABLE
  }
}
