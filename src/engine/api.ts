/**
 * The local API's routes (architecture §3). The server in lib/server.ts has
 * already checked the token and the origin before anything reaches here.
 * Errors are codes, never stack traces.
 *
 * There is deliberately no route that changes the allowed folders: those
 * change only through the folder dialog the main process shows.
 */
import {
  CLOUD_MODEL_PREFIX,
  LOCAL_API_VERSION,
  LOCAL_MODEL_PREFIX,
  type ApiErrorCode,
  type ApprovalAnswer,
  type EngineState,
  type TaskDetail,
  type KeyProvider,
  OWN_KEY_PREFIXES
} from '../shared/protocol'
import type { LocalModels } from './lib/llama'
import type { Logger } from './lib/log'
import { ModelError } from './models/types'
import { ConnectorError } from './lib/mcp'
import { SkillError } from './lib/skills'
import { MemoryError } from './memory'
import { ApprovalError, type PermissionLayer } from './permissions'
import type { Router } from './router'
import { RuntimeError, systemPrompt, type Runtime } from './runtime'
import type { Store } from './store'
import type { ConnectorHub } from './lib/mcp'
import type { SkillStore } from './lib/skills'
import type { SpeechEngine } from './lib/speech'
import type { MemoryStore } from './memory'
import type { RecordStore } from './records'
import type { CallOutcome } from './permissions'
import { ArtifactError, type ArtifactStore } from './artifacts'
import { convert, ConvertError, FORMATS, zipArtifacts, type ExportFormat } from './lib/convert'
import { SearchError, DEFAULT_SEARCH_SETTINGS, siteOf } from './lib/search'
import { ShareError, type ShareService } from './lib/share'
import { ReportError, type ReportService } from './lib/reports'
import { AppError } from './lib/apps/service'
import { NodeDownloadError } from './lib/apps/node'
import { GitError } from './lib/git'
import { PermissionError } from './lib/folders'
import type { SetupInterest, SetupState } from '../shared/protocol'
import { SEARCH_KEY_PROVIDERS, type SearchSettings } from '../shared/protocol'

export interface ApiRequest {
  method: string
  path: string
  body: unknown
  query?: Record<string, string>
  /** Set when a script of this task is calling a tool (feature 4.10). */
  scriptTask?: string
}

export interface ApiResponse {
  status: number
  body: unknown
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  LOCKED: 423
}

export interface Settings {
  defaultModel(): string | null
  setDefaultModel(model: string | null): void
  folders(): string[]
  cloudKey(): boolean
  /** Whether the engine can reach the internet (1.22). */
  online(): boolean
  cloudVia(): 'own' | 'credits' | 'dev' | null
  ownKeys(): Record<KeyProvider, boolean>
}

export function createApi(deps: {
  appVersion: string
  store: Store
  runtime: Runtime
  permissions: PermissionLayer
  router: Router
  local: LocalModels
  settings: Settings
  log: Logger
  memory?: MemoryStore
  skills?: SkillStore
  records?: RecordStore
  connectors?: ConnectorHub
  speech?: SpeechEngine
  /** A tool call from a task's script (feature 4.10). */
  scriptCall?(taskId: string, name: string, input: unknown): Promise<CallOutcome>
  artifacts?: ArtifactStore
  shares?: ShareService
  search?: { get(): SearchSettings; set(next: SearchSettings): void }
  reports?: ReportService
  notifications?: { get(): boolean; set(on: boolean): void }
  documents?: import('./lib/doc-index').DocIndex
  /** The code builder's view of a project folder (§13): its git state and changes, for the user. */
  code?: {
    project(folder: string): Promise<{
      git: import('./lib/git').GitStatus | null
      diff: string
      problem: string | null
    }>
    components(): import('./lib/code/components').ComponentStatus[]
    /** Whether agent commits carry the Titan117 co-author line (decisions §25, §54). */
    coAuthor(): boolean
    setCoAuthor(on: boolean): void
    /** The user's own coding tools (13.14): installed, signed in, turned on. */
    tools(): Promise<{
      tools: import('./lib/code/own-tools').OwnToolStatus[]
      notOffered: { name: string; why: string }[]
    }>
    setToolEnabled(id: string, on: boolean): void
    /** The user's own servers (3.15): added and removed only from the window. */
    servers(): import('./lib/ssh').Server[]
    addServer(input: { name?: unknown; target?: unknown; port?: unknown }): void
    removeServer(name: string): void
  }
  /** The Apps screen (§6, decisions §56): the user's own clicks, inside the allowed folders. */
  apps?: {
    list(): Promise<unknown>
    create(input: {
      folder: string
      title: string
      description: string
      lang?: string
      starter?: string
    }): Promise<unknown>
    setBrand(next: unknown): void
    report(folder: string): Promise<unknown>
    versions(folder: string): Promise<unknown>
    screenshot(folder: string, id: string, file: string): Promise<string>
    preview(folder: string, action: 'start' | 'stop'): Promise<{ url: string | null }>
    check(folder: string): Promise<{ started: boolean }>
    restore(folder: string, sha: string): Promise<{ sha: string }>
    github(folder: string, action: 'save' | 'stop', isPrivate: boolean): Promise<unknown>
    zip(folder: string): Promise<{ name: string; base64: string }>
    setModels(next: import('./tools/lib/define-tool').AppModels): void
  }
  setup?: {
    state(): Promise<SetupState>
    runHealth(): Promise<SetupState>
    save(next: { interests?: SetupInterest[]; done?: boolean }): void
  }
}): (request: ApiRequest) => Promise<ApiResponse> {
  const { store, runtime, permissions, router, local, settings, log } = deps

  function field(body: unknown, name: string): unknown {
    return body && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined
  }

  function need<T>(value: T | undefined): T {
    if (value === undefined) throw new ApiError(404, 'NOT_FOUND', 'Not available.')
    return value
  }

  /** Memory, skills, past tasks, connectors and speech for the window. Null when the route isn't one of these. */
  async function phase3(
    key: string,
    id: string | undefined,
    body: unknown,
    query: Record<string, string>
  ): Promise<unknown | null> {
    if (key === 'POST speech/:id') key = `POST speech/${id}`
    switch (key) {
      case 'GET memory':
        return { memories: need(deps.memory).list({ query: query.q || undefined }) }
      case 'POST memory':
        return {
          memory: need(deps.memory).add({
            scope: (field(body, 'scope') as string) ?? 'shared',
            kind: (field(body, 'kind') as string) ?? 'fact',
            text: field(body, 'text') as string,
            source: 'you'
          })
        }
      case 'PUT memory/:id':
        return {
          memory: need(deps.memory).update(id!, {
            text: field(body, 'text') as string | undefined,
            kind: field(body, 'kind') as string | undefined,
            scope: field(body, 'scope') as string | undefined
          })
        }
      case 'DELETE memory/:id':
        need(deps.memory).remove(id!)
        return { ok: true }
      case 'GET skills':
        return { skills: need(deps.skills).list() }
      case 'PUT skills/:id': {
        const existing = need(deps.skills).get(id!)
        return {
          skill: need(deps.skills).save({
            name: id!,
            description: (field(body, 'description') as string) ?? existing?.description ?? '',
            body: field(body, 'body') as string,
            source: existing ? `${existing.source}; edited by you` : 'you'
          })
        }
      }
      case 'DELETE skills/:id':
        need(deps.skills).remove(id!)
        return { ok: true }
      case 'GET records':
        return { records: need(deps.records).list({ query: query.q || undefined }) }
      case 'DELETE records/:id':
        need(deps.records).remove(id!)
        return { ok: true }
      case 'GET connectors':
        return { connectors: need(deps.connectors).list() }
      case 'POST connectors': {
        const args = field(body, 'args')
        return {
          connector: need(deps.connectors).add({
            name: field(body, 'name') as string,
            kind: field(body, 'kind') as 'stdio' | 'http',
            command: field(body, 'command') as string | undefined,
            args: Array.isArray(args) ? (args as string[]) : [],
            url: field(body, 'url') as string | undefined
          })
        }
      }
      case 'POST connectors/:id/enable':
        return {
          connector: await need(deps.connectors).setEnabled(id!, field(body, 'enabled') === true)
        }
      case 'DELETE connectors/:id':
        await need(deps.connectors).remove(id!)
        return { ok: true }
      case 'POST speech/transcribe': {
        // 16 kHz mono 16-bit samples, base64, recorded by the window's microphone button.
        const pcm = field(body, 'pcm16')
        if (typeof pcm !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'No recording.')
        const bytes = Buffer.from(pcm, 'base64')
        const ints = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2))
        const samples = Float32Array.from(ints, (v) => v / 32768)
        return { text: await need(deps.speech).transcribe(samples) }
      }
      case 'POST speech/speak': {
        const text = field(body, 'text')
        if (typeof text !== 'string' || !text.trim())
          throw new ApiError(400, 'BAD_REQUEST', 'Nothing to read aloud.')
        const wav = await need(deps.speech).synthesize(text)
        return { wav: wav.toString('base64') }
      }
      default:
        return null
    }
  }

  function cleanSearchSettings(body: unknown): SearchSettings {
    const source = field(body, 'source')
    const sources = ['auto', 'credits', ...SEARCH_KEY_PROVIDERS]
    if (typeof source !== 'string' || !sources.includes(source))
      throw new ApiError(400, 'BAD_REQUEST', `The search source is one of: ${sources.join(', ')}.`)
    const code = (value: unknown, upper: boolean): string => {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text && !/^[A-Za-z]{2}$/.test(text))
        throw new ApiError(400, 'BAD_REQUEST', 'Country and language are two-letter codes.')
      return upper ? text.toUpperCase() : text.toLowerCase()
    }
    const list = (value: unknown): string[] =>
      Array.isArray(value)
        ? [
            ...new Set(
              value
                .filter((x): x is string => typeof x === 'string')
                .map(siteOf)
                .filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x))
            )
          ].slice(0, 200)
        : []
    const sites: SearchSettings['sites'] = {}
    const raw = field(body, 'sites')
    if (raw && typeof raw === 'object')
      for (const [agent, lists] of Object.entries(raw as Record<string, unknown>).slice(0, 50))
        sites[agent.slice(0, 60)] = {
          only: list(field(lists, 'only')),
          blocked: list(field(lists, 'blocked'))
        }
    return {
      source: source as SearchSettings['source'],
      country: code(field(body, 'country'), true),
      language: code(field(body, 'language'), false),
      sites
    }
  }

  /** Artifacts, sharing and search settings for the window (phase 4). Null when the route isn't one of these. */
  async function phase4(
    key: string,
    id: string | undefined,
    body: unknown,
    query: Record<string, string>
  ): Promise<unknown | null> {
    switch (key) {
      case 'GET apps':
        return need(deps.apps).list()
      case 'POST apps': {
        const text = (name: string, max: number): string => {
          const value = field(body, name)
          if (typeof value !== 'string' || value.length > max)
            throw new ApiError(400, 'BAD_REQUEST', `"${name}" is missing or too long.`)
          return value
        }
        const lang = field(body, 'lang')
        const starter = field(body, 'starter')
        return {
          app: await need(deps.apps).create({
            folder: text('folder', 1000),
            title: text('title', 120),
            description: text('description', 300),
            ...(typeof lang === 'string' ? { lang } : {}),
            ...(typeof starter === 'string' ? { starter } : {})
          })
        }
      }
      case 'PUT apps/:id': {
        if (id !== 'brand') throw new ApiError(404, 'NOT_FOUND', 'Not found.')
        need(deps.apps).setBrand(body)
        return need(deps.apps).list()
      }
      case 'PUT apps': {
        const role = (name: string): string | null => {
          const value = field(body, name)
          return typeof value === 'string' && value.trim() ? modelId(value) : null
        }
        need(deps.apps).setModels({
          planner: role('planner'),
          coder: role('coder'),
          fixer: role('fixer'),
          quick: role('quick')
        })
        return need(deps.apps).list()
      }
      case 'GET apps/:id': {
        // `/v1/apps/report?folder=…`, `versions?folder=…`, `screenshot?folder=…&report=…&file=…`
        if (!query.folder) throw new ApiError(400, 'BAD_REQUEST', 'Which app?')
        const a = need(deps.apps)
        if (id === 'report') return { report: await a.report(query.folder) }
        if (id === 'versions') return { versions: await a.versions(query.folder) }
        if (id === 'zip') return a.zip(query.folder)
        if (id === 'screenshot')
          return { png: await a.screenshot(query.folder, query.report ?? '', query.file ?? '') }
        throw new ApiError(404, 'NOT_FOUND', 'Not found.')
      }
      case 'POST apps/:id': {
        const folder = field(body, 'folder')
        if (typeof folder !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'Which app?')
        const a = need(deps.apps)
        if (id === 'preview')
          return a.preview(folder, field(body, 'action') === 'stop' ? 'stop' : 'start')
        if (id === 'check') return a.check(folder)
        if (id === 'github')
          return a.github(
            folder,
            field(body, 'action') === 'stop' ? 'stop' : 'save',
            field(body, 'private') !== false
          )
        if (id === 'restore') {
          const sha = field(body, 'version')
          if (typeof sha !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'Which version?')
          return a.restore(folder, sha)
        }
        throw new ApiError(404, 'NOT_FOUND', 'Not found.')
      }
      case 'GET code': {
        const code = need(deps.code)
        const base = { components: code.components(), coAuthor: code.coAuthor() }
        if (!query.folder) return { ...base, project: null }
        try {
          return { ...base, project: await code.project(query.folder) }
        } catch (error) {
          throw new ApiError(400, 'BAD_REQUEST', (error as Error).message)
        }
      }
      case 'PUT code': {
        const tool = field(body, 'tool')
        const enabled = field(body, 'enabled')
        if (tool !== undefined) {
          if (!['codex', 'cursor', 'grok'].includes(tool as string) || typeof enabled !== 'boolean')
            throw new ApiError(400, 'BAD_REQUEST', 'Which experimental tool, on or off?')
          need(deps.code).setToolEnabled(tool as string, enabled)
          return need(deps.code).tools()
        }
        const on = field(body, 'coAuthor')
        if (typeof on !== 'boolean')
          throw new ApiError(400, 'BAD_REQUEST', '"coAuthor" is true or false.')
        need(deps.code).setCoAuthor(on)
        return { coAuthor: need(deps.code).coAuthor() }
      }
      case 'GET code/:id':
        if (id === 'servers') return { servers: need(deps.code).servers() }
        if (id !== 'tools') throw new ApiError(404, 'NOT_FOUND', 'Not found.')
        return need(deps.code).tools()
      case 'POST code/:id': {
        if (id !== 'servers') throw new ApiError(404, 'NOT_FOUND', 'Not found.')
        try {
          need(deps.code).addServer({
            name: field(body, 'name'),
            target: field(body, 'target'),
            port: field(body, 'port')
          })
        } catch (error) {
          throw new ApiError(400, 'BAD_REQUEST', (error as Error).message)
        }
        return { servers: need(deps.code).servers() }
      }
      case 'DELETE code/:id': {
        // `/v1/code/servers?name=…`
        if (id !== 'servers' || !query.name) throw new ApiError(404, 'NOT_FOUND', 'Not found.')
        need(deps.code).removeServer(query.name)
        return { servers: need(deps.code).servers() }
      }
      case 'GET documents':
        return { folders: need(deps.documents).status() }
      case 'PUT documents': {
        const path = field(body, 'path')
        if (typeof path !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'Which folder?')
        const flag = (name: string): boolean | undefined => {
          const v = field(body, name)
          if (v === undefined) return undefined
          if (typeof v !== 'boolean')
            throw new ApiError(400, 'BAD_REQUEST', `"${name}" is true or false.`)
          return v
        }
        try {
          need(deps.documents).setFolder(path, {
            indexed: flag('indexed'),
            readOnly: flag('readOnly'),
            localOnly: flag('localOnly')
          })
        } catch (error) {
          throw new ApiError(400, 'BAD_REQUEST', (error as Error).message)
        }
        return { folders: need(deps.documents).status() }
      }
      case 'POST documents/:id': {
        // `/v1/documents/reindex` and `/v1/documents/search` (to try a search in the window).
        if (id === 'reindex') {
          const path = field(body, 'path')
          void need(deps.documents).reindex(
            typeof path === 'string' ? path : undefined,
            field(body, 'full') === true
          )
          return { ok: true }
        }
        if (id === 'search') {
          const query = field(body, 'query')
          if (typeof query !== 'string' || !query.trim())
            throw new ApiError(400, 'BAD_REQUEST', 'Search for something.')
          return { hits: await need(deps.documents).search(query, { limit: 10 }) }
        }
        throw new ApiError(404, 'NOT_FOUND', 'Not found.')
      }
      case 'GET setup':
        return {
          ...(await need(deps.setup).state()),
          notifications: deps.notifications?.get() ?? true
        }
      case 'PUT notifications': {
        const on = field(body, 'on')
        if (typeof on !== 'boolean')
          throw new ApiError(400, 'BAD_REQUEST', '"on" is true or false.')
        need(deps.notifications).set(on)
        return { on }
      }
      case 'POST tasks/:id/resume':
        return { task: runtime.resume(id!, 'you asked') }
      // `/v1/setup/health` reads as an id here.
      case 'POST setup/:id':
        if (id !== 'health') throw new ApiError(404, 'NOT_FOUND', 'Not found.')
        return need(deps.setup).runHealth()
      case 'PUT setup': {
        const interests = field(body, 'interests')
        const done = field(body, 'done')
        const allowed = ['everyday', 'documents', 'research', 'apps', 'marketing']
        if (
          interests !== undefined &&
          (!Array.isArray(interests) || !interests.every((i) => allowed.includes(i as string)))
        )
          throw new ApiError(400, 'BAD_REQUEST', `Interests are some of: ${allowed.join(', ')}.`)
        if (done !== undefined && typeof done !== 'boolean')
          throw new ApiError(400, 'BAD_REQUEST', '"done" is true or false.')
        need(deps.setup).save({
          interests: interests as SetupInterest[] | undefined,
          done: done as boolean | undefined
        })
        return need(deps.setup).state()
      }
      case 'GET reports': {
        const reports = need(deps.reports)
        return { mode: reports.mode(), reports: reports.list(), errors: reports.recentErrors() }
      }
      case 'PUT reports': {
        const reports = need(deps.reports)
        return { mode: reports.setMode(field(body, 'mode')) }
      }
      case 'POST reports': {
        const errorRef = field(body, 'errorRef')
        const feature = field(body, 'feature')
        return {
          report: need(deps.reports).draft({
            errorRef: typeof errorRef === 'string' ? errorRef : undefined,
            feature: typeof feature === 'string' ? feature : undefined
          })
        }
      }
      case 'POST reports/:id/send':
        return { report: await need(deps.reports).send(id!, String(field(body, 'note') ?? '')) }
      case 'DELETE reports/:id':
        need(deps.reports).discard(id!)
        return { ok: true }
      case 'GET search':
        return { settings: deps.search?.get() ?? DEFAULT_SEARCH_SETTINGS }
      case 'PUT search': {
        const next = cleanSearchSettings(body)
        need(deps.search).set(next)
        return { settings: next }
      }
      case 'GET artifacts':
        return {
          artifacts: need(deps.artifacts).list({
            query: query.q || undefined,
            taskId: query.taskId || undefined
          })
        }
      case 'POST artifacts':
        return {
          artifact: need(deps.artifacts).create({
            taskId: null,
            kind: field(body, 'kind') as string,
            title: field(body, 'title') as string,
            content: field(body, 'content') as string,
            author: 'you'
          })
        }
      case 'GET artifacts/:id':
        return need(deps.artifacts).get(id!)
      case 'GET artifacts/:id/version':
        return { version: need(deps.artifacts).version(id!, Number(query.v)) }
      case 'PUT artifacts/:id': {
        const content = field(body, 'content')
        const title = field(body, 'title')
        return {
          artifact: need(deps.artifacts).update(id!, {
            content: typeof content === 'string' ? content : undefined,
            title: typeof title === 'string' ? title : undefined,
            author: 'you',
            note: 'Your edit'
          })
        }
      }
      case 'POST artifacts/:id/restore':
        return {
          artifact: need(deps.artifacts).restore(id!, Number(field(body, 'version')), 'you')
        }
      case 'DELETE artifacts/:id': {
        const store = need(deps.artifacts)
        const shareId = store.shareId(id!)
        // A deleted artifact doesn't stay shared.
        if (shareId) await need(deps.shares).unshare(shareId)
        store.remove(id!)
        return { ok: true }
      }
      case 'GET artifacts/:id/export': {
        const store = need(deps.artifacts)
        const detail = store.get(id!)
        const version = query.v ? store.version(id!, Number(query.v)) : detail.current
        const format = query.format as ExportFormat
        if (!FORMATS[detail.artifact.kind].includes(format))
          throw new ApiError(
            400,
            'BAD_REQUEST',
            `A ${detail.artifact.kind} can't be downloaded as .${format}.`
          )
        const file = await convert(detail.artifact, version.content, format)
        return { name: file.name, mime: file.mime, base64: file.data.toString('base64') }
      }
      case 'POST artifacts/:id': {
        // `/v1/artifacts/zip`: several artifacts (or versions) as one ZIP (17.21, 17.22).
        if (id !== 'zip') throw new ApiError(404, 'NOT_FOUND', 'Not found.')
        const store = need(deps.artifacts)
        const raw = field(body, 'items')
        if (!Array.isArray(raw) || !raw.length || raw.length > 50)
          throw new ApiError(400, 'BAD_REQUEST', 'Choose between 1 and 50 artifacts.')
        const items = raw.map((entry) => {
          const artifactId = String(field(entry, 'id') ?? '')
          const v = field(entry, 'version')
          const detail = store.get(artifactId)
          const version = typeof v === 'number' ? store.version(artifactId, v) : detail.current
          return {
            artifact: detail.artifact,
            content: version.content,
            version: version.version !== detail.artifact.version ? version.version : undefined
          }
        })
        const zip = await zipArtifacts(items, field(body, 'every') === true)
        const name =
          items.length === 1
            ? `${items[0].artifact.title.replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'Artifact'}.zip`
            : `Titan117 artifacts (${items.length}).zip`
        return { name, base64: zip.toString('base64') }
      }
      case 'POST artifacts/:id/share': {
        const store = need(deps.artifacts)
        const { artifact } = store.get(id!)
        const html = field(body, 'html')
        if (typeof html !== 'string' || !html)
          throw new ApiError(400, 'BAD_REQUEST', 'Nothing to share.')
        const old = store.shareId(id!)
        const shared = await need(deps.shares).share({
          title: artifact.title,
          kind: artifact.kind,
          html
        })
        // Sharing again gives a new link and removes the old one's snapshot.
        if (old)
          await need(deps.shares)
            .unshare(old)
            .catch(() => undefined)
        return { artifact: store.setShare(id!, shared) }
      }
      case 'GET artifacts/:id/comments':
      case 'POST artifacts/:id/comments': {
        const shareId = need(deps.artifacts).shareId(id!)
        if (!shareId) throw new ApiError(400, 'BAD_REQUEST', 'This artifact is not shared.')
        const op = field(body, 'op')
        const comments = await need(deps.shares).comments(
          shareId,
          op === 'reply'
            ? { op: 'reply', text: String(field(body, 'text') ?? '') }
            : op === 'hide'
              ? {
                  op: 'hide',
                  commentId: String(field(body, 'commentId') ?? ''),
                  hidden: field(body, 'hidden') === true
                }
              : { op: 'list' }
        )
        return { comments }
      }
      case 'DELETE artifacts/:id/share': {
        const store = need(deps.artifacts)
        const shareId = store.shareId(id!)
        if (shareId) await need(deps.shares).unshare(shareId)
        return { artifact: store.setShare(id!, null) }
      }
      default:
        return null
    }
  }

  function modelId(value: unknown): string {
    const prefixes = [LOCAL_MODEL_PREFIX, CLOUD_MODEL_PREFIX, ...Object.values(OWN_KEY_PREFIXES)]
    if (typeof value !== 'string' || !prefixes.some((p) => value.startsWith(p)))
      throw new ApiError(400, 'BAD_REQUEST', 'Choose a model first.')
    return value
  }

  async function route({
    method,
    path,
    body,
    query = {},
    scriptTask
  }: ApiRequest): Promise<unknown> {
    const parts = path
      .split('/')
      .filter(Boolean)
      .map((p) => decodeURIComponent(p))
    if (parts[0] !== 'v1') throw new ApiError(404, 'NOT_FOUND', 'Not found.')
    const [, area, id, action] = parts
    const key = `${method} ${area}${id ? '/:id' : ''}${action ? `/${action}` : ''}`

    // A script's token reaches only its own task's tools, through the permission layer.
    if (scriptTask || key === 'POST tool-calls') {
      if (!scriptTask || key !== 'POST tool-calls' || !deps.scriptCall)
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed.')
      const outcome = await deps.scriptCall(
        scriptTask,
        field(body, 'name') as string,
        field(body, 'input') ?? {}
      )
      return { ok: outcome.status === 'done', status: outcome.status, output: outcome.output }
    }

    const extra = await phase3(key, id, body, query)
    if (extra !== null) return extra
    const more = await phase4(key, id, body, query)
    if (more !== null) return more

    switch (key) {
      case 'GET state': {
        const state: EngineState = {
          apiVersion: LOCAL_API_VERSION,
          appVersion: deps.appVersion,
          folders: settings.folders(),
          defaultModel: settings.defaultModel(),
          cloudKey: settings.cloudKey(),
          online: settings.online(),
          cloudVia: settings.cloudVia(),
          ownKeys: settings.ownKeys(),
          hardware: local.hardware(),
          localProblem: local.problem(),
          localChecking: local.checking(),
          tasks: store.listTasks(),
          approvals: store.listApprovals({ status: 'pending' }),
          localModels: await local.list()
        }
        return state
      }

      case 'POST tasks':
        return {
          task: runtime.start(
            field(body, 'text') as string,
            modelId(field(body, 'model')),
            field(body, 'mode') === 'research' ? 'research' : 'normal'
          )
        }

      case 'GET tasks/:id': {
        const task = store.getTask(id)
        if (!task) throw new ApiError(404, 'NOT_FOUND', 'No such task.')
        const detail: TaskDetail = {
          task,
          messages: store.listMessages(id),
          approvals: store.listApprovals({ taskId: id }),
          activity: store.listActivity(id)
        }
        return detail
      }

      case 'POST tasks/:id/messages': {
        const model = field(body, 'model')
        return {
          task: runtime.send(id, field(body, 'text') as string, model ? modelId(model) : undefined)
        }
      }

      case 'POST tasks/:id/cancel':
        if (!store.getTask(id)) throw new ApiError(404, 'NOT_FOUND', 'No such task.')
        runtime.cancel(id)
        return { ok: true }

      case 'POST approvals/:id': {
        const answer = field(body, 'answer')
        if (answer !== 'approve' && answer !== 'always' && answer !== 'deny')
          throw new ApiError(400, 'BAD_REQUEST', 'Answer approve, always or deny.')
        // The local API is the laptop's own window. Remote answers will come
        // through the cloud bridge (phase 15) marked as remote.
        permissions.answer(id, answer as ApprovalAnswer, 'window')
        return { ok: true }
      }

      case 'GET models':
        return {
          local: await local.list(),
          cloud: await router.cloudModels().catch(() => []),
          own: await router.ownKeyModels(),
          cloudKey: settings.cloudKey()
        }

      case 'POST models/:id/download':
        // Not awaited: progress arrives as events.
        local.download(id).catch((error) => {
          if (!(error instanceof Error && error.name === 'AbortError'))
            log.capture('model-download', error, { model: id })
        })
        return { ok: true }

      case 'POST models/:id/cancel':
        await local.cancelDownload(id)
        return { ok: true }

      case 'DELETE models/:id':
        await local.remove(id)
        return { ok: true }

      case 'POST estimate': {
        const model = modelId(field(body, 'model'))
        const taskId = field(body, 'taskId')
        const text = field(body, 'text')
        const history =
          typeof taskId === 'string' ? store.listMessages(taskId).map((m) => m.message) : []
        return router.estimate(
          model,
          [...history, { role: 'user', text: typeof text === 'string' ? text : '' }],
          systemPrompt(settings.folders())
        )
      }

      case 'PUT settings': {
        const model = field(body, 'defaultModel')
        settings.setDefaultModel(model === null ? null : modelId(model))
        return { defaultModel: settings.defaultModel() }
      }

      default:
        throw new ApiError(404, 'NOT_FOUND', 'Not found.')
    }
  }

  return async (request) => {
    try {
      return { status: 200, body: await route(request) }
    } catch (error) {
      if (error instanceof ApiError)
        return { status: error.status, body: { error: error.code, message: error.message } }
      if (error instanceof RuntimeError || error instanceof ApprovalError)
        return { status: STATUS[error.code], body: { error: error.code, message: error.message } }
      if (
        error instanceof ModelError ||
        error instanceof MemoryError ||
        error instanceof SkillError ||
        error instanceof ConnectorError ||
        error instanceof SearchError ||
        error instanceof ConvertError ||
        error instanceof ShareError ||
        error instanceof ReportError ||
        error instanceof AppError ||
        error instanceof GitError ||
        error instanceof NodeDownloadError ||
        error instanceof PermissionError
      )
        return { status: 400, body: { error: 'BAD_REQUEST', message: error.message } }
      if (error instanceof ArtifactError)
        return {
          status: error.code === 'NOT_FOUND' ? 404 : 400,
          body: { error: error.code, message: error.message }
        }
      const ref = log.capture('api', error, { method: request.method, path: request.path })
      return {
        status: 500,
        body: { error: 'INTERNAL', message: `Something went wrong (ref ${ref.slice(0, 8)}).` }
      }
    }
  }
}
