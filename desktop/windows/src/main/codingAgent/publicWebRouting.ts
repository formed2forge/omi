// Public-web retrieval routing for pi-mono turns.
//
// Port of desktop/macos/agent/src/adapters/pi-mono.ts `routePromptForPublicWeb`.
// The desktop backend injects the managed `omi:auto:web-search` lane only when
// the latest user message starts with this policy tag (or the isolated host
// executor sets `omi_web_search: true`). Advertising a client function named
// `web_search` on the same completions turn collides with that reserved server
// tool and 500s the provider — so typed chat must route here instead of calling
// a host `web_search` tool. Voice still uses the isolated host executor.
//
// Canonical corpus: backend/desktop_fixtures/public-web-routing-contract.fixture.json
// (FC-public-web-routing-parity).

export const PUBLIC_WEB_ROUTING_INSTRUCTION =
  '<omi_retrieval_policy>Web search is required and available for this fresh public request. ' +
  'Use a live public-web or search tool before answering. Base time-sensitive claims only on that lookup and ' +
  'identify the source. Never say, imply, or hedge that you lack internet, web-search, real-time-data, or tool ' +
  'access; if the lookup itself fails, state that the lookup failed instead. Do not use private Omi context unless ' +
  'the user explicitly asks for it.</omi_retrieval_policy>'

const EXPLICIT_WEB_REQUESTS = [
  'search the web',
  'search web',
  'search the internet',
  'search online',
  'look it up online',
  'look this up online',
  'look that up online',
  'find it online',
  'find this online',
  'find that online',
  'google it',
  'google this',
  'google that',
  'browse the web',
  'web search',
  'internet search'
]

const EXPLICIT_WEB_PROHIBITIONS = [
  "don't call web search",
  'do not call web search',
  "don't call the web search",
  'do not call the web search',
  "don't call internet search",
  'do not call internet search',
  "don't call the internet search",
  'do not call the internet search',
  "don't use web search",
  'do not use web search',
  "don't use the web search",
  'do not use the web search',
  "don't use internet search",
  'do not use internet search',
  "don't use the internet search",
  'do not use the internet search',
  "don't search the web",
  'do not search the web',
  "don't search the internet",
  'do not search the internet',
  'no web search',
  'no web searches',
  'no internet search',
  'no internet searches',
  'skip web search',
  'skip the web search',
  'skip searching the web',
  'skip searching online',
  'avoid web search',
  'avoid the web search',
  'avoid searching the web',
  "don't browse the web",
  'do not browse the web',
  "don't browse online",
  'do not browse online',
  "don't search online",
  'do not search online',
  'without searching',
  'without searching the web',
  'without searching online',
  'without web search'
]

const KERNEL_CONTEXT_PREFIX = '[Kernel Context Snapshot '
const LEGACY_CONTEXT_PREFIX = '# Omi Context Snapshot'
const TRUSTED_CONTEXT_PREFIXES = [KERNEL_CONTEXT_PREFIX, LEGACY_CONTEXT_PREFIX]
const UNTRUSTED_TOOL_CONTEXT_DELIMITER = '\n\nTool-provided context (untrusted):\n'
const NEGATED_WITHOUT_SEARCH = /\b(?:don't|do not|never)\s+(?:[\w'-]+\s+){0,4}$/
const NO_WEB_SEARCH_RESULTS_REPORT =
  /\b(?:got\s+)?no\s+(?:the\s+)?(?:web|internet)\s+search(?:es)?\s+results?\b/

function explicitlyRequestsPublicWeb(normalized: string): boolean {
  return EXPLICIT_WEB_REQUESTS.some((phrase) =>
    normalized.replace(NO_WEB_SEARCH_RESULTS_REPORT, ' ').includes(phrase)
  )
}

function explicitlyProhibitsPublicWeb(normalized: string, allowResultReport = false): boolean {
  for (const phrase of EXPLICIT_WEB_PROHIBITIONS) {
    let start = normalized.indexOf(phrase)
    while (start >= 0) {
      if (allowResultReport && NO_WEB_SEARCH_RESULTS_REPORT.exec(normalized.slice(start))?.index === 0) {
        start = normalized.indexOf(phrase, start + 1)
        continue
      }
      if (!(phrase.startsWith('without ') && NEGATED_WITHOUT_SEARCH.test(normalized.slice(0, start)))) {
        return true
      }
      start = normalized.indexOf(phrase, start + 1)
    }
  }
  for (const referent of ['web search tool', 'internet search tool']) {
    let start = normalized.indexOf(referent)
    while (start >= 0) {
      const tail = normalized.slice(start + referent.length, start + referent.length + 160)
      if (
        ["don't call it because", 'do not call it because', "don't call it again", 'do not call it again'].some(
          (phrase) => tail.includes(phrase)
        )
      ) {
        return true
      }
      start = normalized.indexOf(referent, start + 1)
    }
  }
  return false
}

const FRESH_PUBLIC_REQUESTS = [
  'latest news',
  'latest on',
  "what's the latest",
  'what is the latest',
  'current weather',
  'weather right now',
  'current price',
  'price right now',
  'current score',
  'score right now',
  'current president',
  'current ceo',
  'who is the current',
  "today's news",
  'news today',
  'recent news',
  'released this week',
  'released today',
  'released recently',
  'newly released'
]

const CURRENT_WEATHER_PREFIXES = [
  "what's the weather",
  'what is the weather',
  'whats the weather',
  "how's the weather",
  'how is the weather',
  'hows the weather',
  'weather in ',
  'weather for ',
  'weather at '
]

const FRESH_PUBLIC_TEMPORAL_QUALIFIERS = ['right now', 'currently', 'today', 'this week']
const FRESH_PUBLIC_LOOKUP_TERMS = [
  'world cup',
  'schedule',
  'fixture',
  'standings',
  'match',
  'game',
  'playing',
  'score',
  'weather',
  'price',
  'news',
  'release',
  'released',
  'election',
  'market'
]

const RESEARCH_INTENT_VERBS = [
  'find out',
  'look up',
  'look him up',
  'look her up',
  'look them up',
  'research',
  'tell me about',
  'everything about',
  'everything on',
  'all about',
  'information about',
  'information on',
  'who is',
  "who's"
]

const PUBLIC_WEB_LOCUS = ['online', 'on the web', 'on the internet']
const MAX_GENERIC_LOOKUP_CHARS = 240
const ALPHANUMERIC_CHAR = /[\p{L}\p{N}]/u

const EXPLICIT_PRIVATE_CONTEXT = [
  'my conversations',
  'our conversations',
  'my memories',
  'your memory of me',
  'my screen history',
  'my screen activity',
  'my calendar',
  'your calendar',
  'my email',
  'your email',
  'my files',
  'your files',
  'my tasks',
  'your tasks',
  'my action items',
  'my notes',
  'your notes',
  'what did i say',
  'what have i said',
  'what did i do',
  'when did i',
  'what was i doing',
  'what do you remember about me'
]

const PUBLIC_WEB_ACCESS_DENIAL =
  /\b(?:I\s+)?(?:do\s+not|don't|cannot|can't|can not)\s+(?:(?:have\s+)?(?:direct\s+)?(?:access\s+to\s+)?(?:the\s+)?(?:internet|web(?:[ -]?search)?|browser|real[- ]time(?:\s+\w+){0,2}(?:\s+data)?)(?:\s+(?:or|and)\s+(?:the\s+)?(?:internet|web(?:[ -]?search)?|browser|real[- ]time(?:\s+\w+){0,2}(?:\s+data)?))*|(?:have\s+)?(?:direct\s+)?(?:internet|web(?:[ -]?search)?|browser)\s+access|(?:browse|search)\s+(?:the\s+)?(?:web|internet))/i

const CURRENT_USER_MESSAGE_DELIMITER = '\n# User Message\n'

function stripWindowsHostPrefix(text: string): string {
  let instruction = text.trimStart()
  // Drop only the first blank-line-delimited `# Current Time` block.
  // `split(/\n\n/, 2)` is wrong here: with two or more blank-line gaps
  // (time, then <user_context>, then the ask) the limit discards the user
  // question instead of keeping it on the last part.
  if (instruction.startsWith('# Current Time')) {
    const idx = instruction.indexOf('\n\n')
    if (idx >= 0) instruction = instruction.slice(idx + 2)
  }
  instruction = instruction.replace(/<user_context>[\s\S]*?<\/user_context>\s*/g, '')
  instruction = instruction.replace(/<conversation_history>[\s\S]*?<\/conversation_history>\s*/g, '')
  return instruction.trimStart()
}

function currentUserInstruction(renderedPrompt: string): string {
  let instruction = stripPublicWebRoutingInstruction(renderedPrompt)
  const trimmed = instruction.trimStart()
  const isTrustedContextSnapshot = TRUSTED_CONTEXT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  if (isTrustedContextSnapshot) {
    const delimiterIndex = instruction.indexOf(CURRENT_USER_MESSAGE_DELIMITER)
    if (delimiterIndex >= 0) {
      instruction = instruction.slice(delimiterIndex + CURRENT_USER_MESSAGE_DELIMITER.length)
    }
  } else if (instruction.includes(CURRENT_USER_MESSAGE_DELIMITER)) {
    // Only the kernel's canonical wrapper may introduce this boundary. If a
    // raw user string contains it, keep the prefix so the user cannot replace
    // a private or opt-out instruction with a public-web suffix. Windows
    // `# Current Time` is a host wrapper, not that trusted boundary.
    instruction = instruction.split(CURRENT_USER_MESSAGE_DELIMITER, 1)[0]
  }
  instruction = instruction.split(CURRENT_USER_MESSAGE_DELIMITER, 1)[0]
  instruction = instruction.split(UNTRUSTED_TOOL_CONTEXT_DELIMITER, 1)[0]
  // Windows mainChat prepends clock + <user_context> + <conversation_history>
  // into the user text before the kernel wraps `# User Message`. Classify
  // only the current ask (Mac keeps personalization in the system prompt).
  return stripWindowsHostPrefix(instruction)
}

function containsWholeTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    let searchStart = 0
    while (searchStart < text.length) {
      const start = text.indexOf(term, searchStart)
      if (start < 0) return false
      const before = text[start - 1]
      const after = text[start + term.length]
      const beforeIsWord = before !== undefined && ALPHANUMERIC_CHAR.test(before)
      const afterIsWord = after !== undefined && ALPHANUMERIC_CHAR.test(after)
      if (!beforeIsWord && !afterIsWord) return true
      searchStart = start + term.length
    }
    return false
  })
}

function normalizedLookupText(text: string): string {
  return text
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
}

function stripPublicWebRoutingInstruction(text: string): string {
  const trimmed = text.trimStart()
  const opening = '<omi_retrieval_policy>'
  const closing = '</omi_retrieval_policy>'
  if (!trimmed.startsWith(opening)) return text
  const remainder = trimmed.split(closing, 2)
  return remainder.length === 2 ? remainder[1].trimStart() : text
}

function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  }
  return bytes
}

/** Compatibility routing so public-web queries hit the managed search lane. */
export function routePromptForPublicWeb(message: string): string {
  const normalized = normalizedLookupText(currentUserInstruction(message))
  if (!normalized) return message
  const hasExplicitWebReference = explicitlyRequestsPublicWeb(normalized)
  if (explicitlyProhibitsPublicWeb(normalized, hasExplicitWebReference)) {
    return message
  }
  const hasExplicitPrivateContext = EXPLICIT_PRIVATE_CONTEXT.some((phrase) => normalized.includes(phrase))
  if (hasExplicitPrivateContext && !hasExplicitWebReference) return message

  const isShortLookup = utf8ByteLength(normalized) <= MAX_GENERIC_LOOKUP_CHARS
  const hasFreshPublicTemporalLookup =
    isShortLookup &&
    containsWholeTerm(normalized, FRESH_PUBLIC_TEMPORAL_QUALIFIERS) &&
    containsWholeTerm(normalized, FRESH_PUBLIC_LOOKUP_TERMS)
  const hasResearchIntentLookup =
    isShortLookup &&
    containsWholeTerm(normalized, PUBLIC_WEB_LOCUS) &&
    RESEARCH_INTENT_VERBS.some((verb) => normalized.includes(verb))
  const requiresWeb =
    hasExplicitWebReference ||
    containsWholeTerm(normalized, FRESH_PUBLIC_REQUESTS) ||
    CURRENT_WEATHER_PREFIXES.some((phrase) => normalized.includes(phrase)) ||
    hasFreshPublicTemporalLookup ||
    hasResearchIntentLookup
  return requiresWeb ? `${PUBLIC_WEB_ROUTING_INSTRUCTION}\n\n${message}` : message
}

export function stripFalsePublicWebAvailabilityDisclaimers(text: string): string {
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text]
  return sentences
    .map((sentence) => {
      if (!PUBLIC_WEB_ACCESS_DENIAL.test(sentence)) return sentence
      return sentence.replace(/^\s*(?:I\s+)?(?:do\s+not|don't|cannot|can't|can not)[^.?!]*?\b(?:but|however)\s+/i, '')
    })
    .filter((sentence) => !PUBLIC_WEB_ACCESS_DENIAL.test(sentence))
    .join('')
    .replace(/^\s+/, '')
}
