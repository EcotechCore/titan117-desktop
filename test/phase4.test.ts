// Phase 4: web search and artifacts (§16, §17; decisions §44). The search
// sources, the cache, robots.txt and clean page text; artifacts with versions,
// real Word, Excel and PowerPoint files, sharing and the sandbox; deep research.
import { afterEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'

import { artifactHtml, ARTIFACT_CSP, chartSvg } from '../src/shared/artifact-html'
import { createArtifactStore } from '../src/engine/artifacts'
import { openDb } from '../src/engine/lib/db'
import type { Engine } from '../src/engine/lib/engine'
import { convert, documentToXlsx, fileName, sheetToCsv } from '../src/engine/lib/convert'
import { createPageReader, extract, robotsAllows, robotsRules } from '../src/engine/lib/read'
import { createSearchService, SEARCH_CACHE_MS, siteAllowed } from '../src/engine/lib/search'
import { createShareService } from '../src/engine/lib/share'
import { createTaskNet } from '../src/engine/lib/web'
import { createTaskPrivacy } from '../src/engine/privacy'
import { registerSecret } from '../src/engine/redact'
import { RESEARCH_RULES } from '../src/engine/runtime'
import { isSandboxUrl, safeName, SANDBOX_CSP, Staged } from '../src/main/lib/export'
import type { SearchSettings, TaskDetail } from '../src/shared/protocol'
import { fakeWeb } from './fakes'
import { call, MODEL, scripted, testEngine, until } from './helpers'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

const SETTINGS: SearchSettings = { source: 'auto', country: 'RO', language: 'ro', sites: {} }

function searchWith(
  respond: (url: string, body: Record<string, unknown> | null) => unknown,
  options: {
    keys?: Record<string, string>
    settings?: Partial<SearchSettings>
    cloud?: boolean
    now?: () => number
  } = {}
): {
  service: ReturnType<typeof createSearchService>
  calls: { url: string; body: Record<string, unknown> | null; headers: Record<string, string> }[]
} {
  const calls: {
    url: string
    body: Record<string, unknown> | null
    headers: Record<string, string>
  }[] = []
  const service = createSearchService({
    fetch: (async (url: string, init?: RequestInit) => {
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
      calls.push({
        url: String(url),
        body,
        headers: (init?.headers ?? {}) as Record<string, string>
      })
      return Response.json(respond(String(url), body))
    }) as typeof fetch,
    cloud: () =>
      options.cloud === false
        ? null
        : { base: 'https://titan117.test/api/v1', key: 't117d_device', via: 'credits' },
    keys: () => options.keys ?? {},
    settings: () => ({ ...SETTINGS, ...options.settings }),
    pickModel: async () => 'openai/gpt-4.1-nano',
    now: options.now
  })
  return { service, calls }
}

const noGuard = (): void => undefined

describe('web search (16.1-16.3, 16.9-16.12)', () => {
  it('through credits: one OpenRouter call with its web search tool on Exa, results from the citations', async () => {
    const { service, calls } = searchWith(() => ({
      choices: [
        {
          message: {
            content: '1. ANAF e-Factura',
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  url: 'https://www.anaf.ro/efactura',
                  title: 'e-Factura',
                  content: 'Since 2024…'
                }
              },
              {
                type: 'url_citation',
                url_citation: { url: 'https://www.anaf.ro/efactura', title: 'dup' }
              }
            ]
          }
        }
      ],
      usage: { cost: 0.0002, server_tool_use_details: { web_search_requests: 1 } }
    }))
    const answer = await service
      .forAgent('Titan', noGuard)
      .search({ query: 'e-factura rules', count: 5 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://titan117.test/api/v1/chat/completions')
    expect(calls[0].headers.Authorization).toBe('Bearer t117d_device')
    expect(calls[0].body?.tools).toEqual([
      { type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 5 } }
    ])
    expect(answer.results).toEqual([
      { title: 'e-Factura', url: 'https://www.anaf.ro/efactura', snippet: 'Since 2024…' }
    ])
    // Search is billed on top of tokens: at least Exa's $0.007 counts towards the budget.
    expect(answer.costUsd).toBeCloseTo(0.007)
    expect(answer.via).toBe('credits (OpenRouter, Exa)')
  })

  it('the same search within 15 minutes is free and isn’t sent again; Brave is never cached', async () => {
    let now = 1_000_000
    const exa = searchWith(() => ({ results: [{ title: 'A', url: 'https://a.example/' }] }), {
      keys: { exa: 'k' },
      now: () => now
    })
    const access = exa.service.forAgent('Titan', noGuard)
    await access.search({ query: 'Rules' })
    const again = await access.search({ query: 'rules' })
    expect(again).toMatchObject({ cached: true, costUsd: 0 })
    expect(exa.calls).toHaveLength(1)
    now += SEARCH_CACHE_MS + 1
    await access.search({ query: 'rules' })
    expect(exa.calls).toHaveLength(2)

    const brave = searchWith(
      () => ({
        web: {
          results: [{ title: 'B', url: 'https://b.example/', description: '<strong>b</strong>' }]
        }
      }),
      {
        keys: { brave: 'k' }
      }
    )
    const b = brave.service.forAgent('Titan', noGuard)
    const first = await b.search({ query: 'x' })
    await b.search({ query: 'x' })
    expect(brave.calls).toHaveLength(2)
    expect(first.results[0].snippet).toBe('b')
    expect(brave.calls[0].url).toContain('country=RO')
    expect(brave.calls[0].url).toContain('search_lang=ro')
    expect(brave.calls[0].headers['X-Subscription-Token']).toBe('k')
  })

  it('uses the user’s own key first, and its country and site lists', async () => {
    const tavily = searchWith(
      () => ({ results: [{ title: 'T', url: 'https://legislatie.just.ro/x', content: 'law' }] }),
      {
        keys: { tavily: 'tvly-k' },
        settings: { sites: { Titan: { only: ['legislatie.just.ro'], blocked: [] } } }
      }
    )
    const answer = await tavily.service.forAgent('Titan', noGuard).search({ query: 'lege' })
    expect(tavily.calls[0].url).toBe('https://api.tavily.com/search')
    expect(tavily.calls[0].body).toMatchObject({
      query: 'lege',
      country: 'romania',
      include_domains: ['legislatie.just.ro']
    })
    expect(answer).toMatchObject({ via: 'your Tavily key', costUsd: 0 })
  })

  it('a blocked site never comes back, whatever the provider sends', async () => {
    const { service } = searchWith(
      () => ({
        results: [
          { title: 'Bad', url: 'https://www.blocked.example/a' },
          { title: 'Sub', url: 'https://news.blocked.example/b' },
          { title: 'Good', url: 'https://good.example/' }
        ]
      }),
      {
        keys: { exa: 'k' },
        settings: { sites: { '*': { only: [], blocked: ['blocked.example'] } } }
      }
    )
    const answer = await service.forAgent('QA', noGuard).search({ query: 'x' })
    expect(answer.results.map((r) => r.title)).toEqual(['Good'])
    expect(siteAllowed({ only: ['anaf.ro'], blocked: [] }, 'www.anaf.ro')).toBe(true)
    expect(siteAllowed({ only: ['anaf.ro'], blocked: [] }, 'evil-anaf.ro')).toBe(false)
  })

  it('with no source, says how to get one', async () => {
    const { service } = searchWith(() => ({}), { cloud: false })
    await expect(service.forAgent('Titan', noGuard).search({ query: 'x' })).rejects.toThrow(
      /sign in to use credits, or add a Brave, Tavily or Exa key/
    )
    const chosen = searchWith(() => ({}), { settings: { source: 'brave' } })
    await expect(chosen.service.forAgent('Titan', noGuard).search({ query: 'x' })).rejects.toThrow(
      /no Brave key is saved/
    )
  })

  it('the guard refuses a query before anything is sent', async () => {
    const { service, calls } = searchWith(() => ({}), { keys: { exa: 'k' } })
    const access = service.forAgent('Titan', () => {
      throw new Error('private')
    })
    await expect(access.search({ query: 'x' })).rejects.toThrow('private')
    expect(calls).toEqual([])
  })
})

describe('reading pages (16.5, 16.6)', () => {
  const ARTICLE = `<html><head><title>Guide | Site</title></head><body>
    <nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
    <article><h1>Export guide</h1><p class="byline">By Ana Pop</p>
    <p>${'Exporting invoices takes three steps and works for every account. '.repeat(8)}</p>
    <h2>Step one</h2><ul><li>Open the list</li><li>Choose the month</li></ul></article>
    <footer>Cookie banner and footer links</footer></body></html>`

  it('keeps the article, its headings and lists, and the links', () => {
    const page = extract(ARTICLE, 'https://docs.example.com/guide')
    expect(page.text).toContain('Exporting invoices takes three steps')
    expect(page.text).toMatch(/## Step one/)
    expect(page.text).toMatch(/- Open the list/)
    expect(page.text).not.toContain('Cookie banner')
    expect(page.links.map((l) => l.url)).toContain('https://docs.example.com/pricing')
  })

  it('reads robots.txt the way search engines do', () => {
    const rules = robotsRules(
      'User-agent: *\nDisallow: /private\nAllow: /private/open\n\nUser-agent: OtherBot\nDisallow: /'
    )
    expect(robotsAllows(rules, '/public')).toBe(true)
    expect(robotsAllows(rules, '/private/x')).toBe(false)
    expect(robotsAllows(rules, '/private/open/y')).toBe(true)
    // A group for us wins over `*`.
    const ours = robotsRules('User-agent: *\nDisallow:\n\nUser-agent: Titan117\nDisallow: /')
    expect(robotsAllows(ours, '/')).toBe(false)
    expect(robotsAllows(robotsRules('User-agent: *\nDisallow: /*.pdf$'), '/a.pdf')).toBe(false)
    expect(robotsAllows(robotsRules('User-agent: *\nDisallow: /*.pdf$'), '/a.pdf?x')).toBe(true)
  })

  it('won’t read a page robots.txt closes, and reads a cached page without fetching it again', async () => {
    const web = fakeWeb({
      'https://site.example/robots.txt': 'User-agent: *\nDisallow: /closed',
      'https://site.example/open': ARTICLE
    })
    const net = createTaskNet({
      taskId: 't',
      privacy: createTaskPrivacy(),
      sites: { has: () => true, add: () => undefined, list: () => [] },
      ask: async () => 'once',
      enginePorts: () => [],
      log: () => undefined,
      fetch: web.fetch
    })
    const reader = createPageReader()
    await expect(reader.read('https://site.example/closed', net)).rejects.toThrow(/robots\.txt/)
    expect(web.requests.map((r) => r.url)).toEqual(['https://site.example/robots.txt'])
    const page = await reader.read('https://site.example/open', net)
    expect(page.title).toMatch(/Guide/)
    await reader.read('https://site.example/open#top', net)
    expect(web.requests.filter((r) => r.url.endsWith('/open'))).toHaveLength(1)
  })
})

describe('artifacts (17.1-17.10)', () => {
  it('every change is a version; the user’s edit and a restore are versions too', () => {
    const changes: string[] = []
    const store = createArtifactStore(openDb(':memory:'), (a, byAgent) =>
      changes.push(`${a?.version}:${byAgent}`)
    )
    const a = store.create({
      taskId: null,
      kind: 'document',
      title: 'Offer',
      content: '# One',
      author: 'Titan'
    })
    store.update(a.id, { content: '# Two', author: 'you', note: 'Your edit' })
    // Saving the same content again makes no version.
    store.update(a.id, { content: '# Two', author: 'you' })
    const restored = store.restore(a.id, 1, 'you')
    expect(restored.version).toBe(3)
    const detail = store.get(a.id)
    expect(detail.current.content).toBe('# One')
    expect(detail.versions.map((v) => `${v.version} ${v.author} ${v.note}`)).toEqual([
      '3 you Restored version 1',
      '2 you Your edit',
      '1 Titan Created'
    ])
    // Only what an agent did opens the panel by itself.
    expect(changes).toEqual(['1:true', '2:false', '3:false'])
  })

  it('checks a spreadsheet’s and a chart’s data', () => {
    const store = createArtifactStore(openDb(':memory:'))
    expect(() =>
      store.create({
        taskId: null,
        kind: 'spreadsheet',
        title: 'S',
        content: '{"columns":["a"]}',
        author: 'Titan'
      })
    ).toThrow(/rows/)
    expect(() =>
      store.create({
        taskId: null,
        kind: 'chart',
        title: 'C',
        content: '{"type":"bar","labels":[],"series":[{"name":"x","values":["1"]}]}',
        author: 'Titan'
      })
    ).toThrow(/series/)
    expect(() =>
      store.create({ taskId: null, kind: 'document', title: ' ', content: 'x', author: 'Titan' })
    ).toThrow(/title/)
  })
})

const REPORT = `# E-invoicing in Romania

Since 2024 every B2B invoice goes through e-Factura [1].

## Deadlines

| Who | From | Days to upload |
|---|---|---|
| Companies | 1 Jan 2024 | 5 |
| Individuals | 1 Jan 2025 | 5 |

## Sources

[1] [ANAF e-Factura](https://www.anaf.ro/efactura)
[2] [Ministry of Finance](https://mfinante.gov.ro/x)
`

describe('downloads (17.8, 17.19, 17.23)', () => {
  it('a report becomes a real Word file', async () => {
    const file = await convert({ kind: 'document', title: 'E-invoicing: Romania' }, REPORT, 'docx')
    expect(file.name).toBe('E-invoicing Romania.docx')
    expect(file.data.subarray(0, 2).toString()).toBe('PK')
    expect(file.data.includes(Buffer.from('word/document.xml'))).toBe(true)
  })

  it('a report’s Excel file has its tables and its sources, with real numbers', async () => {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await documentToXlsx(REPORT, 'E-invoicing'))
    expect(book.worksheets.map((w) => w.name)).toEqual(['Deadlines', 'Sources'])
    const deadlines = book.getWorksheet('Deadlines')!
    expect(deadlines.getRow(1).values).toEqual([undefined, 'Who', 'From', 'Days to upload'])
    expect(deadlines.getCell('C2').value).toBe(5)
    const sources = book.getWorksheet('Sources')!
    expect(sources.getCell('C2').value).toBe('https://www.anaf.ro/efactura')
    expect(sources.rowCount).toBe(3)
  })

  it('spreadsheets keep formulas; CSV defuses them; slides become PowerPoint', async () => {
    const sheet = JSON.stringify({
      columns: ['Item', 'Qty', 'Price', 'Total'],
      rows: [['Hours', 2, 50, '=B2*C2']]
    })
    const xlsx = await convert({ kind: 'spreadsheet', title: 'Invoice' }, sheet, 'xlsx')
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(xlsx.data)
    expect(book.worksheets[0].getCell('D2').value).toMatchObject({ formula: 'B2*C2' })
    expect(sheetToCsv({ columns: ['a'], rows: [['=cmd()'], ['x,y']] })).toBe(
      'a\r\n\'=cmd()\r\n"x,y"\r\n'
    )
    const pptx = await convert(
      { kind: 'slides', title: 'Plan' },
      '# Plan\n\n- one\n\n---\n\n## Two\n\ntext',
      'pptx'
    )
    expect(pptx.data.includes(Buffer.from('ppt/slides/slide2.xml'))).toBe(true)
    await expect(
      convert({ kind: 'diagram', title: 'D' }, 'graph TD; A-->B', 'docx')
    ).rejects.toThrow(/can't be downloaded/)
    expect(fileName('Ofertă / Client "X"', 'pdf')).toBe('Oferta Client X.pdf')
  })
})

describe('the sandbox (17.18, decisions §44)', () => {
  it('every artifact page carries a policy with no network, a page the agent wrote included', () => {
    expect(ARTIFACT_CSP).toContain("default-src 'none'")
    expect(ARTIFACT_CSP).not.toMatch(/connect-src|https?:/)
    const page = artifactHtml(
      { kind: 'page', title: 'Tool' },
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><script>fetch("https://evil.example")</script></body></html>'
    )
    // Ours comes first; with two policies the browser applies both.
    expect(page.indexOf(ARTIFACT_CSP)).toBeLessThan(page.indexOf('default-src *'))
    expect(artifactHtml({ kind: 'document', title: '<b>' }, '# Hi')).toContain(
      '<title>&lt;b&gt;</title>'
    )
  })

  it('serves staged pages only by their random id, with the sandbox header', async () => {
    const staged = new Staged()
    const id = staged.put('<p>hi</p>')
    const ok = staged.respond(`/${id}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-security-policy')).toBe(SANDBOX_CSP)
    expect(SANDBOX_CSP).toMatch(/^sandbox allow-scripts allow-popups;/)
    expect(SANDBOX_CSP).not.toContain('allow-same-origin')
    expect(staged.respond('/../../etc/passwd').status).toBe(404)
    expect(staged.respond(`/${'0'.repeat(32)}`).status).toBe(404)
    expect(isSandboxUrl(`titan117://sandbox/${id}`, 'titan117')).toBe(true)
    expect(isSandboxUrl('https://sandbox/', 'titan117')).toBe(false)
    expect(safeName('../../evil\u0000.pdf', 'x')).toBe('.. .. evil .pdf')
  })

  it('draws charts as SVG, not pictures', () => {
    const svg = chartSvg({
      type: 'bar',
      title: 'Sales',
      labels: ['Jan', 'Feb'],
      series: [{ name: 'RON', values: [10, 20] }]
    })
    expect(svg).toMatch(/^<svg/)
    expect(svg.match(/<rect /g)?.length).toBeGreaterThanOrEqual(2)
    expect(
      chartSvg({ type: 'pie', labels: ['a', 'b'], series: [{ name: 's', values: [1, 3] }] })
    ).toContain('75%')
  })
})

describe('sharing (17.13)', () => {
  it('refuses a page that carries a key or token, before anything is sent', async () => {
    const sent: string[] = []
    const shares = createShareService({
      fetch: (async (url: string) => {
        sent.push(String(url))
        return Response.json({ id: 'p', url: 'https://titan117.test/s/p' })
      }) as typeof fetch,
      account: () => ({ token: 't117d_x', apiBase: 'https://titan117.test/api/v1' })
    })
    await expect(
      shares.share({
        title: 'T',
        kind: 'document',
        html: `<p>${['sk', 'or', 'v1', 'a'.repeat(30)].join('-')}</p>`
      })
    ).rejects.toThrow(/key or token/)
    registerSecret('my-very-own-connector-secret')
    await expect(
      shares.share({ title: 'T', kind: 'document', html: '<p>my-very-own-connector-secret</p>' })
    ).rejects.toThrow(/key or token/)
    expect(sent).toEqual([])
    const signedOut = createShareService({ fetch: fetch, account: () => null })
    await expect(
      signedOut.share({ title: 'T', kind: 'document', html: '<p>x</p>' })
    ).rejects.toThrow(/Sign in/)
  })

  it('an artifact an agent made opens, downloads and shares by link through the engine', async () => {
    const or = scripted([
      {
        toolCalls: [
          {
            name: 'artifact_create',
            input: { kind: 'document', title: 'E-invoicing report', content: REPORT }
          }
        ]
      },
      { text: 'The report is open beside the chat.' }
    ])
    const uploads: { url: string; body: string; auth: string }[] = []
    const fetchAll = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/shares')) {
        uploads.push({
          url,
          body: String(init?.body ?? ''),
          auth: String((init?.headers as Record<string, string>)?.Authorization)
        })
        return init?.method === 'DELETE'
          ? Response.json({ ok: true })
          : Response.json({ id: 'Abc_123', url: 'https://titan117.test/s/Abc_123' })
      }
      return or.fetch(input, init)
    }) as typeof fetch
    engine = await testEngine({ fetch: fetchAll })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'Make the report',
      model: MODEL
    })
    await until(() => !engine!.parts.runtime.isRunning(body.task.id), 20_000)
    const opened = engine.parts.events.find((e) => e.type === 'artifact')
    expect(opened).toBeTruthy()
    const id = opened!.type === 'artifact' ? opened!.artifact.id : ''

    for (const format of ['docx', 'xlsx', 'md']) {
      const file = await call(engine, 'GET', `/v1/artifacts/${id}/export?format=${format}`)
      expect(file.status).toBe(200)
      expect(file.body.name).toBe(`E-invoicing report.${format}`)
    }
    expect((await call(engine, 'GET', `/v1/artifacts/${id}/export?format=pptx`)).status).toBe(400)

    // Signed out: sharing says so.
    expect(
      (await call(engine, 'POST', `/v1/artifacts/${id}/share`, { html: '<p>x</p>' })).status
    ).toBe(400)
    engine.setAccount({
      token: 't117d_' + 'c'.repeat(43),
      proxyUrl: 'https://titan117.test/api/v1',
      locked: false,
      reason: null
    })
    const shared = await call(engine, 'POST', `/v1/artifacts/${id}/share`, {
      html: '<h1>Report</h1>'
    })
    expect(shared.body.artifact.shareUrl).toBe('https://titan117.test/s/Abc_123')
    expect(uploads[0]).toMatchObject({
      url: 'https://titan117.test/api/v1/shares',
      auth: 'Bearer t117d_' + 'c'.repeat(43)
    })
    expect(JSON.parse(uploads[0].body)).toMatchObject({
      title: 'E-invoicing report',
      kind: 'document'
    })
    const unshared = await call(engine, 'DELETE', `/v1/artifacts/${id}/share`)
    expect(unshared.body.artifact.shareUrl).toBeNull()
    expect(uploads[1]).toMatchObject({ url: 'https://titan117.test/api/v1/shares/Abc_123' })

    // The user's own edit is a version the agent sees.
    await call(engine, 'PUT', `/v1/artifacts/${id}`, { content: '# Shorter' })
    const after = (await call(engine, 'GET', `/v1/artifacts/${id}`)).body
    expect(after.artifact.version).toBe(2)
    expect(after.versions[0].author).toBe('you')
  })
})

describe('deep research (16.8)', () => {
  it('runs with its own instructions and a bigger budget', async () => {
    const or = scripted([{ text: 'Report made.' }])
    engine = await testEngine({ fetch: or.fetch })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'Research e-invoicing in Romania',
      model: MODEL,
      mode: 'research'
    })
    expect(body.task.mode).toBe('research')
    await until(() => !engine!.parts.runtime.isRunning(body.task.id), 20_000)
    const system = (or.requests[0].body.messages as { role: string; content: string }[])[0].content
    expect(system).toContain(RESEARCH_RULES)
    const normal = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL })
    expect(normal.body.task.mode).toBe('normal')
    const detail: TaskDetail = (await call(engine, 'GET', `/v1/tasks/${body.task.id}`)).body
    expect(detail.task.status).toBe('done')
  })
})
