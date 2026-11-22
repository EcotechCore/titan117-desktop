// Phase 10, the rest (decisions §58): the sync core (6.12), titan.ai, and
// another target for the same project (6.6).
import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { createDataLayer } from '../src/engine/lib/apps/data'
import {
  exportChanges,
  importChanges,
  newSyncKey,
  open,
  seal,
  SyncError
} from '../src/engine/lib/apps/sync'
import { createSidebarService, readManifest, type SidebarApp } from '../src/engine/lib/apps/sidebar'
import { AppError, createAppService, type AppService } from '../src/engine/lib/apps/service'
import type { CheckResult, Runner } from '../src/engine/lib/apps/runner'
import type { BrowserTests } from '../src/engine/lib/apps/browsers'
import { tempFolder } from './helpers'

beforeAll(() => {
  const home = tempFolder('titan117-home-')
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n\tname = Test User\n\temail = test@example.com\n[core]\n\tautocrlf = false\n'
  )
  process.env.HOME = home
})

describe('the sync core (6.12)', () => {
  it('seals so only the same key opens it, hides the app and pads the size', () => {
    const key = newSyncKey()
    const sealed = seal(key, 'crm', [
      { collection: 'contacts', id: 'ana', op: 'put', at: 5, data: { name: 'Ana' } }
    ])
    const raw = Buffer.from(sealed, 'base64')
    expect(raw.toString('latin1')).not.toMatch(/crm|contacts|Ana/)
    expect((raw.length - 34) % 1024).toBe(0)
    expect(open(key, sealed)).toEqual({
      app: 'crm',
      entries: [{ collection: 'contacts', id: 'ana', op: 'put', at: 5, data: { name: 'Ana' } }]
    })
    expect(() => open(newSyncKey(), sealed)).toThrow(SyncError)
    const tampered = Buffer.from(raw)
    tampered[tampered.length - 1] ^= 1
    expect(() => open(key, tampered.toString('base64'))).toThrow(/changed/)
    expect(() => open(key, Buffer.from('not a package').toString('base64'))).toThrow(SyncError)
    expect(() => seal(Buffer.alloc(8), 'crm', [])).toThrow(/32 bytes/)
  })

  it('two laptops converge: newest change wins, deletions stick, unknown apps are refused', () => {
    const key = newSyncKey()
    const a = createDataLayer(tempFolder('titan117-sync-a-'))
    const b = createDataLayer(tempFolder('titan117-sync-b-'))
    const known = (app: string): boolean => app === 'crm'

    a.insert('crm', 'contacts', { id: 'ana', name: 'Ana' })
    a.insert('crm', 'contacts', { id: 'bob', name: 'Bob' })
    let fromA = exportChanges(a, key, 'crm', 0)
    expect(importChanges(b, key, fromA.sealed as string, known)).toMatchObject({ applied: 2 })
    expect(b.list('crm', 'contacts', { orderBy: 'name' }).map((r) => r.name)).toEqual([
      'Ana',
      'Bob'
    ])
    // Importing doesn't log a change of B's own, so nothing echoes back.
    expect(b.changesSince('crm', 0)).toEqual([])
    // The same package twice changes nothing.
    expect(importChanges(b, key, fromA.sealed as string, known)).toMatchObject({
      applied: 0,
      skipped: 2
    })

    // B edits Ana later than A does: B's edit wins on both.
    const seqA = fromA.upTo
    a.update('crm', 'contacts', 'ana', { city: 'Cluj' })
    const bAna = b.get('crm', 'contacts', 'ana')
    b.applyRemote('crm', {
      ...b.entriesSince('crm', 0).entries[0],
      op: 'put',
      collection: 'contacts',
      id: 'ana',
      at: Date.now() + 10_000,
      created: bAna?._created,
      data: { name: 'Ana B.' }
    })
    fromA = exportChanges(a, key, 'crm', seqA)
    importChanges(b, key, fromA.sealed as string, known)
    expect(b.get('crm', 'contacts', 'ana')?.name).toBe('Ana B.')

    // A deletes Bob; B gets the deletion, and an older put can't bring him back.
    const before = a.changesSince('crm', 0).at(-1)?.seq ?? 0
    a.remove('crm', 'contacts', 'bob')
    const del = exportChanges(a, key, 'crm', before)
    expect(importChanges(b, key, del.sealed as string, known)).toMatchObject({ applied: 1 })
    expect(b.get('crm', 'contacts', 'bob')).toBeNull()
    expect(
      b.applyRemote('crm', {
        collection: 'contacts',
        id: 'bob',
        op: 'put',
        at: 1,
        data: { name: 'Old Bob' }
      })
    ).toBe(false)
    expect(b.get('crm', 'contacts', 'bob')).toBeNull()

    // Only apps in this sidebar; bad records are counted, not applied.
    expect(() => importChanges(b, key, seal(key, 'payroll', []), known)).toThrow(
      /isn’t in this laptop's sidebar/
    )
    const bad = seal(key, 'crm', [
      { collection: 'Bad Name', id: 'x', op: 'put', at: 1, data: {} },
      { collection: 'contacts', id: '../x', op: 'put', at: 1, data: {} },
      { collection: 'contacts', id: 'ok', op: 'put', at: 1, data: { "x') --": 1 } }
    ])
    expect(importChanges(b, key, bad, known)).toMatchObject({ applied: 0, refused: 3 })
    // Nothing changed: no package.
    expect(
      exportChanges(b, key, 'crm', b.changesSince('crm', 0).at(-1)?.seq ?? 0).sealed
    ).toBeNull()
  })
})

function sidebarBench(
  ai = async (input: { prompt: string }) => ({
    text: `answer: ${input.prompt}`,
    costUsd: 0.001,
    model: 'm'
  })
): {
  service: ReturnType<typeof createSidebarService>
  folder: (name: string, manifest: object) => string
  asked: string[]
} {
  const asked: string[] = []
  const registry: SidebarApp[] = []
  const apps = {
    info: (dir: string) => ({ kind: 'web', title: 'x', folder: dir }),
    saveVersion: async () => null,
    check: async () => ({ passed: true, summary: 'All checks passed' }),
    versions: async () => [{ sha: 'abcdef1', subject: 'v', at: 1 }]
  } as unknown as AppService
  const root = tempFolder('titan117-ai-')
  const service = createSidebarService({
    root,
    apps,
    data: createDataLayer(join(root, 'data')),
    registry: () => registry,
    setRegistry: (next) => void registry.splice(0, registry.length, ...next),
    ai: async (input) => {
      asked.push(input.prompt)
      return ai(input)
    }
  })
  const parent = tempFolder('titan117-ai-apps-')
  return {
    service,
    asked,
    folder(name, manifest) {
      const dir = join(parent, name)
      mkdirSync(join(dir, 'dist'), { recursive: true })
      writeFileSync(join(dir, 'dist', 'index.html'), 'x')
      writeFileSync(join(dir, 'titan.json'), JSON.stringify(manifest))
      return dir
    }
  }
}

describe('titan.ai in a sidebar app', () => {
  it('asks the model only when titan.json asks and the user agreed, within a daily limit', async () => {
    const b = sidebarBench()
    const plain = b.folder('notes', { name: 'Notes' })
    await b.service.add(plain, { reads: [], writes: [] })
    await expect(
      b.service.call('notes', 'ai.ask', { prompt: 'hi' }) as Promise<unknown>
    ).rejects.toThrow(/may not ask/)
    expect(b.asked).toEqual([])

    const crm = b.folder('crm', { name: 'CRM', ai: true })
    expect(readManifest(crm, 'x').ai).toBe(true)
    // The review shows it; adding without agreeing to it is refused.
    await expect(b.service.add(crm, { reads: [], writes: [] })).rejects.toThrow(AppError)
    await b.service.add(crm, { reads: [], writes: [], ai: true })
    expect(await b.service.call('crm', 'ai.ask', { prompt: 'Summarise Ana' })).toEqual({
      text: 'answer: Summarise Ana'
    })
    expect(b.service.get('crm')?.ai).toMatchObject({ calls: 1, usd: 0.001 })
    await expect(
      b.service.call('crm', 'ai.ask', { prompt: '' }) as Promise<unknown>
    ).rejects.toThrow(/Ask something/)
    await expect(
      b.service.call('crm', 'ai.ask', { prompt: 'x'.repeat(20_001) }) as Promise<unknown>
    ).rejects.toThrow(/too long/)
    // The daily limit.
    const app = b.service.get('crm') as SidebarApp
    const today = new Date().toISOString().slice(0, 10)
    Object.assign(app, { ai: { day: today, calls: 100, usd: 1 } })
    await expect(
      b.service.call('crm', 'ai.ask', { prompt: 'again' }) as Promise<unknown>
    ).rejects.toThrow(/daily limit/)
  })

  it('an update that newly asks for AI waits for the user', async () => {
    const b = sidebarBench()
    const crm = b.folder('crm', { name: 'CRM' })
    await b.service.add(crm, { reads: [], writes: [] })
    writeFileSync(join(crm, 'titan.json'), JSON.stringify({ name: 'CRM', ai: true }))
    expect((await b.service.update(crm)).status).toBe('review')
    expect(b.service.get('crm')?.grants.ai).toBeFalsy()
  })
})

const ok = (name: CheckResult['name']): CheckResult => ({
  name,
  ran: true,
  ok: true,
  exitCode: 0,
  output: '',
  timedOut: false,
  ms: 1
})

describe('another target for the same project (6.6)', () => {
  it('makes a linked mobile app beside a web app and shares src/shared both ways', async () => {
    const root = tempFolder('titan117-targets-')
    const apps = createAppService({
      runner: {
        install: async () => ok('install'),
        checks: async () => [ok('typecheck'), ok('build'), ok('test')],
        preview: () => null,
        stopPreview: () => false,
        stopAll: () => undefined
      } as unknown as Runner,
      browsers: {} as BrowserTests,
      coAuthor: () => true
    })
    const web = await apps.create(root, {
      title: 'Cluj Bakery',
      description: 'Bread.',
      sidebar: true
    })
    expect(existsSync(join(web.folder, 'src', 'titan.ts'))).toBe(true)
    mkdirSync(join(web.folder, 'src', 'shared'), { recursive: true })
    writeFileSync(join(web.folder, 'src', 'shared', 'prices.ts'), 'export const vat = 0.19\n')

    const phone = await apps.addTarget(web.folder, 'mobile')
    expect(phone).toMatchObject({ kind: 'mobile', title: 'Cluj Bakery mobile' })
    expect(phone.folder).toBe(join(root, 'cluj-bakery-mobile'))
    expect(readFileSync(join(phone.folder, 'src', 'shared', 'prices.ts'), 'utf8')).toContain('vat')
    // Each knows the other; the phone's notes say the sidebar's data isn't reachable yet.
    expect(apps.info(web.folder).linked).toEqual([
      { kind: 'mobile', title: 'Cluj Bakery mobile', folder: phone.folder }
    ])
    expect(apps.info(phone.folder).linked.map((t) => t.kind)).toEqual(['web'])
    expect(readFileSync(join(phone.folder, 'AGENTS.md'), 'utf8')).toMatch(/can't reach yet/)
    expect(readFileSync(join(web.folder, 'AGENTS.md'), 'utf8')).toContain('../cluj-bakery-mobile')

    await expect(apps.addTarget(web.folder, 'mobile')).rejects.toThrow(/already has a mobile app/)
    await expect(apps.addTarget(web.folder, 'web')).rejects.toThrow(/already a web app/)

    writeFileSync(join(web.folder, 'src', 'shared', 'prices.ts'), 'export const vat = 0.21\n')
    expect((await apps.shareCode(web.folder)).updated).toEqual([phone.folder])
    expect(readFileSync(join(phone.folder, 'src', 'shared', 'prices.ts'), 'utf8')).toContain('0.21')
    expect((await apps.versions(phone.folder))[0].subject).toBe('Shared code from Cluj Bakery')
    // Nothing new: no version.
    expect((await apps.shareCode(web.folder)).updated).toEqual([])
  })
})

describe('the SDK in a sidebar app', () => {
  it('is brought up to date before a build, only for apps with titan.json', async () => {
    const root = tempFolder('titan117-sdk-')
    const registry: SidebarApp[] = []
    const service = createSidebarService({
      root,
      apps: {} as AppService,
      data: createDataLayer(join(root, 'data')),
      registry: () => registry,
      setRegistry: () => undefined
    })
    const plain = tempFolder('titan117-plain-')
    expect(await service.refreshSdk(plain)).toBe(false)
    expect(existsSync(join(plain, 'src', 'titan.ts'))).toBe(false)
    const app = tempFolder('titan117-old-sdk-')
    mkdirSync(join(app, 'src'))
    writeFileSync(join(app, 'titan.json'), '{}')
    writeFileSync(join(app, 'src', 'titan.ts'), 'export const titan = {}')
    expect(await service.refreshSdk(app)).toBe(true)
    expect(readFileSync(join(app, 'src', 'titan.ts'), 'utf8')).toContain('ai: {')
    expect(await service.refreshSdk(app)).toBe(false)
  })
})
