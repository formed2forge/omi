# On-device local LLM (transcript summarization)

`src/main/inference/` — a standalone, isolated capability: given a FINISHED
transcript (plain text), produce a short summary/highlights on-device. **Not**
wired into any conversation-summary UI/product surface yet (separate future
work) and **not** the live-transcription path — this only ever runs after a
separate, separately-built small ASR model has already produced a transcript.
Mirrors how Google's Pixel Recorder pairs a dedicated ASR model with Gemini
Nano only for post-hoc summarization, never for transcription itself.

## Files

- `localLlmConfig.ts` — the ONE swappable model spec (`LOCAL_LLM_MODEL`), plus
  the prompt template and default token/timeout limits. Nothing else in this
  feature hardcodes a model id/file/URL — change the model by editing this
  object only.
- `modelStore.ts` — where the weights live on disk (`<userData>/models/local-llm`)
  and a cheap existence check.
- `modelDownloader.ts` — `ensureModelDownloaded(spec)`: first-run/on-demand
  download, streamed to a `.part` sibling, sha256-verified, then atomically
  renamed to the final name. A crash/kill mid-download can never leave a
  corrupt file masquerading as complete.
- `executionProvider.ts` — `selectExecutionPlan()` now consumes
  `capabilityDetection.ts`'s GPU/NPU report: NVIDIA → CUDA, AMD/Intel/
  Qualcomm → Vulkan (llama.cpp's vendor-neutral GPU backend; node-llama-cpp
  has no DirectML backend), everything else (including NPU-tier, since
  llama.cpp has no NPU backend at all) → CPU. **Unverified on real
  hardware** — capabilityDetection.ts's own probes have only run in a macOS
  sandbox; CPU remains the only checked-working path. Fail-open by
  construction: any detection error falls back to CPU.
- `localLlmService.ts` — `summarizeTranscript(text, options)`: the callable
  capability. Typed errors: `ModelNotDownloadedError`, `InferenceError`,
  `InferenceTimeoutError` (subtype of `InferenceError`). Fed by
  `../localAsr/localAsrSession.ts`'s `stop()` once a local-ASR session ends,
  gated on the `localLlmSummaryEnabled` Settings toggle (see "Settings
  toggles" below) — see `../ipc/omiLocalAsr.ts`'s `localLlmSummarizeIfEnabled`.

## Model choice (not yet finalized by product)

Gemma 3 1B Instruct, Google's own QAT (quantization-aware-trained) Q4_0 GGUF
release (`google/gemma-3-1b-it-qat-q4_0-gguf` on Hugging Face) via
`node-llama-cpp` (a llama.cpp binding for GGUF, prebuilt binaries per
platform — no separate tokenizer/runtime plumbing needed). Same model family
Google pairs with dedicated ASR for on-device summarization; QAT quantization
keeps 4-bit quality closer to bf16 than post-hoc quantization of the same
size class; ~1B params, well under 1GB on disk, runs on CPU-only hardware.

`LOCAL_LLM_MODEL.sha256` is currently the `UNVERIFIED_SHA256` placeholder —
`ensureModelDownloaded` refuses to download while it's set. Whoever finalizes
the model must download it once out of band, verify it against the model
card / a second source, and paste the real `sha256` in `localLlmConfig.ts`.

**Two real, separate blockers found while investigating this (2026-08-29),
neither fixed here — see `localLlmConfig.ts`'s own comment for detail:**

1. `google/gemma-3-1b-it-qat-q4_0-gguf` on Hugging Face is **gated** (requires
   an accepted license + an authenticated HF token) — `modelDownloader.ts`'s
   plain HTTPS GET has no auth support today, so the configured URL 401s
   as-is even once a real sha256 is filled in.
2. The configured `fileName`/`url` (`gemma-3-1b-it-qat-Q4_0.gguf`) does not
   match the real repo's actual file, confirmed via HF's public tree API
   against both the gated repo and an ungated mirror
   (`vinimuchulski/gemma-3-1b-it-qat-q4_0-gguf`): the real filename is
   `gemma-3-1b-it-q4_0.gguf` (no `qat-` in the name, lowercase `q4_0`).
   Community mirrors of this model disagree with each other on file size
   (one ~957MB, another ~687MB) and neither hash was cross-verified against
   the actual gated Google file (blocked by #1), so no sha256 was filled in
   despite finding candidate values — filling in an unverified hash from a
   third-party mirror would be worse than the current fail-safe placeholder.

## Settings toggles (prototype)

Two persisted toggles in `appSettings.ts` (`localAsrEnabled`,
`localLlmSummaryEnabled`), both default OFF, IPC'd via
`ipc/localOnDeviceSettings.ts` and surfaced as two rows in the Privacy
settings tab (`renderer/src/components/settings/tabs/PrivacyTab.tsx`).
`localAsrEnabled` gates whether `../localAsr/` runs a parallel on-device
transcription session at all (same effective gate as the pre-existing
`OMI_LOCAL_ASR=1` dev env var — either one turns it on, see
`renderer/src/lib/omiListenClient.ts`); `localLlmSummaryEnabled` separately
gates whether that session's finished transcript is summarized here once it
stops. Neither is plan/tier-aware yet — see
`formed2forge/handoffs/omi-pricing.md` §24 for the not-yet-landed Core/Plus/
Max catalog these will eventually gate against; the extension point is
`ipc/omiLocalAsr.ts`'s `localLlmSummarizeIfEnabled`.

## Local ASR's own execution-provider wiring

`../localAsr/asrExecutionProvider.ts` is the ASR-side counterpart to this
directory's `executionProvider.ts`, consuming the same capability report for
`onnxruntime-node` (Moonshine) instead of `node-llama-cpp`: Windows + a real
GPU → try DirectML (`dml`) ahead of CPU (the only non-CPU execution provider
onnxruntime-node ships prebuilt for Windows — no CUDA/QNN there), everything
else → CPU-only. `../localAsr/moonshineEngine.ts`'s session creation retries
CPU-only if the preferred providers fail to initialize. Same "unverified on
real hardware" caveat as above.

## Distribution

The model is **never** bundled into the installer. `ensureModelDownloaded`
is the on-demand fetch step, meant to be called from a first-run flow once
this is wired into a real product surface.

## Dependency footprint

`node-llama-cpp` is a real `dependencies` entry with a native postinstall
step (downloads a prebuilt binary per platform/arch) — it needs its
`pnpm-workspace.yaml` `allowBuilds` entry (already added, alongside
`better-sqlite3`, `onnxruntime-node`, etc.) to run non-interactively.
Verified locally: `pnpm install` completes cleanly and pulls
`@node-llama-cpp/mac-arm64-metal`'s prebuilt binary on this machine's
platform; the equivalent Windows x64 binary was not fetched/exercised here.

## Testing

`summarizeTranscript` takes an injectable `EngineFactory` (default wraps
`node-llama-cpp` via a lazy dynamic `import()`, so the native binding is
never touched merely by importing the module). Tests inject a fake
`LlmEngine` — no real model file, network call, or native compute in CI.
`modelDownloader.test.ts` injects a fake `fetchImpl` over an in-memory
`ReadableStream`, so downloads are hermetic too.

Not verified in this environment: real generation output quality/latency
against the real model weights on real hardware, and the exact
`node-llama-cpp` call shape (`getLlama`/`loadModel`/`createContext`/
`LlamaChatSession`) has only been typechecked against the installed
package's `.d.ts` files, never executed end-to-end against a real GGUF file.
