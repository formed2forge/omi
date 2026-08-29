// How node-llama-cpp should run the model. Consumes capabilityDetection.ts's
// GPU/NPU capability report (the extension point this file used to document
// as "not landed yet" — it has landed, this is that wiring).
//
// UNVERIFIED ON REAL HARDWARE: capabilityDetection.ts's own GPU/NPU probes
// have only ever run in a macOS sandbox (see its module comment) — no real
// Windows GPU or Copilot+ NPU has exercised either the detection or the
// mapping below. Treat any non-CPU plan this file produces as unverified
// until it's checked on real Windows hardware of each tier; CPU remains the
// only checked-working path (see moonshineEngine.ts's header for the ASR
// side of the same caveat).
import { getInferenceCapabilities, type InferenceCapabilityReport } from './capabilityDetection'
import type { GpuVendor } from './gpuCapability'

// node-llama-cpp's own `LlamaGpuType` is `'metal' | 'cuda' | 'vulkan' | false`
// (node_modules/node-llama-cpp/dist/bindings/types.d.ts) — no NPU backend
// exists in llama.cpp today, so an NPU-tier capability report has nothing
// NPU-specific to select here (see planFromReport below).
export type LocalLlmExecutionProvider = 'cpu' | 'metal' | 'cuda' | 'vulkan'

export interface LocalLlmExecutionPlan {
  provider: LocalLlmExecutionProvider
  /** node-llama-cpp's `getLlama({ gpu })` option. */
  gpu: false | 'metal' | 'cuda' | 'vulkan'
  /** CPU threads to hand node-llama-cpp; 0 lets it pick its own default. */
  threads: number
}

const CPU_BASELINE_PLAN: LocalLlmExecutionPlan = { provider: 'cpu', gpu: false, threads: 0 }

// Maps a detected GPU vendor to the node-llama-cpp GPU backend most likely to
// work for it. NVIDIA gets CUDA; everyone else with a real GPU (AMD, Intel,
// Qualcomm/Adreno) gets Vulkan, llama.cpp's vendor-neutral GPU backend, since
// node-llama-cpp has no DirectML backend. Unmapped vendors (`unknown`) fall
// through to CPU.
const GPU_VENDOR_TO_LLAMA_GPU: Partial<
  Record<GpuVendor, Exclude<LocalLlmExecutionProvider, 'cpu'>>
> = {
  nvidia: 'cuda',
  amd: 'vulkan',
  intel: 'vulkan',
  qualcomm: 'vulkan',
  apple: 'metal'
}

/**
 * Turn a capability report into an execution plan. NPU tier intentionally has
 * no dedicated branch: llama.cpp has no NPU execution backend, so an
 * `npu`-tier report can only benefit from whatever its `gpu` detail also
 * reports (a Copilot+ PC's NPU and its GPU are reported independently — see
 * capabilityDetection.ts) — exactly the same check a `gpu`-tier report gets.
 */
function planFromReport(report: InferenceCapabilityReport): LocalLlmExecutionPlan {
  if (!report.gpu.available || report.gpu.softwareRenderer) return CPU_BASELINE_PLAN
  const gpu = GPU_VENDOR_TO_LLAMA_GPU[report.gpu.vendor]
  if (!gpu) return CPU_BASELINE_PLAN
  return { provider: gpu, gpu, threads: 0 }
}

/**
 * Choose how node-llama-cpp should run the model, from capabilityDetection.ts's
 * memoized GPU/NPU report.
 *
 * EXTENSION POINT (plan/tier gating): whether a given Core/Plus/Max plan is
 * even ALLOWED to use GPU/NPU acceleration (vs. being held to CPU-baseline)
 * is not decided or implemented here — the catalog this would gate against
 * has not landed yet. See formed2forge/handoffs/omi-pricing.md §24 for that
 * work's status; whoever wires plan-awareness in should branch inside
 * `selectExecutionPlan`, not add a second selection function.
 *
 * Fail-open by construction: any capability-detection error or uncertain
 * result falls back to CPU_BASELINE_PLAN rather than blocking or failing
 * summarizeTranscript().
 */
export async function selectExecutionPlan(): Promise<LocalLlmExecutionPlan> {
  try {
    const report = await getInferenceCapabilities()
    return planFromReport(report)
  } catch {
    return CPU_BASELINE_PLAN
  }
}
