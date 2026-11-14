// What the window knows, kept in step with the engine's events.
import type {
  Activity,
  Approval,
  CloudModel,
  EngineEvent,
  EngineState,
  LocalModel,
  StoredMessage,
  Task,
  TaskDetail
} from '../../shared/protocol'

export type View =
  { kind: 'start' } | { kind: 'task'; id: string } | { kind: 'approvals' } | { kind: 'models' }

export interface AppState {
  status: 'connecting' | 'ready' | 'lost'
  engine: EngineState | null
  cloud: CloudModel[]
  tasks: Task[]
  approvals: Approval[]
  details: Record<string, TaskDetail>
  /** Text streaming in for a task's current step. */
  streaming: Record<string, string>
  view: View
  showDetails: boolean
  model: string | null
  problem: string | null
}

export const initialState: AppState = {
  status: 'connecting',
  engine: null,
  cloud: [],
  tasks: [],
  approvals: [],
  details: {},
  streaming: {},
  view: { kind: 'start' },
  showDetails: true,
  model: null,
  problem: null
}

export type Action =
  | { type: 'loaded'; engine: EngineState }
  | { type: 'cloud'; models: CloudModel[] }
  | { type: 'detail'; detail: TaskDetail }
  | { type: 'event'; event: EngineEvent }
  | { type: 'view'; view: View }
  | { type: 'toggleDetails' }
  | { type: 'model'; model: string | null }
  | { type: 'lost' }
  | { type: 'problem'; message: string | null }

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
      return { ...state, cloud: action.models }
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
  }
}
