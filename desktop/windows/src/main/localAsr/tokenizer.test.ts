import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildDetokenizer, loadDetokenizer } from './tokenizer'

// Small fixture vocab shaped exactly like the real model's tokenizer.json (a
// SentencePiece-style BPE vocab with byte-fallback) — NOT the real 32k-token
// vocab (this suite is hermetic, no network/model download).
const fixture = {
  model: {
    vocab: {
      '<unk>': 0,
      '<s>': 1,
      '</s>': 2,
      '▁hello': 10,
      '▁world': 11,
      '▁caf': 12,
      // UTF-8 bytes of "é" (0xC3 0xA9), split as byte-fallback tokens.
      '<0xC3>': 13,
      '<0xA9>': 14,
      unknown_but_not_special: 99 // present in a real vocab; used to prove pass-through
    }
  },
  added_tokens: [
    { id: 0, special: true },
    { id: 1, special: true },
    { id: 2, special: true }
  ]
}

describe('tokenizer detokenizer', () => {
  it('replaces ▁ with a space and strips the leading one', () => {
    const tok = buildDetokenizer(fixture)
    expect(tok.decode([1, 10, 11, 2])).toBe('hello world')
  })

  it('drops special tokens (bos/eos/unk) but keeps ordinary pieces', () => {
    const tok = buildDetokenizer(fixture)
    expect(tok.decode([1, 10, 2])).toBe('hello')
  })

  it('reconstructs a byte-fallback sequence via UTF-8 decode', () => {
    const tok = buildDetokenizer(fixture)
    // "▁caf" + <0xC3> + <0xA9>  → " café" → stripped leading space → "café"
    expect(tok.decode([1, 12, 13, 14, 2])).toBe('café')
  })

  it('silently drops an id absent from the vocab instead of throwing', () => {
    const tok = buildDetokenizer(fixture)
    expect(() => tok.decode([1, 12345, 10, 2])).not.toThrow()
    expect(tok.decode([1, 12345, 10, 2])).toBe('hello')
  })

  it('loadDetokenizer reads and parses a tokenizer.json file from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omi-tokenizer-'))
    try {
      const path = join(dir, 'tokenizer.json')
      writeFileSync(path, JSON.stringify(fixture))
      const tok = await loadDetokenizer(path)
      expect(tok.decode([1, 10, 11, 2])).toBe('hello world')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
