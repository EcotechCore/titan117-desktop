// Phase 14's check with a real model (roadmap: "A website turns into a promo
// video and a month of ready-to-post posts"). A small company site is served
// on this laptop; the Video maker and the Marketing agent work from it in the
// laptop's own Edge or Chrome. The harness plays the user and approves what is
// asked, then checks the files and the calendar, not what a model says.
//
//   pnpm eval:marketing-agents             (Claude Haiku 5.5 by default)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { AddressInfo } from 'net'

import { startEngine, type Engine } from '../../src/engine/lib/engine'
import { findBrowserChannel } from '../../src/engine/lib/browser'
import { countChars, fullText, PLATFORM_INFO } from '../../src/engine/lib/marketing/posts'
import { call, tempFolder } from '../helpers'

const MODEL = `openrouter:${process.env.TITAN_EVAL_MODEL ?? 'anthropic/claude-haiku-5.5'}`
const OUT = join(__dirname, 'results', 'video')

function devKey(): string | null {
  try {
    const env = readFileSync(join(__dirname, '../../.env'), 'utf8')
    return /^OPENROUTER_API_KEY=(.+)$/m.exec(env)?.[1]?.trim() || null
  } catch {
    return process.env.OPENROUTER_API_KEY ?? null
  }
}

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64" viewBox="0 0 240 64"><circle cx="32" cy="32" r="26" fill="#b45309"/><text x="68" y="42" font-family="Georgia" font-size="26" fill="#1c1917">Brutăria Ana</text></svg>'

const CSS = `body{margin:0;font-family:Georgia,serif;color:#1c1917;background:#fffbf5}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 48px;border-bottom:1px solid #eee}
nav a{margin-left:24px;color:#b45309;text-decoration:none}
main{padding:64px 48px;max-width:1100px}
h1{font-size:56px;margin:0 0 16px} h2{font-size:32px;margin:48px 0 12px}
p{font-size:20px;line-height:1.5;color:#44403c;max-width:760px}
.btn{display:inline-block;background:#b45309;color:#fff;padding:16px 28px;border-radius:10px;text-decoration:none;font-size:20px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.card{background:#fff;border:1px solid #eee;border-radius:12px;padding:20px}
@media (max-width:600px){header,main{padding:16px} h1{font-size:36px} .cards{grid-template-columns:1fr}}`

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Brutăria Ana</title><meta name="description" content="Brutăria Ana bakes sourdough, rye and pastries in Cluj every morning from local flour. Order online before 18:00 and collect warm bread from 7:00."><meta name="theme-color" content="#b45309"><link rel="stylesheet" href="/style.css"></head><body><header><a href="/"><img src="/logo.svg" alt="Brutăria Ana logo" height="48"></a><nav><a href="/">Home</a><a href="/order">Order</a><a href="/about">About</a></nav></header><main>${body}</main></body></html>`
}

function site(): Server {
  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const send = (type: string, body: string, status = 200): void => {
      res.writeHead(status, { 'content-type': type })
      res.end(body)
    }
    if (path === '/robots.txt') return send('text/plain', 'User-agent: *\nAllow: /\n')
    if (path === '/style.css') return send('text/css', CSS)
    if (path === '/logo.svg') return send('image/svg+xml', LOGO)
    if (path === '/order')
      return send(
        'text/html; charset=utf-8',
        page(
          'Order',
          '<h1>Order today, collect tomorrow</h1><p>Choose your loaves before 18:00 and we bake them for you overnight. Collect from 7:00 at Strada Memorandumului 12, Cluj.</p><div class="cards"><div class="card"><h3>Sourdough</h3><p>18 lei</p></div><div class="card"><h3>Rye with seeds</h3><p>16 lei</p></div><div class="card"><h3>Cinnamon rolls (4)</h3><p>22 lei</p></div></div><p><a class="btn" href="/order">Place an order</a></p>'
        )
      )
    if (path === '/about')
      return send(
        'text/html; charset=utf-8',
        page(
          'About',
          '<h1>A family bakery since 1998</h1><p>Ana and her son Radu bake everything by hand from flour milled in Transylvania. No additives, long fermentation, and a wood-fired oven.</p><blockquote>"The best rye in Cluj, still warm at seven." — Ioana, a regular</blockquote>'
        )
      )
    if (path === '/')
      return send(
        'text/html; charset=utf-8',
        page(
          'Fresh bread every morning',
          '<h1>Fresh bread, every morning</h1><p>Sourdough, rye and pastries baked by hand in Cluj, from local flour. Order online before 18:00 and collect warm bread from 7:00.</p><p><a class="btn" href="/order">Order now</a></p><h2>Why people come back</h2><div class="cards"><div class="card"><h3>Baked from 4 am</h3><p>Every loaf is fresh the day you collect it.</p></div><div class="card"><h3>Local flour</h3><p>Milled in Transylvania, no additives.</p></div><div class="card"><h3>Order online</h3><p>Two minutes on your phone.</p></div></div>'
        )
      )
    send('text/plain', 'Not found', 404)
  })
}

const key = devKey()
const channel = findBrowserChannel()
const report: string[] = []
let engine: Engine
let server: Server
let base: string
let folder: string

/** Play the user: approve everything the task asks until it ends. */
async function runAndApprove(agent: string, text: string, ms: number): Promise<string> {
  const { body } = await call(engine, 'POST', '/v1/tasks', { text, model: MODEL, agent })
  const taskId: string = body.task.id
  const end = Date.now() + ms
  for (;;) {
    const task = engine.parts.store.getTask(taskId)!
    for (const a of engine.parts.store.listApprovals({ taskId, status: 'pending' })) {
      report.push(`  ${agent} asked (${a.tool}): ${a.summary.replace(/\s+/g, ' ').slice(0, 220)}`)
      await call(engine, 'POST', `/v1/approvals/${a.id}`, { answer: 'approve' })
    }
    if (task.status !== 'running' && task.status !== 'waiting') break
    if (Date.now() > end) throw new Error(`${agent} did not finish in time.`)
    await new Promise((r) => setTimeout(r, 300))
  }
  const task = engine.parts.store.getTask(taskId)!
  const last = engine.parts.store
    .listMessages(taskId)
    .map((m) => m.message)
    .filter((m) => m.role === 'assistant')
    .at(-1)
  report.push(
    `${agent}: ${task.status}, $${task.costUsd.toFixed(4)}; said: ${last && last.role === 'assistant' ? last.text.replace(/\s+/g, ' ').slice(0, 500) : ''}`
  )
  return taskId
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
}

describe.skipIf(!key || !channel)(
  'phase 14: a website turns into a video and a month of posts',
  () => {
    beforeAll(async () => {
      server = site()
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
      const dataDir = tempFolder('titan117-marketing-')
      folder = tempFolder('titan117-bakery-')
      engine = await startEngine({
        dataDir,
        appVersion: '0.0.0-live',
        coreDirs: [dataDir],
        allowedOrigins: ['titan117://app'],
        openRouterKey: key!,
        locked: false,
        loadLlama: async () => {
          throw new Error('No local model here.')
        },
        probeLlama: async () => ({ ok: true, gpu: null, vramBytes: 0, gpuName: null }),
        embedder: null
      })
      engine.addFolder(folder)
      await call(engine, 'PUT', '/v1/settings', { defaultModel: MODEL })
    })

    afterAll(async () => {
      await engine?.close()
      await new Promise((r) => server?.close(r))
      const text = `Phase 14 live check, ${new Date().toISOString().slice(0, 10)}, ${MODEL}\n\n${report.join('\n')}\n`
      mkdirSync(join(__dirname, 'results'), { recursive: true })
      writeFileSync(
        join(__dirname, 'results', `marketing-${new Date().toISOString().slice(0, 10)}.md`),
        text
      )
      console.log(`\n${text}`)
    })

    it('the Video maker reads the site, fills the brand kit and makes the video', async () => {
      await runAndApprove(
        'Video maker',
        `Our website is ${base} . Read it (the home, order and about pages), save our brand kit from it, then make a 20 to 35 second promo video in landscape and portrait with a voiceover. Go ahead without showing me the script first.`,
        600_000
      )
      const brand = engine.parts.marketing.brand.get()
      report.push(
        `Brand kit: ${brand?.name} · ${brand?.primary}/${brand?.accent} · logo ${brand?.logo || 'none'} · tone "${brand?.tone}"`
      )
      expect(brand?.name).toMatch(/Ana/i)
      const videos = files(folder).filter((f) => f.endsWith('.mp4'))
      report.push(
        `Videos: ${videos.map((v) => `${v.slice(folder.length + 1)} (${(statSync(v).size / 1e6).toFixed(1)} MB)`).join(', ')}`
      )
      expect(videos.some((v) => v.includes('landscape'))).toBe(true)
      expect(videos.some((v) => v.includes('portrait'))).toBe(true)
      mkdirSync(OUT, { recursive: true })
      for (const v of videos)
        writeFileSync(join(OUT, `agent-${v.split(/[\\/]/).pop()}`), readFileSync(v))
      const shots = files(folder).filter((f) => f.endsWith('.png'))
      expect(shots.length).toBeGreaterThan(1)
    }, 700_000)

    it('the Marketing agent plans a month of ready-to-post posts', async () => {
      await runAndApprove(
        'Marketing agent',
        'Plan our posts for December 2026: LinkedIn twice a week and X three times a week, around Christmas orders (order by 22 December). Use the brand kit. Save them all as drafts. You may decide everything yourself; don’t ask me questions.',
        600_000
      )
      const posts = engine.parts.marketing.posts.list({ month: '2026-12' })
      const by = (p: string): number => posts.filter((x) => x.platform === p).length
      report.push(`Posts for December: ${posts.length} (LinkedIn ${by('linkedin')}, X ${by('x')})`)
      for (const p of posts.slice(0, 3))
        report.push(
          `  ${p.date} ${p.time} ${PLATFORM_INFO[p.platform].label}: ${fullText(p).replace(/\s+/g, ' ').slice(0, 200)}`
        )
      expect(by('linkedin')).toBeGreaterThanOrEqual(6)
      expect(by('x')).toBeGreaterThanOrEqual(9)
      for (const p of posts)
        expect(countChars(p.platform, fullText(p))).toBeLessThanOrEqual(
          PLATFORM_INFO[p.platform].maxChars
        )
      // Each post is a package the user publishes from the screen.
      const screen = await call(engine, 'GET', '/v1/marketing')
      const x = screen.body.posts.find((p: { platform: string }) => p.platform === 'x')
      expect(x.composeUrl).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/)
      // Nothing was posted: no request ever went to a platform.
      expect(posts.every((p) => p.status === 'draft')).toBe(true)
    }, 700_000)

    it('the Marketing agent drafts ads and reports what the posts brought', async () => {
      // The user posted three of December's posts and reads their numbers off the platforms.
      const posts = engine.parts.marketing.posts.list({ month: '2026-12' }).slice(0, 3)
      for (const p of posts) engine.parts.marketing.posts.setStatus(p.id, 'posted')
      await runAndApprove(
        'Marketing agent',
        `Two things. First: our posts got these numbers. The ${posts[0].platform} post of ${posts[0].date} (id ${posts[0].id}): 120 views, 14 likes, 3 comments, 5 clicks. The ${posts[1].platform} post of ${posts[1].date} (id ${posts[1].id}): 40 views and 2 likes. Record them, then make the campaign report for December 2026. Second: draft Christmas ads for us, one Google search ad for people in Cluj looking for a bakery or Christmas bread, opening ${base}order , and one Meta ad. Decide everything yourself; don't ask me questions.`,
        600_000
      )
      const results = engine.parts.marketing.posts.get(posts[0].id)!.results
      report.push(`Results recorded: ${JSON.stringify(results)}`)
      expect(results).toMatchObject({ views: 120, likes: 14, clicks: 5 })
      const artifacts = engine.parts.artifacts.list()
      report.push(`Artifacts: ${artifacts.map((a) => `${a.kind} "${a.title}"`).join('; ')}`)
      const reportDoc = artifacts.find((a) => a.title.startsWith('Campaign report'))
      expect(reportDoc).toBeTruthy()
      const text = engine.parts.artifacts.get(reportDoc!.id).current.content
      expect(text).toContain('3 posted')
      const tsv = files(folder).find((f) => f.endsWith('google-ads-editor.tsv'))
      expect(tsv).toBeTruthy()
      const tsvText = readFileSync(tsv!, 'utf16le').replace(String.fromCharCode(0xfeff), '')
      const rows = tsvText.trimEnd().split(/\r\n/)
      const ad = rows.find((r) => r.includes('Responsive search ad'))?.split(/\t/) ?? []
      report.push(
        `Google Ads Editor file: ${rows.length - 1} row(s); first headlines: ${ad.slice(6, 9).join(' / ')}`
      )
      expect(tsvText).not.toContain('Enabled')
      expect(artifacts.some((a) => a.title.endsWith('Meta ads'))).toBe(true)
    }, 700_000)
  }
)
