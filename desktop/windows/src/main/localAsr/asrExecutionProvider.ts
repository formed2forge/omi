// Chooses which onnxruntime-node execution providers moonshineEngine.ts should
// try, consuming ../inference/capabilityDetection.ts's GPU/NPU report — the
// same capability module ../inference/executionProvider.ts wires in for the
// post-hoc LLM. CPU is the only verified-working path today (see
// moonshineEngine.ts's header comment); everything below is UNVERIFIED ON
// REAL HARDWARE, same caveat as the LLM side (capabilityDetection.ts's own
// probes have only run in a macOS sandbox against mocked GPU/NPU data).
//
// onnxruntime-node's prebuilt binaries only ship one non-CPU execution
// provider on Windows: DirectML (`dml`), for both x64 and arm64 — no CUDA,
// TensorRT, or QNN build is published for Windows at all (see
// node_modules/onnxruntime-node/README.md's EP support matrix; CUDA is
// Linux-x64-only there). DirectML runs on top of DirectX 12 and is
// vendor-neutral (NVIDIA/AMD/Intel/Qualcomm all expose a D3D12 device), so
// it's the one generic "use the GPU if there is one" lever available here —
// there is no separate NPU execution provider to select even when the
// capability report's tier is 'npu' (Copilot+ NPUs are not exposed through
// onnxruntime-node's prebuilt Windows binaries today).
import { getInferenceCapabilities } from '../inference/capabilityDetection'

export type AsrExecutionProviders = readonly string[]

const CPU_ONLY: AsrExecutionProviders = ['cpu']

/**
 * EXTENSION POINT (plan/tier gating): whether a given Core/Plus/Max plan may
 * use GPU acceleration for local ASR (vs. being held to CPU-baseline) is not
 * decided or implemented here — the catalog this would gate against has not
 * landed yet. See formed2forge/handoffs/omi-pricing.md §24 for that work's
 * status; whoever wires plan-awareness in should branch inside
 * `selectAsrExecutionProviders`, not add a second selection function.
 *
 * Fail-open by construction: any capability-detection error, or running on a
 * platform/GPU combination DirectML doesn't cover, falls back to CPU_ONLY —
 * moonshineEngine.ts additionally retries with CPU_ONLY if session creation
 * with the returned providers fails outright, so a bad guess here can never
 * permanently break local ASR.
 */
export async function selectAsrExecutionProviders(): Promise<AsrExecutionProviders> {
  try {
    const report = await getInferenceCapabilities()
    // dml is a Windows-only EP in onnxruntime-node's prebuilt binaries.
    if (report.platform !== 'win32') return CPU_ONLY
    if (!report.gpu.available || report.gpu.softwareRenderer) return CPU_ONLY
    // An npu-tier report lands here too: no dedicated NPU EP exists in
    // onnxruntime-node's Windows prebuilt binaries, so a GPU-available
    // machine is the only additional case worth trying dml for, whether the
    // report's tier ended up 'npu' or 'gpu'. Listing 'cpu' after 'dml' lets
    // onnxruntime fall back per-node for any op DirectML can't run.
    return ['dml', 'cpu']
  } catch {
    return CPU_ONLY
  }
}
