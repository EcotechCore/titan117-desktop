/**
 * Web search and reading (§16, decisions §44). Searching finds links; reading
 * turns a page, or a whole site, into clean text. Every request passes the
 * task's network policy (security.md A3) and the agent's trusted and blocked
 * sites (16.9); every fact found this way is reported with its address (16.7).
 */
import { htmlToText } from '../lib/read'
import { defineTool } from './lib/define-tool'

export { htmlToText }

const MAX_TEXT = 20_000
/** read_site: at most this many pages, one request a second (decisions §44). */
export const SITE_MAX_PAGES = 25
const SITE_PAGE_TEXT = 3_000

export const webSearch = defineTool<{
  query: string
  count?: number
  freshness?: 'day' | 'week' | 'month' | 'year'
}>({
  name: 'web_search',
  description:
    "Search the web. Returns titles, addresses and short excerpts; read the best pages with web_fetch before relying on them. Search in the user's language for local questions. Cite every fact you use with its address.",
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for, as a person would type it' },
      count: { type: 'number', description: 'How many results, 1 to 10 (default 6)' },
      freshness: {
        type: 'string',
        description: 'Only recent results',
        enum: ['day', 'week', 'month', 'year']
      }
    },
    required: ['query']
  },
  risk: 'read',
  permissions: { search: true },
  untrustedOutput: true,
  describe: (input) => `Search the web for "${String(input.query).slice(0, 80)}"`,
  async run(input, ctx) {
    const answer = await ctx.search.search(input)
    const lines = answer.results.map(
      (r, i) =>
        `[${i + 1}] ${r.title}\n    ${r.url}${r.published ? ` (${r.published})` : ''}${r.snippet ? `\n    ${r.snippet}` : ''}`
    )
    return {
      output: answer.results.length
        ? `Results for "${input.query}":\n\n${lines.join('\n\n')}`
        : `No results for "${input.query}". Try other words.`,
      summary: `Searched "${input.query.slice(0, 60)}": ${answer.results.length} results via ${answer.via}${answer.cached ? ' (from the last 15 minutes, free)' : ''}`,
      costUsd: answer.costUsd
    }
  }
})

export const webFetch = defineTool<{ url: string }>({
  name: 'web_fetch',
  description:
    'Read a web page as clean text (no browser): the article without menus and ads, with its title, author and date when the page gives them. Use browser_open for pages that need clicking or JavaScript.',
  params: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The full address, starting with https://' }
    },
    required: ['url']
  },
  risk: 'read',
  permissions: { network: true },
  untrustedOutput: true,
  describe: (input) => `Read ${input.url}`,
  async run(input, ctx) {
    const page = await ctx.pages.read(input.url)
    const cut = page.text.length > MAX_TEXT
    const head = [
      page.title && `Title: ${page.title}`,
      `Address: ${page.url}`,
      page.byline && `By: ${page.byline}`,
      page.published && `Published: ${page.published}`
    ]
      .filter(Boolean)
      .join('\n')
    return {
      output: `${head}\n\n${page.text.slice(0, MAX_TEXT)}${cut ? '\n[The page is longer; only its start is shown.]' : ''}`,
      summary: `Read ${input.url}`
    }
  }
})

export const readSite = defineTool<{ url: string; pages?: number; focus?: string }>({
  name: 'read_site',
  description: `Read a whole website: follows links on the same site from the address given, at most ${SITE_MAX_PAGES} pages, and returns each page's title, address and the start of its text. Good for "what does this company offer". Respects the site's robots.txt.`,
  params: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Where to start, e.g. https://example.com' },
      pages: {
        type: 'number',
        description: `How many pages at most (default 10, up to ${SITE_MAX_PAGES})`
      },
      focus: {
        type: 'string',
        description: 'Prefer links whose text or address has these words, e.g. "pricing services"'
      }
    },
    required: ['url']
  },
  risk: 'read',
  permissions: { network: true },
  untrustedOutput: true,
  describe: (input) => `Read the site ${input.url}`,
  async run(input, ctx) {
    const start = new URL(input.url)
    const limit = Math.max(1, Math.min(SITE_MAX_PAGES, Math.round(input.pages ?? 10)))
    const words = (input.focus ?? '')
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2)
    const score = (link: { url: string; text: string }): number =>
      words.reduce((n, w) => n + (`${link.url} ${link.text}`.toLowerCase().includes(w) ? 1 : 0), 0)
    const queue: { url: string; text: string }[] = [{ url: start.href, text: '' }]
    const seen = new Set<string>([start.href])
    const read: string[] = []
    const skipped: string[] = []
    while (queue.length && read.length < limit) {
      if (ctx.signal.aborted) break
      const next = queue.shift()!
      if (read.length) await new Promise((r) => setTimeout(r, 1000))
      try {
        const page = await ctx.pages.read(next.url)
        read.push(
          `## ${page.title || page.url}\n${page.url}\n\n${page.text.slice(0, SITE_PAGE_TEXT)}${page.text.length > SITE_PAGE_TEXT ? ' …' : ''}`
        )
        const fresh = page.links.filter((l) => {
          try {
            const u = new URL(l.url)
            return (
              u.hostname === start.hostname &&
              !seen.has(u.href) &&
              !/\.(pdf|jpe?g|png|gif|svg|zip|mp4|mp3|webp|docx?|xlsx?)$/i.test(u.pathname)
            )
          } catch {
            return false
          }
        })
        for (const l of fresh) seen.add(l.url)
        queue.push(...fresh)
        if (words.length) queue.sort((a, b) => score(b) - score(a))
      } catch (error) {
        // The first page failing (refused, robots, not found) is the answer itself.
        if (!read.length && next.url === start.href) throw error
        skipped.push(`${next.url}: ${(error as Error).message}`)
      }
    }
    return {
      output: `${read.length} page${read.length === 1 ? '' : 's'} of ${start.hostname}:\n\n${read.join('\n\n')}${skipped.length ? `\n\nSkipped:\n${skipped.slice(0, 10).join('\n')}` : ''}`,
      summary: `Read ${read.length} pages of ${start.hostname}`
    }
  }
})

export const webTools = [webSearch, webFetch, readSite]
