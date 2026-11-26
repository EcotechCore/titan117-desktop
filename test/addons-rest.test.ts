/* eslint-disable @typescript-eslint/explicit-function-return-type -- test helpers return the shapes they build */
/**
 * The rest of phase 16 (decisions §66.21–66.23): GitLab as a source, add-ons
 * from a folder, any open-source project downloaded for setup, MCP servers
 * and workflows as add-ons (and safe mode for them), and publishing to the
 * user's GitHub.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { openDb } from '../src/engine/lib/db'
import { createLogger } from '../src/engine/lib/log'
import { createPermissionLayer } from '../src/engine/permissions'
import { createStore } from '../src/engine/store'
import { builtInTools, createRegistry } from '../src/engine/tools'
import { createAddonService } from '../src/engine/lib/addons/service'
import { createAddonStore, type AddonLinks } from '../src/engine/lib/addons/store'
import { parseSource, sourceKey } from '../src/engine/lib/addons/source'
import { publishAddon } from '../src/engine/lib/addons/publish'
import { tempFolder, until } from './helpers'

const SHA = 'a'.repeat(40)
const enc = (o: Record<string, string>) =>
  new Map(Object.entries(o).map(([k, v]) => [k, strToU8(v)]))
const TOOL_MANIFEST = {
  titan: 1,
  type: 'tool',
  name: 'vat',
  title: 'VAT',
  version: '1.0.0',
  description: 'Adds Romanian VAT.',
  tool: {
    main: 'tool.js',
    hosts: [],
    tools: [{ name: 'add_vat', description: 'Adds 21% VAT.', risk: 'read' }]
  }
}

describe('GitLab as a source (decisions §66.22)', () => {
  it('reads GitLab addresses with nested groups, refs and commits', () => {
    expect(parseSource('https://gitlab.com/acme/tools/rates')).toEqual({
      host: 'gitlab',
      owner: 'acme/tools',
      repo: 'rates',
      ref: null
    })
    expect(parseSource(`https://gitlab.com/acme/rates/-/commit/${SHA}`).ref).toBe(SHA)
    expect(parseSource('gitlab.com/acme/rates@v2').ref).toBe('v2')
    expect(sourceKey(parseSource('gitlab.com/acme/rates'))).toBe('gitlab.com/acme/rates')
    expect(() => parseSource('gitlab.com/acme')).toThrow()
    expect(() => parseSource('gitlab.com/acme/../x')).toThrow()
  })

  it('finds the main branch’s commit and downloads that commit’s archive; asks for a commit when GitLab won’t say', async () => {
    const calls: string[] = []
    const zip = zipSync({
      'rates-x/README.md': strToU8('# Rates'),
      'rates-x/main.py': strToU8('print(1)')
    })
    const fetch = async (url: string) => {
      calls.push(url.replace('https://gitlab.com/api/v4', ''))
      if (url.endsWith('/projects/acme%2Frates')) return Response.json({ default_branch: 'main' })
      if (url.endsWith('/repository/commits/main')) return Response.json({ id: SHA })
      if (url.includes('/repository/archive.zip')) return new Response(zip)
      return new Response('{}', { status: 401 })
    }
    const store = createAddonStore({ root: null, db: openDb(':memory:') })
    const service = createAddonService({ store })
    const got = await service.download('https://gitlab.com/acme/rates', fetch)
    expect(got.key).toBe(`gitlab.com/acme/rates@${SHA}`)
    expect([...got.files.keys()].sort()).toEqual(['README.md', 'main.py'])
    expect(calls).toEqual([
      '/projects/acme%2Frates',
      '/projects/acme%2Frates/repository/commits/main',
      `/projects/acme%2Frates/repository/archive.zip?sha=${SHA}`
    ])
    await expect(service.download('gitlab.com/acme/other@dev', fetch)).rejects.toThrow(
      /Give the commit/
    )
  })
})

describe('add-ons from a folder (18.3: larger tools from the coding engine)', () => {
  it('checks a tool in the sandbox, installs it, and refuses keys or a tool that doesn’t load', async () => {
    const store = createAddonStore({ root: null, db: openDb(':memory:') })
    const service = createAddonService({ store })
    const files = enc({
      'titan.json': JSON.stringify(TOOL_MANIFEST),
      'tool.js': 'titan.define({ add_vat: (i) => Math.round(i.amount * 121) / 100 })',
      'README.md': 'x'
    })
    const { card } = await service.checkLocal(files)
    expect(card).toContain('from a folder on this laptop')
    expect(card).toContain('reach the internet')
    const addon = await service.installLocal(files, 'Titan')
    expect(addon).toMatchObject({ name: 'vat', repo: null })
    expect(store.tools().map((t) => t.name)).toEqual(['addon_vat_add_vat'])
    const withKey = new Map(files)
    withKey.set('config.js', strToU8(`const k = "sk-or-v1-${'b'.repeat(64)}"`))
    await expect(service.installLocal(withKey, 'Titan')).rejects.toThrow(/Keys were found/)
    const broken = new Map(files)
    broken.set('tool.js', strToU8('titan.define({})'))
    await expect(service.checkLocal(broken)).rejects.toThrow(/doesn’t define add_vat/)
    await expect(service.checkLocal(enc({ 'a.txt': 'x' }))).rejects.toThrow(/no titan.json/)
  })

  it('through the permission layer: reads only the allowed folders and installs after the card', async () => {
    const allowed = tempFolder('titan117-allowed-')
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(join(allowed, 'vat'))
    writeFileSync(join(allowed, 'vat', 'titan.json'), JSON.stringify(TOOL_MANIFEST))
    writeFileSync(join(allowed, 'vat', 'tool.js'), 'titan.define({ add_vat: () => 1 })')
    const db = openDb(':memory:')
    const store = createAddonStore({ root: null, db })
    const tasks = createStore(db, () => undefined)
    const layer = createPermissionLayer({
      tools: createRegistry(builtInTools),
      store: tasks,
      log: createLogger(db, null),
      folders: () => ({ allowed: [allowed], core: [] }),
      services: { addons: createAddonService({ store }) }
    })
    const task = tasks.createTask({ title: 't', agent: 'Titan', model: 'm' })
    const ctx = {
      taskId: task.id,
      agent: 'Titan',
      model: 'm',
      signal: new AbortController().signal
    }
    const run = layer.execute(
      { id: 'a', name: 'addons_install_folder', input: { folder: join(allowed, 'vat') } },
      ctx
    )
    const card = await until(() => tasks.listApprovals({ taskId: task.id, status: 'pending' })[0])
    expect(card.canAlways).toBe(false)
    expect(card.summary).toContain('Install the tool “VAT” 1.0.0 from a folder on this laptop')
    layer.answer(card.id, 'approve', 'window')
    expect((await run).status).toBe('done')
    expect(store.get('vat')).toBeTruthy()
    const outside = await layer.execute(
      {
        id: 'b',
        name: 'addons_install_folder',
        input: { folder: tempFolder('titan117-outside-') }
      },
      ctx
    )
    expect(outside.status).not.toBe('done')
  })
})

describe('any open-source project (10.5)', () => {
  it('downloads into a new allowed folder, runs nothing, and hands Titan the README and setup files', async () => {
    const allowed = tempFolder('titan117-allowed-')
    const zip = zipSync({
      'acme-cli-1/README.md': strToU8('# CLI\nRun `npm install` then `npm start`.'),
      'acme-cli-1/package.json': strToU8(
        JSON.stringify({ scripts: { postinstall: 'node x.js' }, dependencies: { a: '1.0.0' } })
      ),
      'acme-cli-1/src/index.js': strToU8('console.log(1)')
    })
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/commits/')) return new Response(SHA)
      if (url.includes('/zipball/')) return new Response(zip)
      if (url.includes('api.osv.dev')) {
        void init
        return Response.json({ results: [{}] })
      }
      return new Response('{}', { status: 404 })
    }
    const db = openDb(':memory:')
    const tasks = createStore(db, () => undefined)
    const layer = createPermissionLayer({
      tools: createRegistry(builtInTools),
      store: tasks,
      log: createLogger(db, null),
      folders: () => ({ allowed: [allowed], core: [] }),
      services: {
        fetch,
        addons: createAddonService({ store: createAddonStore({ root: null, db }) })
      }
    })
    const task = tasks.createTask({ title: 't', agent: 'Titan', model: 'm' })
    const ctx = {
      taskId: task.id,
      agent: 'Titan',
      model: 'm',
      signal: new AbortController().signal
    }
    const run = layer.execute(
      {
        id: 'a',
        name: 'project_download',
        input: { address: 'acme/cli', folder: join(allowed, 'cli') }
      },
      ctx
    )
    const card = await until(() => tasks.listApprovals({ taskId: task.id, status: 'pending' })[0])
    layer.answer(card.id, 'approve', 'window')
    const out = await run
    expect(out.status).toBe('done')
    expect(out.output).toContain(`Downloaded acme/cli@${SHA}`)
    expect(out.output).toContain('package.json: postinstall')
    expect(out.output).toContain('--- README.md ---')
    expect(readFileSync(join(allowed, 'cli', 'src', 'index.js'), 'utf8')).toBe('console.log(1)')
    // Nothing ran: no node_modules appeared.
    expect(existsSync(join(allowed, 'cli', 'node_modules'))).toBe(false)
  })
})

describe('MCP servers and workflows as add-ons (decisions §66.21)', () => {
  function withEffects() {
    const made: string[] = []
    const removed: string[] = []
    const store = createAddonStore({ root: null, db: openDb(':memory:') })
    let n = 0
    const service = createAddonService({
      store,
      effects: {
        activate(manifest, addon) {
          const id = `${addon}-${++n}`
          made.push(`${manifest.mcp ? 'connector' : 'schedule'} ${id}`)
          return manifest.mcp ? { connector: id } : { schedule: id }
        },
        deactivate(links: AddonLinks) {
          removed.push(links.connector ?? links.schedule ?? '?')
        }
      }
    })
    return { store, service, made, removed }
  }
  const mcp = (version: string) =>
    enc({
      'titan.json': JSON.stringify({
        titan: 1,
        type: 'mcp-server',
        name: 'acme-crm',
        title: 'Acme CRM',
        version,
        description: 'Acme CRM through its MCP server.',
        mcp: { url: 'https://mcp.acme.com/mcp', secrets: ['ACME_TOKEN'] }
      })
    })

  it('a connector is made on install, removed when off, made again when on, and gone with the add-on', async () => {
    const { service, made, removed } = withEffects()
    expect((await service.checkLocal(mcp('1.0.0'))).card).toContain('It needs: ACME_TOKEN')
    await service.installLocal(mcp('1.0.0'), 'you')
    expect(made).toEqual(['connector acme-crm-1'])
    service.setEnabled('acme-crm', false)
    expect(removed).toEqual(['acme-crm-1'])
    service.setEnabled('acme-crm', true)
    await service.installLocal(mcp('1.1.0'), 'you')
    service.rollback('acme-crm')
    expect(made).toEqual(
      ['connector acme-crm-2', 'connector acme-crm-3', 'connector acme-crm-4'].reduce(
        (a, x) => [...a, x],
        ['connector acme-crm-1']
      )
    )
    service.remove('acme-crm')
    expect(removed.at(-1)).toBe('acme-crm-4')
  })

  it('safe mode removes what MCP servers and workflows made; the next normal start makes it again', async () => {
    const { store, service, made, removed } = withEffects()
    await service.installLocal(
      enc({
        'titan.json': JSON.stringify({
          titan: 1,
          type: 'workflow',
          name: 'weekly-posts',
          version: '1.0.0',
          description: 'Drafts the week’s posts.',
          workflow: {
            when: { kind: 'daily', time: '08:00', days: [1] },
            agent: 'Writer',
            prompt: 'Draft the week’s posts.'
          }
        })
      }),
      'you'
    )
    expect(made).toEqual(['schedule weekly-posts-1'])
    service.sync(true)
    expect(removed).toEqual(['weekly-posts-1'])
    expect(store.get('weekly-posts')!.links).toBeUndefined()
    service.sync(false)
    expect(made).toEqual(['schedule weekly-posts-1', 'schedule weekly-posts-2'])
    service.takeDown('weekly-posts', 'Taken down.')
    expect(removed).toEqual(['weekly-posts-1', 'weekly-posts-2'])
  })
})

describe('publishing to the user’s GitHub (decisions §66.23)', () => {
  it('makes a public repository and writes the files, a licence and a README, one at a time', async () => {
    const store = createAddonStore({ root: null, db: openDb(':memory:') })
    const service = createAddonService({ store })
    await service.installLocal(
      enc({
        'titan.json': JSON.stringify(TOOL_MANIFEST),
        'tool.js': 'titan.define({ add_vat: () => 1 })'
      }),
      'Titan'
    )
    const calls: { method: string; path: string; body: Record<string, unknown> }[] = []
    let inFlight = 0
    const fetch = async (url: string, init?: RequestInit) => {
      inFlight++
      expect(inFlight).toBe(1)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer user-token')
      const path = new URL(url).pathname
      calls.push({
        method: init?.method ?? 'GET',
        path,
        body: init?.body ? JSON.parse(String(init.body)) : {}
      })
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      if (path === '/user') return Response.json({ login: 'ana' })
      if (path === '/user/repos') return Response.json({}, { status: 201 })
      return Response.json({}, { status: 201 })
    }
    const { url } = await publishAddon(service, 'vat', 'vat-titan117', 'MIT', 'user-token', fetch)
    expect(url).toBe('https://github.com/ana/vat-titan117')
    expect(calls[1]).toMatchObject({
      method: 'POST',
      path: '/user/repos',
      body: { name: 'vat-titan117', private: false }
    })
    const written = calls
      .filter((c) => c.method === 'PUT')
      .map((c) => c.path.split('/contents/')[1])
    expect(written.sort()).toEqual(['LICENSE', 'README.md', 'titan.json', 'tool.js'])
    const licence = calls.find((c) => c.path.endsWith('/LICENSE'))!.body.content as string
    expect(Buffer.from(licence, 'base64').toString()).toContain(
      `Copyright (c) ${new Date().getFullYear()} ana`
    )
    expect(store.get('vat')!.publishedAs).toBe('ana/vat-titan117')
  })

  it('refuses one from GitHub, a bad name, and a name already taken', async () => {
    const store = createAddonStore({ root: null, db: openDb(':memory:') })
    const service = createAddonService({ store })
    await service.installLocal(
      enc({
        'titan.json': JSON.stringify(TOOL_MANIFEST),
        'tool.js': 'titan.define({ add_vat: () => 1 })'
      }),
      'Titan'
    )
    const taken = async (url: string) =>
      new URL(url).pathname === '/user'
        ? Response.json({ login: 'ana' })
        : Response.json({}, { status: 422 })
    await expect(publishAddon(service, 'vat', '../x', 'MIT', 't', taken)).rejects.toThrow(
      /short name/
    )
    await expect(publishAddon(service, 'vat', 'vat', 'MIT', 't', taken)).rejects.toThrow(
      /already have a repository/
    )
    await expect(publishAddon(service, 'nope', 'vat', 'MIT', 't', taken)).rejects.toThrow(
      /no such add-on/
    )
  })
})
