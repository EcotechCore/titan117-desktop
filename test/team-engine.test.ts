// Teams on the real engine (decisions §68.13): the sync routes the shell
// calls are reachable (they weren't: `/v1/sync/apps` read `apps` as an id),
// a shared app travels as its source without secrets or installed packages,
// lands only in a new allowed folder, and a viewer's copy can't be changed.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createDataLayer } from '../src/engine/lib/apps/data'
import { checkBundle, packApp, readOnlyFor } from '../src/engine/lib/apps/team-share'
import type { Engine } from '../src/engine/lib/engine'
import { call, tempFolder, testEngine } from './helpers'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

function sampleApp(): string {
  const dir = tempFolder()
  writeFileSync(join(dir, 'package.json'), '{"name":"crm"}')
  writeFileSync(join(dir, 'titan.json'), '{"name":"CRM","collections":["clients"]}')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'main.ts'), 'console.log("crm")')
  writeFileSync(join(dir, '.env'), 'API_KEY=secret-value')
  writeFileSync(join(dir, 'server.pem'), 'secret')
  for (const skip of ['node_modules', 'dist', '.git']) {
    mkdirSync(join(dir, skip))
    writeFileSync(join(dir, skip, 'x.js'), 'skip me')
  }
  return dir
}

describe('the sync routes on the real engine', () => {
  it('answers /v1/sync/apps and /v1/sync/tasks', async () => {
    engine = await testEngine({})
    expect(await call(engine, 'GET', '/v1/sync/apps')).toMatchObject({
      status: 200,
      body: { apps: [] }
    })
    expect((await call(engine, 'GET', '/v1/sync/tasks?since=0&limit=5')).status).toBe(200)
    expect((await call(engine, 'GET', '/v1/sync/apps/crm?since=0')).status).toBe(200)
  })

  it('keeps the apps a viewer may not change, and refuses anything else', async () => {
    engine = await testEngine({})
    const put = await call(engine, 'PUT', '/v1/sync/read-only', {
      apps: { crm: 'Acme', 'Bad App!': 'x' }
    })
    expect(put.body).toEqual({ apps: { crm: 'Acme' } })
  })
})

describe('a shared app', () => {
  it('travels as its source, without secrets, packages, builds or git', () => {
    const bundle = packApp(sampleApp(), {
      id: 'crm',
      title: 'CRM',
      manifest: { reads: [], writes: [], ai: false }
    })
    expect(bundle.files.map((f) => f.path).sort()).toEqual([
      'package.json',
      'src/main.ts',
      'titan.json'
    ])
    expect(JSON.stringify(bundle)).not.toContain(
      Buffer.from('API_KEY=secret-value').toString('base64')
    )
  })

  it('refuses a bundle that would write outside its folder or a secret file', () => {
    const ok = {
      type: 'app',
      id: 'crm',
      title: 'CRM',
      manifest: {},
      files: [{ path: 'package.json', data: 'e30=' }]
    }
    expect(checkBundle(ok).files).toHaveLength(1)
    for (const path of [
      '../evil.js',
      '/abs.js',
      'a/../../b',
      '.env',
      'src/.env.local',
      'C:/x',
      'key.pem',
      'a\\b.js'
    ])
      expect(() => checkBundle({ ...ok, files: [{ path, data: 'eA==' }] }), path).toThrow()
    expect(() => checkBundle({ ...ok, id: '../crm' })).toThrow()
  })

  it('is copied only into a new folder inside the allowed folders, after the click', async () => {
    const allowed = tempFolder()
    engine = await testEngine({ folder: allowed })
    const bundle = packApp(sampleApp(), {
      id: 'crm',
      title: 'CRM',
      manifest: { reads: [], writes: [], ai: false }
    })
    const target = join(allowed, 'crm-from-bo')
    const done = await call(engine, 'POST', '/v1/sync/unpack', { bundle, folder: target })
    expect(done.status).toBe(200)
    expect(readFileSync(join(target, 'src', 'main.ts'), 'utf8')).toBe('console.log("crm")')
    expect(existsSync(join(target, '.env'))).toBe(false)
    // Not into a folder with files in it, and never outside the allowed folders.
    expect((await call(engine, 'POST', '/v1/sync/unpack', { bundle, folder: target })).status).toBe(
      400
    )
    const outside = join(tempFolder(), 'crm')
    expect(
      (await call(engine, 'POST', '/v1/sync/unpack', { bundle, folder: outside })).status
    ).toBeGreaterThanOrEqual(400)
    expect(existsSync(outside)).toBe(false)
  })
})

describe('a viewer’s copy of a shared app', () => {
  it('can’t be changed here, while the team’s changes still arrive', () => {
    const raw = createDataLayer(tempFolder())
    const data = readOnlyFor(raw, (app) => (app === 'crm' ? 'Acme' : null))
    expect(() => data.insert('crm', 'clients', { name: 'x' })).toThrow(/viewer/)
    expect(() => data.update('crm', 'clients', 'c1', { name: 'x' })).toThrow(/viewer/)
    expect(() => data.remove('crm', 'clients', 'c1')).toThrow(/viewer/)
    expect(data.insert('stock', 'items', { name: 'ok' })).toBeTruthy()
    expect(
      data.applyRemote('crm', {
        collection: 'clients',
        id: 'c1',
        op: 'put',
        at: 5,
        data: { name: 'From Bo' }
      })
    ).toBe(true)
    expect(
      data
        .list('crm', 'clients')
        .map((r) => (r as { name?: string }).name ?? (r as { data?: { name?: string } }).data?.name)
    ).toContain('From Bo')
    raw.close()
  })
})
