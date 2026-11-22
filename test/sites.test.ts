// Phase 12 (decisions §60): the SEO audit crawler, reports, saved QA tests,
// PageSpeed Insights and AI visibility, against fakes (no network, no browser).
import { describe, expect, it } from 'vitest'

import { auditSite, compareAudits, pageFacts, sitemapUrls } from '../src/engine/lib/sites/audit'
import { checkTest, playwrightSpec } from '../src/engine/lib/sites/qa'
import {
  auditReport,
  issuesSheet,
  qaReport,
  visibilityReport
} from '../src/engine/lib/sites/report'
import { createSiteService, siteUrl } from '../src/engine/lib/sites/service'
import { BUILT_IN_AGENTS, agentMayUse } from '../src/engine/lib/agents'
import { builtInTools } from '../src/engine/tools'
import { parseSheet } from '../src/engine/artifacts'
import type { TaskNet } from '../src/engine/lib/web'

const SITE = 'https://shop.example'

function html(body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><link rel="canonical" href="REPLACE">${head}</head><body>${body}</body></html>`
}

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

/** A small site with known problems. */
function fakeSite(): Record<
  string,
  { status?: number; body?: string; type?: string; location?: string }
> {
  const good = (path: string, title: string, extra = ''): string =>
    html(
      `<h1>${title}</h1><h2>Fresh bread daily</h2><p>${words(260)}</p>${extra}`,
      `<title>${title} | Brutar bakery Cluj</title><meta name="description" content="${'Fresh bread and cakes baked every morning in Cluj, delivered to your door. '.slice(0, 90)}"><meta property="og:title" content="x"><script type="application/ld+json">{"@type":"Bakery"}</script>`
    ).replace('REPLACE', `${SITE}${path}`)
  return {
    '/robots.txt': {
      body: `User-agent: *\nDisallow: /private\nSitemap: ${SITE}/sitemap.xml`,
      type: 'text/plain'
    },
    '/sitemap.xml': {
      body: `<?xml version="1.0"?><urlset><url><loc>${SITE}/</loc></url><url><loc>${SITE}/about</loc></url></urlset>`,
      type: 'application/xml'
    },
    '/llms.txt': { status: 404, body: 'no' },
    '/': {
      body: good(
        '/',
        'Home',
        `<a href="/about">About</a><a href="/old">Old</a><a href="/missing">Missing</a><a href="/private/x">P</a><a href="tel:+40123">Call</a><a href="https://elsewhere.example/">x</a><img src="a.png">`
      )
    },
    '/about': { body: good('/about', 'About', '<a href="/">Home</a><h4>Skipped level</h4>') },
    '/old': { status: 301, location: '/about' },
    '/missing': { status: 404, body: 'gone' },
    '/thin': { body: html('<p>short</p>').replace('REPLACE', `${SITE}/thin`) }
  }
}

function fakeNet(pages: ReturnType<typeof fakeSite>, log: string[] = []): TaskNet {
  const respond = (url: string): Response => {
    const path = new URL(url).pathname
    const page = pages[path]
    log.push(path)
    if (!page)
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
    const headers: Record<string, string> = {
      'content-type': page.type ?? 'text/html; charset=utf-8'
    }
    if (page.location) headers.location = page.location
    return new Response(
      page.status && page.status >= 300 && page.status < 400 ? null : (page.body ?? ''),
      {
        status: page.status ?? 200,
        headers
      }
    )
  }
  return {
    check: async () => undefined,
    fetch: async (url) => respond(url),
    fetchOnce: async (url) => respond(url),
    sites: () => []
  }
}

describe('the SEO audit crawler (14.2)', () => {
  it('finds a site’s problems, keeps to robots.txt and reads the sitemap', async () => {
    const log: string[] = []
    const audit = await auditSite(
      `${SITE}/`,
      { maxPages: 20 },
      {
        net: fakeNet(fakeSite(), log),
        robots: async (url) => !new URL(url).pathname.startsWith('/private'),
        delayMs: 0
      }
    )
    expect(audit.robotsTxt).toBe(true)
    expect(audit.sitemap).toEqual({ url: `${SITE}/sitemap.xml`, urls: 2 })
    expect(audit.llmsTxt).toBe(false)
    // robots.txt was respected: the private page was never requested.
    expect(log).not.toContain('/private/x')
    expect(audit.skipped.map((s) => s.url)).toContain(`${SITE}/private/x`)
    const checks = audit.issues.map((i) => `${i.check} ${new URL(i.url).pathname}`)
    expect(checks).toContain('Broken page /missing')
    expect(checks).toContain('Link to a redirect /old')
    expect(checks).toContain('Images without alt text /')
    expect(checks).toContain('Heading order /about')
    expect(checks).toContain('No llms.txt /')
    // Good pages pass the basics.
    expect(checks).not.toContain('Missing title /')
    expect(checks).not.toContain('No phone layout /')
    expect(audit.issues.find((i) => i.check === 'Broken page')!.detail).toMatch(/linked from/)
    expect(audit.score).toBeGreaterThan(0)
    expect(audit.score).toBeLessThan(100)
    expect(audit.topics).toContain('bread')
  })

  it('says when the start page sends visitors to another site', async () => {
    const pages = fakeSite()
    pages['/'] = { status: 307, location: 'https://sign-in.example/handshake' }
    const audit = await auditSite(
      `${SITE}/`,
      {},
      { net: fakeNet(pages), robots: async () => true, delayMs: 0 }
    )
    const issue = audit.issues.find((i) => i.check === 'Redirects to another site')!
    expect(issue.severity).toBe('high')
    expect(issue.detail).toMatch(/sign-in\.example/)
  })

  it('stops at the page limit and says so', async () => {
    const audit = await auditSite(
      `${SITE}/`,
      { maxPages: 1 },
      { net: fakeNet(fakeSite()), robots: async () => true, delayMs: 0 }
    )
    expect(audit.pages).toHaveLength(1)
    expect(audit.limited).toBe(true)
  })

  it('reads a page’s facts and a sitemap index', () => {
    const facts = pageFacts(
      html(
        '<h1>A</h1><h1>B</h1><img alt="x"><a href="/a#top">a</a>',
        '<title>T</title><link rel="alternate" hreflang="ro" href="/ro">'
      ).replace('REPLACE', '/'),
      `${SITE}/`,
      'shop.example'
    )
    expect(facts.h1).toEqual(['A', 'B'])
    expect(facts.links).toEqual([`${SITE}/a`])
    expect(facts.hreflang).toEqual([{ lang: 'ro', href: `${SITE}/ro` }])
    expect(
      sitemapUrls('<sitemapindex><sitemap><loc>https://x/s1.xml</loc></sitemap></sitemapindex>')
    ).toEqual({ pages: [], sitemaps: ['https://x/s1.xml'] })
  })

  it('compares a re-audit with the last one (14.13) and keeps history on the laptop', async () => {
    const net = fakeNet(fakeSite())
    const first = await auditSite(`${SITE}/`, {}, { net, robots: async () => true, delayMs: 0 })
    const pages = fakeSite()
    pages['/missing'] = {
      body: html(
        `<h1>Back</h1><p>${words(300)}</p>`,
        '<title>Back again, a proper title</title>'
      ).replace('REPLACE', `${SITE}/missing`)
    }
    const second = await auditSite(
      `${SITE}/`,
      {},
      { net: fakeNet(pages), robots: async () => true, delayMs: 0 }
    )
    const diff = compareAudits(first, second)
    expect(diff.fixed.map((i) => i.check)).toContain('Broken page')
    const service = createSiteService({ dir: null, fetch, cloud: () => null })
    service.remember(first)
    service.remember(second)
    expect(service.history(SITE).map((h) => h.at)).toEqual([second.at, first.at])
    const report = auditReport(second, diff)
    expect(report).toMatch(/# SEO audit: shop.example/)
    expect(report).toMatch(/Since the last audit/)
    const sheet = parseSheet(issuesSheet(second))
    expect(sheet.columns).toEqual(['Priority', 'Check', 'Address', 'Detail'])
    expect(sheet.rows.length).toBe(second.issues.length)
  })

  it('refuses addresses that aren’t web pages', () => {
    expect(() => siteUrl('file:///C:/x')).toThrow()
    expect(() => siteUrl('javascript:alert(1)')).toThrow()
    expect(siteUrl('shop.example')).toBe('https://shop.example/')
    expect(siteUrl('localhost:5173')).toBe('https://localhost:5173/')
  })
})

describe('saved QA tests (5.2)', () => {
  it('checks a test and writes the same steps as a Playwright file', () => {
    const test = checkTest({
      name: 'contact-form',
      url: SITE,
      steps: [
        { action: 'click', text: 'Contact', role: 'link' },
        { action: 'fill', label: 'Email', value: 'a@b.example' },
        { action: 'expect_text', text: 'Thanks' }
      ]
    })
    const spec = playwrightSpec(test)
    expect(spec).toMatch(/getByRole\("link", \{ name: "Contact" \}\)/)
    expect(spec).toMatch(/getByLabel\("Email"\)/)
    expect(() => checkTest({ ...test, steps: [{ action: 'evaluate', code: 'x' }] })).toThrow()
    expect(() => checkTest({ ...test, name: '../escape' })).toThrow()
    expect(() => checkTest({ ...test, url: 'file:///C:/x' })).toThrow()
  })

  it('reports test runs and page problems', () => {
    const report = qaReport(
      SITE,
      [
        {
          url: `${SITE}/`,
          size: 'phone',
          status: 200,
          title: 'Home',
          consoleErrors: ['boom'],
          pageErrors: [],
          failedRequests: [],
          axe: [
            {
              id: 'image-alt',
              impact: 'critical',
              help: 'Images must have alternative text',
              helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
              nodes: 2,
              example: 'img'
            }
          ],
          vitals: {
            lcp: 3100,
            cls: 0.02,
            tbt: 40,
            fcp: 900,
            ttfb: 120,
            loadMs: 1500,
            requests: 12,
            transferKb: 300
          },
          overflow: true,
          screenshot: null,
          error: null
        }
      ],
      [{ name: 'home', passed: false, failedStep: 2, error: 'not found', ms: 1200 }]
    )
    expect(report).toMatch(/Images must have alternative text/)
    expect(report).toMatch(/failed at step 2/)
    expect(report).toMatch(/sideways scroll/)
    expect(report).toMatch(/3100 \(needs work\)/)
  })
})

describe('PageSpeed Insights and AI visibility (14.3, 14.12)', () => {
  it('reads Lighthouse scores, lab numbers and real visitors’ data', async () => {
    const asked: string[] = []
    const headers: (string | null)[] = []
    const net: TaskNet = {
      check: async () => undefined,
      fetchOnce: async () => new Response(''),
      sites: () => [],
      fetch: async (url, init) => {
        asked.push(url)
        headers.push(new Headers(init?.headers).get('x-goog-api-key'))
        return Response.json({
          lighthouseResult: {
            categories: {
              performance: { title: 'Performance', score: 0.72 },
              seo: { title: 'SEO', score: 0.9 }
            },
            audits: {
              'largest-contentful-paint': {
                title: 'Largest Contentful Paint',
                displayValue: '3.1 s'
              },
              'render-blocking-resources': {
                title: 'Eliminate render-blocking resources',
                score: 0.3,
                displayValue: 'Potential savings of 900 ms',
                details: { type: 'opportunity', overallSavingsMs: 900 }
              }
            }
          },
          loadingExperience: {
            overall_category: 'AVERAGE',
            metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900, category: 'AVERAGE' } }
          }
        })
      }
    }
    // The user's own key goes in a header, never in the address.
    const key = ['test', 'pagespeed', 'key'].join('-')
    const service = createSiteService({
      dir: null,
      fetch,
      cloud: () => null,
      pagespeedKey: () => key
    })
    const result = await service.speed(`${SITE}/`, 'mobile', net)
    expect(headers[0]).toBe(key)
    expect(asked[0]).not.toContain(key)
    expect(asked[0]).toMatch(
      /^https:\/\/pagespeedonline\.googleapis\.com\/pagespeedonline\/v5\/runPagespeed\?url=https%3A%2F%2Fshop\.example%2F&strategy=mobile/
    )
    expect(result.scores).toEqual({ Performance: 72, SEO: 90 })
    expect(result.opportunities[0].title).toMatch(/render-blocking/)
    expect(result.field[0]).toEqual({
      metric: 'LARGEST_CONTENTFUL_PAINT_MS',
      p75: 2900,
      category: 'AVERAGE'
    })
  })

  it('asks models with web search and finds mentions and citations', async () => {
    const bodies: Record<string, unknown>[] = []
    const fake = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      bodies.push(body)
      const mentions = body.model === 'perplexity/sonar'
      return Response.json({
        choices: [
          {
            message: {
              content: mentions
                ? 'Try Brutar in Cluj, known for sourdough.'
                : 'Try Panifcom or Paul.',
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: {
                    url: mentions
                      ? 'https://www.brutar.example/about'
                      : 'https://tripadvisor.example/x'
                  }
                }
              ]
            }
          }
        ],
        usage: { cost: 0.004 }
      })
    }) as unknown as typeof fetch
    const service = createSiteService({
      dir: null,
      fetch: fake,
      cloud: () => ({ base: 'https://openrouter.example/api/v1', key: 'k', via: 'key' })
    })
    const answers = await service.visibility({
      brand: 'Brutar',
      domain: 'https://www.brutar.example/',
      questions: ['best bakery in Cluj']
    })
    expect(answers).toHaveLength(3)
    expect(
      bodies.every((b) =>
        b.model === 'perplexity/sonar'
          ? b.tools === undefined
          : JSON.stringify(b.tools) ===
            JSON.stringify([{ type: 'openrouter:web_search', parameters: { max_results: 5 } }])
      )
    ).toBe(true)
    const sonar = answers.find((a) => a.model === 'perplexity/sonar')!
    expect(sonar.mentioned && sonar.cited).toBe(true)
    expect(answers.filter((a) => a.mentioned)).toHaveLength(1)
    expect(answers.find((a) => a.model !== 'perplexity/sonar')!.sources).toEqual([
      'tripadvisor.example'
    ])
    expect(visibilityReport('Brutar', 'brutar.example', answers)).toMatch(/Mentioned in 1 of 3/)
  })
})

describe('the QA tester and the SEO agent (5.2, 5.8)', () => {
  it('are built in and use only their tool groups', () => {
    const qa = BUILT_IN_AGENTS.find((a) => a.name === 'QA tester')!
    const seo = BUILT_IN_AGENTS.find((a) => a.name === 'SEO agent')!
    expect(qa.tools).toContain('sites')
    expect(seo.tools).toContain('sites')
    const may = (def: typeof qa): string[] =>
      builtInTools.filter((t) => agentMayUse(def, t, { isPart: false })).map((t) => t.name)
    expect(may(qa)).toEqual(
      expect.arrayContaining([
        'qa_check',
        'qa_save_test',
        'qa_run_tests',
        'site_audit',
        'browser_open'
      ])
    )
    expect(may(qa)).not.toContain('code_task')
    expect(may(qa)).not.toContain('run_command')
    expect(may(seo)).toEqual(
      expect.arrayContaining(['site_audit', 'seo_speed', 'seo_ai_visibility', 'code_task'])
    )
    expect(may(seo)).not.toContain('image_create')
    expect(may(seo)).not.toContain('agent_delegate')
  })
})
