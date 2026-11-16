// Phase 4 leftovers and auto-update: several artifacts as one ZIP (17.21,
// 17.22), comments on shared pages from the owner's side (17.14), and
// auto-update staying off until it's set up (1.10; decisions §50).
import { afterEach, describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'

import type { Engine } from '../src/engine/lib/engine'
import { zipArtifacts } from '../src/engine/lib/convert'
import { createShareService } from '../src/engine/lib/share'
import { startUpdates } from '../src/main/lib/updates'
import { call, testEngine } from './helpers'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

describe('several artifacts as one ZIP (17.21, 17.22)', () => {
  it('each artifact in its own folder, in its best format or every format', async () => {
    const doc = {
      artifact: { kind: 'document' as const, title: 'Offer' },
      content: '# Offer\n\n| a | b |\n|---|---|\n| 1 | 2 |'
    }
    const sheet = {
      artifact: { kind: 'spreadsheet' as const, title: 'Offer' },
      content: JSON.stringify({ columns: ['a'], rows: [[1]] })
    }
    const best = unzipSync(new Uint8Array(await zipArtifacts([doc, sheet], false)))
    expect(Object.keys(best).sort()).toEqual(['Offer 2/Offer.xlsx', 'Offer/Offer.docx'])
    const every = unzipSync(new Uint8Array(await zipArtifacts([{ ...doc, version: 2 }], true)))
    expect(Object.keys(every).sort()).toEqual([
      'Offer/Offer v2.docx',
      'Offer/Offer v2.html',
      'Offer/Offer v2.md',
      'Offer/Offer v2.txt',
      'Offer/Offer v2.xlsx'
    ])
    expect(strFromU8(every['Offer/Offer v2.md'])).toContain('# Offer')
  })

  it('through the engine, an older version too', async () => {
    engine = await testEngine()
    const a = (
      await call(engine, 'POST', '/v1/artifacts', {
        kind: 'document',
        title: 'Plan',
        content: '# One'
      })
    ).body.artifact
    await call(engine, 'PUT', `/v1/artifacts/${a.id}`, { content: '# Two' })
    const zip = await call(engine, 'POST', '/v1/artifacts/zip', {
      items: [{ id: a.id, version: 1 }],
      every: false
    })
    expect(zip.body.name).toBe('Plan.zip')
    const files = unzipSync(new Uint8Array(Buffer.from(zip.body.base64, 'base64')))
    expect(Object.keys(files)).toEqual(['Plan/Plan v1.docx'])
    expect((await call(engine, 'POST', '/v1/artifacts/zip', { items: [] })).status).toBe(400)
    expect(
      (await call(engine, 'POST', '/v1/artifacts/zip', { items: [{ id: 'nope' }] })).status
    ).toBe(404)
  })
})

describe('comments on shared pages, the owner’s side (17.14)', () => {
  it('lists, replies and hides through our web app with the device token', async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string }[] = []
    const shares = createShareService({
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body ?? '{}')),
          auth: String((init?.headers as Record<string, string>).Authorization)
        })
        return Response.json({
          comments: [
            { id: 'c1', name: 'Ana', text: 'Typo', fromOwner: false, at: 1, hidden: false }
          ]
        })
      }) as typeof fetch,
      account: () => ({ token: 't117d_x', apiBase: 'https://titan117.test/api/v1' })
    })
    const list = await shares.comments('Pub_1', { op: 'reply', text: 'Thanks' })
    expect(list).toHaveLength(1)
    expect(calls.map((c) => c.body.op)).toEqual(['reply', 'list'])
    expect(calls[0]).toMatchObject({
      url: 'https://titan117.test/api/v1/shares/Pub_1/comments/owner',
      auth: 'Bearer t117d_x'
    })
  })

  it('an artifact that isn’t shared has no comments to show', async () => {
    engine = await testEngine()
    const a = (
      await call(engine, 'POST', '/v1/artifacts', { kind: 'document', title: 'P', content: '# P' })
    ).body.artifact
    expect((await call(engine, 'GET', `/v1/artifacts/${a.id}/comments`)).status).toBe(400)
  })
})

describe('auto-update (1.10)', () => {
  it('stays off from source and without an https update address', () => {
    const states: string[] = []
    expect(
      startUpdates({
        packaged: false,
        url: 'https://u.example',
        onChange: (s) => states.push(s.state)
      }).state()
    ).toMatchObject({ state: 'off' })
    expect(
      startUpdates({ packaged: true, url: null, onChange: () => undefined }).state()
    ).toMatchObject({ state: 'off', why: 'No update address yet.' })
    expect(
      startUpdates({ packaged: true, url: 'http://u.example', onChange: () => undefined }).state()
        .state
    ).toBe('off')
  })
})
