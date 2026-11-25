// Website visits for sites built with Titan117 (15.10; decisions §63): the
// page sends one beacon, the site's own Worker writes one data point to the
// user's Workers Analytics Engine, and the app reads them back. The Worker's
// real code runs here against a fake environment.
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  COUNTING_WORKER,
  VISIT_PATH,
  VISIT_SCRIPT,
  VISIT_SCRIPT_PATH,
  VISITS_DATASET,
  publishToCloudflare,
  readVisits,
  siteFiles,
  visitsReport,
  withVisitScript
} from '../src/engine/lib/apps/cloudflare'
import { countsVisits } from '../src/engine/lib/apps/service'
import { tempFolder } from './helpers'

const TOKEN = 'cfut_0000000000000000000000000000000000test'

interface Point {
  blobs: string[]
  indexes: string[]
}

/** The Worker's own module, loaded as Cloudflare would. */
async function worker(): Promise<{
  fetch(request: Request, env: unknown): Promise<Response>
}> {
  const url = `data:text/javascript;base64,${Buffer.from(COUNTING_WORKER).toString('base64')}`
  return ((await import(/* @vite-ignore */ url)) as { default: never }).default
}

function env(points: Point[]): unknown {
  return {
    SITE: 'cluj-bakery',
    VISITS: { writeDataPoint: (p: Point) => void points.push(p) },
    ASSETS: { fetch: async () => new Response('the file') }
  }
}

function visit(body: unknown, headers: Record<string, string> = {}, country = 'RO'): Request {
  const request = new Request(`https://cluj-bakery.ana.workers.dev${VISIT_PATH}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)', ...headers }
  })
  Object.defineProperty(request, 'cf', { value: { country } })
  return request
}

describe('counting visits', () => {
  it('the Worker writes the page, the linking site, the country and the device: nothing else', async () => {
    const w = await worker()
    const points: Point[] = []
    const res = await w.fetch(
      visit(
        { p: '/order?coupon=x', r: 'https://www.google.com/search?q=bread' },
        {
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)'
        }
      ),
      env(points)
    )
    expect(res.status).toBe(204)
    expect(points).toEqual([
      { blobs: ['/order', 'www.google.com', 'RO', 'phone'], indexes: ['cluj-bakery'] }
    ])
    // A link from the site itself isn't "came from".
    await w.fetch(visit({ p: '/', r: 'https://cluj-bakery.ana.workers.dev/order' }), env(points))
    expect(points[1].blobs).toEqual(['/', '', 'RO', 'computer'])
  })

  it('doesn’t count bots, other methods, or broken bodies as anything but a plain visit', async () => {
    const w = await worker()
    const points: Point[] = []
    await w.fetch(visit({ p: '/' }, { 'user-agent': 'Googlebot/2.1' }), env(points))
    expect(points).toHaveLength(0)
    const get = new Request(`https://cluj-bakery.ana.workers.dev${VISIT_PATH}`)
    expect((await w.fetch(get, env(points))).status).toBe(405)
    const broken = new Request(`https://cluj-bakery.ana.workers.dev${VISIT_PATH}`, {
      method: 'POST',
      body: 'not json'
    })
    await w.fetch(broken, env(points))
    expect(points[0].blobs[0]).toBe('/')
  })

  it('every other request is served from the files, untouched', async () => {
    const w = await worker()
    const points: Point[] = []
    const res = await w.fetch(new Request('https://cluj-bakery.ana.workers.dev/'), env(points))
    expect(await res.text()).toBe('the file')
    expect(points).toHaveLength(0)
  })

  it('the page script sends one beacon per page and respects Do Not Track', () => {
    expect(VISIT_SCRIPT).toContain("navigator.doNotTrack === '1'")
    expect(VISIT_SCRIPT).toContain('globalPrivacyControl')
    expect(VISIT_SCRIPT).toContain(`sendBeacon('${VISIT_PATH}'`)
    expect(VISIT_SCRIPT).not.toMatch(/cookie|localStorage/i)
    expect(withVisitScript('<html><head><title>x</title></head><body></body></html>')).toBe(
      `<html><head><title>x</title><script src="${VISIT_SCRIPT_PATH}" defer></script></head><body></body></html>`
    )
    // Added once.
    const once = withVisitScript('<head></head>')
    expect(withVisitScript(once)).toBe(once)
  })
})

describe('publishing a site that counts visits', () => {
  function site(config?: object): string {
    const dir = tempFolder('titan117-site-')
    const dist = join(dir, 'dist')
    mkdirSync(dist)
    writeFileSync(join(dist, 'index.html'), '<!doctype html><head></head><h1>Hi</h1>')
    writeFileSync(join(dist, 'app.js'), 'console.log(1)')
    if (config) writeFileSync(join(dir, 'site.config.json'), JSON.stringify(config))
    return dir
  }

  it('adds the script to pages, the counting Worker and its two bindings', async () => {
    const dir = site()
    const files = await siteFiles(join(dir, 'dist'), { visits: true })
    expect(files.map((f) => f.path).sort()).toEqual(['/_t117/v.js', '/app.js', '/index.html'])
    expect(files.find((f) => f.path === '/index.html')!.data.toString()).toContain(
      VISIT_SCRIPT_PATH
    )
    expect(files.find((f) => f.path === '/app.js')!.data.toString()).toBe('console.log(1)')

    let script: FormData | null = null
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname.replace('/client/v4', '')
      if (path === '/accounts')
        return Response.json({ success: true, result: [{ id: 'acc1', name: 'Ana' }] })
      if (path.endsWith('/assets-upload-session'))
        return Response.json({ success: true, result: { jwt: 'j', buckets: [] } })
      if (init?.method === 'PUT') script = init.body as FormData
      if (path === '/accounts/acc1/workers/subdomain')
        return Response.json({ success: true, result: { subdomain: 'ana' } })
      return Response.json({ success: true, result: {} })
    }) as typeof fetch
    await publishToCloudflare({
      fetch: fetchFn,
      token: TOKEN,
      dist: join(dir, 'dist'),
      name: 'cluj-bakery',
      visits: true
    })
    const metadata = JSON.parse(await (script!.get('metadata') as Blob).text())
    expect(metadata.bindings).toEqual([
      { type: 'assets', name: 'ASSETS' },
      { type: 'analytics_engine', name: 'VISITS', dataset: VISITS_DATASET },
      { type: 'plain_text', name: 'SITE', text: 'cluj-bakery' }
    ])
    expect(await (script!.get('worker.js') as Blob).text()).toBe(COUNTING_WORKER)
  })

  it('counts by default; "analytics": false in site.config.json turns it off', () => {
    expect(countsVisits(site())).toBe(true)
    expect(countsVisits(site({ title: 'x' }))).toBe(true)
    expect(countsVisits(site({ analytics: false }))).toBe(false)
  })
})

describe('reading visits back', () => {
  it('asks the SQL API for this site only and makes a report', async () => {
    const queries: string[] = []
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname.replace('/client/v4', '')
      if (path === '/accounts') return Response.json({ success: true, result: [{ id: 'acc1' }] })
      const sql = String(init?.body)
      queries.push(sql)
      const rows = sql.includes('toStartOfInterval')
        ? [
            { name: '2026-11-24 00:00:00', views: '12' },
            { name: '2026-11-25 00:00:00', views: 30 }
          ]
        : sql.includes('blob1')
          ? [
              { name: '/', views: 30 },
              { name: '/order', views: 12 }
            ]
          : sql.includes('blob2')
            ? [
                { name: '', views: 25 },
                { name: 'www.google.com', views: 17 }
              ]
            : sql.includes('blob3')
              ? [{ name: 'RO', views: 40 }]
              : [{ name: 'phone', views: 29 }]
      return Response.json({ meta: [], data: rows, rows: rows.length })
    }) as typeof fetch
    const v = await readVisits({ fetch: fetchFn, token: TOKEN, name: 'Cluj Bakery', days: 500 })
    expect(v.days).toBe(90)
    expect(v.total).toBe(42)
    expect(v.byDay).toEqual([
      { day: '2026-11-24', views: 12 },
      { day: '2026-11-25', views: 30 }
    ])
    expect(v.from[0].name).toBe('(direct or unknown)')
    expect(queries).toHaveLength(5)
    for (const q of queries) {
      expect(q).toContain(`FROM ${VISITS_DATASET}`)
      expect(q).toContain("index1 = 'cluj-bakery'")
      expect(q).toContain("INTERVAL '90' DAY")
      expect(q).toContain('SUM(_sample_interval)')
      expect(q).toMatch(/FORMAT JSON$/)
    }
    const report = visitsReport(v)
    expect(report).toContain('**42 page view(s)**')
    expect(report).toContain('| /order | 12 |')
  })

  it('says which permission to add when Cloudflare refuses', async () => {
    const fetchFn = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname.replace('/client/v4', '')
      if (path === '/accounts') return Response.json({ success: true, result: [{ id: 'acc1' }] })
      return Response.json({ success: false }, { status: 403 })
    }) as typeof fetch
    await expect(readVisits({ fetch: fetchFn, token: TOKEN, name: 'x', days: 7 })).rejects.toThrow(
      /Account Analytics → Read/
    )
  })
})
