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
          task: runtime.start(field(body, 'text') as string, modelId(field(body, 'model')))
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
        error instanceof ConnectorError
      )
        return { status: 400, body: { error: 'BAD_REQUEST', message: error.message } }
      const ref = log.capture('api', error, { method: request.method, path: request.path })
      return {
        status: 500,
        body: { error: 'INTERNAL', message: `Something went wrong (ref ${ref.slice(0, 8)}).` }
      }
    }
  }
}
