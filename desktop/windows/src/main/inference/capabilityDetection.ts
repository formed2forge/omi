import { cpus } from 'os'
import { detectGpu, type GpuCapability, type GpuInfoFetcher } from './gpuCapability'
import { detectNpu, type NpuCapability, type NpuQueryRunner } from './npuCapability'

// Foundational scaffolding for future on-device ASR/LLM work: reports what
// local inference acceleration is realistically available on THIS machine, so
// a later model-loading path can pick an execution provider without every
// caller re-deriving it. This module is detection/reporting ONLY — it does
// not load a model, create an ONNX Runtime session, or pick an execution
// provider itself. That decision is separate work gated on the local-model
// architecture, which is not yet finalized.
//
// Windows hardware is far more heterogeneous than Apple Silicon: Copilot+ NPUs
// (Snapdragon X, Intel, AMD — each a different toolchain), GPUs of wildly
// varying capability (or none), and a large base of CPU-only machines. `tier`
// is a coarse, ordered hint (npu > gpu > cpu) — the `gpu`/`npu`/`cpu` detail
// fields carry enough for a future caller to make a finer-grained call.
export type InferenceTier = 'npu' | 'gpu' | 'cpu'

export type CpuCapability = {
  cores: number
  model: string | null
}

export type InferenceCapabilityReport = {
  tier: InferenceTier
  platform: NodeJS.Platform
  gpu: GpuCapability
  npu: NpuCapability
  cpu: CpuCapability
  /** `Date.now()` at detection time, for staleness/telemetry purposes. */
  detectedAt: number
}

function detectCpu(cpuList: ReturnType<typeof cpus>): CpuCapability {
  return { cores: cpuList.length, model: cpuList[0]?.model ?? null }
}

function pickTier(gpu: GpuCapability, npu: NpuCapability): InferenceTier {
  if (npu.available) return 'npu'
  if (gpu.available) return 'gpu'
  return 'cpu'
}

export type CapabilityDetectionDeps = {
  platform?: NodeJS.Platform
  gpuFetcher?: GpuInfoFetcher
  npuRunner?: NpuQueryRunner
  cpuList?: ReturnType<typeof cpus>
  now?: () => number
}

/** Run detection fresh. Prefer `getInferenceCapabilities()` for normal callers
 *  — this is the underlying, fully dependency-injectable primitive tests use. */
export async function detectInferenceCapabilities(
  deps: CapabilityDetectionDeps = {}
): Promise<InferenceCapabilityReport> {
  const platform = deps.platform ?? process.platform
  const [gpu, npu] = await Promise.all([
    detectGpu(deps.gpuFetcher),
    detectNpu(platform, deps.npuRunner)
  ])
  const cpu = detectCpu(deps.cpuList ?? cpus())
  return {
    tier: pickTier(gpu, npu),
    platform,
    gpu,
    npu,
    cpu,
    detectedAt: (deps.now ?? Date.now)()
  }
}

let cached: Promise<InferenceCapabilityReport> | null = null

/**
 * Memoized capability report — detection (especially the NPU PowerShell
 * probe) is not free and hardware doesn't change mid-session, so repeat
 * callers reuse the first result instead of re-probing. Call at app startup
 * or lazily on first use; either way later callers get the same promise.
 */
export function getInferenceCapabilities(forceRefresh = false): Promise<InferenceCapabilityReport> {
  if (forceRefresh || !cached) {
    cached = detectInferenceCapabilities()
  }
  return cached
}

/** Test-only: clear the memoized report so each test starts from a clean slate. */
export function resetInferenceCapabilitiesCache(): void {
  cached = null
}
