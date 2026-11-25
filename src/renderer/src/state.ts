// What the window knows, kept in step with the engine's events.
import type {
  Activity,
  Approval,
  CloudModel,
  OwnKeyModel,
  EngineEvent,
  EngineState,
  LocalModel,
  StoredMessage,
  Task,
  TaskDetail
} from '../../shared/protocol'

export type View =
  | { kind: 'start' }
  | { kind: 'task'; id: string }
  | { kind: 'approvals' }
  | { kind: 'models' }
  | { kind: 'memory' }
  | { kind: 'connectors' }
  | { kind: 'artifacts' }
  | { kind: 'search' }
  | { kind: 'setup' }
  | { kind: 'documents' }
  | { kind: 'code' }
  | { kind: 'apps' }
  /** The team (4.2-4.4) and comparing models (2.8). */
  | { kind: 'agents' }
  | { kind: 'compare' }
  /** Schedules, web watches and recordings (phase 13). */
  | { kind: 'automations' }
  | { kind: 'remote' }
  /** The brand kit, the content calendar and promo videos (phase 14). */
  | { kind: 'marketing' }
  /** A sidebar app (6.2), by its id. */
  | { kind: 'sidebar-app'; id: string }

export interface AppState {
  status: 'connecting' | 'ready' | 'lost'
  engine: EngineState | null
  cloud: CloudModel[]
  /** Models reachable with the user's own API keys. */
  own: OwnKeyModel[]
  tasks: Task[]
  approvals: Approval[]
  details: Record<string, TaskDetail>
  /** Text streaming in for a task's current step. */
  streaming: Record<string, string>
  view: View
  showDetails: boolean
  model: string | null
  problem: string | null
  /** Bumped when memory, skills, past tasks or connectors change: their views reload. */
  changed: Record<string, number>
  /** The artifact open beside the chat (17.1), and whether it fills the window. */
  artifact: string | null
  artifactFull: boolean
  /** The last caught error, for "Something went wrong" (19.2). */
  lastError: { errorId: string; source: string } | null
  /** The report dialog, when open. */
  report: { errorRef?: string; feature?: string } | null
}

export const initialState: AppState = {
  status: 'connecting',
  engine: null,
  cloud: [],
  own: [],
  tasks: [],
  approvals: [],
  details: {},
  streaming: {},
  view: { kind: 'start' },
  showDetails: true,
  model: null,
  problem: null,
  changed: {},
  artifact: null,
  artifactFull: false,
  lastError: null,
  report: null
}

export type Action =
  | { type: 'loaded'; engine: EngineState }
  | { type: 'cloud'; models: CloudModel[]; own: OwnKeyModel[] }
  | { type: 'detail'; detail: TaskDetail }
  | { type: 'event'; event: EngineEvent }
  | { type: 'view'; view: View }
  | { type: 'toggleDetails' }
  | { type: 'model'; model: string | null }
  | { type: 'lost' }
  | { type: 'problem'; message: string | null }
  | { type: 'artifact'; id: string | null }
  | { type: 'artifactFull' }
  | { type: 'report'; report: AppState['report'] }
  | { type: 'dismissError' }

function upsert<T extends { id: string }>(list: T[], item: T, front = false): T[] {
  const index = list.findIndex((x) => x.id === item.id)
  if (index < 0) return front ? [item, ...list] : [...list, item]
  const next = list.slice()
  next[index] = item
  return next
}

function withDetail(
  state: AppState,
  taskId: string,
  change: (detail: TaskDetail) => TaskDetail
): AppState {
  const detail = state.details[taskId]
  return detail ? { ...state, details: { ...state.details, [taskId]: change(detail) } } : state
}

function onEvent(state: AppState, event: EngineEvent): AppState {
  switch (event.type) {
    case 'task': {
      const tasks = upsert(state.tasks, event.task, true).sort((a, b) => b.updatedAt - a.updatedAt)
      return withDetail({ ...state, tasks }, event.task.id, (d) => ({ ...d, task: event.task }))
    }
    case 'message': {
      const { taskId } = event.message
      const streaming = { ...state.streaming }
      if (event.message.message.role === 'assistant') delete streaming[taskId]
      return withDetail({ ...state, streaming }, taskId, (d) => ({
        ...d,
        messages: upsert<StoredMessage>(d.messages, event.message)
      }))
    }
    case 'delta':
      return {
        ...state,
        streaming: {
          ...state.streaming,
          [event.taskId]: (state.streaming[event.taskId] ?? '') + event.text
        }
      }
    case 'approval': {
      const approvals =
        event.approval.status === 'pending'
          ? upsert(state.approvals, event.approval)
          : state.approvals.filter((a) => a.id !== event.approval.id)
      return withDetail({ ...state, approvals }, event.approval.taskId, (d) => ({
        ...d,
        approvals: upsert<Approval>(d.approvals, event.approval)
      }))
    }
    case 'activity':
      return withDetail(state, event.activity.taskId, (d) => ({
        ...d,
        activity: upsert<Activity>(d.activity, event.activity)
      }))
    case 'folders':
      return state.engine
        ? { ...state, engine: { ...state.engine, folders: event.folders } }
        : state
    case 'localModel':
      return state.engine
        ? {
            ...state,
            engine: {
              ...state.engine,
              localModels: upsert<LocalModel>(state.engine.localModels, event.model)
            }
          }
        : state
    case 'settings':
      return state.engine
        ? {
            ...state,
            model: event.defaultModel ?? state.model,
            engine: { ...state.engine, defaultModel: event.defaultModel }
          }
        : state
    case 'local':
      return state.engine
        ? {
            ...state,
            engine: {
              ...state.engine,
              hardware: event.hardware,
              localProblem: event.localProblem,
              localModels: event.localModels,
              localChecking: false
            }
          }
        : state
    case 'online':
      return state.engine ? { ...state, engine: { ...state.engine, online: event.online } } : state
    case 'error':
      return { ...state, lastError: { errorId: event.errorId, source: event.source } }
    case 'artifact':
      // What an agent makes opens beside the chat (17.1).
      return { ...state, artifact: event.artifact.id }
    case 'changed':
      return {
        ...state,
        changed: { ...state.changed, [event.what]: (state.changed[event.what] ?? 0) + 1 }
      }
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        status: 'ready',
        engine: action.engine,
        tasks: action.engine.tasks,
        approvals: action.engine.approvals,
        model: state.model ?? action.engine.defaultModel
      }
    case 'cloud':
      return { ...state, cloud: action.models, own: action.own }
    case 'detail':
      return { ...state, details: { ...state.details, [action.detail.task.id]: action.detail } }
    case 'event':
      return onEvent(state, action.event)
    case 'view':
      return { ...state, view: action.view, problem: null }
    case 'toggleDetails':
      return { ...state, showDetails: !state.showDetails }
    case 'model':
      return { ...state, model: action.model }
    case 'lost':
      return { ...state, status: 'lost' }
    case 'problem':
      return { ...state, problem: action.message }
    case 'artifact':
      return { ...state, artifact: action.id, artifactFull: action.id ? state.artifactFull : false }
    case 'artifactFull':
      return { ...state, artifactFull: !state.artifactFull }
    case 'report':
      return { ...state, report: action.report, lastError: action.report ? null : state.lastError }
    case 'dismissError':
      return { ...state, lastError: null }
  }
}
