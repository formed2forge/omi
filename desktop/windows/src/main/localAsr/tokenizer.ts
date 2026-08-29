// Decode-only detokenizer for the model's tokenizer.json (a SentencePiece-style
// BPE vocab with byte-fallback, the same shape Llama/Moonshine/many HF models
// ship — verified against the real onnx-community/moonshine-tiny-ONNX
// tokenizer.json: `{"model":{"type":"BPE","byte_fallback":true,"vocab":{...}}}`,
// decoder pipeline `Replace("▁"→" ") → ByteFallback → Fuse → Strip(1 leading
// space)`). We only ever need id→text (the model emits token ids; we never
// re-tokenize text), so this implements just that direction — no BPE merge/encode
// logic, no pre-tokenizer, no normalizer.
import { readFile } from 'node:fs/promises'

export type Detokenizer = {
  /** Decode a sequence of token ids to text, dropping special tokens (BOS/EOS/
   *  unk/added tokens) and reconstructing byte-fallback sequences. */
  decode: (ids: readonly number[]) => string
}

type TokenizerJson = {
  model: { vocab: Record<string, number> }
  added_tokens?: { id: number; special?: boolean }[]
}

const BYTE_TOKEN_RE = /^<0x([0-9A-Fa-f]{2})>$/
const WORD_BOUNDARY = '▁' // SentencePiece's "▁", marks a leading space

export function buildDetokenizer(tokenizerJson: TokenizerJson): Detokenizer {
  const idToToken = new Map<number, string>()
  for (const [piece, id] of Object.entries(tokenizerJson.model.vocab)) {
    idToToken.set(id, piece)
  }
  const specialIds = new Set(
    (tokenizerJson.added_tokens ?? []).filter((t) => t.special).map((t) => t.id)
  )

  function decode(ids: readonly number[]): string {
    let out = ''
    let byteBuf: number[] = []
    const flushBytes = (): void => {
      if (byteBuf.length === 0) return
      out += Buffer.from(byteBuf).toString('utf8')
      byteBuf = []
    }
    for (const id of ids) {
      if (specialIds.has(id)) continue
      const piece = idToToken.get(id)
      if (piece === undefined) continue // unknown id — drop rather than corrupt output
      const m = BYTE_TOKEN_RE.exec(piece)
      if (m) {
        byteBuf.push(parseInt(m[1], 16))
        continue
      }
      flushBytes()
      out += piece.replace(new RegExp(WORD_BOUNDARY, 'g'), ' ')
    }
    flushBytes()
    // Strip decoder: at most one leading space (matches tokenizer.json's
    // `{"type":"Strip","start":1,"stop":0}`).
    return out.startsWith(' ') ? out.slice(1) : out
  }

  return { decode }
}

/** Load and parse the model's tokenizer.json into a Detokenizer. */
export async function loadDetokenizer(tokenizerJsonPath: string): Promise<Detokenizer> {
  const raw = await readFile(tokenizerJsonPath, 'utf8')
  return buildDetokenizer(JSON.parse(raw) as TokenizerJson)
}
