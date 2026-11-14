// The local API (guardrails §6): localhost only, the per-install token on
// every request, and web pages (other origins) refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { request } from 'http'
import { join } from 'path'

import type { Engine } from '../src/engine/lib/engine'
import { installToken } from '../src/engine/lib/server'
import { call, MODEL, ORIGIN, scripted, tempFolder, testEngine, until } from './helpers'

let engine: Engine
beforeAll(async () => {
  engine = await testEngine({ fetch: scripted([{ text: 'ok' }]).fetch })
})
afterAll(() => engine.close())

function raw(
  path: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: engine.port, path, method: 'GET', headers },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

describe('who may call', () => {
  it('refuses a request with no token', async () => {
    const response = await fetch(`http://127.0.0.1:${engine.port}/v1/state`)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'UNAUTHENTICATED' })
  })

  it('refuses a wrong token', async () => {
    const response = await call(engine, 'GET', '/v1/state', undefined, {
      Authorization: `Bearer ${'0'.repeat(64)}`
    })
    expect(response.status).toBe(401)
  })

  it('refuses the events stream without the token', async () => {
    const response = await fetch(`http://127.0.0.1:${engine.port}/v1/events`)
    expect(response.status).toBe(401)
  })

  it.each(['https://evil.example', 'http://localhost:3000', 'null', 'file://'])(
    'refuses a web page from %s, even with the token',
    async (origin) => {
      const response = await call(engine, 'GET', '/v1/state', undefined, { Origin: origin })
      expect(response.status).toBe(403)
      expect(response.body).toEqual({ error: 'FORBIDDEN_ORIGIN' })
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  )

  it('refuses a preflight from another origin', async () => {
    const response = await fetch(`http://127.0.0.1:${engine.port}/v1/tasks`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' }
    })
    expect(response.status).toBe(403)
  })

  it('refuses a host name that only points at this laptop (DNS rebinding)', async () => {
    const response = await raw('/v1/state', {
      Host: 'evil.example',
      Authorization: `Bearer ${engine.token}`
    })
    expect(response.status).toBe(403)
  })

  it("answers the app's own window", async () => {
    const response = await call(engine, 'GET', '/v1/state', undefined, { Origin: ORIGIN })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(response.body).toMatchObject({ apiVersion: 1, cloudKey: true, folders: [] })
    // The state says a key exists; it never carries the key or the token.
    expect(JSON.stringify(response.body)).not.toContain(engine.token)
    expect(JSON.stringify(response.body)).not.toContain('sk-or-')
  })

  it('listens on 127.0.0.1 only', () => {
    const source = readFileSync(join(__dirname, '../src/engine/lib/server.ts'), 'utf8')
    expect(source).toMatch(/server\.listen\(options\.port \?\? 0, '127\.0\.0\.1'/)
    expect(source).not.toMatch(/0\.0\.0\.0|listen\([^,)]*\)/)
  })
})

describe('what it answers', () => {
  it('has no route that changes the allowed folders', async () => {
    for (const method of ['POST', 'PUT', 'DELETE'])
      for (const path of ['/v1/folders', '/v1/settings/folders', '/v1/state'])
        expect((await call(engine, method, path, { path: 'C:/' })).status).toBe(404)
    const settings = await call(engine, 'PUT', '/v1/settings', {
      defaultModel: MODEL,
      folders: ['C:/']
    })
    expect(settings.status).toBe(200)
    expect((await call(engine, 'GET', '/v1/state')).body.folders).toEqual([])
  })

  it('answers with codes, never stack traces', async () => {
    const missing = await call(engine, 'GET', '/v1/tasks/nope')
    expect(missing).toMatchObject({ status: 404, body: { error: 'NOT_FOUND' } })

    const noModel = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: 'gpt' })
    expect(noModel).toMatchObject({ status: 400, body: { error: 'BAD_REQUEST' } })

    const empty = await call(engine, 'POST', '/v1/tasks', { text: '  ', model: MODEL })
    expect(empty.status).toBe(400)

    const badAnswer = await call(engine, 'POST', '/v1/approvals/x', { answer: 'maybe' })
    expect(badAnswer.status).toBe(400)

    const noApproval = await call(engine, 'POST', '/v1/approvals/x', { answer: 'approve' })
    expect(noApproval).toMatchObject({ status: 404, body: { error: 'NOT_FOUND' } })

    const badJson = await fetch(`http://127.0.0.1:${engine.port}/v1/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${engine.token}` },
      body: '{not json'
    })
    expect(badJson.status).toBe(400)

    for (const r of [missing, noModel, empty, badAnswer, noApproval])
      expect(JSON.stringify(r.body)).not.toMatch(/\.ts|at \w+ \(/)
  })

  it('streams events to the window', async () => {
    const response = await fetch(`http://127.0.0.1:${engine.port}/v1/events`, {
      headers: { Authorization: `Bearer ${engine.token}`, Origin: ORIGIN }
    })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        seen += decoder.decode(value)
      }
    })()
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL })
    await until(() => seen.includes('"status":"done"'))
    expect(seen).toContain('"type":"delta"')
    expect(seen).toContain(body.task.id)
    await reader.cancel()
    await reading
  })

  it('estimates the cost before a task runs', async () => {
    const cloud = await call(engine, 'POST', '/v1/estimate', { model: MODEL, text: 'hello' })
    expect(cloud.body.free).toBe(false)
    expect(cloud.body.usd).toBeGreaterThan(0)
    const local = await call(engine, 'POST', '/v1/estimate', {
      model: 'local:qwen2.5-1.5b-instruct-q4_k_m',
      text: 'hello'
    })
    expect(local.body).toMatchObject({ free: true, usd: 0 })
  })

  it('lists only cloud models that can use tools', async () => {
    const { body } = await call(engine, 'GET', '/v1/models')
    expect(body.cloud.map((m: { id: string }) => m.id)).toEqual(['test/model'])
    expect(body.local.length).toBeGreaterThan(0)
  })
})

describe('the per-install token', () => {
  it('is made once and kept', () => {
    const dir = tempFolder()
    const first = installToken(dir)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(installToken(dir)).toBe(first)
    expect(installToken(tempFolder())).not.toBe(first)
  })
})
