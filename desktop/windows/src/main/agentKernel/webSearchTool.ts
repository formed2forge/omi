// Host executor for `web_search` — Windows port of macOS
// RealtimeHubController.searchPublicWeb + APIClient.searchPublicWebForVoice.
//
// Isolated POST to the desktop backend `v2/chat/completions` with
// `omi_web_search: true`. Deliberately does NOT reuse the canonical chat
// session transcript: that session may contain private memories or prior tool
// results, and the backend withholds provider-hosted web search from a tainted
// transcript. One isolated user message preserves that privacy boundary and
// lets typed chat and realtime voice share the same managed public-web lane.
//
// Hits `desktopApiBase` (version-less; we append `/v2/chat/completions`), never
// the Python `apiBase`. No BYOK headers — same as Mac `includeBYOK: false`.
// Native / electron edges are reached by CALL-TIME dynamic import so this
// module stays load-pure for vitest.

import type { ProductToolContext, ProductToolExecutor } from './toolRelayBridge'

/** Mac `APIClient.searchPublicWebForVoice` requestTimeout. */
export const PUBLIC_WEB_SEARCH_TIMEOUT_MS = 45_000

const LOOKUP_FAILED = 'Error: The web lookup failed. Please try again.'

/** Host-authored public-only request sent to the managed web-search lane.
 *  Port of RealtimeHubTools.publicWebSearchPrompt — private realtime/chat
 *  context is deliberately excluded. */
export function publicWebSearchPrompt(query: string): string {
  return (
    'Search the live public web before answering this request. Reply with one to four concise, ' +
    'natural spoken sentences. Name the source you relied on, but do not use Markdown or recite a URL.\n' +
    '\n' +
    'Request:\n' +
    query
  )
}

export interface PublicWebSearchRequest {
  query: string
  signal?: AbortSignal
}

/** Narrow fetch seam so tests never import electron. Matches `net.fetch`. */
export type WebSearchFetch = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string
    signal?: AbortSignal
  }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface PublicWebSearchDeps {
  getSession: () => { desktopApiBase: string; token: string } | null
  getAbortSignal: () => AbortSignal | undefined
  fetch: WebSearchFetch
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: unknown } }>
}

function completionsUrl(desktopApiBase: string): string {
  return `${desktopApiBase.replace(/\/+$/, '')}/v2/chat/completions`
}

async function bindProdSearchDeps(): Promise<PublicWebSearchDeps> {
  const { net } = await import('electron')
  const { getBackendSession, getAbortSignal } = await import('../assistants/core/session')
  return {
    getSession: () => getBackendSession(),
    getAbortSignal,
    fetch: (url, init) => net.fetch(url, init)
  }
}

/**
 * POST one isolated public-web lookup. Fail-open to an `Error: …` string
 * (never a throw) so the tool loop continues.
 */
export async function searchPublicWeb(
  req: PublicWebSearchRequest,
  deps?: PublicWebSearchDeps
): Promise<string> {
  const bound = deps ?? (await bindProdSearchDeps())
  const session = bound.getSession()
  if (!session) {
    return 'Error: not signed in to Omi. Ask the user to sign in, then retry.'
  }

  const external = req.signal
  const sessionSignal = bound.getAbortSignal()
  if (external?.aborted || sessionSignal?.aborted) {
    return 'Error: request was cancelled.'
  }

  const ctrl = new AbortController()
  const onAbort = (): void => ctrl.abort()
  external?.addEventListener('abort', onAbort, { once: true })
  sessionSignal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ctrl.abort(), PUBLIC_WEB_SEARCH_TIMEOUT_MS)

  try {
    const res = await bound.fetch(completionsUrl(session.desktopApiBase), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'omi-sonnet',
        stream: false,
        max_tokens: 512,
        omi_web_search: true,
        messages: [{ role: 'user', content: req.query }]
      }),
      signal: ctrl.signal
    })
    if (!res.ok) return LOOKUP_FAILED
    const data = (await res.json()) as ChatCompletionsResponse
    const content = data.choices?.[0]?.message?.content
    const answer = typeof content === 'string' ? content.trim() : ''
    if (!answer) return LOOKUP_FAILED
    return answer
  } catch {
    if (ctrl.signal.aborted) return 'Error: request was cancelled.'
    return LOOKUP_FAILED
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
    sessionSignal?.removeEventListener('abort', onAbort)
  }
}

/**
 * `web_search`. Wraps the user query in Mac's public-web prompt and posts an
 * isolated completions request. The optional `context` argument is accepted
 * (schema compatibility with the voice/chat tool card) but NEVER forwarded —
 * Mac's `searchPublicWeb` discards `toolContext` for the same privacy reason.
 */
export function createWebSearchExecutor(
  search?: (req: PublicWebSearchRequest) => Promise<string>
): ProductToolExecutor {
  const run = search ?? ((req) => searchPublicWeb(req))
  return async (input, ctx: ProductToolContext) => {
    const raw = input.query
    const query = typeof raw === 'string' ? raw.trim() : ''
    if (!query) return 'Error: query is required'
    if (ctx.signal.aborted) return 'Error: request was cancelled.'
    return run({ query: publicWebSearchPrompt(query), signal: ctx.signal })
  }
}
