// How node-llama-cpp should run the model. CPU-baseline only, today — this is
// the whole of task scope here; GPU/NPU offload is an explicit extension point,
// not attempted in this change.
export type LocalLlmExecutionProvider = 'cpu'

export interface LocalLlmExecutionPlan {
  provider: LocalLlmExecutionProvider
  /** node-llama-cpp's `getLlama({ gpu })` option. Always `false` until a
   *  GPU/NPU plan exists — see the EXTENSION POINT note below. */
  gpu: false
  /** CPU threads to hand node-llama-cpp; 0 lets it pick its own default. */
  threads: number
}

const CPU_BASELINE_PLAN: LocalLlmExecutionPlan = { provider: 'cpu', gpu: false, threads: 0 }

/**
 * Choose how node-llama-cpp should run the model. CPU-baseline only, today.
 *
 * EXTENSION POINT: a separate, parallel workstream is building GPU/NPU
 * capability detection for Windows (expected under something like
 * `src/main/inference/` or a sibling capability-detection module — not landed
 * at the time this was written, so it isn't imported here). Once that module
 * exists and exports a capability query, prefer it here:
 *
 *   1. Import its capability-query function.
 *   2. If it reports a usable GPU (CUDA/Vulkan) or NPU, return a
 *      LocalLlmExecutionPlan with `gpu` set to the matching node-llama-cpp
 *      value ('cuda' | 'vulkan' | true) instead of `false`, and `provider`
 *      updated to match.
 *   3. Keep this function fail-open: any capability-detection error or
 *      uncertain result should fall back to CPU_BASELINE_PLAN rather than
 *      block or fail summarizeTranscript().
 *
 * Deliberately NOT a dynamic `import()` of a guessed module path today — a
 * literal import path to a module that doesn't exist yet risks failing the
 * build/typecheck the moment this file is added, which would block on work
 * happening in a different, unmerged branch.
 */
export async function selectExecutionPlan(): Promise<LocalLlmExecutionPlan> {
  return CPU_BASELINE_PLAN
}
