// Error reports (features 19.1-19.11; decisions §22, §45): built from a
// caught error, shown in full, nothing private in them, queued while offline
// or signed out, sent on sign-in, and "Fixed in" followed up.
import { afterEach, describe, expect, it } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

import type { Engine } from '../src/engine/lib/engine'
import { tidyPaths } from '../src/engine/lib/reports'
import { call, FAKE_KEY, MODEL, scripted, tempFolder, testEngine, until } from './helpers'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

const TOKEN = 't117d_' + 'r'.repeat(43)
const PROMPT = 'Client Popescu owes 91,300 EUR, keep this private'

/** Our web app, faked: records what arrives and answers like the real routes. */
function fakeServer(): {
  fetch: typeof fetch
  posts: { url: string; body: Record<string, unknown> }[]
} {
  const posts: { url: string; body: Record<string, unknown> }[] = []
  const or = scripted([{ text: 'Done.' }])
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/error-reports')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      posts.push({ url, body })
      if (url.endsWith('/fixed'))
        return Response.json({
          fixed: (body.refs as string[]).map((ref) => ({ ref, fixedIn: '0.5' }))
        })
      return Response.json({ ref: `T117-${String(posts.length).padStart(6, '0')}` })
    }
    return or.fetch(input, init)
  }) as typeof fetch
  return { fetch: fake, posts }
}

describe('error reports', () => {
  it('a report holds the error and redacted log lines, never prompts, keys or the home folder', async () => {
    const server = fakeServer()
    engine = await testEngine({ dataDir: tempFolder(), fetch: server.fetch })
    const task = await call(engine, 'POST', '/v1/tasks', { text: PROMPT, model: MODEL })
    await until(() => !engine!.parts.runtime.isRunning(task.body.task.id), 20_000)
    const id = engine.parts.log.capture(
      'tool',
      new Error(`Could not open ${join(homedir(), 'Clients', 'offer.docx')} with key ${FAKE_KEY}`)
    )

    const { body } = await call(engine, 'POST', '/v1/reports', { errorRef: id.slice(0, 8) })
    const report = body.report.report
    expect(report.feature).toBe('tool')
    expect(report.message).toContain(join('~', 'Clients', 'offer.docx'))
    expect(report.logLines.length).toBeGreaterThan(0)
    const all = JSON.stringify(body)
    expect(all).not.toContain(FAKE_KEY)
    expect(all).not.toContain(homedir())
    expect(all).not.toContain('Popescu')
    // Nothing has left the laptop yet.
    expect(server.posts).toEqual([])
  })

  it('waits in the queue while signed out, then sends exactly what was shown, with the note', async () => {
    const server = fakeServer()
    engine = await testEngine({ dataDir: tempFolder(), fetch: server.fetch })
    const id = engine.parts.log.capture('runtime', new Error('Something broke'))
    const draft = (await call(engine, 'POST', '/v1/reports', { errorRef: id })).body.report
    const queued = (
      await call(engine, 'POST', `/v1/reports/${draft.id}/send`, { note: `It broke. ${FAKE_KEY}` })
    ).body.report
    expect(queued).toMatchObject({ status: 'queued', ref: null })
    expect(queued.problem).toMatch(/sign in/)
    expect(server.posts).toEqual([])

    engine.setAccount({
      token: TOKEN,
      proxyUrl: 'https://titan117.test/api/v1',
      locked: false,
      reason: null
    })
    await until(() => server.posts.some((p) => p.url.endsWith('/fixed')))
    const sent = server.posts.find((p) => p.url === 'https://titan117.test/api/v1/error-reports')!
    expect(sent.body).toEqual({ ...draft.report, note: 'It broke. [redacted]' })
    const list = (await call(engine, 'GET', '/v1/reports')).body.reports
    expect(list[0]).toMatchObject({ status: 'sent', ref: 'T117-000001', fixedIn: '0.5' })
  })

  it('"send automatically" sends a caught error by itself, at most once a minute; "ask" and "never" don\u2019t', async () => {
    const server = fakeServer()
    engine = await testEngine({ dataDir: tempFolder(), fetch: server.fetch })
    engine.setAccount({
      token: TOKEN,
      proxyUrl: 'https://titan117.test/api/v1',
      locked: false,
      reason: null
    })
    expect((await call(engine, 'GET', '/v1/reports')).body.mode).toBe('ask')
    engine.parts.log.capture('runtime', new Error('asked, not sent'))
    await call(engine, 'PUT', '/v1/reports', { mode: 'never' })
    engine.parts.log.capture('runtime', new Error('never sent'))
    await new Promise((r) => setTimeout(r, 50))
    expect(server.posts.filter((p) => p.url.endsWith('/error-reports'))).toEqual([])

    await call(engine, 'PUT', '/v1/reports', { mode: 'auto' })
    engine.parts.log.capture('runtime', new Error('sent automatically'))
    engine.parts.log.capture('runtime', new Error('too soon after the last one'))
    await until(() => server.posts.some((p) => p.url.endsWith('/error-reports')))
    await new Promise((r) => setTimeout(r, 50))
    const sent = server.posts.filter((p) => p.url.endsWith('/error-reports'))
    expect(sent).toHaveLength(1)
    expect(sent[0].body.message).toBe('sent automatically')
    expect((await call(engine, 'PUT', '/v1/reports', { mode: 'loud' })).status).toBe(400)
  })

  it('every caught error tells the window, so it can offer a report', async () => {
    engine = await testEngine()
    const id = engine.parts.log.capture('browser', new Error('x'))
    expect(engine.parts.events).toContainEqual({ type: 'error', errorId: id, source: 'browser' })
  })

  it('refuses an error that isn\u2019t in the local log, and "Report a problem" works without one', async () => {
    engine = await testEngine()
    expect((await call(engine, 'POST', '/v1/reports', { errorRef: 'deadbeef' })).status).toBe(400)
    const free = await call(engine, 'POST', '/v1/reports', { feature: 'report a problem' })
    expect(free.body.report.report).toMatchObject({ feature: 'report a problem', message: '' })
    // A draft the user didn't send can be dropped; a sent one can't be.
    expect((await call(engine, 'DELETE', `/v1/reports/${free.body.report.id}`)).status).toBe(200)
  })

  it('the home folder becomes ~ in every spelling', () => {
    expect(
      tidyPaths(
        'C:\\Users\\ana\\x and C:/Users/ana/y and C:\\\\Users\\\\ana\\\\z',
        'C:\\Users\\ana'
      )
    ).toBe('~\\x and ~/y and ~\\\\z')
  })
})
