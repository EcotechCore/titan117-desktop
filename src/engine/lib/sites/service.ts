/**
 * Site checks for the QA tester and the SEO agent (5.2, 5.8, §14; decisions
 * §60): the audit crawler, the QA run, Google's PageSpeed Insights, AI search
 * visibility through OpenRouter, saved tests, and each site's past audits
 * kept on the laptop for re-audits (14.13). Nothing here goes to our cloud.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PermissionError } from '../folders'
import type { TaskNet } from '../web'
import { auditSite, type Issue, type SiteAudit } from './audit'
import { runQa, runTests, type QaDeps, type QaPage, type SavedTest, type TestRun } from './qa'

export class SiteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteError'
  }
}

export interface SpeedResult {
  url: string
  strategy: 'mobile' | 'desktop'
  /** Lighthouse category scores, 0-100. */
  scores: Record<string, number>
  /** Lab metrics as Lighthouse shows them. */
  lab: Record<string, string>
  /** Real users' experience from the Chrome UX Report, when Google has enough data. */
  field: { metric: string; p75: number; category: string }[]
  fieldOverall: string | null
  /** The biggest savings Lighthouse suggests. */
  opportunities: { title: string; saving: string }[]
}

export interface VisibilityAnswer {
  model: string
  question: string
  mentioned: boolean
  cited: boolean
  /** Other sites the answer cited: who the model trusts instead (14.9). */
  sources: string[]
  excerpt: string
  costUsd: number
  error: string | null
}

export interface AuditHistory {
  at: number
  score: number
  pages: number
  issues: Issue[]
}

/** The models asked for AI search visibility (14.12): ChatGPT's, Perplexity's and Google's families. */
export const VISIBILITY_MODELS = [
  'openai/gpt-5.4-mini',
  'perplexity/sonar',
  'google/gemini-3.5-flash-lite'
]
export const MAX_QUESTIONS = 5

export interface CloudAccess {
  base: string
  key: string
  via: string
}

export interface SiteService {
  audit(
    url: string,
    maxPages: number | undefined,
    deps: { net: TaskNet; robots(url: string): Promise<boolean>; signal?: AbortSignal }
  ): Promise<SiteAudit>
  qa(urls: string[], options: { screenshots?: boolean }, deps: QaDeps): Promise<QaPage[]>
  runTests(tests: SavedTest[], deps: QaDeps): Promise<TestRun[]>
  speed(
    url: string,
    strategy: 'mobile' | 'desktop',
    net: TaskNet,
    signal?: AbortSignal
  ): Promise<SpeedResult>
  visibility(
    input: { brand: string; domain: string; questions: string[]; models?: string[] },
    signal?: AbortSignal
  ): Promise<VisibilityAnswer[]>
  /** Earlier audits of a site, newest first. */
  history(site: string): AuditHistory[]
  remember(audit: SiteAudit): void
}

const PSI = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed'

function fileFor(dir: string, site: string): string {
  return join(
    dir,
    `${site
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9.-]+/gi, '_')
      .slice(0, 100)}.json`
  )
}

export function createSiteService(deps: {
  /** Where past audits are kept (the app's data folder); null keeps them in memory. */
  dir: string | null
  fetch: typeof fetch
  /** OpenRouter through credits or the user's own key, or null when neither. */
  cloud(): CloudAccess | null
  /** The user's own Google API key for PageSpeed Insights, from the keychain. */
  pagespeedKey?: () => string | null
  qa?: { launch?: QaDeps['launch'] }
}): SiteService {
  const memory = new Map<string, AuditHistory[]>()

  function history(site: string): AuditHistory[] {
    if (!deps.dir) return memory.get(site) ?? []
    try {
      return JSON.parse(readFileSync(fileFor(deps.dir, site), 'utf8')) as AuditHistory[]
    } catch {
      return []
    }
  }

  return {
    audit: (url, maxPages, d) => auditSite(url, { maxPages }, d),
    qa: (urls, options, d) => runQa(urls, options, { launch: deps.qa?.launch, ...d }),
    runTests: (tests, d) => runTests(tests, { launch: deps.qa?.launch, ...d }),

    async speed(url, strategy, net, signal) {
      const query = new URLSearchParams({ url, strategy })
      for (const c of ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'])
        query.append('category', c)
      const key = deps.pagespeedKey?.() ?? null
      // The key goes in a header, never in the address (where it could be logged).
      const response = await net.fetch(`${PSI}?${query}`, {
        signal,
        headers: { Accept: 'application/json', ...(key ? { 'X-goog-api-key': key } : {}) }
      })
      if (response.status === 429)
        throw new SiteError(
          key
            ? "Your Google key has reached PageSpeed Insights' limit for now. Try again later."
            : "Google's shared free limit for PageSpeed Insights is used up. Add your own free Google API key (Web search → Google PageSpeed Insights) and try again; the QA check's own speed numbers work meanwhile."
        )
      if (!response.ok) {
        const body = (await response.text().catch(() => '')).slice(0, 300)
        throw new SiteError(
          `PageSpeed Insights answered ${response.status}${/message/.test(body) ? `: ${(JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ''}` : ''}.`
        )
      }
      const json = (await response.json()) as {
        lighthouseResult?: {
          categories?: Record<string, { title?: string; score?: number | null }>
          audits?: Record<
            string,
            {
              title?: string
              score?: number | null
              displayValue?: string
              details?: { type?: string; overallSavingsMs?: number }
            }
          >
        }
        loadingExperience?: {
          overall_category?: string
          metrics?: Record<string, { percentile?: number; category?: string }>
        }
      }
      const lh = json.lighthouseResult ?? {}
      const scores: Record<string, number> = {}
      for (const [id, c] of Object.entries(lh.categories ?? {}))
        if (typeof c.score === 'number') scores[c.title ?? id] = Math.round(c.score * 100)
      const lab: Record<string, string> = {}
      for (const id of [
        'first-contentful-paint',
        'largest-contentful-paint',
        'total-blocking-time',
        'cumulative-layout-shift',
        'speed-index'
      ])
        if (lh.audits?.[id]?.displayValue)
          lab[lh.audits[id].title ?? id] = lh.audits[id].displayValue!
      const opportunities = Object.values(lh.audits ?? {})
        .filter(
          (a) =>
            a.details?.type === 'opportunity' &&
            (a.score ?? 1) < 0.9 &&
            (a.details.overallSavingsMs ?? 0) > 100
        )
        .sort((a, b) => (b.details?.overallSavingsMs ?? 0) - (a.details?.overallSavingsMs ?? 0))
        .slice(0, 6)
        .map((a) => ({
          title: a.title ?? '',
          saving: a.displayValue ?? `${Math.round(a.details?.overallSavingsMs ?? 0)} ms`
        }))
      const field = Object.entries(json.loadingExperience?.metrics ?? {}).map(([metric, m]) => ({
        metric,
        p75: m.percentile ?? 0,
        category: m.category ?? ''
      }))
      return {
        url,
        strategy,
        scores,
        lab,
        field,
        fieldOverall: json.loadingExperience?.overall_category ?? null,
        opportunities
      }
    },

    async visibility(input, signal) {
      const access = deps.cloud()
      if (!access)
        throw new SiteError(
          'Checking AI answers needs you signed in to Titan117 (credits) or your own OpenRouter key.'
        )
      const brand = input.brand.trim().toLowerCase()
      const domain = input.domain
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
        .toLowerCase()
      const models = (input.models?.length ? input.models : VISIBILITY_MODELS).slice(0, 3)
      const questions = input.questions
        .map((q) => q.trim())
        .filter(Boolean)
        .slice(0, MAX_QUESTIONS)
      const jobs = questions.flatMap((question) => models.map((model) => ({ question, model })))
      return Promise.all(
        jobs.map(async ({ question, model }): Promise<VisibilityAnswer> => {
          const empty = {
            model,
            question,
            mentioned: false,
            cited: false,
            sources: [],
            excerpt: '',
            costUsd: 0
          }
          try {
            const response = await deps.fetch(`${access.base}/chat/completions`, {
              method: 'POST',
              signal,
              headers: {
                Authorization: `Bearer ${access.key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://titan117.com',
                'X-Title': 'Titan117'
              },
              // The question as a person would ask it, with the provider's own web search (native where it has one).
              body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: question }],
                // Perplexity's models search by themselves and take no tools.
                ...(model.startsWith('perplexity/')
                  ? {}
                  : { tools: [{ type: 'openrouter:web_search', parameters: { max_results: 5 } }] }),
                max_tokens: 700,
                stream: false
              })
            })
            if (!response.ok) return { ...empty, error: `${model} answered ${response.status}.` }
            const json = (await response.json()) as {
              choices?: {
                message?: {
                  content?: string
                  annotations?: { type?: string; url_citation?: { url?: string } }[]
                }
              }[]
              usage?: { cost?: number }
            }
            const message = json.choices?.[0]?.message
            const text = String(message?.content ?? '')
            const urls = (message?.annotations ?? [])
              .map((a) => a.url_citation?.url ?? '')
              .filter(Boolean)
            const hosts = [
              ...new Set(
                urls
                  .map((u) => {
                    try {
                      return new URL(u).hostname.replace(/^www\./, '')
                    } catch {
                      return ''
                    }
                  })
                  .filter(Boolean)
              )
            ]
            const lower = text.toLowerCase()
            const at = Math.max(lower.indexOf(brand), domain ? lower.indexOf(domain) : -1)
            return {
              ...empty,
              mentioned: (!!brand && lower.includes(brand)) || (!!domain && lower.includes(domain)),
              cited: hosts.some((h) => h === domain || h.endsWith(`.${domain}`)),
              sources: hosts.filter((h) => h !== domain).slice(0, 8),
              excerpt: (at >= 0 ? text.slice(Math.max(0, at - 120), at + 200) : text.slice(0, 300))
                .replace(/\s+/g, ' ')
                .trim(),
              costUsd: json.usage?.cost ?? 0,
              error: null
            }
          } catch (error) {
            if (signal?.aborted) throw error
            return { ...empty, error: String((error as Error).message ?? error).slice(0, 200) }
          }
        })
      )
    },

    history,

    remember(audit) {
      const entry: AuditHistory = {
        at: audit.at,
        score: audit.score,
        pages: audit.pages.length,
        issues: audit.issues
      }
      const next = [entry, ...history(audit.site)].slice(0, 12)
      if (!deps.dir) memory.set(audit.site, next)
      else {
        mkdirSync(deps.dir, { recursive: true })
        writeFileSync(fileFor(deps.dir, audit.site), JSON.stringify(next), 'utf8')
      }
    }
  }
}

/** Refuse an address that isn't an ordinary web page. */
export function siteUrl(value: string): string {
  const text = String(value ?? '').trim()
  // Another scheme (file:, javascript:) is refused, never read as a host name.
  // ("example.com:8080" is a host and a port, not a scheme.)
  if (/^[a-z][a-z0-9+.-]*:(\/\/|[^0-9])/i.test(text) && !/^https?:\/\//i.test(text))
    throw new PermissionError('Only web addresses (http and https) can be checked.')
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    throw new PermissionError('That is not a web address.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new PermissionError('Only web addresses can be checked.')
  url.hash = ''
  return url.toString()
}
