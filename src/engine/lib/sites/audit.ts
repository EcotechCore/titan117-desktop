/**
 * The site audit (features 14.2, 14.10-14.12, decisions §60): our own polite
 * crawler, through the task's network policy. It follows only the site's own
 * links, reads robots.txt and keeps to it, waits between requests, and stops
 * at a page limit. Ideas from SEOnaut, SiteOne Crawler and LibreCrawl (MIT);
 * our own code.
 *
 * Pages are data, never instructions (guardrails §5): only facts are kept.
 */
import { parseHTML } from 'linkedom'

import { USER_AGENT } from '../read'
import type { TaskNet } from '../web'

export const DEFAULT_PAGES = 30
export const MAX_PAGES = 200
/** Between two requests to the same site: polite, like a person clicking fast. */
export const CRAWL_DELAY_MS = 400
const MAX_HTML = 3_000_000

export type Severity = 'high' | 'medium' | 'low'

export interface Issue {
  severity: Severity
  check: string
  url: string
  detail: string
}

export interface PageFacts {
  url: string
  status: number
  /** Where an address redirected to, the last hop. */
  redirectedTo: string | null
  ms: number
  bytes: number
  html: boolean
  title: string
  description: string
  h1: string[]
  headings: { level: number; text: string }[]
  canonical: string
  robots: string
  lang: string
  hreflang: { lang: string; href: string }[]
  images: number
  imagesWithoutAlt: number
  words: number
  /** Links to pages on the same site, absolute, without #fragments. */
  links: string[]
  externalLinks: number
  /** schema.org types found in JSON-LD. */
  structured: string[]
  openGraph: boolean
  viewport: boolean
  phone: boolean
}

export interface SiteAudit {
  site: string
  start: string
  at: number
  pages: PageFacts[]
  /** Pages not read, and why (robots.txt, another type). */
  skipped: { url: string; why: string }[]
  robotsTxt: boolean
  sitemap: { url: string; urls: number } | null
  llmsTxt: boolean
  issues: Issue[]
  /** 0-100: fewer and lighter issues score higher. */
  score: number
  /** The pages' most common heading words: what the site is about (14.9). */
  topics: string[]
  /** Stopped before reading every page it found. */
  limited: boolean
}

export interface CrawlDeps {
  net: TaskNet
  robots(url: string): Promise<boolean>
  signal?: AbortSignal
  delayMs?: number
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

function normalise(href: string, base: string): string | null {
  try {
    const url = new URL(href, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function sameSite(url: string, host: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, '') === host.replace(/^www\./, '')
  } catch {
    return false
  }
}

const SKIP_FILES =
  /\.(pdf|zip|png|jpe?g|gif|webp|svg|ico|mp4|mp3|webm|docx?|xlsx?|pptx?|css|js|json|xml|txt|woff2?)$/i

/** The facts an audit keeps from one HTML page. */
export function pageFacts(
  html: string,
  url: string,
  host: string
): Omit<PageFacts, 'status' | 'redirectedTo' | 'ms' | 'bytes' | 'html'> {
  const { document } = parseHTML(html)
  const attr = (selector: string, name: string): string =>
    document.querySelector(selector)?.getAttribute(name)?.trim() ?? ''
  const clean = (text: string | null | undefined): string =>
    String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({
    level: Number(h.tagName.slice(1)),
    text: clean(h.textContent).slice(0, 120)
  }))
  const links: string[] = []
  let externalLinks = 0
  for (const a of document.querySelectorAll('a[href]')) {
    const target = normalise(a.getAttribute('href') ?? '', url)
    if (!target) continue
    if (sameSite(target, host)) links.push(target)
    else externalLinks++
  }
  const structured: string[] = []
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(walk)
        if (!value || typeof value !== 'object') return
        const record = value as Record<string, unknown>
        const type = record['@type']
        for (const t of Array.isArray(type) ? type : [type])
          if (typeof t === 'string') structured.push(t.slice(0, 60))
        if (record['@graph']) walk(record['@graph'])
      }
      walk(JSON.parse(script.textContent ?? ''))
    } catch {
      structured.push('(unreadable JSON-LD)')
    }
  }
  for (const el of document.querySelectorAll('script, style, noscript, template')) el.remove()
  const text = clean(document.body?.textContent)
  const images = [...document.querySelectorAll('img')]
  return {
    url,
    title: clean(document.querySelector('title')?.textContent),
    description: attr('meta[name="description"]', 'content'),
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    headings: headings.slice(0, 60),
    canonical: attr('link[rel="canonical"]', 'href'),
    robots: attr('meta[name="robots"]', 'content').toLowerCase(),
    lang: document.documentElement?.getAttribute('lang') ?? '',
    hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => ({
      lang: l.getAttribute('hreflang') ?? '',
      href: normalise(l.getAttribute('href') ?? '', url) ?? ''
    })),
    images: images.length,
    imagesWithoutAlt: images.filter((i) => !i.hasAttribute('alt')).length,
    words: text ? text.split(' ').length : 0,
    links: [...new Set(links)],
    externalLinks,
    structured: [...new Set(structured)],
    openGraph: !!document.querySelector('meta[property="og:title"]'),
    viewport: /width=device-width/.test(attr('meta[name="viewport"]', 'content')),
    phone: !!document.querySelector('a[href^="tel:"]')
  }
}

/** Addresses listed in a sitemap (or a sitemap index's first sitemaps). */
export function sitemapUrls(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, '&')
  )
  return /<sitemapindex/i.test(xml) ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] }
}

const STOP = new Set(
  'the and for with your our you are from that this what how why who about more into can get all new not but has have will when its out use who one two of to in on at by an a is be or as it we us de si la in cu pe din pentru'.split(
    ' '
  )
)

function topicsOf(pages: PageFacts[]): string[] {
  const counts = new Map<string, number>()
  for (const page of pages)
    for (const h of [page.title, ...page.headings.filter((x) => x.level <= 2).map((x) => x.text)])
      for (const word of h.toLowerCase().match(/\p{L}[\p{L}\p{N}-]{2,}/gu) ?? [])
        if (!STOP.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([w]) => w)
}

/** The checks: each page, then the site as a whole. */
export function findIssues(audit: Omit<SiteAudit, 'issues' | 'score' | 'topics'>): Issue[] {
  const issues: Issue[] = []
  const add = (severity: Severity, check: string, url: string, detail: string): void => {
    issues.push({ severity, check, url, detail })
  }
  const byUrl = new Map(audit.pages.map((p) => [p.url, p]))
  const linkedFrom = new Map<string, string>()
  for (const page of audit.pages)
    for (const link of page.links) if (!linkedFrom.has(link)) linkedFrom.set(link, page.url)

  for (const page of audit.pages) {
    if (page.status >= 400 || page.status === 0) {
      const from = linkedFrom.get(page.url)
      add(
        'high',
        page.status === 0 ? 'Page did not load' : 'Broken page',
        page.url,
        `Answered ${page.status || 'nothing'}${from ? `; linked from ${from}` : ''}.`
      )
      continue
    }
    if (page.redirectedTo) {
      if (page.redirectedTo === 'loop')
        add('high', 'Redirect loop', page.url, 'Redirects in a circle.')
      else if (!sameSite(page.redirectedTo, new URL(audit.site).hostname))
        add(
          page.url === audit.start ? 'high' : 'medium',
          'Redirects to another site',
          page.url,
          `Sends visitors to ${page.redirectedTo.slice(0, 120)}${page.url === audit.start ? ': search engines can’t read the site from here' : ''}.`
        )
      else if (linkedFrom.has(page.url))
        add(
          'low',
          'Link to a redirect',
          page.url,
          `Redirects to ${page.redirectedTo}; link straight to it (from ${linkedFrom.get(page.url)}).`
        )
      continue
    }
    if (!page.html) continue
    if (new URL(page.url).protocol === 'http:')
      add('high', 'Not secure (http)', page.url, 'Serve every page over https.')
    if (!page.title) add('high', 'Missing title', page.url, 'The page has no <title>.')
    else if (page.title.length > 60)
      add(
        'low',
        'Long title',
        page.url,
        `${page.title.length} characters; search results cut it after about 60.`
      )
    else if (page.title.length < 10)
      add('low', 'Short title', page.url, `"${page.title}" says little about the page.`)
    if (!page.description) add('medium', 'Missing description', page.url, 'No meta description.')
    else if (page.description.length < 50 || page.description.length > 160)
      add(
        'low',
        'Description length',
        page.url,
        `${page.description.length} characters (50-160 is best).`
      )
    if (page.h1.length === 0) add('medium', 'No main heading', page.url, 'No <h1> on the page.')
    else if (page.h1.length > 1)
      add('low', 'Several main headings', page.url, `${page.h1.length} <h1> headings.`)
    let last = 0
    for (const h of page.headings) {
      if (last && h.level > last + 1) {
        add(
          'low',
          'Heading order',
          page.url,
          `h${last} is followed by h${h.level} ("${h.text.slice(0, 50)}").`
        )
        break
      }
      last = h.level
    }
    if (page.imagesWithoutAlt)
      add(
        'medium',
        'Images without alt text',
        page.url,
        `${page.imagesWithoutAlt} of ${page.images} image(s).`
      )
    if (page.words < 200 && !page.robots.includes('noindex'))
      add('low', 'Thin page', page.url, `${page.words} words; pages that rank usually say more.`)
    if (page.robots.includes('noindex'))
      add(
        'medium',
        'Not indexed',
        page.url,
        'The page asks search engines not to index it (meta robots noindex).'
      )
    if (!page.canonical) add('low', 'No canonical link', page.url, 'Add <link rel="canonical">.')
    else {
      const canonical = normalise(page.canonical, page.url)
      if (canonical && canonical !== page.url && byUrl.get(canonical)?.status === 200)
        add('low', 'Canonical points elsewhere', page.url, `Canonical is ${canonical}.`)
    }
    if (!page.lang) add('medium', 'No language', page.url, 'No lang on <html>.')
    if (!page.viewport)
      add('medium', 'No phone layout', page.url, 'No viewport meta tag with width=device-width.')
    if (!page.openGraph)
      add('low', 'No link previews', page.url, 'No Open Graph tags (og:title, og:image).')
    if (!page.structured.length)
      add('low', 'No structured data', page.url, 'No schema.org JSON-LD.')
    if (page.ms > 2000) add('low', 'Slow answer', page.url, `The server took ${page.ms} ms.`)
    if (page.bytes > 500_000)
      add('low', 'Heavy HTML', page.url, `${Math.round(page.bytes / 1024)} KB of HTML.`)
    // Several languages (14.10): each alternate should exist and the set should name itself.
    if (page.hreflang.length) {
      if (!page.hreflang.some((h) => h.href === page.url))
        add('low', 'Language versions', page.url, 'hreflang links don’t include the page itself.')
      for (const h of page.hreflang) {
        const target = byUrl.get(h.href)
        if (target && target.status >= 400)
          add(
            'medium',
            'Language versions',
            page.url,
            `The ${h.lang} version (${h.href}) is broken.`
          )
      }
    }
  }

  // The site as a whole.
  const ok = audit.pages.filter((p) => p.html && p.status === 200 && !p.redirectedTo)
  const dupes = (pick: (p: PageFacts) => string, check: string, severity: Severity): void => {
    const seen = new Map<string, string[]>()
    for (const p of ok) {
      const key = pick(p)
      if (key) seen.set(key, [...(seen.get(key) ?? []), p.url])
    }
    for (const [key, urls] of seen)
      if (urls.length > 1)
        add(
          severity,
          check,
          urls[0],
          `"${key.slice(0, 70)}" on ${urls.length} pages: ${urls.slice(1, 4).join(', ')}${urls.length > 4 ? ', …' : ''}.`
        )
  }
  dupes((p) => p.title, 'Duplicate title', 'medium')
  dupes((p) => p.description, 'Duplicate description', 'low')
  if (!audit.robotsTxt)
    add('low', 'No robots.txt', audit.site, 'Add /robots.txt with a link to the sitemap.')
  if (!audit.sitemap)
    add(
      'medium',
      'No sitemap',
      audit.site,
      'No sitemap.xml found (in robots.txt or at /sitemap.xml).'
    )
  if (!audit.llmsTxt)
    add(
      'low',
      'No llms.txt',
      audit.site,
      'An /llms.txt helps AI assistants describe the site (llmstxt.org).'
    )
  const types = new Set(ok.flatMap((p) => p.structured))
  if (
    ok.length &&
    ![...types].some((t) => /Organization|LocalBusiness|Store|Restaurant|Corporation/.test(t))
  )
    add(
      'low',
      'Local SEO: business details',
      audit.site,
      'No Organization or LocalBusiness schema.org data on any page.'
    )
  if (ok.length && !ok.some((p) => p.phone))
    add('low', 'Local SEO: phone link', audit.site, 'No tap-to-call (tel:) link on any page read.')
  return issues
}

const WEIGHT: Record<Severity, number> = { high: 6, medium: 2, low: 0.5 }

export function scoreOf(issues: Issue[], pages: number): number {
  const sum = issues.reduce((s, i) => s + WEIGHT[i.severity], 0)
  return Math.max(0, Math.min(100, Math.round(100 - (sum / Math.max(1, pages)) * 8)))
}

/** Crawl the site from `start` and audit what it finds. */
export async function auditSite(
  start: string,
  options: { maxPages?: number },
  deps: CrawlDeps
): Promise<SiteAudit> {
  const now = deps.now ?? Date.now
  const wait = deps.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const delay = deps.delayMs ?? CRAWL_DELAY_MS
  const first = new URL(start)
  first.hash = ''
  const origin = first.origin
  const host = first.hostname
  const max = Math.max(1, Math.min(MAX_PAGES, Math.floor(options.maxPages ?? DEFAULT_PAGES)))
  const headers = { 'User-Agent': USER_AGENT }
  let requests = 0
  // The start address first: private content in it is refused before any request or question.
  await deps.net.check(first.toString(), null, 'navigate')

  async function get(url: string, accept: string): Promise<Response> {
    if (deps.signal?.aborted) throw new Error('Stopped.')
    if (requests++ > 0) await wait(delay)
    return deps.net.fetchOnce(url, { headers: { ...headers, Accept: accept }, signal: deps.signal })
  }

  async function text(url: string): Promise<string | null> {
    try {
      const r = await get(url, 'text/plain,application/xml,text/xml,*/*')
      if (!r.ok) return null
      return (await r.text()).slice(0, 2_000_000)
    } catch (error) {
      if ((error as Error).name === 'PermissionError') throw error
      return null
    }
  }

  // The site's own files first: robots.txt, the sitemap, llms.txt.
  const robotsBody = await text(`${origin}/robots.txt`)
  const sitemapsNamed = [...(robotsBody ?? '').matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map(
    (m) => m[1]
  )
  let sitemap: SiteAudit['sitemap'] = null
  const fromSitemap: string[] = []
  for (const candidate of sitemapsNamed.length
    ? sitemapsNamed.slice(0, 2)
    : [`${origin}/sitemap.xml`]) {
    if (!sameSite(candidate, host)) continue
    const xml = await text(candidate)
    if (!xml || !/<(urlset|sitemapindex)/i.test(xml)) continue
    const found = sitemapUrls(xml)
    for (const child of found.sitemaps.slice(0, 3)) {
      if (!sameSite(child, host)) continue
      const inner = await text(child)
      if (inner) found.pages.push(...sitemapUrls(inner).pages)
    }
    sitemap = { url: candidate, urls: found.pages.length }
    fromSitemap.push(...found.pages.filter((u) => sameSite(u, host)))
    break
  }
  const llms = await text(`${origin}/llms.txt`)
  const llmsTxt = !!llms && /^\uFEFF?\s*#\s+\S/.test(llms)

  const queue: { url: string; depth: number }[] = [{ url: first.toString(), depth: 0 }]
  const seen = new Set<string>([first.toString()])
  for (const u of fromSitemap) {
    const n = normalise(u, origin)
    if (n && !seen.has(n)) {
      seen.add(n)
      queue.push({ url: n, depth: 1 })
    }
  }
  const pages: PageFacts[] = []
  const skipped: SiteAudit['skipped'] = []
  let limited = false

  while (queue.length) {
    if (pages.length >= max) {
      limited = true
      break
    }
    const { url, depth } = queue.shift()!
    if (SKIP_FILES.test(new URL(url).pathname)) continue
    if (!(await deps.robots(url))) {
      skipped.push({ url, why: 'robots.txt asks not to' })
      continue
    }
    const started = now()
    let response: Response
    try {
      response = await get(url, 'text/html,application/xhtml+xml')
    } catch (error) {
      if (deps.signal?.aborted) throw error
      // A link the network policy refuses (it looks like it carries a key) is left out, not the whole audit.
      if ((error as Error).name === 'PermissionError') {
        if (url === first.toString()) throw error
        skipped.push({ url, why: (error as Error).message.slice(0, 160) })
        continue
      }
      pages.push(emptyPage(url, 0, null, now() - started))
      continue
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      const target = location ? normalise(location, url) : null
      let to = target ?? 'nowhere'
      if (target) {
        // A loop: the chain comes back to an address it passed.
        const chain = new Set([url])
        let hop: string | null = target
        for (let i = 0; i < 5 && hop && sameSite(hop, host); i++) {
          if (chain.has(hop)) {
            to = 'loop'
            break
          }
          chain.add(hop)
          if (!seen.has(hop)) break
          hop = pages.find((p) => p.url === hop)?.redirectedTo ?? null
        }
        if (to !== 'loop' && sameSite(target, host) && !seen.has(target)) {
          seen.add(target)
          queue.unshift({ url: target, depth })
        }
      }
      pages.push(emptyPage(url, response.status, to, now() - started))
      continue
    }
    const type = response.headers.get('content-type') ?? ''
    if (!/html/.test(type)) {
      skipped.push({ url, why: `not a page (${type.split(';')[0] || 'unknown type'})` })
      continue
    }
    const body = response.ok ? (await response.text()).slice(0, MAX_HTML) : ''
    if (!response.ok) {
      pages.push(emptyPage(url, response.status, null, now() - started))
      continue
    }
    const facts: PageFacts = {
      ...pageFacts(body, url, host),
      status: response.status,
      redirectedTo: null,
      ms: now() - started,
      bytes: Buffer.byteLength(body),
      html: true
    }
    pages.push(facts)
    for (const link of facts.links) {
      if (seen.has(link) || SKIP_FILES.test(new URL(link).pathname)) continue
      seen.add(link)
      queue.push({ url: link, depth: depth + 1 })
    }
  }

  const base = {
    site: origin,
    start: first.toString(),
    at: now(),
    pages,
    skipped,
    robotsTxt: robotsBody !== null,
    sitemap,
    llmsTxt,
    limited
  }
  const issues = findIssues(base)
  const counted = pages.filter((p) => p.html).length || pages.length
  return { ...base, issues, score: scoreOf(issues, counted), topics: topicsOf(pages) }
}

function emptyPage(
  url: string,
  status: number,
  redirectedTo: string | null,
  ms: number
): PageFacts {
  return {
    url,
    status,
    redirectedTo,
    ms,
    bytes: 0,
    html: false,
    title: '',
    description: '',
    h1: [],
    headings: [],
    canonical: '',
    robots: '',
    lang: '',
    hreflang: [],
    images: 0,
    imagesWithoutAlt: 0,
    words: 0,
    links: [],
    externalLinks: 0,
    structured: [],
    openGraph: false,
    viewport: false,
    phone: false
  }
}

/** What changed since an earlier audit of the same site (14.13). */
export function compareAudits(
  before: { at: number; score: number; issues: Issue[] },
  after: { score: number; issues: Issue[] }
): { fixed: Issue[]; added: Issue[]; scoreBefore: number; at: number } {
  const key = (i: Issue): string => `${i.check}|${i.url}`
  const was = new Set(before.issues.map(key))
  const now = new Set(after.issues.map(key))
  return {
    fixed: before.issues.filter((i) => !now.has(key(i))),
    added: after.issues.filter((i) => !was.has(key(i))),
    scoreBefore: before.score,
    at: before.at
  }
}
