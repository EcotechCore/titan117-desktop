// Sidebar apps (6.2, 6.11, 6.12, 6.14; decisions §58): the shared data
// layer, what an app may reach, adding and updating builds, and how the
// window serves them with no network.
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'

import { createDataLayer, DataError } from '../src/engine/lib/apps/data'
import { createSidebarService, readManifest, type SidebarApp } from '../src/engine/lib/apps/sidebar'
import { AppError, type AppService } from '../src/engine/lib/apps/service'
import { AGENTS_MARK, SDK_SOURCE } from '../src/engine/lib/apps/sdk'
import {
  isSidebarNavigation,
  sidebarAppOf,
  sidebarCsp,
  sidebarFile,
  sidebarResponse
} from '../src/main/lib/sidebar-files'
import { appCreateRequest } from '../src/renderer/src/apps-lib'
import { tempFolder } from './helpers'

describe('the shared data layer', () => {
  it('keeps records per app and collection, with filters, search, order and limits', () => {
    const data = createDataLayer(tempFolder('titan117-data-'))
    const ana = data.insert('crm', 'contacts', { name: 'Ana', city: 'Cluj', vip: true })
    data.insert('crm', 'contacts', { name: 'Bogdan', city: 'Iasi', vip: false })
    data.insert('crm', 'contacts', { name: 'Carla', city: 'Cluj', vip: false })
    data.insert('stock', 'items', { sku: 'A1', qty: 3 })
    expect(ana.id).toMatch(/^[\w-]+$/)
    expect(ana._created).toBeGreaterThan(0)
    expect(
      data.list('crm', 'contacts', { where: { city: 'Cluj' }, orderBy: 'name' }).map((r) => r.name)
    ).toEqual(['Ana', 'Carla'])
    expect(data.list('crm', 'contacts', { where: { vip: true } }).map((r) => r.name)).toEqual([
      'Ana'
    ])
    expect(data.list('crm', 'contacts', { search: 'BOGD' }).map((r) => r.name)).toEqual(['Bogdan'])
    // A search for % or _ matches those characters, not everything.
    expect(data.list('crm', 'contacts', { search: '%' })).toEqual([])
    expect(data.count('crm', 'contacts', { where: { city: 'Cluj' } })).toBe(2)
    expect(data.list('crm', 'contacts', { orderBy: 'name', desc: true, limit: 1 })[0].name).toBe(
      'Carla'
    )
    // Each app has its own database.
    expect(data.list('stock', 'contacts')).toEqual([])
    expect(data.collections('crm')).toEqual([
      { name: 'contacts', count: 3, fields: expect.arrayContaining(['name', 'city', 'vip']) }
    ])
  })

  it('updates (null removes a field), deletes, and logs every change for sync', () => {
    const data = createDataLayer(tempFolder('titan117-data-'))
    const row = data.insert('crm', 'contacts', { id: 'ana', name: 'Ana', note: 'x' })
    expect(row.id).toBe('ana')
    const changed = data.update('crm', 'contacts', 'ana', { note: null, phone: '0722' })
    expect(changed).toMatchObject({ id: 'ana', name: 'Ana', phone: '0722' })
    expect(changed).not.toHaveProperty('note')
    // The id and times are ours: a record can't change them.
    expect(data.update('crm', 'contacts', 'ana', { id: 'bob', _created: 1 }).id).toBe('ana')
    expect(data.remove('crm', 'contacts', 'ana')).toBe(true)
    expect(data.remove('crm', 'contacts', 'ana')).toBe(false)
    expect(data.changesSince('crm', 0).map((c) => c.op)).toEqual(['put', 'put', 'put', 'delete'])
    expect(data.changesSince('crm', 3).length).toBe(1)
  })

  it('refuses bad names, injection through field names, big records and duplicates', () => {
    const data = createDataLayer(tempFolder('titan117-data-'))
    expect(() => data.insert('crm', 'Bad Name', {})).toThrow(DataError)
    expect(() => data.insert('../x', 'contacts', {})).toThrow(DataError)
    expect(() => data.list('crm', 'contacts', { where: { "x') or 1=1 --": 1 } })).toThrow(DataError)
    expect(() => data.list('crm', 'contacts', { orderBy: 'name; drop table docs' })).toThrow(
      DataError
    )
    expect(() => data.insert('crm', 'contacts', { big: 'x'.repeat(300_000) })).toThrow(/too big/)
    expect(() => data.insert('crm', 'contacts', [1, 2])).toThrow(DataError)
    data.insert('crm', 'contacts', { id: 'a' })
    expect(() => data.insert('crm', 'contacts', { id: 'a' })).toThrow(/already/)
  })

  it('drops an app’s data only when asked', () => {
    const root = tempFolder('titan117-data-')
    const data = createDataLayer(root)
    data.insert('crm', 'contacts', { name: 'Ana' })
    data.drop('crm')
    expect(existsSync(join(root, 'crm', 'data.db'))).toBe(false)
    expect(data.list('crm', 'contacts')).toEqual([])
  })
})

/** An app folder with a built `dist`, and an app service that "checks" it. */
function bench(options: { passes?: boolean } = {}): {
  folder: (name: string, manifest?: object) => string
  service: ReturnType<typeof createSidebarService>
  registry: SidebarApp[]
  root: string
  versions: string[]
} {
  const root = tempFolder('titan117-sidebar-')
  const registry: SidebarApp[] = []
  const versions: string[] = []
  const apps = {
    info: (dir: string) => {
      const kind = existsSync(join(dir, 'mobile')) ? 'mobile' : 'web'
      return { kind, title: dir.split(/[\\/]/).pop() ?? 'x', folder: dir }
    },
    async saveVersion(_dir: string, message: string) {
      versions.push(message)
      return { sha: 'x', pushed: null, pushError: null }
    },
    async check() {
      return { passed: options.passes !== false, summary: 'All checks passed' }
    },
    versions: async () => [{ sha: `abc${versions.length}def0`, subject: 'v', at: 1 }]
  } as unknown as AppService
  const service = createSidebarService({
    root,
    apps,
    data: createDataLayer(join(root, 'data')),
    registry: () => registry,
    setRegistry: (next) => void registry.splice(0, registry.length, ...next),
    userName: () => 'Ana'
  })
  const parent = tempFolder('titan117-apps-')
  return {
    root,
    registry,
    versions,
    service,
    folder(name, manifest) {
      const dir = join(parent, name)
      mkdirSync(join(dir, 'dist', 'assets'), { recursive: true })
      writeFileSync(join(dir, 'dist', 'index.html'), `<h1>${name}</h1>`)
      writeFileSync(join(dir, 'dist', 'assets', 'app.js'), 'console.log(1)')
      if (manifest) writeFileSync(join(dir, 'titan.json'), JSON.stringify(manifest))
      return dir
    }
  }
}

describe('sidebar apps', () => {
  it('a CRM and an inventory share data only as granted', async () => {
    const b = bench()
    const stock = b.folder('inventory', { name: 'Inventory', icon: 'box', collections: ['items'] })
    const crm = b.folder('crm', {
      name: 'CRM',
      icon: 'users',
      collections: ['contacts'],
      reads: ['inventory/items']
    })
    const inv = await b.service.add(stock, { reads: [], writes: [] })
    expect(inv).toMatchObject({ id: 'inventory', title: 'Inventory', icon: 'box' })
    // Adding writes the SDK, titan.json and the agent notes, and saves a version.
    expect(readFileSync(join(stock, 'src', 'titan.ts'), 'utf8')).toBe(SDK_SOURCE)
    expect(readFileSync(join(stock, 'AGENTS.md'), 'utf8')).toContain(AGENTS_MARK)
    expect(b.versions).toEqual(['Added to the Titan117 sidebar'])

    // The review names what it reaches; adding with other grants is refused.
    const review = b.service.review(crm)
    expect(review.reads).toEqual([{ ref: 'inventory/items', app: 'Inventory' }])
    await expect(b.service.add(crm, { reads: [], writes: [] })).rejects.toThrow(AppError)
    await b.service.add(crm, { reads: ['inventory/items'], writes: [] })

    b.service.call('inventory', 'db.insert', { collection: 'items', data: { sku: 'A1', qty: 3 } })
    b.service.call('crm', 'db.insert', { collection: 'contacts', data: { name: 'Ana' } })
    // The CRM reads the inventory's items…
    expect(b.service.call('crm', 'db.list', { collection: 'inventory/items' })).toEqual([
      expect.objectContaining({ sku: 'A1', qty: 3 })
    ])
    // …but can't change them, or read anything else of it.
    expect(() =>
      b.service.call('crm', 'db.insert', { collection: 'inventory/items', data: { sku: 'B' } })
    ).toThrow(/may not change/)
    expect(() => b.service.call('crm', 'db.list', { collection: 'inventory/orders' })).toThrow(
      /may not read/
    )
    // The inventory may not read the CRM at all.
    expect(() => b.service.call('inventory', 'db.list', { collection: 'crm/contacts' })).toThrow(
      /may not read/
    )
    expect(() => b.service.call('crm', 'shell.run', {})).toThrow(/isn't something/)
    expect(() => b.service.call('nobody', 'db.list', { collection: 'x' })).toThrow(AppError)
    expect(b.service.call('crm', 'auth.user', {})).toEqual({ name: 'Ana' })
    // Titan reads across both through the shared layer.
    expect(b.service.data.list('crm', 'contacts')[0].name).toBe('Ana')
    expect(b.service.data.list('inventory', 'items')[0].sku).toBe('A1')
  })

  it('serves the checked build, keeps a few, and asks again when an update wants more', async () => {
    const b = bench()
    const crm = b.folder('crm', { name: 'CRM', collections: ['contacts'] })
    const app = await b.service.add(crm, { reads: [], writes: [] })
    const current = JSON.parse(readFileSync(join(b.root, 'crm', 'current.json'), 'utf8'))
    expect(current.build).toBe(app.build)
    expect(readFileSync(join(b.root, 'crm', 'builds', app.build, 'index.html'), 'utf8')).toBe(
      '<h1>crm</h1>'
    )
    const updated = await b.service.update(crm)
    expect(updated.status).toBe('updated')
    // Now it asks for the inventory: the sidebar keeps the old build until the user agrees.
    writeFileSync(join(crm, 'titan.json'), JSON.stringify({ name: 'CRM', reads: ['inventory/*'] }))
    const again = await b.service.update(crm)
    expect(again.status).toBe('review')
    expect(b.service.get('crm')?.grants.reads).toEqual([])
    // Errors the app reports are kept for "Fix with Titan" (6.14); an update clears them.
    b.service.call('crm', 'app.error', { message: 'x is undefined' })
    expect(b.service.get('crm')?.error?.message).toBe('x is undefined')
    await b.service.remove('crm', { deleteData: true })
    expect(b.service.list()).toEqual([])
    expect(existsSync(join(b.root, 'crm', 'current.json'))).toBe(false)
  })

  it('keeps the old build when the checks fail, and never takes a mobile app', async () => {
    const b = bench({ passes: false })
    const crm = b.folder('crm')
    await expect(b.service.add(crm, { reads: [], writes: [] })).rejects.toThrow(/didn't pass/)
    expect(b.service.list()).toEqual([])
    const phone = b.folder('phone')
    mkdirSync(join(phone, 'mobile'))
    expect(() => b.service.review(phone)).toThrow(/Only a website/)
  })

  it('checks titan.json', () => {
    const dir = tempFolder('titan117-manifest-')
    expect(readManifest(dir, 'Fallback')).toEqual({
      name: 'Fallback',
      icon: 'app',
      collections: [],
      reads: [],
      writes: [],
      ai: false
    })
    writeFileSync(join(dir, 'titan.json'), JSON.stringify({ reads: ['../../etc'] }))
    expect(() => readManifest(dir, 'x')).toThrow(/isn't another app's collection/)
    writeFileSync(join(dir, 'titan.json'), JSON.stringify({ collections: ['Bad Name'] }))
    expect(() => readManifest(dir, 'x')).toThrow(AppError)
    writeFileSync(join(dir, 'titan.json'), '{nope')
    expect(() => readManifest(dir, 'x')).toThrow(/valid JSON/)
    writeFileSync(join(dir, 'titan.json'), JSON.stringify({ icon: 'rocket', name: 'CRM' }))
    expect(readManifest(dir, 'x')).toMatchObject({ icon: 'app', name: 'CRM' })
  })
})

describe('serving a sidebar app in the window', () => {
  const root = tempFolder('titan117-serve-')
  mkdirSync(join(root, 'crm', 'builds', 'abc1234', 'assets'), { recursive: true })
  writeFileSync(join(root, 'crm', 'builds', 'abc1234', 'index.html'), '<h1>CRM</h1>')
  writeFileSync(join(root, 'crm', 'builds', 'abc1234', 'assets', 'a.js'), 'x')
  writeFileSync(join(root, 'crm', 'current.json'), JSON.stringify({ build: 'abc1234' }))
  writeFileSync(join(root, 'crm', 'data.db'), 'secret')

  it('serves only the current build’s files', () => {
    expect(sidebarAppOf('crm.apps')).toBe('crm')
    expect(sidebarAppOf('app')).toBeNull()
    expect(sidebarAppOf('../x.apps')).toBeNull()
    expect(sidebarFile(root, 'crm', '/')).toBe(join(root, 'crm', 'builds', 'abc1234', 'index.html'))
    expect(sidebarFile(root, 'crm', '/contacts')).toContain('index.html')
    expect(sidebarFile(root, 'crm', '/assets/a.js')).toContain('a.js')
    // Never the database or anything outside the build.
    expect(sidebarFile(root, 'crm', '/../../data.db')).toBeNull()
    expect(sidebarFile(root, 'crm', '/%2e%2e/%2e%2e/data.db')).toBeNull()
    expect(sidebarFile(root, 'nobody', '/')).toBeNull()
  })

  it('sends a policy with no network', async () => {
    const response = sidebarResponse(root, 'crm', '/')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<h1>CRM</h1>')
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toBe(sidebarCsp('crm'))
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('script-src titan117://crm.apps')
    expect(csp).not.toMatch(/https?:/)
    expect(sidebarResponse(root, 'crm', '/missing.js').status).toBe(404)
  })

  it('keeps each app’s frame on its own address', () => {
    expect(isSidebarNavigation('titan117://crm.apps/', '')).toBe(true)
    expect(isSidebarNavigation('titan117://crm.apps/x', 'titan117://crm.apps/')).toBe(true)
    expect(isSidebarNavigation('titan117://stock.apps/', 'titan117://crm.apps/')).toBe(false)
    expect(isSidebarNavigation('https://evil.example/', 'titan117://crm.apps/')).toBe(false)
    expect(isSidebarNavigation('titan117://app/index.html', '')).toBe(false)
  })
})

describe('asking for a sidebar app', () => {
  it('a new internal tool starts with the SDK and ends in the sidebar', () => {
    const text = appCreateRequest(
      'C:/apps',
      'CRM',
      'Our customers',
      'contacts',
      'blank',
      'web',
      true
    )
    expect(text).toContain('app_create, sidebar true')
    expect(text).toContain('titan.db')
    expect(text).toContain('sidebar_add')
    // Not for a mobile app.
    expect(appCreateRequest('C:/apps', 'X', 'Y', 'z', 'blank', 'mobile', true)).not.toContain(
      'sidebar'
    )
  })
})

describe('sidebar apps as add-ons (decisions §66.7)', () => {
  it('keeps the builds and rolls back to the one before, which the window then serves', async () => {
    const b = bench()
    const dir = b.folder('notes', { name: 'Notes', icon: 'list', collections: ['notes'] })
    const first = await b.service.add(dir, { reads: [], writes: [] })
    // The first build is older on disk than the update.
    utimesSync(
      join(b.root, first.id, 'builds', first.build),
      new Date(2026, 0, 1),
      new Date(2026, 0, 1)
    )
    writeFileSync(join(dir, 'dist', 'index.html'), '<h1>broken</h1>')
    const updated = await b.service.update(dir)
    expect(updated.status).toBe('updated')
    const now = b.service.get(first.id)!
    expect(now.build).not.toBe(first.build)
    expect(b.service.builds(first.id).map((x) => [x.build, x.current])).toEqual([
      [now.build, true],
      [first.build, false]
    ])
    const back = await b.service.rollback(first.id)
    expect(back.build).toBe(first.build)
    expect(readFileSync(sidebarFile(b.root, first.id, '/index.html')!, 'utf8')).toBe(
      '<h1>notes</h1>'
    )
    await expect(b.service.rollback(first.id)).rejects.toThrow(/no earlier build/)
  })
})
