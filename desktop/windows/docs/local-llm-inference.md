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
- `executionProvider.ts` — CPU-baseline execution plan today, with a
  documented extension point for a GPU/NPU capability-detection module (a
  separate, parallel workstream) once it lands.
- `localLlmService.ts` — `summarizeTranscript(text, options)`: the callable
  capability. Typed errors: `ModelNotDownloadedError`, `InferenceError`,
  `InferenceTimeoutError` (subtype of `InferenceError`).

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
