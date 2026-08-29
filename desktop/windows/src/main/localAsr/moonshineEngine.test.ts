import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hermetic coverage of getSessions()' execution-provider fallback logic added
// in this change — NOT a test of Moonshine inference correctness itself (that
// was verified end-to-end against the real model in a standalone harness, per
// this file's own header comment; a full encoder/decoder/tokenizer mock here
// would just be re-testing that harness's job). onnxruntime-node's native
// binding and the real capability-detection module are both mocked so this
// suite never touches real ORT sessions or GPU/NPU probes.
vi.mock('./asrExecutionProvider', () => ({ selectAsrExecutionProviders: vi.fn() }))
vi.mock('./tokenizer', () => ({ loadDetokenizer: vi.fn() }))
vi.mock('onnxruntime-node', () => {
  class FakeTensor {
    type: string
    data: unknown
    dims: number[]
    constructor(type: string, data: unknown, dims: number[]) {
      this.type = type
      this.data = data
      this.dims = dims
    }
  }
  return {
    InferenceSession: { create: vi.fn() },
    Tensor: FakeTensor
  }
})

import * as ort from 'onnxruntime-node'
import { createMoonshineEngine } from './moonshineEngine'
import { selectAsrExecutionProviders } from './asrExecutionProvider'
import { loadDetokenizer } from './tokenizer'
import { ARCH, ENCODER_FILE } from './model'

const mockSelectProviders = vi.mocked(selectAsrExecutionProviders)
const mockLoadDetokenizer = vi.mocked(loadDetokenizer)
const createSession = vi.mocked(ort.InferenceSession.create)

// Cast to ort.InferenceSession: these fixtures intentionally implement only
// the `run` method moonshineEngine.ts actually calls, not the full real
// InferenceSession interface (release/startProfiling/etc.) — a real session
// is never constructed in this hermetic suite.
function fakeEncoderSession(): ort.InferenceSession {
  return {
    run: vi.fn(async () => ({
      last_hidden_state: new ort.Tensor('float32', new Float32Array(8), [1, 1, 8])
    }))
  } as unknown as ort.InferenceSession
}

/** A decoder session whose very first greedy step picks eosTokenId — the
 *  loop then stops after one iteration, keeping this fixture minimal. */
function fakeDecoderSession(): ort.InferenceSession {
  const out: Record<string, unknown> = {
    // vocabSize=3, index ARCH.eosTokenId (2) has the highest logit.
    logits: new ort.Tensor('float32', new Float32Array([0, 0, 1]), [1, 1, 3])
  }
  for (let l = 0; l < ARCH.numDecoderLayers; l++) {
    for (const branch of ['decoder', 'encoder']) {
      for (const kind of ['key', 'value']) {
        out[`present.${l}.${branch}.${kind}`] = new ort.Tensor(
          'float32',
          new Float32Array(4),
          [1, 1, 1, 4]
        )
      }
    }
  }
  return { run: vi.fn(async () => out) } as unknown as ort.InferenceSession
}

describe('createMoonshineEngine — execution provider fallback', () => {
  beforeEach(() => {
    mockSelectProviders.mockReset()
    mockLoadDetokenizer.mockReset()
    createSession.mockReset()
    mockLoadDetokenizer.mockResolvedValue({ decode: () => 'hello world' })
  })

  it('creates sessions with the providers selectAsrExecutionProviders returns', async () => {
    mockSelectProviders.mockResolvedValue(['cpu'])
    createSession.mockImplementation(async (path: unknown) =>
      typeof path === 'string' && path.includes(ENCODER_FILE)
        ? fakeEncoderSession()
        : fakeDecoderSession()
    )

    const engine = createMoonshineEngine('/fake/model/dir')
    const { text } = await engine.transcribe(new Float32Array(160))

    expect(text).toBe('hello world')
    expect(createSession).toHaveBeenCalledTimes(2)
    for (const call of createSession.mock.calls) {
      expect((call[1] as { executionProviders: string[] }).executionProviders).toEqual(['cpu'])
    }
  })

  it('falls back to CPU-only when the preferred (e.g. dml) providers fail to initialize', async () => {
    mockSelectProviders.mockResolvedValue(['dml', 'cpu'])
    createSession.mockImplementation(async (path: unknown, opts: unknown) => {
      const providers = (opts as { executionProviders: string[] }).executionProviders
      if (providers.includes('dml')) throw new Error('DirectML device unavailable')
      return typeof path === 'string' && path.includes(ENCODER_FILE)
        ? fakeEncoderSession()
        : fakeDecoderSession()
    })

    const engine = createMoonshineEngine('/fake/model/dir')
    const { text } = await engine.transcribe(new Float32Array(160))

    expect(text).toBe('hello world')
    // 2 calls for the failed dml attempt (encoder+decoder) + 2 for the CPU retry.
    expect(createSession).toHaveBeenCalledTimes(4)
    const providersTried = createSession.mock.calls.map(
      (call) => (call[1] as { executionProviders: string[] }).executionProviders
    )
    expect(providersTried).toEqual([['dml', 'cpu'], ['dml', 'cpu'], ['cpu'], ['cpu']])
  })

  // Main error path: even the CPU-only fallback fails to initialize.
  it('propagates the error when the CPU-only fallback also fails', async () => {
    mockSelectProviders.mockResolvedValue(['cpu'])
    createSession.mockImplementation(async () => {
      throw new Error('no working ONNX Runtime build')
    })

    const engine = createMoonshineEngine('/fake/model/dir')
    await expect(engine.transcribe(new Float32Array(160))).rejects.toThrow(
      'no working ONNX Runtime build'
    )
  })
})
