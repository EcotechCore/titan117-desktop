/**
 * Sidebar apps (6.2, 6.11, 6.14; decisions §58): a web app made with the
 * app builder, added to the Titan117 sidebar. It gets the `titan` SDK and a
 * `titan.json` that says which collections it keeps and which other apps'
 * data it reads or writes. The user agrees to exactly that when adding it,
 * and again when a new version asks for more.
 *
 * The sidebar runs a checked build, never the working folder: adding or
 * updating saves a version, runs the app's checks, and copies its `dist`
 * into the engine's data folder (`sidebar-apps/<id>/builds/<version>`),
 * which the window serves from `titan117://<id>.apps/` inside a sandboxed
 * frame with no network. The app reaches its data only through the calls
 * below, which the window relays.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { APP_ID, checkCollection, DataError, type DataLayer, type Query } from './data'
import { AppError, type AppService } from './service'
import { slugOf } from './template'

import { AGENTS_MARK, AGENTS_NOTES, MANIFEST, manifestText, SDK_PATH, SDK_SOURCE } from './sdk'

export interface Manifest {
  name: string
  /** A short word for the sidebar's icon (users, box, receipt, …). */
  icon: string
  /** Collections this app keeps (for people and agents reading the data). */
  collections: string[]
  /** Other apps' collections it reads: "inventory/items", or "inventory/*" for all of them. */
  reads: string[]
  /** Other apps' collections it changes. */
  writes: string[]
  /** Whether it asks the user's model questions (`titan.ai`): costs credits, sends what it asks. */
  ai: boolean
}

export interface Grants {
  reads: string[]
  writes: string[]
  /** May ask the user's model (`titan.ai`); off unless agreed. */
  ai?: boolean
}

/** `titan.ai` calls per app per day, at most. */
export const AI_CALLS_PER_DAY = 100
const MAX_PROMPT = 20_000

export interface SidebarApp {
  id: string
  folder: string
  title: string
  icon: string
  collections: string[]
  /** The version (commit) the sidebar runs. */
  build: string
  grants: Grants
  addedAt: number
  updatedAt: number
  /** Today's `titan.ai` use: the day (YYYY-MM-DD), calls and cost. */
  ai?: { day: string; calls: number; usd: number }
  /** The last error the app reported, for "Fix with Titan" (6.14). */
  error: { message: string; at: number } | null
}

export interface Review {
  id: string
  title: string
  manifest: Manifest
  /** What the user agrees to: other apps' data, by name. */
  reads: { ref: string; app: string | null }[]
  writes: { ref: string; app: string | null }[]
  /** Whether it's already in the sidebar (then this is an update). */
  added: boolean
}

export type UpdateResult =
  { status: 'updated'; app: SidebarApp } | { status: 'review'; review: Review }

const KEEP_BUILDS = 3
const REF = /^([a-z0-9][a-z0-9-]{0,59})\/([a-z][a-z0-9_]{0,39}|\*)$/
const ICONS = [
  'app',
  'users',
  'box',
  'receipt',
  'calendar',
  'chart',
  'list',
  'truck',
  'tag',
  'book'
]

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((x): x is string => typeof x === 'string'))].slice(0, 50)
    : []
}

/** `titan.json`, checked; a missing file gives the defaults for this app. */
export function readManifest(dir: string, fallbackName: string): Manifest {
  let raw: Record<string, unknown> = {}
  const file = join(dir, MANIFEST)
  if (existsSync(file)) {
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      throw new AppError('titan.json isn’t valid JSON. Fix it (or ask Titan to) and try again.')
    }
  }
  const collections = list(raw.collections)
  for (const c of collections)
    try {
      checkCollection(c)
    } catch (error) {
      throw new AppError(`titan.json: ${(error as Error).message}`)
    }
  const refs = (name: 'reads' | 'writes'): string[] => {
    const out = list(raw[name])
    for (const r of out)
      if (!REF.test(r))
        throw new AppError(
          `titan.json "${name}": "${r.slice(0, 80)}" isn't another app's collection, like "inventory/items".`
        )
    return out
  }
  const name =
    typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : fallbackName
  const icon = typeof raw.icon === 'string' && ICONS.includes(raw.icon) ? raw.icon : 'app'
  return {
    name,
    icon,
    collections,
    reads: refs('reads'),
    writes: refs('writes'),
    ai: raw.ai === true
  }
}

/** Whether a grant list covers `app/collection`. */
export function covers(grants: string[], app: string, collection: string): boolean {
  return grants.includes(`${app}/${collection}`) || grants.includes(`${app}/*`)
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x))

/** What the manifest asks for beyond what the user already agreed to. */
function asksMore(manifest: Manifest, grants: Grants): boolean {
  return (
    manifest.reads.some((r) => !grants.reads.includes(r)) ||
    manifest.writes.some((w) => !grants.writes.includes(w)) ||
    (manifest.ai && !grants.ai)
  )
}

export interface SidebarService {
  list(): SidebarApp[]
  get(id: string): SidebarApp | null
  byFolder(folder: string): SidebarApp | null
  /** What adding (or updating) this app would let it reach. */
  review(folder: string): Review
  /** Add the app: the SDK, a version, its checks, and a build in the sidebar. `grants` must be what the review showed. */
  add(folder: string, grants: Grants, onProgress?: (note: string) => void): Promise<SidebarApp>
  /** A new build of an app already in the sidebar; asks for a review if it wants more data. */
  update(folder: string, onProgress?: (note: string) => void): Promise<UpdateResult>
  remove(id: string, options?: { deleteData?: boolean }): Promise<void>
  /** The builds kept for going back (decisions §58.4, §66.7), newest first. */
  builds(id: string): { build: string; at: number; current: boolean }[]
  /** Put the build before the one in use back in the sidebar (decisions §66.7). */
  rollback(id: string): Promise<SidebarApp>
  /** A call from the app's frame, relayed by the window (`ai.ask` answers later). */
  call(id: string, method: string, args: unknown): unknown
  /** Data for Titan (the user's agent), across every sidebar app. */
  data: DataLayer
  /** Before a build: a sidebar app (one with titan.json) gets the current SDK; true when it changed. */
  refreshSdk(folder: string): Promise<boolean>
  /** Where a build's files are, for the window's `titan117://<id>.apps/`. */
  root: string
}

export function createSidebarService(deps: {
  root: string
  apps: AppService
  data: DataLayer
  registry(): SidebarApp[]
  setRegistry(next: SidebarApp[]): void
  userName?: () => string | null
  /** One question to the user's default model, for `titan.ai` (no tools). */
  ai?: (input: {
    app: string
    title: string
    prompt: string
  }) => Promise<{ text: string; costUsd: number; model: string }>
  onChange?: () => void
}): SidebarService {
  const { apps, data, root } = deps

  const all = (): SidebarApp[] => deps.registry()
  function save(next: SidebarApp[]): void {
    deps.setRegistry(next)
    deps.onChange?.()
  }
  function put(app: SidebarApp): void {
    save([...all().filter((a) => a.id !== app.id), app])
  }
  const byFolder = (folder: string): SidebarApp | null =>
    all().find((a) => a.folder === folder) ?? null

  function idFor(folder: string): string {
    const known = byFolder(folder)
    if (known) return known.id
    const base = slugOf(basename(folder)).slice(0, 50) || 'app'
    const taken = new Set(all().map((a) => a.id))
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    return id
  }

  function review(folder: string): Review {
    const info = apps.info(folder)
    if (info.kind !== 'web')
      throw new AppError(
        'Only a website or web app goes in the sidebar; mobile and desktop apps run on their own.'
      )
    const manifest = readManifest(folder, info.title)
    const name = (ref: string): string | null => {
      const id = ref.split('/')[0]
      return all().find((a) => a.id === id)?.title ?? null
    }
    return {
      id: idFor(folder),
      title: manifest.name,
      manifest,
      reads: manifest.reads.map((ref) => ({ ref, app: name(ref) })),
      writes: manifest.writes.map((ref) => ({ ref, app: name(ref) })),
      added: !!byFolder(folder)
    }
  }

  /** The SDK, titan.json and the agent notes, saved as a version when anything changed. */
  async function prepare(folder: string, title: string): Promise<void> {
    await mkdir(join(folder, 'src'), { recursive: true })
    const sdkFile = join(folder, SDK_PATH)
    if (!existsSync(sdkFile) || (await readFile(sdkFile, 'utf8')) !== SDK_SOURCE)
      await writeFile(sdkFile, SDK_SOURCE)
    const manifestFile = join(folder, MANIFEST)
    if (!existsSync(manifestFile)) await writeFile(manifestFile, manifestText(title))
    const agents = join(folder, 'AGENTS.md')
    const notes = existsSync(agents) ? await readFile(agents, 'utf8') : ''
    if (!notes.includes(AGENTS_MARK)) await writeFile(agents, notes + AGENTS_NOTES)
  }

  /** Save, check and copy the build; returns the version it ran. */
  async function build(
    folder: string,
    message: string,
    onProgress?: (note: string) => void
  ): Promise<string> {
    await apps.saveVersion(folder, message)
    const report = await apps.check(folder, { browsers: false, onProgress })
    if (!report.passed)
      throw new AppError(
        `The app's checks didn't pass, so the sidebar keeps what it had. Ask Titan to fix it:\n${report.summary.slice(0, 1500)}`
      )
    const dist = join(folder, 'dist')
    if (!existsSync(join(dist, 'index.html')))
      throw new AppError('The build made no dist/index.html.')
    const [head] = await apps.versions(folder)
    if (!head) throw new AppError('The app has no saved version.')
    return head.sha.slice(0, 12)
  }

  async function install(id: string, folder: string, version: string): Promise<void> {
    const builds = join(root, id, 'builds')
    const target = join(builds, version)
    await rm(target, { recursive: true, force: true })
    await mkdir(builds, { recursive: true })
    await cp(join(folder, 'dist'), target, { recursive: true })
    await writeFile(join(root, id, 'current.json'), JSON.stringify({ build: version }) + '\n')
    // Older builds go; the last few stay for going back.
    const keep = new Set([version])
    const older = readdirSync(builds).filter((b) => !keep.has(b))
    for (const old of older.slice(0, Math.max(0, older.length - (KEEP_BUILDS - 1))))
      await rm(join(builds, old), { recursive: true, force: true })
  }

  /** `titan.ai.ask`: only when agreed, a daily limit, one plain question to the user's model. */
  async function askModel(app: SidebarApp, a: Record<string, unknown>): Promise<{ text: string }> {
    if (!app.grants.ai)
      throw new DataError(
        `${app.title} may not ask the AI model. Set "ai": true in titan.json; you'll be asked when the app is updated.`
      )
    if (!deps.ai) throw new DataError('The AI model isn’t available here.')
    const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : ''
    if (!prompt) throw new DataError('Ask something.')
    if (prompt.length > MAX_PROMPT)
      throw new DataError(
        `That question is too long (${MAX_PROMPT.toLocaleString('en')} characters at most).`
      )
    const day = new Date().toISOString().slice(0, 10)
    const used = app.ai?.day === day ? app.ai : { day, calls: 0, usd: 0 }
    if (used.calls >= AI_CALLS_PER_DAY)
      throw new DataError(
        `${app.title} asked the AI model ${AI_CALLS_PER_DAY} times today; that's the daily limit.`
      )
    // Count the call before it runs, so a burst can't pass the limit.
    const latest = service.get(app.id) ?? app
    put({ ...latest, ai: { ...used, calls: used.calls + 1 } })
    const answer = await deps.ai({ app: app.id, title: app.title, prompt })
    const now = service.get(app.id)
    if (now && now.ai?.day === day)
      put({ ...now, ai: { ...now.ai, usd: Math.round((now.ai.usd + answer.costUsd) * 1e6) / 1e6 } })
    return { text: answer.text }
  }

  const service: SidebarService = {
    root,
    data,
    list: () => [...all()].sort((a, b) => a.addedAt - b.addedAt),
    get: (id) => all().find((a) => a.id === id) ?? null,
    byFolder,
    review,

    async refreshSdk(folder) {
      if (!existsSync(join(folder, MANIFEST))) return false
      const sdkFile = join(folder, SDK_PATH)
      if (existsSync(sdkFile) && (await readFile(sdkFile, 'utf8')) === SDK_SOURCE) return false
      await mkdir(join(folder, 'src'), { recursive: true })
      await writeFile(sdkFile, SDK_SOURCE)
      return true
    },

    async add(folder, grants, onProgress) {
      const before = review(folder)
      if (
        !sameSet(grants.reads, before.manifest.reads) ||
        !sameSet(grants.writes, before.manifest.writes) ||
        !!grants.ai !== before.manifest.ai
      )
        throw new AppError('What the app asks for changed since you looked. Look again and add it.')
      const info = apps.info(folder)
      await prepare(folder, info.title)
      // prepare may have written titan.json; read it again (same asks when it existed).
      const manifest = readManifest(folder, info.title)
      if (asksMore(manifest, grants))
        throw new AppError('What the app asks for changed. Look again and add it.')
      const version = await build(
        folder,
        before.added ? 'Updated in the Titan117 sidebar' : 'Added to the Titan117 sidebar',
        onProgress
      )
      await install(before.id, folder, version)
      const known = byFolder(folder)
      const now = Date.now()
      const app: SidebarApp = {
        id: before.id,
        folder,
        title: manifest.name,
        icon: manifest.icon,
        collections: manifest.collections,
        build: version,
        grants: { reads: [...grants.reads], writes: [...grants.writes], ai: !!grants.ai },
        addedAt: known?.addedAt ?? now,
        updatedAt: now,
        error: null
      }
      put(app)
      return app
    },

    async update(folder, onProgress) {
      const known = byFolder(folder)
      if (!known) throw new AppError('That app isn’t in the sidebar. Add it first.')
      const manifest = readManifest(folder, known.title)
      if (asksMore(manifest, known.grants)) return { status: 'review', review: review(folder) }
      await prepare(folder, known.title)
      const version = await build(folder, 'Updated in the Titan117 sidebar', onProgress)
      await install(known.id, folder, version)
      const app: SidebarApp = {
        ...known,
        title: manifest.name,
        icon: manifest.icon,
        collections: manifest.collections,
        build: version,
        // Asking for less narrows what it has.
        grants: {
          reads: known.grants.reads.filter((r) => manifest.reads.includes(r)),
          writes: known.grants.writes.filter((w) => manifest.writes.includes(w)),
          ai: !!known.grants.ai && manifest.ai
        },
        updatedAt: Date.now(),
        error: null
      }
      put(app)
      return { status: 'updated', app }
    },

    builds(id) {
      const known = service.get(id)
      if (!known) return []
      const dir = join(root, id, 'builds')
      let names: string[]
      try {
        names = readdirSync(dir).filter((b) => /^[0-9a-f]{6,40}$/.test(b))
      } catch {
        return []
      }
      return names
        .map((build) => ({
          build,
          at: statSync(join(dir, build)).mtimeMs,
          current: build === known.build
        }))
        .sort((a, b) => b.at - a.at)
    },

    async rollback(id) {
      const known = service.get(id)
      if (!known) throw new AppError('That app isn’t in the sidebar.')
      const builds = service.builds(id)
      const at = builds.findIndex((b) => b.current)
      const previous = at >= 0 ? builds[at + 1] : undefined
      if (!previous) throw new AppError(`${known.title} has no earlier build to go back to.`)
      await writeFile(
        join(root, id, 'current.json'),
        `${JSON.stringify({ build: previous.build })}\n`
      )
      const app: SidebarApp = {
        ...known,
        build: previous.build,
        updatedAt: Date.now(),
        error: null
      }
      put(app)
      return app
    },

    async remove(id, options) {
      const known = service.get(id)
      if (!known) return
      save(all().filter((a) => a.id !== id))
      await rm(join(root, id, 'builds'), { recursive: true, force: true })
      await rm(join(root, id, 'current.json'), { force: true })
      if (options?.deleteData) data.drop(id)
    },

    call(id, method, args) {
      const app = service.get(id)
      if (!app) throw new AppError('This app isn’t in the sidebar any more.')
      const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
      /** "contacts" is the app's own; "inventory/items" is another app's, if granted. */
      const target = (write: boolean): { app: string; collection: string } => {
        const ref = a.collection
        if (typeof ref !== 'string') throw new DataError('Which collection?')
        const slash = ref.indexOf('/')
        if (slash < 0) {
          checkCollection(ref)
          return { app: app.id, collection: ref }
        }
        const other = ref.slice(0, slash)
        const collection = ref.slice(slash + 1)
        checkCollection(collection)
        if (other === app.id) return { app: app.id, collection }
        if (!APP_ID.test(other) || !service.get(other))
          throw new DataError(`There's no sidebar app "${other.slice(0, 60)}".`)
        const allowed = write
          ? covers(app.grants.writes, other, collection)
          : covers(app.grants.reads, other, collection) ||
            covers(app.grants.writes, other, collection)
        if (!allowed)
          throw new DataError(
            `${app.title} may not ${write ? 'change' : 'read'} ${ref}. Add it to titan.json under "${write ? 'writes' : 'reads'}"; you'll be asked when the app is updated.`
          )
        return { app: other, collection }
      }
      const query = (a.query && typeof a.query === 'object' ? a.query : undefined) as
        Query | undefined
      switch (method) {
        case 'db.collections':
          return data.collections(app.id)
        case 'db.list': {
          const t = target(false)
          return data.list(t.app, t.collection, query)
        }
        case 'db.count': {
          const t = target(false)
          return data.count(t.app, t.collection, query)
        }
        case 'db.get': {
          const t = target(false)
          return data.get(t.app, t.collection, String(a.id ?? ''))
        }
        case 'db.insert': {
          const t = target(true)
          const row = data.insert(t.app, t.collection, a.data)
          deps.onChange?.()
          return row
        }
        case 'db.update': {
          const t = target(true)
          return data.update(t.app, t.collection, String(a.id ?? ''), a.data)
        }
        case 'db.remove': {
          const t = target(true)
          return data.remove(t.app, t.collection, String(a.id ?? ''))
        }
        case 'auth.user':
          return { name: deps.userName?.() ?? null }
        case 'ai.ask':
          return askModel(app, a)
        case 'app.error': {
          const message = typeof a.message === 'string' ? a.message.slice(0, 2000) : 'An error'
          put({ ...app, error: { message, at: Date.now() } })
          return null
        }
        default:
          throw new DataError(
            `"${String(method).slice(0, 40)}" isn't something a sidebar app can do.`
          )
      }
    }
  }
  return service
}
