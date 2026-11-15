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
  type TaskDetail
} from '../shared/protocol'
import type { LocalModels } from './lib/llama'
import type { Logger } from './lib/log'
import { ModelError } from './models/types'
import { ApprovalError, type PermissionLayer } from './permissions'
import type { Router } from './router'
import { RuntimeError, systemPrompt, type Runtime } from './runtime'
import type { Store } from './store'

export interface ApiRequest {
  method: string
  path: string
  body: unknown
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
  cloudVia(): 'credits' | 'dev' | null
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
}): (request: ApiRequest) => Promise<ApiResponse> {
  const { store, runtime, permissions, router, local, settings, log } = deps

  function field(body: unknown, name: string): unknown {
    return body && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined
  }

  function modelId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !(value.startsWith(LOCAL_MODEL_PREFIX) || value.startsWith(CLOUD_MODEL_PREFIX))
    )
      throw new ApiError(400, 'BAD_REQUEST', 'Choose a model first.')
    return value
  }

  async function route({ method, path, body }: ApiRequest): Promise<unknown> {
    const parts = path.split('/').filter(Boolean)
    if (parts[0] !== 'v1') throw new ApiError(404, 'NOT_FOUND', 'Not found.')
    const [, area, id, action] = parts
    const key = `${method} ${area}${id ? '/:id' : ''}${action ? `/${action}` : ''}`

    switch (key) {
      case 'GET state': {
        const state: EngineState = {
          apiVersion: LOCAL_API_VERSION,
          appVersion: deps.appVersion,
          folders: settings.folders(),
          defaultModel: settings.defaultModel(),
          cloudKey: settings.cloudKey(),
          cloudVia: settings.cloudVia(),
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
      if (error instanceof ModelError)
        return { status: 400, body: { error: 'BAD_REQUEST', message: error.message } }
      const ref = log.capture('api', error, { method: request.method, path: request.path })
      return {
        status: 500,
        body: { error: 'INTERNAL', message: `Something went wrong (ref ${ref.slice(0, 8)}).` }
      }
    }
  }
}
