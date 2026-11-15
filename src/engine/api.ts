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
import { convert, ConvertError, FORMATS, type ExportFormat } from './lib/convert'
import { SearchError, DEFAULT_SEARCH_SETTINGS, siteOf } from './lib/search'
import { ShareError, type ShareService } from './lib/share'
import { ReportError, type ReportService } from './lib/reports'
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
        error instanceof ReportError
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
