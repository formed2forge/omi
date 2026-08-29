// Config for the standalone, on-device "basic processing" LLM: takes a FINISHED
// transcript (plain text) and produces a short summary/highlights. This is a
// separate, later-stage step from live transcription — it is invoked only after
// a dedicated (separately-built) small ASR model has already produced a
// transcript, exactly the way Google's Pixel Recorder pairs a dedicated ASR
// model with Gemini Nano only for post-hoc summarization, never for the
// transcription itself.
//
// Everything model-identity-specific lives in ONE object (LOCAL_LLM_MODEL)
// below, so the model can be swapped by the product owner without touching
// modelStore.ts / modelDownloader.ts / localLlmService.ts.

export interface LocalLlmModelSpec {
  /** Stable identifier for this model choice (used in error messages/logging). */
  id: string
  /** Human-readable label, for future UI (e.g. a download-progress dialog). */
  displayName: string
  /** File name the weights are stored under in the per-user model cache dir. */
  fileName: string
  /** Direct HTTPS download URL for the GGUF weights. */
  url: string
  /** Expected sha256 of the downloaded file, lowercase hex. modelDownloader.ts
   *  refuses to trust a download that doesn't match this. */
  sha256: string
  /** Approximate size in bytes. Used only for download-progress percentage —
   *  NEVER for integrity (sha256 is the only thing that gates trust). */
  approxSizeBytes: number
  /** Context window (tokens) to allocate when loading the model. */
  contextSize: number
}

/**
 * Sentinel `sha256` meaning "not yet pinned." `ensureModelDownloaded` refuses to
 * even attempt a download while a spec carries this value, so an unverified
 * hash can never be silently trusted. Whoever finalizes the model choice must:
 *   1. Download the file once, out of band.
 *   2. Verify it against the model card / a second source.
 *   3. Compute its real hash (`shasum -a 256 <file>`) and paste it in below.
 */
export const UNVERIFIED_SHA256 = 'UNVERIFIED-PENDING-PRODUCT-DECISION'

/**
 * Investigated 2026-08-29 while wiring the GPU/NPU capability report into
 * `executionProvider.ts` — still left as UNVERIFIED_SHA256 above, on purpose,
 * because verification actually surfaced TWO blockers, not zero:
 *
 * 1. `google/gemma-3-1b-it-qat-q4_0-gguf` on Hugging Face is GATED (requires
 *    an accepted license + an authenticated HF token). This environment has
 *    no HF credentials, so the real file's bytes could not be fetched to hash
 *    at all — `modelDownloader.ts`'s plain unauthenticated HTTPS GET would
 *    401 against this URL regardless of the sha256 field.
 * 2. Separately, `fileName`/`url` below (`gemma-3-1b-it-qat-Q4_0.gguf`) do
 *    NOT match the real repo's actual file — confirmed via HF's public
 *    `/api/models/...` tree listing against both the gated repo itself and
 *    an ungated mirror of the identical repo
 *    (`vinimuchulski/gemma-3-1b-it-qat-q4_0-gguf`): the real file is named
 *    `gemma-3-1b-it-q4_0.gguf` (no `qat-` segment, lowercase `q4_0`).
 *
 * Two community re-uploads under "qat-q4_0"-ish names were checked as
 * candidate second sources for a hash, and they DISAGREE with each other —
 * `vinimuchulski/...` is ~957MB, `msievers/gemma-3-1b-it-qat-q4_0-gguf` is
 * ~687MB (closer to this file's own `approxSizeBytes` comment below, but
 * that comment itself was never verified against a real download either).
 * Neither could be cross-checked against the actual gated Google file
 * (blocked by #1), so trusting either mirror's hash would mean silently
 * betting which of two disagreeing community re-uploads is the real thing —
 * worse than the current fail-safe placeholder. Do not paste a hash here
 * without first resolving #1 (get real HF credentials + license acceptance)
 * and downloading the actual gated file directly.
 */

/**
 * The active local-LLM model choice. NOT YET FINALIZED by the product owner —
 * this whole object is designed to be swapped wholesale for a different
 * model/quantization/runtime footprint; nothing else in this feature hardcodes
 * a model identifier, file name, or URL.
 *
 * Picked for now: Gemma 3 1B Instruct, Google's own QAT (quantization-aware
 * trained) Q4_0 GGUF release.
 *   https://huggingface.co/google/gemma-3-1b-it-qat-q4_0-gguf
 *
 * Why this one:
 *   - Same model family Google itself pairs with a dedicated ASR model for
 *     on-device summarization (Pixel Recorder + Gemini Nano) — the exact
 *     "small ASR model for transcription, separate small LLM for post-hoc
 *     processing" shape product asked to mirror here.
 *   - QAT quantization keeps a 4-bit model much closer to bf16 quality than
 *     post-hoc (RTN) quantization of the same size class — meaningfully
 *     better output quality per byte on disk.
 *   - ~1B parameters, well under 1GB on disk at Q4_0 — inside the "small,
 *     light, NOT the live-ASR model, NOT a large/expensive model" mandate,
 *     and cheap enough to load/run on CPU-only commodity hardware.
 *   - GGUF + node-llama-cpp needs no separate tokenizer/runtime plumbing on
 *     top — the binding owns tokenization, KV cache, sampling, and chat
 *     templating end-to-end, which keeps this integration small.
 *
 * `sha256` is intentionally left as the placeholder below — this environment
 * had no way to verify a ~GB-scale download against a second source before
 * shipping it, so it should not be treated as production-ready as-is. See
 * UNVERIFIED_SHA256.
 */
export const LOCAL_LLM_MODEL: LocalLlmModelSpec = {
  id: 'gemma-3-1b-it-qat-q4_0',
  displayName: 'Gemma 3 1B Instruct (QAT, Q4_0 GGUF)',
  fileName: 'gemma-3-1b-it-qat-Q4_0.gguf',
  url: 'https://huggingface.co/google/gemma-3-1b-it-qat-q4_0-gguf/resolve/main/gemma-3-1b-it-qat-Q4_0.gguf',
  sha256: UNVERIFIED_SHA256,
  approxSizeBytes: 720 * 1024 * 1024,
  contextSize: 4096
}

/** Output cap for a "short summary or extracted highlights" — deliberately
 *  small; this is not free-form chat. */
export const LOCAL_LLM_DEFAULT_MAX_OUTPUT_TOKENS = 200

/** How long summarizeTranscript() waits for one generation before giving up
 *  and throwing InferenceTimeoutError (localLlmService.ts). */
export const LOCAL_LLM_DEFAULT_TIMEOUT_MS = 20_000

/** Minimal, swappable instruction prompt for "basic processing" of a finished
 *  transcript. Deliberately NOT a live-transcription prompt — the model only
 *  ever sees a completed transcript, never streaming audio/partial text. */
export function buildSummaryPrompt(transcriptText: string): string {
  return (
    'You are summarizing a finished conversation transcript for the person who ' +
    'recorded it. Write a short, neutral summary (3-5 sentences) covering the ' +
    'main topics and any clear action items. Do not invent details that are not ' +
    'in the transcript.\n\n' +
    `Transcript:\n${transcriptText}\n\nSummary:`
  )
}
