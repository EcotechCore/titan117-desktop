// Offline (features 1.22, 1.24; decisions §17, §47): the engine notices,
// cloud tasks stop cleanly instead of failing, online-only features say why,
// and what waited goes once the internet is back. The 14-day lease is tested
// in account.test.ts ("offline, the lease it has keeps working until it expires").
import { afterEach, describe, expect, it } from 'vitest'

import type { Engine } from '../src/engine/lib/engine'
import { createConnectivity, isNetworkFailure, OFFLINE_NOTE } from '../src/engine/lib/online'
import { createSearchService } from '../src/engine/lib/search'
import { createShareService } from '../src/engine/lib/share'
import { call, MODEL, scripted, tempFolder, testEngine, until } from './helpers'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

const down = (async () => {
  throw new TypeError('fetch failed')
}) as unknown as typeof fetch

describe('noticing the network', () => {
  it('tells a network failure from a refusal, a cancel or our own block', () => {
    expect(isNetworkFailure(new TypeError('fetch failed'))).toBe(true)
    expect(isNetworkFailure(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }))).toBe(
      true
    )
    expect(isNetworkFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false)
    expect(isNetworkFailure(Object.assign(new Error('blocked'), { name: 'NetworkError' }))).toBe(
      false
    )
    expect(isNetworkFailure(new Error('OpenRouter answered 500.'))).toBe(false)
  })

  it('goes offline on a failed request and back online when the probe gets any answer', async () => {
    const changes: boolean[] = []
    let up = false
    const c = createConnectivity({
      fetch: (async () => {
        if (!up) throw new TypeError('fetch failed')
        return new Response('', { status: 401 })
      }) as typeof fetch,
      onChange: (online) => changes.push(online)
    })
    const tracked = c.track(down)
    await expect(tracked('https://openrouter.ai/x')).rejects.toThrow()
    expect(c.online()).toBe(false)
    expect(await c.probe()).toBe(false)
    up = true
    // Even an error page means the internet works.
    expect(await c.probe()).toBe(true)
    expect(changes).toEqual([false, true])
    c.close()
  })
})

describe('working offline', () => {
  it('a cloud task stops cleanly with a plain note, not an error to report', async () => {
    engine = await testEngine({ fetch: down })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'hello', model: MODEL })
    await until(() => !engine!.parts.runtime.isRunning(body.task.id), 10_000)
    const task = (await call(engine, 'GET', `/v1/tasks/${body.task.id}`)).body.task
    expect(task).toMatchObject({ status: 'stopped', note: OFFLINE_NOTE })
    expect(engine.parts.events).toContainEqual({ type: 'online', online: false })
    expect(engine.parts.events.some((e) => e.type === 'error')).toBe(false)
    expect((await call(engine, 'GET', '/v1/state')).body.online).toBe(false)

    // The next cloud step doesn't even try while offline.
    await call(engine, 'POST', `/v1/tasks/${body.task.id}/messages`, { text: 'again' })
    await until(() => !engine!.parts.runtime.isRunning(body.task.id), 10_000)
    expect((await call(engine, 'GET', `/v1/tasks/${body.task.id}`)).body.task.note).toBe(
      OFFLINE_NOTE
    )
  })

  it('a web page while offline says so; the model then stops at its next step; back online, waiting reports go', async () => {
    const or = scripted([
      { toolCalls: [{ name: 'web_fetch', input: { url: 'https://docs.example.com/' } }] },
      { text: 'Done.' }
    ])
    const posted: string[] = []
    let probeUp = false
    const modelFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/key')) {
        if (!probeUp) throw new TypeError('fetch failed')
        return new Response('', { status: 401 })
      }
      if (url.includes('/error-reports')) {
        if (!probeUp) throw new TypeError('fetch failed')
        posted.push(url)
        return Response.json(url.endsWith('/fixed') ? { fixed: [] } : { ref: 'T117-000001' })
      }
      return or.fetch(input, init)
    }) as typeof fetch
    engine = await testEngine({ dataDir: tempFolder(), fetch: modelFetch, toolFetch: down })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'Read https://docs.example.com/',
      model: MODEL
    })
    await until(() => !engine!.parts.runtime.isRunning(body.task.id), 20_000)
    const done = (await call(engine, 'GET', `/v1/tasks/${body.task.id}`)).body
    const page = done.messages
      .map((m: { message: unknown }) => m.message)
      .find((m: { role: string; name?: string }) => m.role === 'tool' && m.name === 'web_fetch')
    expect(page.output).toMatch(/^No internet connection/)
    expect(done.task).toMatchObject({ status: 'stopped', note: OFFLINE_NOTE })

    // A report made offline waits, then goes by itself once the probe gets through.
    engine.setAccount({
      token: 't117d_' + 'o'.repeat(43),
      proxyUrl: 'https://titan117.test/api/v1',
      locked: false,
      reason: null
    })
    const draft = (await call(engine, 'POST', '/v1/reports', { feature: 'report a problem' })).body
      .report
    posted.length = 0
    const queued = (await call(engine, 'POST', `/v1/reports/${draft.id}/send`, { note: '' })).body
      .report
    expect(queued.status).toBe('queued')
    probeUp = true
    expect(await engine.parts.connectivity.probe()).toBe(true)
    await until(() => posted.some((u) => u.endsWith('/error-reports')))
    expect((await call(engine, 'GET', '/v1/state')).body.online).toBe(true)
  })

  it('search and sharing say they need the internet', async () => {
    const search = createSearchService({
      fetch: down,
      cloud: () => null,
      keys: () => ({ exa: 'k' }),
      settings: () => ({ source: 'auto', country: '', language: '', sites: {} }),
      pickModel: async () => 'm'
    })
    await expect(search.forAgent('Titan', () => undefined).search({ query: 'x' })).rejects.toThrow(
      /^No internet connection: web search needs it/
    )
    const shares = createShareService({
      fetch: down,
      account: () => ({ token: 't117d_x', apiBase: 'https://titan117.test/api/v1' })
    })
    await expect(shares.share({ title: 't', kind: 'document', html: '<p>x</p>' })).rejects.toThrow(
      /^No internet connection: sharing needs it/
    )
  })
})
