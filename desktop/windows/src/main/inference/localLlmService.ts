// Standalone, callable "basic processing" capability: finished transcript text
// in, short generated text (summary/highlights) out — via the small local LLM
// picked in localLlmConfig.ts, run through node-llama-cpp.
//
// Deliberately NOT wired into any conversation-summary UI/product surface yet
// (that integration is separate future work) — this module is the isolated,
// independently-testable capability only.
//
// Deliberately NOT the live-transcription path: this only ever runs on a
// FINISHED transcript, after a separate (separately-built) ASR model has
// already produced it.
import { isModelDownloaded, localLlmModelPath } from './modelStore'
import {
  LOCAL_LLM_MODEL,
  LOCAL_LLM_DEFAULT_MAX_OUTPUT_TOKENS,
  LOCAL_LLM_DEFAULT_TIMEOUT_MS,
  buildSummaryPrompt,
  type LocalLlmModelSpec
} from './localLlmConfig'
import { selectExecutionPlan, type LocalLlmExecutionPlan } from './executionProvider'

/** The model isn't downloaded yet. Callers should have run
 *  `ensureModelDownloaded` (modelDownloader.ts) — typically as part of a
 *  first-run flow — before calling summarizeTranscript. */
export class ModelNotDownloadedError extends Error {
  constructor(readonly modelId: string) {
    super(
      `Local LLM model "${modelId}" is not downloaded yet — call ensureModelDownloaded() first.`
    )
    this.name = 'ModelNotDownloadedError'
  }
}

/** Inference itself failed (engine load error, generation error, or any
 *  non-ModelNotDownloadedError thrown by the engine). */
export class InferenceError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'InferenceError'
  }
}

/** Generation didn't finish within the configured timeout. A subtype of
 *  InferenceError so a caller that only checks `instanceof InferenceError`
 *  still catches it. */
export class InferenceTimeoutError extends InferenceError {
  constructor(readonly timeoutMs: number) {
    super(`Local LLM inference timed out after ${timeoutMs}ms`)
    this.name = 'InferenceTimeoutError'
  }
}

/** Minimal engine contract this service needs. The default production engine
 *  (below) wraps node-llama-cpp; tests inject a fake implementing this
 *  interface instead — the native binding never enters the test import graph. */
export interface LlmEngine {
  generate(prompt: string, opts: { maxTokens: number; signal: AbortSignal }): Promise<string>
  dispose(): Promise<void> | void
}

export type EngineFactory = (
  modelPath: string,
  spec: LocalLlmModelSpec,
  plan: LocalLlmExecutionPlan
) => Promise<LlmEngine>

/** Default production engine: lazily imports node-llama-cpp so the native
 *  binding is only ever touched once summarizeTranscript actually runs (not
 *  merely by importing this module) — keeps app startup and unit tests free
 *  of the native dependency. */
const defaultEngineFactory: EngineFactory = async (modelPath, spec, plan) => {
  const { getLlama, LlamaChatSession } = await import('node-llama-cpp')
  const llama = await getLlama({ gpu: plan.gpu })
  const model = await llama.loadModel({ modelPath })
  const context = await model.createContext({
    contextSize: spec.contextSize,
    threads: plan.threads
  })
  const sequence = context.getSequence()
  const session = new LlamaChatSession({ contextSequence: sequence })
  return {
    generate: (prompt, opts) =>
      session.prompt(prompt, { maxTokens: opts.maxTokens, signal: opts.signal }),
    dispose: async () => {
      session.dispose()
      await context.dispose()
      await model.dispose()
    }
  }
}

export interface SummarizeOptions {
  /** Cap on generated tokens. Defaults to LOCAL_LLM_DEFAULT_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number
  /** Give up (InferenceTimeoutError) after this many ms. Defaults to
   *  LOCAL_LLM_DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number
  /** Caller-controlled cancellation, e.g. tied to app shutdown. */
  signal?: AbortSignal
  /** Override the model spec — tests only; production omits this. */
  modelSpec?: LocalLlmModelSpec
  /** Override the model cache dir — tests only; production omits this
   *  (matches the baseDir override on modelStore/modelDownloader). */
  baseDir?: string
  /** Override engine construction — tests only; production omits this. */
  engineFactory?: EngineFactory
}

function runWithTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout()
      reject(new InferenceTimeoutError(timeoutMs))
    }, timeoutMs)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * Run "basic processing" (a short summary) over a FINISHED transcript, on the
 * local model — the standalone capability this module exists to provide.
 *
 * Throws:
 *   - `ModelNotDownloadedError` if the model file isn't present on disk yet.
 *   - `InferenceTimeoutError` if generation doesn't finish in time.
 *   - `InferenceError` for any other engine/generation failure.
 */
export async function summarizeTranscript(
  transcriptText: string,
  options: SummarizeOptions = {}
): Promise<string> {
  const spec = options.modelSpec ?? LOCAL_LLM_MODEL
  const engineFactory = options.engineFactory ?? defaultEngineFactory
  const maxOutputTokens = options.maxOutputTokens ?? LOCAL_LLM_DEFAULT_MAX_OUTPUT_TOKENS
  const timeoutMs = options.timeoutMs ?? LOCAL_LLM_DEFAULT_TIMEOUT_MS

  if (!isModelDownloaded(spec, options.baseDir)) {
    throw new ModelNotDownloadedError(spec.id)
  }

  const modelPath = localLlmModelPath(spec, options.baseDir)
  const plan = await selectExecutionPlan()

  const controller = new AbortController()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let engine: LlmEngine | undefined
  try {
    engine = await engineFactory(modelPath, spec, plan)
    const prompt = buildSummaryPrompt(transcriptText)
    const text = await runWithTimeout(
      engine.generate(prompt, { maxTokens: maxOutputTokens, signal: controller.signal }),
      timeoutMs,
      () => controller.abort()
    )
    return text.trim()
  } catch (e) {
    if (e instanceof InferenceError) throw e
    throw new InferenceError('Local LLM inference failed', e)
  } finally {
    if (engine) {
      try {
        await engine.dispose()
      } catch {
        /* best-effort cleanup — a dispose failure must not mask the real result/error */
      }
    }
  }
}
