/**
 * Web search (features 16.1-16.3, 16.9-16.12; decisions §44). One service
 * every agent's `web_search` tool goes through:
 *
 *   credits   one OpenRouter call with its `openrouter:web_search` server
 *             tool on Exa, through our credits proxy (or the user's own
 *             OpenRouter key); a small model only lists the results
 *   own key   Brave, Tavily or Exa, straight from the laptop
 *
 * The tool never sees a key or the device token: it asks this service, which
 * the permission layer hands it after checking the query for private content.
 * Results are cached in memory for 15 minutes, except Brave's (its terms
 * allow keeping results only on a plan with storage rights).
 */
import type {
  SearchKeyProvider,
  SearchResult,
  SearchSettings,
  SearchSource,
  SiteLists
} from '../../shared/protocol'
import type { Fetch } from './net'
import type { CloudAccess } from './openrouter'

export const SEARCH_CACHE_MS = 15 * 60 * 1000
const CACHE_MAX = 200
/** Exa through OpenRouter: $0.007 a search with up to 10 results (external-services.md). */
export const OPENROUTER_SEARCH_USD = 0.007

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  source: 'auto',
  country: '',
  language: '',
  sites: {}
}

export class SearchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchError'
  }
}

export interface SearchRequest {
  query: string
  count?: number
  /** Only results from the last day, week, month or year. */
  freshness?: 'day' | 'week' | 'month' | 'year'
}

export interface SearchAnswer {
  results: SearchResult[]
  /** Who answered, for the activity log: "credits (OpenRouter, Exa)", "your Tavily key". */
  via: string
  /** What it cost in credits' dollars; 0 when billed to the user's own key or cached. */
  costUsd: number
  cached: boolean
}

/** What a tool sees: search, and the agent's site lists. */
export interface SearchAccess {
  search(request: SearchRequest): Promise<SearchAnswer>
  sites(): SiteLists
}

export interface SearchService {
  /** For one agent's tool call; `guard` refuses a query carrying private content. */
  forAgent(agent: string, guard: (query: string) => void): SearchAccess
  /** Is `host` allowed for this agent by its site lists? */
  allowedSite(agent: string, host: string): boolean
}

const LABEL: Record<SearchKeyProvider, string> = { exa: 'Exa', tavily: 'Tavily', brave: 'Brave' }

/** "www.example.com" → "example.com"; also accepts addresses. */
export function siteOf(value: string): string {
  let host = value.trim().toLowerCase()
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname
  } catch {
    // Not an address; used as written.
  }
  return host.replace(/^www\./, '').replace(/\/.*$/, '')
}

/** Whether `host` is `site` or one of its subdomains. */
export function onSite(host: string, site: string): boolean {
  const h = siteOf(host)
  const s = siteOf(site)
  return !!s && (h === s || h.endsWith(`.${s}`))
}

export function siteAllowed(lists: SiteLists, host: string): boolean {
  if (lists.blocked.some((s) => onSite(host, s))) return false
  return lists.only.length === 0 || lists.only.some((s) => onSite(host, s))
}

function clampCount(n: number | undefined): number {
  return Math.max(1, Math.min(10, Math.round(n ?? 6)))
}

/** Tavily wants a country's English name in lower case. The EU and a few more. */
const COUNTRY_NAMES: Record<string, string> = {
  AT: 'austria',
  BE: 'belgium',
  BG: 'bulgaria',
  HR: 'croatia',
  CY: 'cyprus',
  CZ: 'czech republic',
  DK: 'denmark',
  EE: 'estonia',
  FI: 'finland',
  FR: 'france',
  DE: 'germany',
  GR: 'greece',
  HU: 'hungary',
  IE: 'ireland',
  IT: 'italy',
  LV: 'latvia',
  LT: 'lithuania',
  LU: 'luxembourg',
  MT: 'malta',
  NL: 'netherlands',
  PL: 'poland',
  PT: 'portugal',
  RO: 'romania',
  SK: 'slovakia',
  SI: 'slovenia',
  ES: 'spain',
  SE: 'sweden',
  GB: 'united kingdom',
  US: 'united states',
  CA: 'canada',
  CH: 'switzerland',
  NO: 'norway',
  MD: 'moldova',
  UA: 'ukraine'
}

const FRESHNESS = {
  brave: { day: 'pd', week: 'pw', month: 'pm', year: 'py' },
  tavily: { day: 'day', week: 'week', month: 'month', year: 'year' }
} as const

function text(value: unknown, max = 600): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

async function failure(provider: string, response: Response): Promise<SearchError> {
  if (response.status === 401 || response.status === 403)
    return new SearchError(`${provider} refused the key. Check it in Settings.`)
  if (response.status === 402)
    return new SearchError(
      provider === 'Credits'
        ? 'No credits left, or no active plan. Top up on your account page.'
        : `The ${provider} account has no credit left.`
    )
  if (response.status === 429)
    return new SearchError(`${provider} is rate limiting. Try again shortly.`)
  return new SearchError(`${provider} answered ${response.status}.`)
}

export function createSearchService(deps: {
  fetch: Fetch
  /** Where OpenRouter calls go (credits proxy or the user's own key), or null. */
  cloud(): CloudAccess | null
  keys(): Partial<Record<SearchKeyProvider, string>>
  settings(): SearchSettings
  /** The small model that lists OpenRouter's search results. */
  pickModel(): Promise<string>
  now?: () => number
}): SearchService {
  const now = deps.now ?? Date.now
  const cache = new Map<string, { at: number; answer: SearchAnswer }>()

  function listsFor(agent: string): SiteLists {
    const all = deps.settings().sites ?? {}
    const own = all[agent] ?? { only: [], blocked: [] }
    const shared = all['*'] ?? { only: [], blocked: [] }
    return {
      only: [...new Set([...shared.only, ...own.only].map(siteOf).filter(Boolean))],
      blocked: [...new Set([...shared.blocked, ...own.blocked].map(siteOf).filter(Boolean))]
    }
  }

  function chooseSource(): Exclude<SearchSource, 'auto'> {
    const { source } = deps.settings()
    const keys = deps.keys()
    if (source === 'credits') {
      if (!deps.cloud())
        throw new SearchError('Search through credits needs you signed in to Titan117.')
      return 'credits'
    }
    if (source !== 'auto') {
      if (!keys[source])
        throw new SearchError(
          `Search is set to ${LABEL[source]}, but no ${LABEL[source]} key is saved.`
        )
      return source
    }
    for (const p of ['exa', 'tavily', 'brave'] as const) if (keys[p]) return p
    if (deps.cloud()) return 'credits'
    throw new SearchError(
      'No search source: sign in to use credits, or add a Brave, Tavily or Exa key in Settings.'
    )
  }

  async function viaOpenRouter(
    request: Required<Pick<SearchRequest, 'query'>> & SearchRequest,
    lists: SiteLists
  ): Promise<SearchAnswer> {
    const access = deps.cloud()
    if (!access) throw new SearchError('Search through credits needs you signed in to Titan117.')
    const parameters: Record<string, unknown> = {
      engine: 'exa',
      max_results: clampCount(request.count)
    }
    if (lists.only.length) parameters.allowed_domains = lists.only
    if (lists.blocked.length) parameters.excluded_domains = lists.blocked
    const response = await deps.fetch(`${access.base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access.key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://titan117.com',
        'X-Title': 'Titan117'
      },
      body: JSON.stringify({
        model: await deps.pickModel(),
        messages: [
          {
            role: 'system',
            content:
              'Run exactly one web search with the web search tool for the user message, then list what it found: one line per result, its title and address. Add nothing else.'
          },
          { role: 'user', content: request.query }
        ],
        tools: [{ type: 'openrouter:web_search', parameters }],
        max_tokens: 400,
        stream: false
      })
    })
    if (!response.ok)
      throw await failure(access.via === 'credits' ? 'Credits' : 'OpenRouter', response)
    const json = (await response.json()) as {
      choices?: {
        message?: {
          annotations?: {
            type?: string
            url_citation?: { url?: string; title?: string; content?: string }
          }[]
        }
      }[]
      usage?: { cost?: number; server_tool_use_details?: { web_search_requests?: number } }
    }
    const seen = new Set<string>()
    const results: SearchResult[] = []
    for (const a of json.choices?.[0]?.message?.annotations ?? []) {
      const url = a.url_citation?.url
      if (a.type !== 'url_citation' || !url || seen.has(url)) continue
      seen.add(url)
      results.push({
        title: text(a.url_citation?.title, 200) || url,
        url,
        snippet: text(a.url_citation?.content)
      })
    }
    // Search is billed on top of tokens; count at least its list price.
    const searches = json.usage?.server_tool_use_details?.web_search_requests ?? 1
    const costUsd = Math.max(json.usage?.cost ?? 0, searches * OPENROUTER_SEARCH_USD)
    return {
      results,
      via: access.via === 'credits' ? 'credits (OpenRouter, Exa)' : 'your OpenRouter key (Exa)',
      // The user's own OpenRouter key pays OpenRouter directly, but it is still this task's spend.
      costUsd,
      cached: false
    }
  }

  async function viaExa(
    request: SearchRequest,
    lists: SiteLists,
    key: string
  ): Promise<SearchAnswer> {
    const settings = deps.settings()
    const body: Record<string, unknown> = {
      query: request.query,
      numResults: clampCount(request.count),
      type: 'auto',
      contents: { highlights: { maxCharacters: 500 } }
    }
    if (lists.only.length) body.includeDomains = lists.only
    if (lists.blocked.length) body.excludeDomains = lists.blocked
    if (settings.country) body.userLocation = settings.country.toUpperCase()
    if (request.freshness) {
      const days = { day: 1, week: 7, month: 31, year: 365 }[request.freshness]
      body.startPublishedDate = new Date(now() - days * 86_400_000).toISOString()
    }
    const response = await deps.fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw await failure('Exa', response)
    const json = (await response.json()) as {
      results?: { title?: string; url?: string; highlights?: string[]; publishedDate?: string }[]
    }
    return {
      results: (json.results ?? [])
        .filter((r) => r.url)
        .map((r) => ({
          title: text(r.title, 200) || r.url!,
          url: r.url!,
          snippet: text((r.highlights ?? []).join(' … ')),
          ...(r.publishedDate ? { published: r.publishedDate.slice(0, 10) } : {})
        })),
      via: 'your Exa key',
      costUsd: 0,
      cached: false
    }
  }

  async function viaTavily(
    request: SearchRequest,
    lists: SiteLists,
    key: string
  ): Promise<SearchAnswer> {
    const settings = deps.settings()
    const body: Record<string, unknown> = {
      query: request.query,
      max_results: clampCount(request.count),
      search_depth: 'basic',
      topic: 'general'
    }
    const country = COUNTRY_NAMES[settings.country.toUpperCase()]
    if (country) body.country = country
    if (lists.only.length) body.include_domains = lists.only
    if (lists.blocked.length) body.exclude_domains = lists.blocked
    if (request.freshness) body.time_range = FRESHNESS.tavily[request.freshness]
    const response = await deps.fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw await failure('Tavily', response)
    const json = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string; published_date?: string }[]
    }
    return {
      results: (json.results ?? [])
        .filter((r) => r.url)
        .map((r) => ({
          title: text(r.title, 200) || r.url!,
          url: r.url!,
          snippet: text(r.content),
          ...(r.published_date ? { published: r.published_date.slice(0, 10) } : {})
        })),
      via: 'your Tavily key',
      costUsd: 0,
      cached: false
    }
  }

  async function viaBrave(
    request: SearchRequest,
    lists: SiteLists,
    key: string
  ): Promise<SearchAnswer> {
    const settings = deps.settings()
    // Brave has no domain filter: "only these sites" goes into the query as site: operators.
    const scope = lists.only.length ? ` (${lists.only.map((s) => `site:${s}`).join(' OR ')})` : ''
    const params = new URLSearchParams({
      q: `${request.query}${scope}`,
      count: String(clampCount(request.count))
    })
    if (settings.country) params.set('country', settings.country.toUpperCase())
    if (settings.language) params.set('search_lang', settings.language.toLowerCase())
    if (request.freshness) params.set('freshness', FRESHNESS.brave[request.freshness])
    const response = await deps.fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { 'X-Subscription-Token': key, Accept: 'application/json' }
    })
    if (!response.ok) throw await failure('Brave', response)
    const json = (await response.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string; age?: string }[] }
    }
    return {
      results: (json.web?.results ?? [])
        .filter((r) => r.url)
        .map((r) => ({
          title: text(r.title, 200) || r.url!,
          url: r.url!,
          // Brave marks the matched words with <strong>.
          snippet: text((r.description ?? '').replace(/<[^>]+>/g, '')),
          ...(r.age ? { published: text(r.age, 40) } : {})
        })),
      via: 'your Brave key',
      costUsd: 0,
      cached: false
    }
  }

  async function search(agent: string, request: SearchRequest): Promise<SearchAnswer> {
    const query = request.query.trim().slice(0, 400)
    if (!query) throw new SearchError('Search for something.')
    const lists = listsFor(agent)
    const source = chooseSource()
    const settings = deps.settings()
    const key = JSON.stringify([
      source,
      query.toLowerCase(),
      clampCount(request.count),
      request.freshness ?? '',
      settings.country,
      settings.language,
      lists
    ])
    const hit = cache.get(key)
    if (hit && now() - hit.at < SEARCH_CACHE_MS) return { ...hit.answer, costUsd: 0, cached: true }

    const keys = deps.keys()
    const full = { ...request, query }
    const answer =
      source === 'credits'
        ? await viaOpenRouter(full, lists)
        : source === 'exa'
          ? await viaExa(full, lists, keys.exa!)
          : source === 'tavily'
            ? await viaTavily(full, lists, keys.tavily!)
            : await viaBrave(full, lists, keys.brave!)
    // Whatever the provider did with the filters, nothing from a blocked site gets through.
    answer.results = answer.results
      .filter((r) => {
        try {
          return siteAllowed(lists, new URL(r.url).hostname)
        } catch {
          return false
        }
      })
      .slice(0, clampCount(request.count))

    if (source !== 'brave') {
      cache.set(key, { at: now(), answer })
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
    }
    return answer
  }

  return {
    forAgent(agent, guard) {
      return {
        async search(request) {
          guard(request.query)
          return search(agent, request)
        },
        sites: () => listsFor(agent)
      }
    },
    allowedSite: (agent, host) => siteAllowed(listsFor(agent), host)
  }
}
