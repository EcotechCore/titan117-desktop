/**
 * Installed add-ons (features 18.5, 18.7; decisions §66.6-66.9): each one's
 * versions under `addons/<name>/<version>/` in the app's data folder, which is
 * a core folder (no file tool, shell command or add-on can write there), the
 * version in use, rollback, and safe mode.
 *
 * What an add-on contributes is read from here on every use: its tools (run in
 * the QuickJS sandbox), its agents and skills. In safe mode it contributes
 * nothing.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { AgentDef, Skill } from '../../../shared/protocol'
import { addonToolRisk, safeAddonPath, type AddonManifest } from '../../../shared/addon-manifest'
import { defineTool, type ToolDefinition } from '../../tools/lib/define-tool'
import { getMeta, setMeta, type Db } from '../db'
import { parseAgent } from '../agents'
import { runInSandbox } from './sandbox'

/** Versions kept per add-on (the one in use and the ones before it). */
export const KEEP_VERSIONS = 5
/** Calls in a row that fail after a change before a tool add-on is switched off. */
export const FAILURES_TO_SWITCH_OFF = 3
/** Starts in a row that didn't reach a healthy minute after a change before safe mode. */
export const FAILED_STARTS_FOR_SAFE_MODE = 2
export const HEALTHY_AFTER_MS = 60_000

export class AddonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AddonError'
  }
}

export interface AddonVersion {
  /** The folder name: a commit's first 12 characters, or `v<n>` for one Titan made. */
  id: string
  version: string
  commit: string | null
  installedAt: number
  manifest: AddonManifest
}

export interface Addon {
  name: string
  type: AddonManifest['type']
  title: string
  description: string
  /** `owner/repo` for one from GitHub, null for one Titan made on the laptop. */
  repo: string | null
  /** Who installed or made it: "you", or "Titan in a task". */
  by: string
  versions: AddonVersion[]
  current: string
  enabled: boolean
  /** Why it is off, when it switched itself off. */
  offReason: string | null
  /** Failed calls in a row since the last good one. */
  failures: number
  /** Titan117 took it down after a report (decisions §66.11): off, and it can't be turned on. */
  takenDown?: boolean
  /** What an MCP server or workflow add-on made outside the store, to undo (decisions §66.21). */
  links?: AddonLinks
  /** Where the user published it on GitHub (decisions §66.23): `owner/repo`. */
  publishedAs?: string
  changedAt: number
}

export interface AddonLinks {
  /** The connector's id on Connectors. */
  connector?: string
  /** The schedule's id on Automations. */
  schedule?: string
}

export interface SafeModeState {
  on: boolean
  /** Why: "--safe-mode", or the starts that failed. */
  reason: string | null
  /** The add-on that changed last, to roll back or remove. */
  lastChanged: string | null
}

interface BootState {
  /** A start that hasn't reached a healthy minute yet. */
  pending: boolean
  failedStarts: number
  changedSinceGood: boolean
  lastChanged: string | null
  safe: { reason: string; at: number } | null
}

const BOOT_KEY = 'addonBoot'
const REGISTRY_KEY = 'addons'

export interface AddonStore {
  list(): Addon[]
  get(name: string): Addon | null
  /** Files of the version in use, for an app template or to read a tool's code. */
  file(name: string, path: string): Buffer
  dir(name: string): string | null
  install(input: {
    manifest: AddonManifest
    files: Map<string, Uint8Array>
    repo: string | null
    commit: string | null
    by: string
  }): Addon
  rollback(name: string): Addon
  remove(name: string): void
  setEnabled(name: string, enabled: boolean): Addon
  /** Our listing says it was taken down: switched off for good (decisions §66.11). */
  takeDown(name: string, reason: string): Addon
  setLinks(name: string, links: AddonLinks | undefined): void
  setPublished(name: string, repo: string): void
  /** The paths of the version in use's files. */
  files(name: string): string[]
  /** A call to one of its tools worked or failed (decisions §66.8). */
  recordCall(name: string, ok: boolean): void
  safeMode(): SafeModeState
  /** "Start normally": add-ons back on from the next start (and now). */
  leaveSafeMode(): void
  /** The app ran for a healthy minute. */
  markHealthy(): void
  tools(): ToolDefinition[]
  agents(): AgentDef[]
  skills(): Skill[]
}

function skillFrom(path: string, text: string, source: string): Skill | null {
  const base = path.split('/').pop()!.replace(/\.md$/, '')
  const name = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) return null
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  const header: Record<string, string> = {}
  for (const line of (match?.[1] ?? '').split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) header[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return {
    name,
    description: (header.description ?? '').slice(0, 300),
    source,
    body: (match ? match[2] : text).trim().slice(0, 20_000),
    updatedAt: 0
  }
}

/** The tool's name among Titan's tools. */
export function addonToolName(addon: string, tool: string): string {
  return `addon_${addon.replace(/-/g, '_')}_${tool}`
}

export function createAddonStore(deps: {
  /** `addons/` in the data folder; null keeps files in memory (tests). */
  root: string | null
  db: Db
  /** Started with `--safe-mode`. */
  forceSafeMode?: boolean
  onChange?: () => void
  now?: () => number
}): AddonStore {
  const { db } = deps
  const now = deps.now ?? Date.now
  const memory = new Map<string, Buffer>()
  const onChange = deps.onChange ?? (() => undefined)

  const all = (): Addon[] => getMeta<Addon[]>(db, REGISTRY_KEY, [])
  const save = (next: Addon[]): void => {
    setMeta(db, REGISTRY_KEY, next)
    onChange()
  }
  const boot = (): BootState =>
    getMeta<BootState>(db, BOOT_KEY, {
      pending: false,
      failedStarts: 0,
      changedSinceGood: false,
      lastChanged: null,
      safe: null
    })
  const setBoot = (next: BootState): void => setMeta(db, BOOT_KEY, next)

  // This start: the last one that never got healthy after a change counts as failed.
  {
    const b = boot()
    let failedStarts = b.failedStarts
    if (b.pending && b.changedSinceGood) failedStarts++
    let safe = b.safe
    if (!safe && failedStarts >= FAILED_STARTS_FOR_SAFE_MODE)
      safe = {
        reason: `Titan117 didn't start properly ${failedStarts} times after ${b.lastChanged ? `“${b.lastChanged}”` : 'an add-on'} changed.`,
        at: now()
      }
    setBoot({ ...b, pending: true, failedStarts, safe })
  }

  function changed(name: string): void {
    setBoot({ ...boot(), changedSinceGood: true, lastChanged: name, failedStarts: 0 })
  }

  const location = (name: string, id: string, path: string): string =>
    deps.root ? join(deps.root, name, id, ...path.split('/')) : `${name}/${id}/${path}`

  function writeFile(name: string, id: string, path: string, data: Uint8Array): void {
    const where = location(name, id, path)
    if (!deps.root) {
      memory.set(where, Buffer.from(data))
      return
    }
    mkdirSync(dirname(where), { recursive: true })
    writeFileSync(where, data)
  }

  function readFile(name: string, id: string, path: string): Buffer {
    const safe = safeAddonPath(path)
    if (!safe || safe === '.') throw new AddonError('That isn’t a file of the add-on.')
    const where = location(name, id, safe)
    if (!deps.root) {
      const data = memory.get(where)
      if (!data) throw new AddonError(`The add-on has no file ${safe}.`)
      return data
    }
    try {
      return readFileSync(where)
    } catch {
      throw new AddonError(`The add-on has no file ${safe}.`)
    }
  }

  function dropVersion(name: string, id: string): void {
    if (deps.root) rmSync(join(deps.root, name, id), { recursive: true, force: true })
    else
      for (const key of [...memory.keys()]) if (key.startsWith(`${name}/${id}/`)) memory.delete(key)
  }

  const active = (): Addon[] => (store.safeMode().on ? [] : all().filter((a) => a.enabled))
  const currentOf = (a: Addon): AddonVersion =>
    a.versions.find((v) => v.id === a.current) ?? a.versions.at(-1)!

  function sourceLabel(a: Addon, v: AddonVersion): string {
    return a.repo
      ? `add-on ${a.title} (${a.repo}@${(v.commit ?? v.id).slice(0, 7)})`
      : `add-on ${a.title}, made by Titan`
  }

  const store: AddonStore = {
    list: () => all(),
    get: (name) => all().find((a) => a.name === name) ?? null,

    file(name, path) {
      const a = store.get(name)
      if (!a) throw new AddonError('There is no such add-on.')
      return readFile(name, a.current, path)
    },

    dir(name) {
      const a = store.get(name)
      return a && deps.root ? join(deps.root, name, a.current) : null
    },

    install({ manifest, files, repo, commit, by }) {
      const list = all()
      const existing = list.find((a) => a.name === manifest.name)
      if (existing && existing.repo !== repo)
        throw new AddonError(
          `There is already an add-on called ${manifest.name} from ${existing.repo ?? 'Titan'}. Remove it first.`
        )
      if (existing && existing.type !== manifest.type)
        throw new AddonError(
          `${manifest.name} was a ${existing.type}; a new version can’t change its type.`
        )
      const id = commit
        ? commit.slice(0, 12)
        : `v${(existing?.versions.length ?? 0) + 1}-${now().toString(36)}`
      if (existing?.versions.some((v) => v.id === id) && existing.current === id)
        throw new AddonError(`${manifest.title} is already installed at that commit.`)
      dropVersion(manifest.name, id)
      for (const [path, data] of files) writeFile(manifest.name, id, path, data)
      const version: AddonVersion = {
        id,
        version: manifest.version,
        commit,
        installedAt: now(),
        manifest
      }
      const versions = [...(existing?.versions.filter((v) => v.id !== id) ?? []), version]
      for (const old of versions.splice(0, Math.max(0, versions.length - KEEP_VERSIONS)))
        dropVersion(manifest.name, old.id)
      const addon: Addon = {
        name: manifest.name,
        type: manifest.type,
        title: manifest.title,
        description: manifest.description,
        repo,
        by,
        versions,
        current: id,
        enabled: true,
        offReason: null,
        failures: 0,
        changedAt: now(),
        ...(existing?.links ? { links: existing.links } : {})
      }
      save([...list.filter((a) => a.name !== manifest.name), addon])
      changed(manifest.name)
      return addon
    },

    rollback(name) {
      const a = store.get(name)
      if (!a) throw new AddonError('There is no such add-on.')
      if (a.takenDown)
        throw new AddonError(
          `Titan117 took ${a.title} down after a report, so it stays off. Remove it.`
        )
      const at = a.versions.findIndex((v) => v.id === a.current)
      if (at <= 0) throw new AddonError(`${a.title} has no earlier version to go back to.`)
      const next: Addon = {
        ...a,
        current: a.versions[at - 1].id,
        title: a.versions[at - 1].manifest.title,
        enabled: true,
        offReason: null,
        failures: 0,
        changedAt: now()
      }
      save(all().map((x) => (x.name === name ? next : x)))
      changed(name)
      return next
    },

    remove(name) {
      const a = store.get(name)
      if (!a) throw new AddonError('There is no such add-on.')
      for (const v of a.versions) dropVersion(name, v.id)
      if (deps.root) rmSync(join(deps.root, name), { recursive: true, force: true })
      save(all().filter((x) => x.name !== name))
      changed(name)
    },

    setEnabled(name, enabled) {
      const a = store.get(name)
      if (!a) throw new AddonError('There is no such add-on.')
      if (enabled && a.takenDown)
        throw new AddonError(
          `Titan117 took ${a.title} down after a report, so it stays off. Remove it.`
        )
      const next = { ...a, enabled, offReason: null, failures: 0, changedAt: now() }
      save(all().map((x) => (x.name === name ? next : x)))
      changed(name)
      return next
    },

    setPublished(name, repo) {
      save(all().map((x) => (x.name === name ? { ...x, publishedAs: repo } : x)))
    },

    files(name) {
      const a = store.get(name)
      if (!a) throw new AddonError('There is no such add-on.')
      if (!deps.root) {
        const prefix = `${name}/${a.current}/`
        return [...memory.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length))
      }
      const base = join(deps.root, name, a.current)
      const out: string[] = []
      const walk = (dir: string, rel: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (out.length >= 2000) return
          const r = rel ? `${rel}/${e.name}` : e.name
          if (e.isDirectory()) walk(join(dir, e.name), r)
          else if (e.isFile()) out.push(r)
        }
      }
      walk(base, '')
      return out.sort()
    },

    setLinks(name, links) {
      save(all().map((x) => (x.name === name ? { ...x, links } : x)))
    },

    takeDown(name, reason) {
      const a = store.get(name)
      if (!a) throw new AddonError('There is no such add-on.')
      const next: Addon = {
        ...a,
        enabled: false,
        takenDown: true,
        offReason: reason,
        changedAt: now()
      }
      save(all().map((x) => (x.name === name ? next : x)))
      return next
    },

    recordCall(name, ok) {
      const a = store.get(name)
      if (!a) return
      if (ok) {
        if (a.failures) save(all().map((x) => (x.name === name ? { ...x, failures: 0 } : x)))
        return
      }
      const failures = a.failures + 1
      // Only right after a change: an add-on that has worked keeps working through a bad day.
      const recent = now() - a.changedAt < 7 * 24 * 3600_000
      const off = recent && failures >= FAILURES_TO_SWITCH_OFF
      save(
        all().map((x) =>
          x.name === name
            ? {
                ...x,
                failures,
                enabled: off ? false : x.enabled,
                offReason: off
                  ? `It failed ${failures} times in a row after it changed, so it was switched off. Roll it back or remove it.`
                  : x.offReason
              }
            : x
        )
      )
    },

    safeMode() {
      const b = boot()
      if (deps.forceSafeMode)
        return { on: true, reason: 'Started with --safe-mode.', lastChanged: b.lastChanged }
      return { on: b.safe !== null, reason: b.safe?.reason ?? null, lastChanged: b.lastChanged }
    },

    leaveSafeMode() {
      setBoot({ ...boot(), safe: null, failedStarts: 0, pending: false })
      onChange()
    },

    markHealthy() {
      const b = boot()
      // A healthy start in safe mode says nothing about the add-ons, which were off.
      if (b.safe || deps.forceSafeMode) setBoot({ ...b, pending: false })
      else setBoot({ ...b, pending: false, failedStarts: 0, changedSinceGood: false })
    },

    tools() {
      const out: ToolDefinition[] = []
      for (const a of active()) {
        const v = currentOf(a)
        const spec = v.manifest.tool
        if (a.type !== 'tool' || !spec) continue
        for (const t of spec.tools) {
          const risk = addonToolRisk(t.name, t.risk)
          out.push(
            defineTool<Record<string, unknown>>({
              name: addonToolName(a.name, t.name),
              description: `[Add-on: ${a.title}] ${t.description}`.slice(0, 1000),
              params: {
                type: 'object',
                properties: Object.fromEntries(
                  Object.entries(t.params.properties).map(([k, p]) => [
                    k,
                    {
                      type: p.type,
                      description: p.description || k,
                      ...(p.enum ? { enum: p.enum } : {})
                    }
                  ])
                ),
                required: t.params.required
              },
              risk,
              permissions: { addons: 'run', network: spec.hosts.length > 0 },
              // Whatever an add-on returns is someone else's text, and may carry what it read.
              untrustedOutput: true,
              privateOutput: true,
              laptopOnly: risk === 'external',
              describe: (input) => `${a.title}: ${t.name} ${JSON.stringify(input).slice(0, 300)}`,
              async run(input, ctx) {
                const code = readFile(a.name, v.id, spec.main).toString('utf8')
                try {
                  const result = await runInSandbox({
                    code,
                    tool: t.name,
                    input,
                    hosts: spec.hosts,
                    fetch: (url, init) => ctx.net.fetchOnce(url, init),
                    signal: ctx.signal
                  })
                  store.recordCall(a.name, true)
                  return {
                    output: result.output || '(no output)',
                    summary: `${a.title}: ${t.name}`
                  }
                } catch (error) {
                  store.recordCall(a.name, false)
                  throw error
                }
              }
            })
          )
        }
      }
      return out
    },

    agents() {
      const out: AgentDef[] = []
      for (const a of active()) {
        const v = currentOf(a)
        if (a.type !== 'agent' || !v.manifest.agent) continue
        try {
          const def = parseAgent(
            readFile(a.name, v.id, v.manifest.agent).toString('utf8'),
            sourceLabel(a, v)
          )
          out.push({ ...def, source: sourceLabel(a, v), updatedAt: v.installedAt })
        } catch {
          // A file that stopped parsing is left out; the Add-ons screen still lists the add-on.
        }
      }
      return out
    },

    skills() {
      const out: Skill[] = []
      for (const a of active()) {
        const v = currentOf(a)
        for (const path of v.manifest.skills) {
          try {
            const skill = skillFrom(
              path,
              readFile(a.name, v.id, path).toString('utf8'),
              sourceLabel(a, v)
            )
            if (skill && !out.some((s) => s.name === skill.name))
              out.push({ ...skill, updatedAt: v.installedAt })
          } catch {
            // Left out, as for an agent.
          }
        }
      }
      return out
    }
  }
  return store
}
