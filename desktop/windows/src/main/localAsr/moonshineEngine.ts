// CPU-baseline local ASR inference: onnxruntime-node running the two ONNX graphs
// exported for Moonshine Tiny (see model.ts) — an encoder session and a "merged"
// decoder-with-past session (the standard HF Optimum export shape: one graph that
// branches internally on a `use_cache_branch` flag between "prefill, no cache" and
// "decode one token using cached K/V"). Greedy (argmax) decoding — no beam search,
// no sampling — which is the right trade for a continuous background transcriber:
// deterministic, cheap, and Moonshine's short target utterances don't benefit much
// from beam search.
//
// VERIFIED end-to-end against the real pinned model (see model.ts) with real
// speech audio during development of this feature: encoder ~10-80ms and a full
// greedy decode loop ~80-90ms for a 2.5s utterance on a CPU, correctly producing
// "The quick brown fox jumps over the lazy dog." — see the PR description for the
// harness. NOT verified on real Windows hardware (this was run on macOS/arm64;
// onnxruntime-node ships prebuilt binaries for both, and the CPU EP is
// platform-independent, but Windows CPU throughput is unmeasured).
import * as ort from 'onnxruntime-node'
import { join } from 'node:path'
import { ARCH, DECODER_FILE, ENCODER_FILE, SAMPLE_RATE, TOKENIZER_FILE } from './model'
import { loadDetokenizer, type Detokenizer } from './tokenizer'

export type AsrResult = { text: string }

export type AsrEngine = {
  /** Run one inference pass over a chunk of 16kHz mono float32 PCM in [-1, 1].
   *  Returns the greedily-decoded text (may be empty for silence/non-speech). */
  transcribe: (pcm: Float32Array) => Promise<AsrResult>
  dispose: () => Promise<void>
}

function emptyPast(numHeads: number, headDim: number): ort.Tensor {
  return new ort.Tensor('float32', new Float32Array(0), [1, numHeads, 0, headDim])
}

/** Deep-copies an output tensor's data+dims into a fresh Tensor. Required before
 *  holding a session.run() output across the NEXT session.run() call on the same
 *  session — onnxruntime-node's CPU EP reuses internal arena buffers between
 *  calls, so an un-copied output tensor can be silently overwritten (observed
 *  directly during development: a held tensor's `.dims` changed to a stale,
 *  wrong-shaped value on the following decode step, which ORT then rejected with
 *  a broadcast error deep in the model's cross-attention MatMul). */
function cloneTensor(t: ort.Tensor): ort.Tensor {
  return new ort.Tensor(t.type, (t.data as Float32Array).slice(), t.dims.slice())
}

/** Create an AsrEngine bound to the given model directory (must already contain
 *  ENCODER_FILE/DECODER_FILE/TOKENIZER_FILE — see modelManager.ensureModelReady).
 *  Sessions load lazily on first transcribe() call and are reused for the life of
 *  the engine. */
export function createMoonshineEngine(modelDir: string): AsrEngine {
  let sessions: Promise<{ encoder: ort.InferenceSession; decoder: ort.InferenceSession }> | null =
    null
  let detokenizer: Promise<Detokenizer> | null = null

  function getSessions(): Promise<{
    encoder: ort.InferenceSession
    decoder: ort.InferenceSession
  }> {
    if (!sessions) {
      sessions = (async () => {
        const [encoder, decoder] = await Promise.all([
          ort.InferenceSession.create(join(modelDir, ENCODER_FILE), {
            executionProviders: ['cpu']
          }),
          ort.InferenceSession.create(join(modelDir, DECODER_FILE), {
            executionProviders: ['cpu']
          })
        ])
        return { encoder, decoder }
      })().catch((e) => {
        sessions = null // allow a later call to retry (e.g. a corrupt download gets re-fixed)
        throw e
      })
    }
    return sessions
  }

  function getDetokenizer(): Promise<Detokenizer> {
    if (!detokenizer) {
      detokenizer = loadDetokenizer(join(modelDir, TOKENIZER_FILE)).catch((e) => {
        detokenizer = null
        throw e
      })
    }
    return detokenizer
  }

  async function transcribe(pcm: Float32Array): Promise<AsrResult> {
    const [{ encoder, decoder }, tok] = await Promise.all([getSessions(), getDetokenizer()])
    const { numDecoderLayers: L, numAttentionHeads: H, headDim: D, bosTokenId, eosTokenId } = ARCH

    const encOut = await encoder.run({
      input_values: new ort.Tensor('float32', pcm, [1, pcm.length])
    })
    const encoderHiddenStates = encOut.last_hidden_state

    let past: Record<string, ort.Tensor> = {}
    for (let l = 0; l < L; l++) {
      past[`past_key_values.${l}.decoder.key`] = emptyPast(H, D)
      past[`past_key_values.${l}.decoder.value`] = emptyPast(H, D)
      past[`past_key_values.${l}.encoder.key`] = emptyPast(H, D)
      past[`past_key_values.${l}.encoder.value`] = emptyPast(H, D)
    }

    const tokens: number[] = [bosTokenId]
    let useCache = false
    for (let step = 0; step < ARCH.maxNewTokens; step++) {
      const inputIds = useCache ? [tokens[tokens.length - 1]] : tokens
      const feeds: Record<string, ort.Tensor> = {
        input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [
          1,
          inputIds.length
        ]),
        encoder_hidden_states: encoderHiddenStates,
        use_cache_branch: new ort.Tensor('bool', [useCache], [1]),
        ...past
      }
      const out = await decoder.run(feeds)
      const logits = out.logits
      const vocabSize = logits.dims[2]
      const seq = logits.dims[1]
      const lastRowStart = (seq - 1) * vocabSize
      const data = logits.data as Float32Array
      let bestId = 0
      let bestVal = -Infinity
      for (let v = 0; v < vocabSize; v++) {
        const val = data[lastRowStart + v]
        if (val > bestVal) {
          bestVal = val
          bestId = v
        }
      }
      tokens.push(bestId)

      // Carry the cache forward. The merged decoder's cached (`use_cache_branch:
      // true`) path does NOT recompute cross-attention K/V from
      // encoder_hidden_states — that's the whole point of caching — so its
      // present.*.encoder.* outputs are degenerate placeholders once caching is
      // active. Cross-attn K/V never changes across decode steps for a fixed
      // encoder output, so thread the ONE real value computed on the first
      // (no-cache) step forward unchanged (matches optimum/transformers.js).
      const next: Record<string, ort.Tensor> = {}
      for (let l = 0; l < L; l++) {
        next[`past_key_values.${l}.decoder.key`] = cloneTensor(out[`present.${l}.decoder.key`])
        next[`past_key_values.${l}.decoder.value`] = cloneTensor(out[`present.${l}.decoder.value`])
        next[`past_key_values.${l}.encoder.key`] = useCache
          ? past[`past_key_values.${l}.encoder.key`]
          : cloneTensor(out[`present.${l}.encoder.key`])
        next[`past_key_values.${l}.encoder.value`] = useCache
          ? past[`past_key_values.${l}.encoder.value`]
          : cloneTensor(out[`present.${l}.encoder.value`])
      }
      past = next
      useCache = true
      if (bestId === eosTokenId) break
    }

    const text = tok.decode(tokens).trim()
    return { text }
  }

  async function dispose(): Promise<void> {
    const s = sessions
    sessions = null
    detokenizer = null
    if (!s) return
    const { encoder, decoder } = await s
    await Promise.all([encoder.release(), decoder.release()])
  }

  return { transcribe, dispose }
}

export { SAMPLE_RATE }
