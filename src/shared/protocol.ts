/**
 * The local API's shapes, shared by the engine and the window (architecture
 * §3). Types only: nothing here may import from the engine or from Node.
 */

export const LOCAL_API_VERSION = 1

/** How risky a tool is (guardrails §4). */
export type Risk =
  /** Reads inside allowed folders. Runs without asking; always logged. */
  | 'read'
  /** Changes something on the laptop. Asks, unless the user allowed it for this task. */
  | 'write'
  /** Publish, send, post, pay, delete, push. Always asks, whatever the settings. */
  | 'external'

export type TaskStatus = 'running' | 'waiting' | 'done' | 'stopped' | 'error'

export interface Task {
  id: string
  title: string
  agent: string
  model: string
  status: TaskStatus
  /** Why a task stopped or failed, in plain words. */
  note: string | null
  steps: number
  costUsd: number
  createdAt: number
  updatedAt: number
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; callId: string; name: string; output: string; isError?: boolean }

export interface StoredMessage {
  id: string
  taskId: string
  seq: number
  createdAt: number
  message: ChatMessage
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'
export type ApprovalAnswer = 'approve' | 'always' | 'deny'

export interface Approval {
  id: string
  taskId: string
  callId: string
  tool: string
  risk: Risk
  /** One line: what will happen if the user approves. */
  summary: string
  input: Record<string, unknown>
  status: ApprovalStatus
  /** Whether "always allow in this task" is offered (never for external actions). */
  canAlways: boolean
  answeredBy: string | null
  createdAt: number
  answeredAt: number | null
}

export type ActivityKind = 'task' | 'model' | 'tool' | 'approval' | 'refused' | 'budget' | 'error'

export interface Activity {
  id: string
  taskId: string
  at: number
  kind: ActivityKind
  agent: string
  model: string | null
  tool: string | null
  summary: string
  costUsd: number
  approvedBy: string | null
}

export type ModelFit = 'runs well' | 'runs slowly' | 'too big'

export interface LocalModel {
  id: string
  name: string
  sizeBytes: number
  licence: string
  note: string
  fit: ModelFit
  state: 'not downloaded' | 'downloading' | 'ready'
  downloadedBytes: number
}

export interface CloudModel {
  id: string
  name: string
  /** US dollars per million tokens, from OpenRouter's own list. */
  inputPerMillion: number
  outputPerMillion: number
  contextLength: number
}

export interface Estimate {
  free: boolean
  /** Estimated provider cost in US dollars; null when the price is unknown. */
  usd: number | null
  label: string
}

export interface EngineState {
  apiVersion: number
  appVersion: string
  folders: string[]
  defaultModel: string | null
  /** Whether a development OpenRouter key was found. Never the key itself. */
  cloudKey: boolean
  hardware: { ramBytes: number; vramBytes: number; gpu: string | null }
  /** Why local models can't run on this laptop, or null when they can. */
  localProblem: string | null
  /** True while the engine is still finding out whether local models can run. */
  localChecking: boolean
  tasks: Task[]
  approvals: Approval[]
  localModels: LocalModel[]
}

export interface TaskDetail {
  task: Task
  messages: StoredMessage[]
  approvals: Approval[]
  activity: Activity[]
}

export type EngineEvent =
  | { type: 'task'; task: Task }
  | { type: 'message'; message: StoredMessage }
  | { type: 'delta'; taskId: string; text: string }
  | { type: 'approval'; approval: Approval }
  | { type: 'activity'; activity: Activity }
  | { type: 'folders'; folders: string[] }
  | { type: 'localModel'; model: LocalModel }
  | {
      type: 'local'
      hardware: EngineState['hardware']
      localProblem: string | null
      localModels: LocalModel[]
    }
  | { type: 'settings'; defaultModel: string | null }

/** Error codes the local API answers with. Never stack traces. */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ORIGIN'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'INTERNAL'

export const LOCAL_MODEL_PREFIX = 'local:'
export const CLOUD_MODEL_PREFIX = 'openrouter:'
