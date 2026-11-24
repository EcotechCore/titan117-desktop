// Phase 13 (decisions §61): schedules in plain words, the scheduler's
// catch-up, web watches, recordings and saved logins. No network and no
// real browser: fakes, and the engine in memory.
import { describe, expect, it } from 'vitest'

import { openDb } from '../src/engine/lib/db'
import { BUILT_IN_AGENTS, agentMayUse, createAgentStore } from '../src/engine/lib/agents'
import { checkWhen, describeWhen, nextRun, type When } from '../src/engine/lib/automation/schedule'
import { createAutomation } from '../src/engine/lib/automation/service'
import { checkUrls, createWatchStore, diffLines } from '../src/engine/lib/automation/watch'
import {
  checkRecording,
  createRecordingStore,
  describeStep,
  stepsFromEvents,
  type RecordedEvent
} from '../src/engine/lib/automation/recorder'
import type { Runtime } from '../src/engine/runtime'
import { builtInTools } from '../src/engine/tools'
import { SiteLogins, siteOf } from '../src/main/lib/site-logins'
import { fakeBrowser, fakeWeb } from './fakes'
import { MODEL, call, scripted, tempFolder, testEngine, until } from './helpers'

const at = (text: string): number => new Date(text).getTime()

describe('schedules', () => {
  it('checks a "when" and says it in plain words', () => {
    const now = at('2026-11-24T10:00:00')
    expect(
      describeWhen(checkWhen({ kind: 'daily', time: '8:00', days: [5, 1, 2, 3, 4] }, now))
    ).toBe('Every weekday at 08:00')
    expect(describeWhen(checkWhen({ kind: 'daily', time: '07:30' }, now))).toBe(
      'Every day at 07:30'
    )
    expect(describeWhen(checkWhen({ kind: 'daily', time: '09:00', days: [1] }, now))).toBe(
      'Every Monday at 09:00'
    )
    expect(describeWhen(checkWhen({ kind: 'interval', minutes: 120 }, now))).toBe('Every 2 hours')
    expect(describeWhen(checkWhen({ kind: 'monthly', day: 1, time: '09:00' }, now))).toBe(
      'On day 1 of every month at 09:00'
    )
    for (const bad of [
      { kind: 'daily', time: '25:00' },
      { kind: 'daily', time: '08:00', days: [9] },
      { kind: 'interval', minutes: 5 },
      { kind: 'monthly', day: 0, time: '08:00' },
      { kind: 'once', at: '2020-01-01T00:00' },
      { kind: 'cron', expr: '* * * * *' }
    ])
      expect(() => checkWhen(bad, now)).toThrow()
  })

  it('finds the next run in local time', () => {
    // Tuesday 24 Nov 2026, 10:00.
    const now = at('2026-11-24T10:00:00')
    const weekdays: When = { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] }
    expect(nextRun(weekdays, now)).toBe(at('2026-11-25T08:00:00'))
    // Friday after 8: the next one is Monday.
    expect(nextRun(weekdays, at('2026-11-27T09:00:00'))).toBe(at('2026-11-30T08:00:00'))
    expect(nextRun({ kind: 'daily', time: '18:00' }, now)).toBe(at('2026-11-24T18:00:00'))
    expect(nextRun({ kind: 'interval', minutes: 30 }, now)).toBe(now + 30 * 60_000)
    // The 31st in a month without one runs on its last day.
    expect(nextRun({ kind: 'monthly', day: 31, time: '09:00' }, at('2027-02-01T00:00:00'))).toBe(
      at('2027-02-28T09:00:00')
    )
    expect(nextRun({ kind: 'once', at: now + 1000 }, now)).toBe(now + 1000)
    expect(nextRun({ kind: 'once', at: now - 1000 }, now)).toBeNull()
  })
})

/** The scheduler with a clock we move and a runtime that only notes what it started. */
function scheduler(options: { locked?: () => string | null } = {}): {
  auto: ReturnType<typeof createAutomation>
  started: { kind: string; text: string; allow?: string[] }[]
  clock: { now: number }
  running: Set<string>
} {
  const clock = { now: at('2026-11-24T10:00:00') }
  const started: { kind: string; text: string; allow?: string[] }[] = []
  const running = new Set<string>()
  const runtime = {
    isRunning: (id: string) => running.has(id),
    settled: async () => undefined,
    start(text: string, _model: string, _mode: string, agent: string) {
      started.push({ kind: `task:${agent}`, text })
      return { id: `t${started.length}` }
    },
    runDirect(input: { text: string; call: { name: string }; allow?: string[] }) {
      started.push({ kind: input.call.name, text: input.text, allow: input.allow })
      return { id: `t${started.length}` }
    },
    send: () => undefined
  } as unknown as Runtime
  const auto = createAutomation({
    db: openDb(':memory:'),
    dataDir: null,
    runtime: () => runtime,
    agents: createAgentStore({ dir: null }),
    defaultModel: () => MODEL,
    locked: options.locked ?? (() => null),
    onChange: () => undefined,
    now: () => clock.now
  })
  return { auto, started, clock, running }
}

describe('the scheduler', () => {
  it('runs what is due, once, and moves on', () => {
    const { auto, started, clock } = scheduler()
    const s = auto.schedules.create({
      name: 'Morning briefing',
      when: { kind: 'daily', time: '08:00' },
      action: { kind: 'task', agent: 'Titan', prompt: 'Brief me.' },
      source: 'you'
    })
    expect(s.nextAt).toBe(at('2026-11-25T08:00:00'))
    auto.tick()
    expect(started).toHaveLength(0)
    clock.now = at('2026-11-25T08:00:20')
    auto.tick()
    auto.tick()
    expect(started).toHaveLength(1)
    expect(started[0].kind).toBe('task:Titan')
    expect(started[0].text).toContain('Brief me.')
    const after = auto.schedules.get('morning briefing')!
    expect(after.nextAt).toBe(at('2026-11-26T08:00:00'))
    expect(after.lastTaskId).toBe('t1')
  })

  it('catches up with one run after days off, and says so', () => {
    const { auto, started, clock } = scheduler()
    auto.schedules.create({
      name: 'Hourly',
      when: { kind: 'interval', minutes: 60 },
      action: { kind: 'task', agent: 'Titan', prompt: 'Check.' },
      source: 'you'
    })
    // The laptop was off for three days.
    clock.now += 3 * 24 * 3600_000
    auto.tick()
    expect(started).toHaveLength(1)
    const s = auto.schedules.get('Hourly')!
    expect(s.lastNote).toContain('Caught up')
    expect(s.nextAt).toBe(clock.now + 3600_000)
  })

  it('does nothing while the app is locked, then catches up', () => {
    let lock: string | null = 'Sign in to keep using Titan117.'
    const { auto, started, clock } = scheduler({ locked: () => lock })
    auto.schedules.create({
      name: 'Hourly',
      when: { kind: 'interval', minutes: 60 },
      action: { kind: 'task', agent: 'Titan', prompt: 'Check.' },
      source: 'you'
    })
    clock.now += 2 * 3600_000
    auto.tick()
    expect(started).toHaveLength(0)
    lock = null
    auto.tick()
    expect(started).toHaveLength(1)
  })

  it('skips a run while the last one is still going, pauses and resumes', () => {
    const { auto, started, clock, running } = scheduler()
    auto.schedules.create({
      name: 'Hourly',
      when: { kind: 'interval', minutes: 60 },
      action: { kind: 'task', agent: 'Titan', prompt: 'Check.' },
      source: 'you'
    })
    clock.now += 3600_000
    auto.tick()
    running.add('t1')
    clock.now += 3600_000
    auto.tick()
    expect(started).toHaveLength(1)
    expect(auto.schedules.get('Hourly')!.lastNote).toContain('Skipped')
    running.clear()
    auto.schedules.setEnabled('Hourly', false)
    clock.now += 5 * 3600_000
    auto.tick()
    expect(started).toHaveLength(1)
    // Resumed: the next time counts from now, with no catching up.
    auto.schedules.setEnabled('Hourly', true)
    auto.tick()
    expect(started).toHaveLength(1)
    expect(auto.schedules.get('Hourly')!.nextAt).toBe(clock.now + 3600_000)
  })

  it('replays a recording without a model, and a one-off runs once', () => {
    const { auto, started, clock } = scheduler()
    auto.recordings.save(
      checkRecording(
        {
          name: 'export',
          url: 'https://portal.example',
          steps: [{ action: 'click', text: 'Export' }]
        },
        'you'
      )
    )
    auto.schedules.create({
      name: 'Export once',
      when: { kind: 'once', at: clock.now + 60_000 },
      action: { kind: 'recording', recording: 'export' },
      source: 'you'
    })
    clock.now += 61_000
    auto.tick()
    expect(started).toEqual([
      expect.objectContaining({ kind: 'recording_run', allow: ['recording_run'] })
    ])
    expect(auto.schedules.get('Export once')!.nextAt).toBeNull()
    clock.now += 24 * 3600_000
    auto.tick()
    expect(started).toHaveLength(1)
  })

  it('refuses a schedule for something that does not exist', () => {
    const { auto } = scheduler()
    const when = { kind: 'daily', time: '08:00' }
    for (const action of [
      { kind: 'recording', recording: 'nope' },
      { kind: 'watch', watch: 'nope' },
      { kind: 'task', agent: 'Nobody', prompt: 'x' },
      { kind: 'task', agent: 'Titan', prompt: '' },
      { kind: 'shell', command: 'rm -rf' }
    ])
      expect(() => auto.schedules.create({ name: 'x', when, action, source: 'you' })).toThrow()
    auto.schedules.create({
      name: 'One',
      when,
      action: { kind: 'task', agent: 'Titan', prompt: 'x' },
      source: 'you'
    })
    expect(() =>
      auto.schedules.create({
        name: 'one',
        when,
        action: { kind: 'task', agent: 'Titan', prompt: 'x' },
        source: 'you'
      })
    ).toThrow(/already/)
  })
})

describe('web watches', () => {
  it('compares lines and ignores dates and blanks', () => {
    const before = 'Act 1 on waste\nAct 2 on water\n24.11.2026\n\nFooter'
    const next = 'Act 3 on packaging\nAct 1 on waste\n25.11.2026\nFooter'
    expect(diffLines(before, next)).toEqual({
      added: ['Act 3 on packaging'],
      removed: ['Act 2 on water'],
      more: 0
    })
  })

  it('checks addresses', () => {
    expect(checkUrls(['laws.example/new', 'https://laws.example/new#top'])).toEqual([
      'https://laws.example/new'
    ])
    for (const bad of [
      [],
      ['file:///C:/x'],
      ['https://u:p@x.example'],
      Array(11)
        .fill(0)
        .map((_, i) => `https://a${i}.example`)
    ])
      expect(() => checkUrls(bad)).toThrow()
  })

  it('sets a starting point, then reports what changed', async () => {
    let now = 1000
    const store = createWatchStore({ db: openDb(':memory:'), now: () => now })
    const watch = store.save({
      name: 'Laws',
      urls: ['https://laws.example/new', 'https://laws.example/down'],
      about: 'waste and packaging',
      source: 'you'
    })
    const pages: Record<string, string> = { 'https://laws.example/new': 'Act 1 on waste' }
    const read = async (url: string): Promise<string> => {
      if (!pages[url]) throw new Error('The page answered 503.')
      return pages[url]
    }
    const first = await store.check(watch.id, read)
    expect(first.pages[0]).toMatchObject({ first: true, changed: false })
    // A page that can't be read is reported, not treated as a change.
    expect(first.pages[1]).toMatchObject({ changed: false, error: 'The page answered 503.' })
    expect(store.get('laws')!.lastChangedAt).toBeNull()

    now = 2000
    const same = await store.check('Laws', read)
    expect(same.pages[0]).toMatchObject({ first: false, changed: false })

    now = 3000
    pages['https://laws.example/new'] = 'Act 2 on packaging\nAct 1 on waste'
    const changed = await store.check('Laws', read)
    expect(changed.pages[0]).toMatchObject({ changed: true, added: ['Act 2 on packaging'] })
    expect(store.get('Laws')!.lastChangedAt).toBe(3000)
    expect(store.changes('Laws')).toEqual([
      { url: 'https://laws.example/new', at: 3000, added: ['Act 2 on packaging'], removed: [] }
    ])
    store.remove('Laws')
    expect(store.list()).toHaveLength(0)
  })
})

describe('recordings', () => {
  const event = (e: Partial<RecordedEvent>): RecordedEvent => ({
    kind: 'click',
    target: { css: 'button' },
    url: 'https://portal.example/login',
    at: 0,
    ...e
  })

  it('turns what was recorded into steps, without the password', () => {
    const user = { role: 'textbox' as const, name: 'Email', label: 'Email', css: '#email' }
    const pass = { role: 'textbox' as const, name: 'Password', label: 'Password', css: '#pw' }
    const steps = stepsFromEvents(
      [
        event({ kind: 'click', target: user }),
        event({ kind: 'fill', target: user, value: 'an' }),
        event({ kind: 'fill', target: user, value: 'ana@firm.example', username: true }),
        event({ kind: 'fill', target: pass, secret: true }),
        event({ kind: 'press', key: 'Enter', target: pass }),
        event({ kind: 'click', target: { role: 'link', name: 'Reports', text: 'Reports' } }),
        event({ kind: 'select', target: { role: 'combobox', label: 'Month' }, value: 'May' })
      ],
      'https://portal.example/login'
    )
    expect(steps.map((s) => s.action)).toEqual(['fill', 'fill_login', 'press', 'click', 'select'])
    expect(steps[0]).toMatchObject({ value: 'ana@firm.example' })
    expect(steps[1]).toMatchObject({ field: 'password', site: 'portal.example' })
    expect(JSON.stringify(steps)).not.toContain('secret')
    const recording = checkRecording(
      { name: 'reports', url: 'https://portal.example/login', steps },
      'you (recorded)'
    )
    expect(recording.steps.map(describeStep)[1]).toBe(
      'Fill textbox "Password" with the saved password for portal.example'
    )
  })

  it('checks steps and variables', () => {
    const base = { name: 'x', url: 'https://a.example' }
    const ok = checkRecording(
      {
        ...base,
        variables: [{ name: 'month', label: 'Month', default: 'May' }],
        steps: [
          { action: 'goto', url: '/reports?m={{month}}' },
          { action: 'click', text: 'Export', role: 'button' },
          { action: 'fill', label: 'Month', value: '{{month}}' },
          { action: 'pause' }
        ]
      },
      'an agent'
    )
    expect(ok.steps[0]).toEqual({ action: 'goto', url: 'https://a.example/reports?m={{month}}' })
    expect(ok.steps[1]).toEqual({
      action: 'click',
      target: { role: 'button', name: 'Export', text: 'Export' }
    })
    for (const bad of [
      { ...base, name: 'Bad Name', steps: [{ action: 'press', key: 'Enter' }] },
      { ...base, url: 'file:///C:/x', steps: [{ action: 'press', key: 'Enter' }] },
      { ...base, steps: [] },
      { ...base, steps: [{ action: 'eval', code: '1' }] },
      { ...base, steps: [{ action: 'click' }] },
      { ...base, steps: [{ action: 'press', key: 'F5' }] },
      { ...base, steps: [{ action: 'goto', url: 'javascript:alert(1)' }] },
      { ...base, steps: [{ action: 'fill', label: 'A', value: '{{missing}}' }] }
    ])
      expect(() => checkRecording(bad, 'x')).toThrow()
  })

  it('keeps recordings as files and skips broken ones', () => {
    const dir = tempFolder('titan117-recordings-')
    const store = createRecordingStore({ dir })
    store.save(
      checkRecording(
        { name: 'a', url: 'https://a.example', steps: [{ action: 'wait_text', text: 'Hi' }] },
        'you'
      )
    )
    expect(createRecordingStore({ dir }).get('a')?.steps).toHaveLength(1)
    store.remove('a')
    expect(store.list()).toHaveLength(0)
  })
})

describe('saved logins', () => {
  const keychain = {
    encrypt: (text: string) => Buffer.from(text, 'utf8').reverse(),
    decrypt: (data: Buffer) => Buffer.from(data).reverse().toString('utf8')
  }

  it('keeps logins encrypted and never hands a password to the window', () => {
    const dir = tempFolder('titan117-logins-')
    const logins = new SiteLogins(dir, keychain)
    expect(logins.set('https://www.Portal.example/login', 'ana', 'pw-not-real')).toEqual({
      ok: true
    })
    expect(logins.saved()).toEqual([{ site: 'portal.example', username: 'ana' }])
    expect(JSON.stringify(logins.saved())).not.toContain('pw-not-real')
    expect(new SiteLogins(dir, keychain).all()).toEqual({
      'portal.example': { username: 'ana', password: 'pw-not-real' }
    })
    expect(logins.set('not a site!', 'a', 'b').ok).toBe(false)
    expect(logins.set('a.example', '', 'b').ok).toBe(false)
    expect(logins.remove('portal.example')).toBe(true)
    expect(logins.saved()).toEqual([])
    // No keychain: nothing is written in the clear.
    expect(new SiteLogins(dir, null).set('a.example', 'a', 'b').ok).toBe(false)
    expect(siteOf('ftp://x')).toBeNull()
  })
})

describe('agents and tools', () => {
  it('gives the automation tools to the Web watcher, the Recorder and Titan only', () => {
    const tools = builtInTools.filter((t) => t.permissions.automation)
    expect(tools.map((t) => t.name).sort()).toEqual([
      'recording_list',
      'recording_run',
      'recording_save',
      'schedule_change',
      'schedule_create',
      'schedule_list',
      'watch_check',
      'watch_list',
      'watch_save'
    ])
    const allowed = BUILT_IN_AGENTS.filter((a) =>
      tools.every((t) => agentMayUse(a, t, { isPart: false }))
    ).map((a) => a.name)
    expect(allowed).toEqual(['Titan', 'Web watcher', 'Recorder'])
    // Standing instructions are answered on the laptop only.
    for (const name of ['schedule_create', 'recording_save'])
      expect(tools.find((t) => t.name === name)!.laptopOnly).toBe(true)
  })
})

describe('the engine', () => {
  it('a schedule made in plain words asks first, then shows on the screen', async () => {
    const model = scripted([
      {
        toolCalls: [
          {
            name: 'schedule_create',
            input: {
              name: 'Morning briefing',
              when: { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] },
              prompt: 'Brief me on new invoices in the Invoices folder.'
            }
          }
        ]
      },
      { text: 'Done: every weekday at 8.' }
    ])
    const engine = await testEngine({ fetch: model.fetch })
    try {
      const { body } = await call(engine, 'POST', '/v1/tasks', {
        text: 'Every weekday at 8, brief me on new invoices',
        model: MODEL
      })
      const approval = await until(
        () => engine.parts.store.listApprovals({ taskId: body.task.id, status: 'pending' })[0]
      )
      expect(approval.summary).toContain('Every weekday at 08:00')
      expect(approval.canAlways).toBe(false)
      expect(engine.parts.automation.schedules.list()).toHaveLength(0)
      await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
      await engine.parts.runtime.settled(body.task.id)
      const list = await call(engine, 'GET', '/v1/automations')
      expect(list.body.schedules).toEqual([
        expect.objectContaining({
          name: 'Morning briefing',
          whenText: 'Every weekday at 08:00',
          enabled: true
        })
      ])
      expect(list.body.schedules[0].source).toContain('Titan')
    } finally {
      await engine.close()
    }
  })

  it('a recording runs from the screen without a model; its final step waits for the user', async () => {
    const browser = fakeBrowser()
    const web = fakeWeb()
    const model = scripted([{ text: 'unused' }])
    const engine = await testEngine({
      fetch: model.fetch,
      toolFetch: web.fetch,
      browser: browser.host
    })
    try {
      const saved = await call(engine, 'POST', '/v1/automations/recording-save', {
        recording: {
          name: 'send-report',
          title: 'Send the monthly report',
          url: 'https://portal.example/reports',
          variables: [{ name: 'month', label: 'Month', default: 'May' }],
          steps: [
            { action: 'fill', label: 'Month', value: '{{month}}' },
            { action: 'click', role: 'button', text: 'Export' },
            { action: 'click', role: 'button', text: 'Send report' }
          ]
        }
      })
      expect(saved.status).toBe(200)
      expect(saved.body.recordings[0].stepsText[2]).toBe('Click button "Send report"')
      const run = await call(engine, 'POST', '/v1/automations/recording-run', {
        name: 'send-report',
        values: { month: 'June' }
      })
      const taskId: string = run.body.task.id
      // The click on Run was the OK for the replay; only the final step asks.
      const approval = await until(
        () => engine.parts.store.listApprovals({ taskId, status: 'pending' })[0]
      )
      expect(approval.summary).toContain('Send report')
      expect(browser.clicked).toEqual(['Export'])
      await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
      await engine.parts.runtime.settled(taskId)
      expect(browser.clicked).toEqual(['Export', 'Send report'])
      const task = engine.parts.store.getTask(taskId)!
      expect(task).toMatchObject({ status: 'done', agent: 'Recorder', model: 'none' })
      // No model was called.
      expect(model.requests).toHaveLength(0)
      // A bad edit is refused and nothing changes.
      const bad = await call(engine, 'POST', '/v1/automations/recording-save', {
        recording: {
          name: 'send-report',
          url: 'https://portal.example',
          steps: [{ action: 'eval' }]
        }
      })
      expect(bad.status).toBe(400)
    } finally {
      await engine.close()
    }
  })

  it('a watch check reads without a model and asks the agent only when something changed', async () => {
    const web = fakeWeb({
      'https://laws.example/new': '<html><body><p>Act 1 on waste management</p></body></html>'
    })
    const model = scripted([
      { text: 'A new act on packaging matters to you: https://laws.example/new' }
    ])
    const engine = await testEngine({ fetch: model.fetch, toolFetch: web.fetch })
    try {
      await call(engine, 'PUT', '/v1/settings', { defaultModel: MODEL })
      const made = await call(engine, 'POST', '/v1/automations/watch', {
        name: 'Laws',
        urls: ['https://laws.example/new'],
        about: 'packaging'
      })
      const id: string = made.body.watches[0].id
      const first = await call(engine, 'POST', '/v1/automations/watch-check', { id })
      await engine.parts.runtime.settled(first.body.task.id)
      await until(() => engine.parts.automation.watches.get(id)?.lastCheckedAt ?? undefined)
      expect(engine.parts.store.getTask(first.body.task.id)).toMatchObject({
        status: 'done',
        agent: 'Web watcher'
      })
      expect(model.requests).toHaveLength(0)

      // The page changes: the next check reads it again and the agent says what matters.
      web.pages.set(
        'https://laws.example/new',
        '<html><body><p>Act 2 on packaging waste</p><p>Act 1 on waste management</p></body></html>'
      )
      const schedule = await call(engine, 'POST', '/v1/automations/schedule', {
        name: 'Laws weekly',
        when: { kind: 'daily', time: '09:00', days: [1] },
        action: { kind: 'watch', watch: 'Laws' }
      })
      expect(schedule.body.schedules[0].actionText).toBe('Check the watch "Laws"')
      const ran = await call(engine, 'POST', '/v1/automations/schedule-run', {
        id: schedule.body.schedules[0].id
      })
      const taskId: string = ran.body.schedules[0].lastTaskId
      await until(() => (model.requests.length ? true : undefined))
      await until(() => (engine.parts.store.getTask(taskId)?.status === 'done' ? true : undefined))
      const messages = engine.parts.store.listMessages(taskId).map((m) => m.message)
      expect(messages.find((m) => m.role === 'tool')).toMatchObject({ name: 'watch_check' })
      expect(JSON.stringify(messages)).toContain('+ Act 2 on packaging waste')
      expect(messages.at(-1)).toMatchObject({ role: 'assistant' })
      expect(model.requests).toHaveLength(1)
      const list = await call(engine, 'GET', '/v1/automations')
      expect(list.body.watches[0].changes[0].added).toEqual(['Act 2 on packaging waste'])
    } finally {
      await engine.close()
    }
  })
})
