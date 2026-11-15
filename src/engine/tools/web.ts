/**
 * Reading a web page without the browser (cheaper and faster for plain
 * pages). Every request passes the task's network policy (security.md A3).
 * Phase 4 replaces the text extraction with Readability.
 */
import { defineTool } from './lib/define-tool'

const MAX_TEXT = 20_000

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

export const webFetch = defineTool<{ url: string }>({
  name: 'web_fetch',
  description:
    'Read a web page as plain text (no browser). Good for articles, docs and simple pages; use browser_open for pages that need clicking or JavaScript.',
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
    const response = await ctx.net.fetch(input.url, {
      headers: {
        'User-Agent': 'Titan117/0.1 (desktop assistant)',
        Accept: 'text/html,text/plain,application/json'
      },
      signal: ctx.signal
    })
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok) throw new Error(`The page answered ${response.status}.`)
    if (!/text|json|xml/.test(type))
      throw new Error(`That address isn't a page (${type || 'unknown type'}).`)
    const raw = await response.text()
    const { title, text } = /html/.test(type) ? htmlToText(raw) : { title: '', text: raw }
    const cut = text.length > MAX_TEXT
    return {
      output: `${title ? `Title: ${title}\n` : ''}Address: ${response.url || input.url}\n\n${text.slice(0, MAX_TEXT)}${cut ? '\n[The page is longer; only its start is shown.]' : ''}`,
      summary: `Read ${input.url}`
    }
  }
})
