// Unit tests for the web_search host executor. Injected fetch/session — no
// electron, no network. Asserts the Mac public-web contract: isolated POST to
// desktop `/v2/chat/completions`, `omi_web_search: true`, no BYOK header, one
// user message, 45s timeout, and that optional `context` never leaves the host.

import { describe, it, expect, vi } from 'vitest'
import {
  PUBLIC_WEB_SEARCH_TIMEOUT_MS,
  createWebSearchExecutor,
  publicWebSearchPrompt,
  searchPublicWeb,
  type PublicWebSearchDeps,
  type WebSearchFetch
} from './webSearchTool'
import { defaultProductToolExecutors, WINDOWS_SERVICEABLE_PRODUCT_TOOLS } from './toolRelayBridge'

const ctx = (signal?: AbortSignal) => ({
  sessionId: 's1',
  adapterId: 'pi-mono',
  signal: signal ?? new AbortController().signal
})

describe('publicWebSearchPrompt', () => {
  it('matches the Mac spoken-answer wrapper (live web, name the source, no Markdown/URL)', () => {
    const prompt = publicWebSearchPrompt('current New York weather')
    expect(prompt).toContain('Search the live public web before answering this request.')
    expect(prompt).toContain('Name the source you relied on, but do not use Markdown or recite a URL.')
    expect(prompt).toContain('Request:\ncurrent New York weather')
  })
})

describe('createWebSearchExecutor', () => {
  it('requires a query', async () => {
    const search = vi.fn(async () => 'unused')
    const exec = createWebSearchExecutor(search)
    expect(await exec({}, ctx())).toBe('Error: query is required')
    expect(await exec({ query: '   ' }, ctx())).toBe('Error: query is required')
    expect(search).not.toHaveBeenCalled()
  })

  it('wraps the query in the Mac public-web prompt and does not forward context', async () => {
    const search = vi.fn(async () => 'It is sunny, according to the National Weather Service.')
    const exec = createWebSearchExecutor(search)
    const out = await exec(
      { query: 'current New York weather', context: 'my dog is named Spot' },
      ctx()
    )
    expect(out).toBe('It is sunny, according to the National Weather Service.')
    expect(search).toHaveBeenCalledTimes(1)
    const req = search.mock.calls[0][0]
    expect(req.query).toBe(publicWebSearchPrompt('current New York weather'))
    expect(req.query).not.toContain('Spot')
    expect(req).not.toHaveProperty('context')
  })

  it('returns cancelled when the relay signal is already aborted', async () => {
    const search = vi.fn(async () => 'unused')
    const exec = createWebSearchExecutor(search)
    const ac = new AbortController()
    ac.abort()
    expect(await exec({ query: 'news' }, ctx(ac.signal))).toBe('Error: request was cancelled.')
    expect(search).not.toHaveBeenCalled()
  })
})

describe('searchPublicWeb — Mac isolated-lane contract', () => {
  function deps(over?: {
    session?: { desktopApiBase: string; token: string } | null
    fetch?: WebSearchFetch
    abort?: AbortSignal
  }): PublicWebSearchDeps {
    return {
      getSession: () =>
        over && 'session' in over
          ? (over.session ?? null)
          : { desktopApiBase: 'https://desktop.example.test', token: 'public-web-token' },
      getAbortSignal: () => over?.abort,
      fetch:
        over?.fetch ??
        (async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content:
                    'It is sunny and 80 degrees, according to the National Weather Service.'
                }
              }
            ]
          })
        }))
    }
  }

  it('POSTs one public-only managed request matching Mac APIClientPublicWebSearchTests', async () => {
    const captured: { url?: string; init?: Parameters<WebSearchFetch>[1] } = {}
    const fetch: WebSearchFetch = async (url, init) => {
      captured.url = url
      captured.init = init
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'It is sunny and 80 degrees, according to the National Weather Service.'
              }
            }
          ]
        })
      }
    }

    const answer = await searchPublicWeb(
      { query: publicWebSearchPrompt('Search current New York weather and name the source.') },
      deps({ fetch })
    )
    expect(answer).toBe('It is sunny and 80 degrees, according to the National Weather Service.')
    expect(captured.url).toBe('https://desktop.example.test/v2/chat/completions')
    expect(captured.init?.method).toBe('POST')
    expect(captured.init?.headers.Authorization).toBe('Bearer public-web-token')
    expect(captured.init?.headers['X-BYOK-Anthropic']).toBeUndefined()
    expect(captured.init?.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(captured.init?.body ?? '{}') as Record<string, unknown>
    expect(body.model).toBe('omi-sonnet')
    expect(body.omi_web_search).toBe(true)
    expect(body.stream).toBe(false)
    expect(body.max_tokens).toBe(512)
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe(
      publicWebSearchPrompt('Search current New York weather and name the source.')
    )
  })

  it('strips a trailing slash on desktopApiBase before appending /v2/chat/completions', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] })
    }))
    await searchPublicWeb(
      { query: 'q' },
      deps({
        session: { desktopApiBase: 'https://desktop.example.test/', token: 't' },
        fetch
      })
    )
    expect(fetch.mock.calls[0][0]).toBe('https://desktop.example.test/v2/chat/completions')
  })

  it('fail-opens when signed out', async () => {
    const fetch = vi.fn<WebSearchFetch>(async () => {
      throw new Error('should not fetch')
    })
    const out = await searchPublicWeb({ query: 'q' }, deps({ session: null, fetch }))
    expect(out).toBe('Error: not signed in to Omi. Ask the user to sign in, then retry.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fail-opens on HTTP error, empty content, and thrown fetch', async () => {
    expect(
      await searchPublicWeb(
        { query: 'q' },
        deps({
          fetch: async () => ({ ok: false, status: 500, json: async () => ({}) })
        })
      )
    ).toBe('Error: The web lookup failed. Please try again.')

    expect(
      await searchPublicWeb(
        { query: 'q' },
        deps({
          fetch: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: '   ' } }] })
          })
        })
      )
    ).toBe('Error: The web lookup failed. Please try again.')

    expect(
      await searchPublicWeb(
        { query: 'q' },
        deps({
          fetch: async () => {
            throw new Error('network down')
          }
        })
      )
    ).toBe('Error: The web lookup failed. Please try again.')
  })

  it('uses the Mac 45s timeout budget', () => {
    expect(PUBLIC_WEB_SEARCH_TIMEOUT_MS).toBe(45_000)
  })
})

describe('web_search is registered + serviceable', () => {
  it('is in the default registry and the serviceable allowlist', () => {
    expect(defaultProductToolExecutors.has('web_search')).toBe(true)
    expect(WINDOWS_SERVICEABLE_PRODUCT_TOOLS.has('web_search')).toBe(true)
  })
})
