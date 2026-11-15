// Setup and health (features 1.4, 1.12, 1.13, 1.20, 1.21): the checklist,
// the health check of saved keys, the first-launch state and disk use.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { Engine } from '../src/engine/lib/engine'
import {
  checklist,
  createSetupService,
  diskOf,
  folderBytes,
  type SetupFacts
} from '../src/engine/lib/setup'
import { call, tempFolder, testEngine } from './helpers'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

const GB = 1024 ** 3

function facts(extra: Partial<SetupFacts> = {}): SetupFacts {
  return {
    dataDir: null,
    signedIn: true,
    locked: false,
    lockReason: null,
    cloud: true,
    defaultModel: 'openrouter:x',
    hardware: { ramBytes: 16 * GB, vramBytes: 0, gpu: null },
    localProblem: null,
    localModels: [
      { id: 'small', name: 'Small', fit: 'runs well', state: 'not downloaded', sizeBytes: 1 * GB },
      { id: 'mid', name: 'Middle', fit: 'runs well', state: 'not downloaded', sizeBytes: 4 * GB },
      { id: 'big', name: 'Big', fit: 'too big', state: 'not downloaded', sizeBytes: 40 * GB }
    ],
    folders: ['C:/work'],
    ownKeys: {},
    browser: 'msedge',
    connectors: [],
    queuedReports: 0,
    errorsToday: 0,
    interests: [],
    ...extra
  }
}

const byId = (
  list: ReturnType<typeof checklist>,
  id: string
): ReturnType<typeof checklist>[number] | undefined => list.find((c) => c.id === id)

describe('the setup checklist (1.20)', () => {
  it('a ready laptop has nothing to fix, and suggests the largest local model that runs well', () => {
    const list = checklist(facts())
    expect(list.filter((c) => c.status === 'problem' || c.status === 'missing')).toEqual([])
    expect(byId(list, 'local')).toMatchObject({ status: 'suggested' })
    expect(byId(list, 'local')!.detail).toMatch(/^Middle runs well/)
  })

  it('says what is missing, each with how to fix it', () => {
    const list = checklist(
      facts({
        signedIn: false,
        cloud: false,
        defaultModel: null,
        folders: [],
        browser: null,
        interests: ['research', 'documents'],
        connectors: [{ name: 'Notion', status: 'error', error: 'Refused the token.' }]
      })
    )
    expect(byId(list, 'account')).toMatchObject({ status: 'problem', fix: { kind: 'account' } })
    expect(byId(list, 'model')).toMatchObject({
      status: 'missing',
      fix: { kind: 'view', target: 'models' }
    })
    expect(byId(list, 'search')).toMatchObject({ status: 'missing', fix: { target: 'search' } })
    expect(byId(list, 'folders')).toMatchObject({ status: 'missing', fix: { kind: 'folder' } })
    expect(byId(list, 'browser')).toMatchObject({ status: 'missing', fix: { kind: 'link' } })
    expect(byId(list, 'connector-Notion')).toMatchObject({
      status: 'problem',
      detail: 'Refused the token.'
    })
  })

  it('shows only what the chosen uses need', () => {
    const research = checklist(facts({ folders: [], interests: ['research'] }))
    expect(byId(research, 'folders')).toBeUndefined()
    expect(byId(research, 'search')).toMatchObject({ status: 'ready' })
    const apps = checklist(facts({ interests: ['apps'] }))
    expect(byId(apps, 'search')).toBeUndefined()
  })

  it('offers cloud models when local ones can\u2019t run here (1.18)', () => {
    const list = checklist(facts({ localProblem: 'No AVX2 support.' }))
    expect(byId(list, 'local')).toMatchObject({
      status: 'suggested',
      fix: { label: 'See cloud models' }
    })
    // An old or missing Visual C++ runtime: Microsoft's own link (decisions §49).
    const runtime = checklist(
      facts({ localProblem: 'Install the latest Microsoft Visual C++ runtime (x64).' })
    )
    expect(byId(runtime, 'local')!.fix).toMatchObject({
      kind: 'link',
      target: 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
    })
  })
})

describe('the health check (1.21)', () => {
  it('tries each saved model key with its provider; a refused one is a problem; search keys cost a search, so they are left alone', async () => {
    const calls: string[] = []
    const service = createSetupService({
      done: () => true,
      facts: async () =>
        facts({ ownKeys: { openrouter: 'or-key', openai: 'oa-key', exa: 'exa-key' } }),
      fetch: (async (url: string) => {
        calls.push(String(url))
        return new Response('{}', { status: String(url).includes('openrouter') ? 401 : 200 })
      }) as typeof fetch
    })
    const state = await service.runHealth()
    expect(calls.sort()).toEqual([
      'https://api.openai.com/v1/models',
      'https://openrouter.ai/api/v1/key'
    ])
    expect(byId(state.checks, 'key-openrouter')).toMatchObject({ status: 'problem' })
    expect(byId(state.checks, 'key-openai')).toBeUndefined()
    expect(state.checkedAt).toBeTypeOf('number')
    // The result stays until the next check.
    expect(byId((await service.state()).checks, 'key-openrouter')).toBeTruthy()
  })

  it('an unreachable provider is not reported as a broken key', async () => {
    const service = createSetupService({
      done: () => true,
      facts: async () => facts({ ownKeys: { anthropic: 'k' } }),
      fetch: (async () => {
        throw new Error('offline')
      }) as typeof fetch
    })
    expect((await service.runHealth()).checks.some((c) => c.id.startsWith('key-'))).toBe(false)
  })
})

describe('setup through the engine (1.12, 1.13)', () => {
  it('starts with the wizard, remembers the uses and that setup is done, and counts disk use', async () => {
    const dataDir = tempFolder()
    engine = await testEngine({ dataDir })
    const first = (await call(engine, 'GET', '/v1/setup')).body
    expect(first.done).toBe(false)
    expect(first.hardware.cores).toBeGreaterThan(0)
    expect(first.hardware.diskFreeBytes).toBeGreaterThan(0)
    expect(first.components.map((c: { id: string }) => c.id)).toContain('logs')

    expect((await call(engine, 'PUT', '/v1/setup', { interests: ['hacking'] })).status).toBe(400)
    const saved = (await call(engine, 'PUT', '/v1/setup', { interests: ['research'], done: true }))
      .body
    expect(saved).toMatchObject({ done: true, interests: ['research'] })
    expect((await call(engine, 'GET', '/v1/setup')).body.done).toBe(true)
    const health = await call(engine, 'POST', '/v1/setup/health')
    expect(health.status).toBe(200)
    expect(health.body.checkedAt).toBeTypeOf('number')
  })

  it('measures folders and the disk', () => {
    const dir = tempFolder()
    mkdirSync(join(dir, 'a'))
    writeFileSync(join(dir, 'a', 'one.bin'), Buffer.alloc(1000))
    writeFileSync(join(dir, 'two.bin'), Buffer.alloc(500))
    expect(folderBytes(dir)).toBe(1500)
    expect(diskOf(dir)!.totalBytes).toBeGreaterThan(diskOf(dir)!.freeBytes)
  })
})
