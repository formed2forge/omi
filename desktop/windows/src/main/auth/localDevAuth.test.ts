import { describe, it, expect, vi } from 'vitest'
import { requestLocalDevCustomToken, sanitizeLocalDevUid } from './localDevAuth'

describe('sanitizeLocalDevUid', () => {
  it('accepts the seeded pricing fixture uids', () => {
    for (const uid of ['pricing_basic', 'pricing_plus', 'pricing_pro_v2', 'pricing_plus_lapsed']) {
      expect(sanitizeLocalDevUid(uid)).toBe(uid)
    }
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeLocalDevUid('  pricing_plus  ')).toBe('pricing_plus')
  })

  it('rejects an empty or whitespace-only uid', () => {
    expect(sanitizeLocalDevUid('')).toBeNull()
    expect(sanitizeLocalDevUid('   ')).toBeNull()
  })

  it('rejects a uid over 128 characters', () => {
    expect(sanitizeLocalDevUid('a'.repeat(129))).toBeNull()
  })

  it('accepts exactly 128 characters', () => {
    expect(sanitizeLocalDevUid('a'.repeat(128))).toBe('a'.repeat(128))
  })

  it('rejects characters outside the safe charset (injection guard)', () => {
    expect(sanitizeLocalDevUid('pricing plus')).toBeNull()
    expect(sanitizeLocalDevUid('pricing/plus')).toBeNull()
    expect(sanitizeLocalDevUid('pricing_plus&uid=other')).toBeNull()
    expect(sanitizeLocalDevUid('<script>')).toBeNull()
  })
})

describe('requestLocalDevCustomToken', () => {
  it('POSTs form-encoded uid and returns the custom token', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('http://192.168.1.50:8000/v1/auth/local-dev/custom-token')
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
        'application/x-www-form-urlencoded'
      )
      expect(init?.body).toBeInstanceOf(URLSearchParams)
      expect((init?.body as URLSearchParams).get('uid')).toBe('pricing_plus')
      return new Response(
        JSON.stringify({ custom_token: 'CT', uid: 'pricing_plus', provider: 'local_dev' }),
        { status: 200 }
      )
    }) as unknown as typeof fetch
    const out = await requestLocalDevCustomToken(
      'http://192.168.1.50:8000',
      'pricing_plus',
      fetchImpl
    )
    expect(out).toEqual({ customToken: 'CT', uid: 'pricing_plus' })
  })

  it('tolerates a trailing slash on the api base', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      expect(String(url)).toBe('http://192.168.1.50:8000/v1/auth/local-dev/custom-token')
      return new Response(JSON.stringify({ custom_token: 'CT' }), { status: 200 })
    }) as unknown as typeof fetch
    await requestLocalDevCustomToken('http://192.168.1.50:8000/', 'pricing_plus', fetchImpl)
  })

  it('surfaces a clarified message on 404 (backend not bound to an Auth emulator)', async () => {
    const fetchImpl = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(
      requestLocalDevCustomToken('http://x:8000', 'pricing_plus', fetchImpl)
    ).rejects.toThrow(/FIREBASE_AUTH_EMULATOR_HOST/)
  })

  it('surfaces the backend detail on 400', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ detail: 'uid must contain 1–128 characters' }), {
        status: 400
      })) as unknown as typeof fetch
    await expect(
      requestLocalDevCustomToken('http://x:8000', 'pricing_plus', fetchImpl)
    ).rejects.toThrow(/Local development sign-in failed \(400\): uid must contain/)
  })

  it('rejects a 200 with no custom_token', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ uid: 'pricing_plus' }), {
        status: 200
      })) as unknown as typeof fetch
    await expect(
      requestLocalDevCustomToken('http://x:8000', 'pricing_plus', fetchImpl)
    ).rejects.toThrow(/no custom_token/)
  })
})
