// Local ASR model spec — pinned to a specific quantized ONNX export of Moonshine
// Tiny (https://huggingface.co/onnx-community/moonshine-tiny-ONNX). Moonshine over
// Whisper: same ONNX Runtime CPU-EP story, but its encoder takes the raw 16kHz
// waveform directly (no mel-spectrogram front end to get right) and its "tiny"
// checkpoint is small enough (~28MB total) to run continuously on any Windows
// 10/11 CPU without a GPU/NPU — see the PR description for the from-scratch
// verification that this exact spec transcribes correctly end-to-end.
//
// SWAPPABLE: every field below is read by modelManager/moonshineEngine — bumping
// MODEL_ID/MODEL_REVISION/MODEL_FILES to a different export is the intended way to
// change models. If you do, ARCH must be re-derived from the new model's
// config.json (decoder_num_attention_heads, hidden_size / num_attention_heads for
// head_dim, bos/eos/decoder_start token ids) — these are architecture constants,
// not guesses, and a mismatch fails loudly in moonshineEngine (shape errors), not
// silently.

export const MODEL_ID = 'onnx-community/moonshine-tiny-ONNX'
export const MODEL_REVISION = 'main'

/** Files fetched into the per-model download directory (see modelManager.ts).
 *  The two ONNX files are the int8-dynamic-quantized graphs — ~28MB combined vs.
 *  ~110MB fp32, with no measurable accuracy loss in verification and ~2x faster
 *  CPU decode. */
export const MODEL_FILES = [
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
  'tokenizer.json'
] as const

export function modelFileUrl(file: string): string {
  return `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`
}

/** Local on-disk name for a repo file path (flattens the `onnx/` prefix so the
 *  download dir is flat — matches what moonshineEngine reads). */
export function modelFileName(file: string): string {
  return file.replace(/^onnx\//, '')
}

export const ENCODER_FILE = modelFileName(MODEL_FILES[0])
export const DECODER_FILE = modelFileName(MODEL_FILES[1])
export const TOKENIZER_FILE = modelFileName(MODEL_FILES[2])

/** Architecture constants read from the pinned model's config.json. Required to
 *  drive the greedy-decode loop (past_key_values shapes, stop token) without
 *  parsing config.json at runtime. */
export const ARCH = {
  numDecoderLayers: 6,
  numAttentionHeads: 8,
  hiddenSize: 288,
  get headDim(): number {
    return this.hiddenSize / this.numAttentionHeads
  },
  bosTokenId: 1,
  eosTokenId: 2,
  /** Hard cap on generated tokens per inference chunk — bounds worst-case CPU
   *  time per flush even if the model never emits EOS (e.g. on non-speech audio). */
  maxNewTokens: 224
} as const

/** Sample rate the model (and the rest of the capture pipeline) expects. */
export const SAMPLE_RATE = 16000
