// Phase 13 for real (decisions §61): the recorder's page script and the
// replay in this laptop's own Edge or Chrome, the scheduler starting a
// recorded task, and the web watcher with a real model on pages that change.
// The harness plays the user: it does the steps once, approves what is asked,
// and checks what the test portal received, not what a model says.
//
//   pnpm eval:automation                  (Claude Haiku 5.5 by default)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AddressInfo } from 'net'

import { startEngine, type Engine } from '../../src/engine/lib/engine'
import { createBrowserHost, findBrowserChannel } from '../../src/engine/lib/browser'
import {
  captureScript,
  checkRecording,
  stepsFromEvents,
  type RecordedEvent
} from '../../src/engine/lib/automation/recorder'
import { call, tempFolder, until } from '../helpers'

const MODEL = `openrouter:${process.env.TITAN_EVAL_MODEL ?? 'anthropic/claude-haiku-5.5'}`
const PASSWORD = ['not', 'a', 'real', 'password', '117'].join('-')
/** A real public page that changes often, to see a real change (not a law source). */
const LIVE_PAGE = process.env.TITAN_WATCH_URL ?? 'https://news.ycombinator.com/newest'
/** A real official page listing new legislation: read once, as the starting point. */
const LAW_PAGE = process.env.TITAN_LAW_URL ?? 'https://www.legislation.gov.uk/new'

function devKey(): string | null {
  try {
    const env = readFileSync(join(__dirname, '../../.env'), 'utf8')
    return /^OPENROUTER_API_KEY=(.+)$/m.exec(env)?.[1]?.trim() || null
  } catch {
    return process.env.OPENROUTER_API_KEY ?? null
  }
}

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`

/** A small supplier portal: sign in, pick a month, export, send. */
function portal(): {
  server: Server
  logins: { email: string; password: string }[]
  exports: string[]
  sent: string[]
  laws: string[]
  stolen: string[]
} {
  const state = {
    logins: [] as { email: string; password: string }[],
    exports: [] as string[],
    sent: [] as string[],
    stolen: [] as string[],
    laws: ['Order 12/2026 on waste oil collection', 'Law 5/2026 on water permits']
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const html = (text: string): void => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(text)
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const form = new URLSearchParams(body)
      if (url.pathname === '/robots.txt') {
        res.writeHead(404)
        return res.end()
      }
      if (url.pathname === '/login' && req.method === 'POST') {
        state.logins.push({ email: form.get('email') ?? '', password: form.get('password') ?? '' })
        res.writeHead(303, { location: '/reports' })
        return res.end()
      }
      if (url.pathname === '/export' && req.method === 'POST') {
        state.exports.push(form.get('month') ?? '')
        return html(
          page(
            'Exported',
            `<h1>Report for ${form.get('month')} is ready</h1><form method="post" action="/send"><input type="hidden" name="month" value="${form.get('month')}"><button>Send report</button></form>`
          )
        )
      }
      if (url.pathname === '/send' && req.method === 'POST') {
        state.sent.push(form.get('month') ?? '')
        return html(page('Sent', '<h1>Report sent</h1>'))
      }
      if (url.pathname === '/steal') {
        state.stolen.push(body)
        return html(page('Thanks', '<h1>Thanks</h1>'))
      }
      // A sign-in form that sends what is typed to another site.
      if (url.pathname === '/phish')
        return html(
          page(
            'Sign in',
            `<form method="post" action="http://localhost:${(server.address() as AddressInfo).port}/steal"><label for="pw">Password</label><input id="pw" name="password" type="password"><button type="submit">Continue</button></form>`
          )
        )
      if (url.pathname === '/reports')
        return html(
          page(
            'Reports',
            `<h1>Reports</h1><form method="post" action="/export"><label for="month">Month</label><select id="month" name="month"><option>April</option><option>May</option><option>June</option></select><label>Reference <input name="ref"></label><button>Export</button></form>`
          )
        )
      if (url.pathname === '/laws')
        return html(
          page(
            'New acts',
            `<h1>Newly published acts</h1><ul>${state.laws.map((l) => `<li>${l}</li>`).join('')}</ul>`
          )
        )
      return html(
        page(
          'Sign in',
          `<h1>Supplier portal</h1><form method="post" action="/login"><label for="email">Email</label><input id="email" name="email" type="email"><label for="pw">Password</label><input id="pw" name="password" type="password"><button type="submit">Sign in</button></form>`
        )
      )
    })
  })
  return { server, ...state }
}

const key = devKey()
const channel = findBrowserChannel()
let engine: Engine
let site: ReturnType<typeof portal>
let base: string
const report: string[] = []

describe.skipIf(!channel)('phase 13 in a real browser', () => {
  beforeAll(async () => {
    site = portal()
    await new Promise<void>((r) => site.server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(site.server.address() as AddressInfo).port}`
    const dataDir = tempFolder('titan117-automation-')
    engine = await startEngine({
      dataDir,
      appVersion: '0.0.0-live',
      coreDirs: [dataDir],
      allowedOrigins: ['titan117://app'],
      openRouterKey: key,
      locked: false,
      loadLlama: async () => {
        throw new Error('No local model here.')
      },
      probeLlama: async () => ({ ok: true, gpu: null, vramBytes: 0, gpuName: null }),
      embedder: null,
      browser: createBrowserHost({
        profileDir: join(dataDir, 'browser-profile'),
        headless: true
      })
    })
    engine.setLogins({ '127.0.0.1': { username: 'ana@firm.example', password: PASSWORD } })
    await call(engine, 'PUT', '/v1/settings', { defaultModel: MODEL })
  })

  afterAll(async () => {
    await engine?.close()
    await new Promise((r) => site.server.close(r))
    console.log(`\n${report.join('\n')}\n`)
  })

  it('records what a person does, without the password', async () => {
    // The same page script the app uses, in a browser the harness drives like a person.
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({ channel: channel!, headless: true })
    const events: RecordedEvent[] = []
    try {
      const p = await browser.newPage()
      await p.exposeBinding('__titanRecord', (_s, e: RecordedEvent) => void events.push(e))
      await p.addInitScript(captureScript)
      await p.goto(base)
      await p.getByLabel('Email').click()
      await p.getByLabel('Email').pressSequentially('ana@firm.example')
      await p.getByLabel('Password').click()
      await p.getByLabel('Password').pressSequentially(PASSWORD)
      await p.getByRole('button', { name: 'Sign in' }).click()
      await p.waitForURL('**/reports')
      await p.getByLabel('Month').selectOption('May')
      await p.getByLabel('Reference').fill('INV-1')
      await p.getByRole('button', { name: 'Export' }).click()
      await p.getByText('is ready').waitFor()
      await p.getByRole('button', { name: 'Send report' }).click()
      await p.getByText('Report sent').waitFor()
    } finally {
      await browser.close()
    }
    expect(JSON.stringify(events)).not.toContain(PASSWORD)
    const steps = stepsFromEvents(events, base)
    const recording = checkRecording(
      { name: 'monthly-report', title: 'Send the monthly report', url: base, steps },
      'you (recorded)'
    )
    report.push(
      `Recorded ${events.length} actions as ${recording.steps.length} steps: ${recording.steps.map((s) => s.action).join(', ')}`
    )
    expect(recording.steps.map((s) => s.action)).toEqual([
      'fill',
      'fill_login',
      'click',
      'select',
      'fill',
      'click',
      'click'
    ])
    // The user's edit (8.3): the month and the reference become variables.
    const edited = {
      ...recording,
      variables: [
        { name: 'month', label: 'Month', default: 'May' },
        { name: 'ref', label: 'Reference', default: '' }
      ],
      steps: recording.steps.map((s) =>
        s.action === 'select'
          ? { ...s, value: '{{month}}' }
          : s.action === 'fill' && s.value === 'INV-1'
            ? { ...s, value: '{{ref}}' }
            : s
      )
    }
    const saved = await call(engine, 'POST', '/v1/automations/recording-save', {
      recording: edited
    })
    expect(saved.status).toBe(200)
    expect(saved.body.recordings[0].missingLogins).toEqual([])
    site.logins.length = 0
    site.exports.length = 0
    site.sent.length = 0
  })

  it('the app’s own recording session starts and stops', async () => {
    const started = await call(engine, 'POST', '/v1/automations/record-start', { url: base })
    expect(started.status).toBe(200)
    expect(started.body.session.url).toContain(base)
    const stopped = await call(engine, 'POST', '/v1/automations/record-stop', { discard: true })
    expect(stopped.status).toBe(200)
    expect(stopped.body.session).toBeNull()
  })

  it('replays it on a schedule, without AI, and waits before the final step', async () => {
    const made = await call(engine, 'POST', '/v1/automations/schedule', {
      name: 'Monthly report',
      when: { kind: 'once', at: Date.now() + 1500 },
      action: {
        kind: 'recording',
        recording: 'monthly-report',
        values: { month: 'June', ref: 'INV-7' }
      }
    })
    expect(made.status).toBe(200)
    await new Promise((r) => setTimeout(r, 1700))
    // The scheduler's own look for what is due (every 30 seconds in the app).
    engine.parts.automation.tick()
    const schedule = engine.parts.automation.schedules.get('Monthly report')!
    expect(schedule.lastTaskId).toBeTruthy()
    const taskId = schedule.lastTaskId!
    // It ran by itself up to the final step: signed in with the saved login, chose June, exported.
    const approval = await until(
      () => engine.parts.store.listApprovals({ taskId, status: 'pending' })[0],
      60_000
    )
    expect(approval.summary).toContain('Send report')
    expect(site.logins).toEqual([{ email: 'ana@firm.example', password: PASSWORD }])
    expect(site.exports).toEqual(['June'])
    expect(site.sent).toEqual([])
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
    await engine.parts.runtime.settled(taskId)
    expect(site.sent).toEqual(['June'])
    const task = engine.parts.store.getTask(taskId)!
    expect(task).toMatchObject({ status: 'done', model: 'none', costUsd: 0 })
    // The password is in no message and no activity line.
    const all = JSON.stringify([
      engine.parts.store.listMessages(taskId),
      engine.parts.store.listActivity(taskId)
    ])
    expect(all).not.toContain(PASSWORD)
    report.push(
      `Scheduled replay: signed in, exported June, waited for "Send report", sent after approval; ${task.steps} step, $${task.costUsd}`
    )
  })

  it('a saved password never travels to another site', async () => {
    await call(engine, 'POST', '/v1/automations/recording-save', {
      recording: {
        name: 'phish',
        url: `${base}/phish`,
        steps: [
          { action: 'fill_login', label: 'Password', field: 'password', site: '127.0.0.1' },
          { action: 'click', role: 'button', text: 'Continue' },
          { action: 'wait_text', text: 'Thanks' }
        ]
      }
    })
    const run = await call(engine, 'POST', '/v1/automations/recording-run', { name: 'phish' })
    await engine.parts.runtime.settled(run.body.task.id)
    expect(site.stolen).toEqual([])
    expect(JSON.stringify(engine.parts.store.listMessages(run.body.task.id))).toContain(
      'stopped at step 3'
    )
    report.push('A form posting the saved password to another host: blocked, nothing arrived')
  }, 120_000)

  it('a step that broke is reported with where it stopped', async () => {
    const recording = engine.parts.automation.recordings.get('monthly-report')!
    await call(engine, 'POST', '/v1/automations/recording-save', {
      recording: {
        ...recording,
        name: 'broken',
        steps: recording.steps.map((s) =>
          s.action === 'click' && s.target.name === 'Export'
            ? { action: 'click', target: { role: 'button', name: 'Download CSV' } }
            : s
        )
      }
    })
    const run = await call(engine, 'POST', '/v1/automations/recording-run', {
      name: 'broken',
      values: { ref: 'INV-8' }
    })
    await engine.parts.runtime.settled(run.body.task.id)
    const output = JSON.stringify(engine.parts.store.listMessages(run.body.task.id))
    expect(output).toContain('stopped at step 6')
    expect(output).toContain('Download CSV')
    expect(site.sent).toEqual(['June'])
  }, 120_000)

  it.skipIf(!key)('the web watcher says what changed, with a real model', async () => {
    const made = await call(engine, 'POST', '/v1/automations/watch', {
      name: 'New acts',
      urls: [`${base}/laws`],
      about: 'We are a packaging company: anything about packaging, deposits or waste matters.'
    })
    const id: string = made.body.watches[0].id
    const first = await call(engine, 'POST', '/v1/automations/watch-check', { id })
    await engine.parts.runtime.settled(first.body.task.id)
    expect(engine.parts.store.getTask(first.body.task.id)).toMatchObject({ costUsd: 0 })
    site.laws.unshift('Law 31/2026 on a deposit scheme for plastic packaging')
    const second = await call(engine, 'POST', '/v1/automations/watch-check', { id })
    const taskId: string = second.body.task.id
    await until(() => {
      const task = engine.parts.store.getTask(taskId)!
      return task.costUsd > 0 && task.status === 'done'
    }, 120_000)
    const answer = engine.parts.store
      .listMessages(taskId)
      .map((m) => m.message)
      .filter((m) => m.role === 'assistant')
      .at(-1)
    const text = answer && answer.role === 'assistant' ? answer.text : ''
    expect(text).toMatch(/31\/2026|deposit/i)
    report.push(
      `Watcher on a changed page ($${engine.parts.store.getTask(taskId)!.costUsd.toFixed(4)}): ${text.replace(/\s+/g, ' ').slice(0, 300)}`
    )
  })

  it.skipIf(!key)(
    'a real official page reads, and a real page shows a real change',
    async () => {
      const made = await call(engine, 'POST', '/v1/automations/watch', {
        name: 'Real pages',
        urls: [LAW_PAGE, LIVE_PAGE]
      })
      const id: string = made.body.watches.find((w: { name: string }) => w.name === 'Real pages').id
      const first = await call(engine, 'POST', '/v1/automations/watch-check', { id })
      await engine.parts.runtime.settled(first.body.task.id)
      const firstText = JSON.stringify(engine.parts.store.listMessages(first.body.task.id))
      report.push(
        `First read of ${LAW_PAGE}: ${/legislation[^"]*?Could not be read[^"]{0,160}/.exec(firstText)?.[0] ?? (firstText.includes('Could not be read') ? 'one page could not be read' : 'both pages read')}`
      )
      // A minute later the fast page has new lines; the law page usually has none.
      await new Promise((r) => setTimeout(r, 75_000))
      const second = await call(engine, 'POST', '/v1/automations/watch-check', { id })
      const taskId: string = second.body.task.id
      await until(() => engine.parts.store.getTask(taskId)!.status !== 'running', 180_000)
      await new Promise((r) => setTimeout(r, 500))
      await until(() => engine.parts.store.getTask(taskId)!.status !== 'running', 180_000)
      const watch = engine.parts.automation.watches.get(id)!
      const changes = engine.parts.automation.watches.changes(id)
      report.push(
        `Second check: ${changes.length} page(s) changed (${changes.map((c) => `${new URL(c.url).hostname}: +${c.added.length} -${c.removed.length}`).join('; ')}); last change ${watch.lastChangedAt ? 'seen' : 'none'}`
      )
      const last = engine.parts.store
        .listMessages(taskId)
        .map((m) => m.message)
        .filter((m) => m.role === 'assistant')
        .at(-1)
      if (last && last.role === 'assistant' && last.text)
        report.push(`The watcher said: ${last.text.replace(/\s+/g, ' ').slice(0, 400)}`)
      expect(changes.some((c) => c.url === LIVE_PAGE)).toBe(true)
    },
    400_000
  )

  it('reads EUR-Lex through its official RSS feed, one line per act', async () => {
    // "All Parliament and Council legislation", from EUR-Lex's "Predefined RSS alerts" page.
    const feed =
      process.env.TITAN_FEED_URL ?? 'https://eur-lex.europa.eu/EN/display-feed.rss?rssId=162'
    const made = await call(engine, 'POST', '/v1/automations/watch', {
      name: 'EU legislation',
      urls: [feed]
    })
    const id: string = made.body.watches.find(
      (w: { name: string }) => w.name === 'EU legislation'
    ).id
    const run = await call(engine, 'POST', '/v1/automations/watch-check', { id })
    await engine.parts.runtime.settled(run.body.task.id)
    const output = JSON.stringify(engine.parts.store.listMessages(run.body.task.id))
    expect(output).toContain('Read for the first time')
    expect(output).not.toContain('Could not be read')
    const row = engine.parts.db
      .prepare('select text from watch_pages where watch_id = ?')
      .get(id) as { text: string }
    const lines = row.text.split(String.fromCharCode(10))
    report.push(`EUR-Lex feed: ${lines.length} acts read; first: ${lines[0].slice(0, 160)}`)
    expect(lines.length).toBeGreaterThan(5)
    expect(lines[0]).toMatch(/\(https:\/\/eur-lex\.europa\.eu\//)
  }, 120_000)

  it.skipIf(!key)(
    'a new file in a folder starts the agent, which is told the file',
    async () => {
      const folder = tempFolder('titan117-inbox-')
      engine.addFolder(folder)
      const made = await call(engine, 'POST', '/v1/automations/schedule', {
        name: 'New notes',
        when: { kind: 'folder', folder, match: ['txt'] },
        action: {
          kind: 'task',
          agent: 'Titan',
          prompt: 'Read each new file and tell me in one line what it says.'
        }
      })
      expect(made.status).toBe(200)
      await new Promise((r) => setTimeout(r, 1200))
      writeFileSync(
        join(folder, 'delivery.txt'),
        'The pallets from Brasov arrive on Thursday at 10.'
      )
      // The trigger waits until a file has settled (10 seconds), then the scheduler's look finds it.
      await new Promise((r) => setTimeout(r, 11_500))
      engine.parts.automation.tick()
      const schedule = engine.parts.automation.schedules.get('New notes')!
      expect(schedule.lastNote).toBe('Started for 1 new file(s).')
      const taskId = schedule.lastTaskId!
      await until(() => engine.parts.store.getTask(taskId)!.status === 'done', 120_000)
      const answer = engine.parts.store
        .listMessages(taskId)
        .map((m) => m.message)
        .filter((m) => m.role === 'assistant')
        .at(-1)
      const text = answer && answer.role === 'assistant' ? answer.text : ''
      expect(text).toMatch(/Thursday/i)
      report.push(`Folder trigger: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
    },
    200_000
  )

  it.skipIf(!key)('Titan makes a schedule from plain words, after the user’s OK', async () => {
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'Every weekday at 8 in the morning, check the web watch "New acts" for me.',
      model: MODEL
    })
    const taskId: string = body.task.id
    const approval = await until(
      () => engine.parts.store.listApprovals({ taskId, status: 'pending' })[0],
      120_000
    )
    expect(approval.tool).toBe('schedule_create')
    report.push(`Titan asked: ${approval.summary}`)
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
    await until(() => engine.parts.store.getTask(taskId)!.status === 'done', 120_000)
    const schedule = engine.parts.automation.schedules
      .list()
      .find((s) => s.action.kind === 'watch')!
    expect(schedule.when).toMatchObject({ kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] })
    expect(schedule.action).toEqual({ kind: 'watch', watch: 'New acts' })
    report.push(
      `Schedule made: ${schedule.name}; next run ${new Date(schedule.nextAt!).toString().slice(0, 21)}; cost $${engine.parts.store.getTask(taskId)!.costUsd.toFixed(4)}`
    )
  })
})
