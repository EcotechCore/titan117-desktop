/**
 * Reading web pages (features 16.5, 16.6; decisions §44): a page becomes
 * clean text with Mozilla's Readability (Apache 2.0) on linkedom (ISC),
 * falling back to plain text; robots.txt is respected for our user agent;
 * the same page within 15 minutes is read from memory.
 *
 * Every request goes through the task's network policy (`TaskNet`), so the
 * site list, private-content checks and approvals apply as for any request.
 */
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

import type { TaskNet } from './web'

export const USER_AGENT = 'Titan117/0.1 (desktop assistant; +https://titan117.com)'
const ROBOTS_AGENT = 'titan117'
export const PAGE_CACHE_MS = 15 * 60 * 1000
const CACHE_MAX = 100
const MAX_BYTES = 3 * 1024 * 1024

export class ReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReadError'
  }
}

export interface Page {
  url: string
  title: string
  /** Who wrote it and when, when the page says. */
  byline: string
  published: string
  text: string
  /** Links on the page, absolute, same order, without duplicates. */
  links: { url: string; text: string }[]
}

/** A plain-text version of an HTML page: scripts, styles and tags removed. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? ''
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
  return { title, text }
}

/** Readability's article as text, keeping headings, list items and paragraphs apart. */
export function extract(html: string, url: string): Omit<Page, 'url'> {
  const { document } = parseHTML(html)
  const links: Page['links'] = []
  const seen = new Set<string>()
  for (const a of Array.from(document.querySelectorAll('a[href]')) as Element[]) {
    try {
      const href = new URL(a.getAttribute('href') ?? '', url)
      href.hash = ''
      if (!/^https?:$/.test(href.protocol) || seen.has(href.href)) continue
      seen.add(href.href)
      links.push({
        url: href.href,
        text: (a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      })
    } catch {
      // Not a usable link.
    }
  }
  const title = (document.querySelector('title')?.textContent ?? '').trim()
  let article: ReturnType<Readability['parse']> = null
  try {
    article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse()
  } catch {
    // Some pages trip Readability; plain text below.
  }
  if (!article?.content) {
    const plain = htmlToText(html)
    return { title: plain.title || title, byline: '', published: '', text: plain.text, links }
  }
  const body = article.content
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_m, tag: string, inner: string) => {
      return `\n\n${'#'.repeat(Number(tag[1]))} ${inner}\n\n`
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
  const { text } = htmlToText(body)
  return {
    title: article.title?.trim() || title,
    byline: (article.byline ?? '').trim(),
    published: (article.publishedTime ?? '').slice(0, 10),
    text,
    links
  }
}

/** The rules of robots.txt that apply to us: ours if named, otherwise `*`. */
export function robotsRules(body: string): { allow: string[]; disallow: string[] } {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = []
  let current: (typeof groups)[number] | null = null
  let lastWasAgent = false
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const field = match[1].toLowerCase()
    const value = match[2].trim()
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (field === 'allow' && value) current.allow.push(value)
    if (field === 'disallow' && value) current.disallow.push(value)
  }
  const ours = groups.filter((g) => g.agents.some((a) => a !== '*' && ROBOTS_AGENT.includes(a)))
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes('*'))
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow)
  }
}

function ruleMatches(rule: string, path: string): number {
  // `*` matches anything, `$` ends the path; the longest matching rule wins.
  const pattern = rule.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${pattern}`).test(path) ? rule.length : -1
}

export function robotsAllows(
  rules: { allow: string[]; disallow: string[] },
  path: string
): boolean {
  const allow = Math.max(-1, ...rules.allow.map((r) => ruleMatches(r, path)))
  const disallow = Math.max(-1, ...rules.disallow.map((r) => ruleMatches(r, path)))
  return disallow < 0 || allow >= disallow
}

export interface PageReader {
  /** Read one page as text. Throws ReadError when it can't. */
  read(url: string, net: TaskNet, signal?: AbortSignal): Promise<Page>
  /** Whether robots.txt lets us read this address. */
  allowedByRobots(url: string, net: TaskNet, signal?: AbortSignal): Promise<boolean>
}

export function createPageReader(now: () => number = Date.now): PageReader {
  const pages = new Map<string, { at: number; page: Page }>()
  const robots = new Map<string, { at: number; rules: { allow: string[]; disallow: string[] } }>()

  async function rulesFor(
    origin: string,
    net: TaskNet,
    signal?: AbortSignal
  ): Promise<{ allow: string[]; disallow: string[] }> {
    const hit = robots.get(origin)
    if (hit && now() - hit.at < PAGE_CACHE_MS) return hit.rules
    let rules = { allow: [] as string[], disallow: [] as string[] }
    try {
      const response = await net.fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
        signal
      })
      // 4xx: no rules (as Google reads it); 5xx: assume closed for now.
      if (response.ok) rules = robotsRules((await response.text()).slice(0, 500_000))
      else if (response.status >= 500) rules = { allow: [], disallow: ['/'] }
    } catch (error) {
      // The network policy refusing the site is the caller's answer, not a robots one.
      if ((error as Error).name === 'PermissionError') throw error
    }
    robots.set(origin, { at: now(), rules })
    return rules
  }

  const reader: PageReader = {
    async allowedByRobots(url, net, signal) {
      const target = new URL(url)
      const rules = await rulesFor(target.origin, net, signal)
      return robotsAllows(rules, `${target.pathname}${target.search}`)
    },

    async read(url, net, signal) {
      let target: URL
      try {
        target = new URL(url)
      } catch {
        throw new ReadError('That is not a web address.')
      }
      target.hash = ''
      const hit = pages.get(target.href)
      if (hit && now() - hit.at < PAGE_CACHE_MS) {
        // Cached, but the network policy still decides whether this task may read it.
        await net.check(target.href, null, 'navigate')
        return hit.page
      }
      // The task's network policy decides first (site list, private content), so a
      // refused or unanswered site gets no request at all, not even for robots.txt.
      await net.check(target.href, null, 'navigate')
      if (!(await reader.allowedByRobots(target.href, net, signal)))
        throw new ReadError(
          `${target.hostname} asks automated readers not to read this page (robots.txt). Open it with browser_open if the user wants it read as they would.`
        )
      const response = await net.fetch(target.href, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9'
        },
        signal
      })
      if (!response.ok) throw new ReadError(`The page answered ${response.status}.`)
      const type = response.headers.get('content-type') ?? ''
      if (!/text|json|xml/.test(type))
        throw new ReadError(`That address isn't a page (${type || 'unknown type'}).`)
      const raw = (await response.text()).slice(0, MAX_BYTES)
      const final = response.url || target.href
      const page: Page = /html/.test(type)
        ? { url: final, ...extract(raw, final) }
        : { url: final, title: '', byline: '', published: '', text: raw, links: [] }
      pages.set(target.href, { at: now(), page })
      if (pages.size > CACHE_MAX) pages.delete(pages.keys().next().value!)
      return page
    }
  }
  return reader
}
