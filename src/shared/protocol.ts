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
  /** Deep research (feature 16.8) runs with a bigger budget and its own instructions. */
  mode: 'normal' | 'research'
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
  | {
      role: 'assistant'
      text: string
      toolCalls?: ToolCall[]
      /**
       * The provider's own content blocks for this turn, sent back unchanged on
       * the next turn (Anthropic's thinking blocks must be). Only that provider reads it.
       */
      raw?: { source: 'anthropic'; content: unknown[] }
    }
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
  /** Whether "always" is offered (never for external actions or the always-ask list). */
  canAlways: boolean
  /** What "always" means here when it isn't "always in this task", e.g. a command in a folder. */
  alwaysLabel: string | null
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
  /** Whether cloud models can be used now. Never a key or token itself. */
  cloudKey: boolean
  /** Whether the engine can reach the internet now (1.22). */
  online: boolean
  /** Where OpenRouter calls go: the user's own key, our credits proxy, a development key, or nowhere. */
  cloudVia: 'own' | 'credits' | 'dev' | null
  /** Which of the user's own API keys are saved (features 2.9, 11.5). Never the keys themselves. */
  ownKeys: Record<KeyProvider, boolean>
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
  /** Memory, skills, past-task records or connectors changed: the window reloads that list. */
  | {
      type: 'changed'
      what: 'memory' | 'skills' | 'records' | 'connectors' | 'artifacts' | 'reports'
    }
  /** The engine went offline or came back online (1.22). */
  | { type: 'online'; online: boolean }
  /** An error was caught (19.2): the window may offer to send a report. */
  | { type: 'error'; errorId: string; source: string }
  /** An agent made or changed an artifact: the window opens it beside the chat. */
  | { type: 'artifact'; artifact: Artifact }

/** Error codes the local API answers with. Never stack traces. */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ORIGIN'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'LOCKED'
  | 'INTERNAL'

export const LOCAL_MODEL_PREFIX = 'local:'
export const CLOUD_MODEL_PREFIX = 'openrouter:'

/** Model providers the user can add their own API key for (features 2.9, 11.5). */
export const MODEL_KEY_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'google'] as const
/** Search providers the user can add their own key for (feature 16.3, decisions §44). */
export const SEARCH_KEY_PROVIDERS = ['exa', 'tavily', 'brave'] as const
export type SearchKeyProvider = (typeof SEARCH_KEY_PROVIDERS)[number]
export const KEY_PROVIDERS = [...MODEL_KEY_PROVIDERS, ...SEARCH_KEY_PROVIDERS] as const
export type KeyProvider = (typeof KEY_PROVIDERS)[number]

/** Model ids for the user's own keys: `anthropic:claude-…`, `openai:…`, `google:gemini-…`. */
export const OWN_KEY_PREFIXES = {
  anthropic: 'anthropic:',
  openai: 'openai:',
  google: 'google:'
} as const
export type DirectProvider = keyof typeof OWN_KEY_PREFIXES

/** A model reachable with one of the user's own keys. Billed by the provider, not in credits. */
export interface OwnKeyModel {
  /** Our id, with the provider prefix. */
  id: string
  name: string
  provider: DirectProvider
}

/** A memory (features 3.2-3.4). Scope `shared` or `agent:<name>`. */
export type MemoryKind = 'fact' | 'preference' | 'profile' | 'note'

export interface Memory {
  id: string
  scope: string
  kind: MemoryKind
  text: string
  /** Who wrote it: "you", or an agent and the task it came from. */
  source: string
  taskId: string | null
  createdAt: number
  updatedAt: number
}

/** A learned skill (feature 3.5): a Markdown file the user can read and edit. */
export interface Skill {
  name: string
  description: string
  source: string
  body: string
  updatedAt: number
}

/** How a past task was solved (feature 3.13). */
export interface TaskRecord {
  id: string
  taskId: string
  agent: string
  goal: string
  outcome: string
  steps: string
  failed: string
  worked: string
  places: string
  createdAt: number
}

/** An MCP connector the user added (feature 3.6). Its secrets stay in the keychain. */
export interface Connector {
  id: string
  name: string
  kind: 'stdio' | 'http'
  command: string | null
  args: string[]
  url: string | null
  enabled: boolean
  /** The names of the secrets it uses (never the values). */
  secretNames: string[]
  status: 'off' | 'connecting' | 'ready' | 'error'
  error: string | null
  tools: { name: string; description: string; risk: Risk }[]
  createdAt: number
}

/** Where web searches come from (features 16.2, 16.3; decisions §44). */
export type SearchSource = 'auto' | 'credits' | SearchKeyProvider

export interface SiteLists {
  /** Search and read only these sites (empty: any site). */
  only: string[]
  /** Never search or read these. */
  blocked: string[]
}

export interface SearchSettings {
  source: SearchSource
  /** Two-letter country code, e.g. "RO"; empty for none. */
  country: string
  /** Two-letter language code, e.g. "ro"; empty for none. */
  language: string
  /** Trusted and blocked sites per agent (feature 16.9). */
  sites: Record<string, SiteLists>
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  published?: string
}

/** Artifact types (features 17.2-17.7, decisions §44). */
export const ARTIFACT_KINDS = [
  'document',
  'page',
  'spreadsheet',
  'chart',
  'diagram',
  'slides'
] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export interface Artifact {
  id: string
  taskId: string | null
  kind: ArtifactKind
  title: string
  /** The current version's number (1, 2, ...). */
  version: number
  /** The public link when shared (feature 17.13), or null. */
  shareUrl: string | null
  createdAt: number
  updatedAt: number
}

export interface ArtifactVersion {
  artifactId: string
  version: number
  /** Markdown, HTML, JSON (spreadsheet, chart) or Mermaid, by kind. */
  content: string
  /** Who made this version: "you", or an agent. */
  author: string
  note: string
  createdAt: number
}

export interface ArtifactDetail {
  artifact: Artifact
  current: ArtifactVersion
  versions: Omit<ArtifactVersion, 'content'>[]
}

/** Error reports (features 19.1-19.11, decisions §22, §45). */
export type ReportMode = 'ask' | 'auto' | 'never'

export interface ErrorReport {
  id: string
  appVersion: string
  os: string
  feature: string
  message: string
  stack: string
  logLines: string[]
  note: string
}

export interface QueuedReport {
  id: string
  status: 'draft' | 'queued' | 'sent'
  report: ErrorReport
  ref: string | null
  /** Set when a release fixed it (19.5): "Fixed in 1.4". */
  fixedIn: string | null
  problem: string | null
  createdAt: number
  sentAt: number | null
}

export interface CaughtError {
  id: string
  at: number
  source: string
  message: string
}

/** Setup and health (features 1.4, 1.12, 1.13, 1.20, 1.21). */
export type SetupInterest = 'everyday' | 'documents' | 'research' | 'apps' | 'marketing'

export interface SetupCheck {
  id: string
  area: string
  title: string
  status: 'ready' | 'missing' | 'problem' | 'suggested'
  detail: string
  /** How to fix it: open a view, the folder dialog, the account, a web page, or a report. */
  fix: {
    kind: 'view' | 'folder' | 'account' | 'link' | 'report'
    target?: string
    label: string
  } | null
}

export interface SetupComponent {
  id: string
  name: string
  bytes: number
}

export interface SetupState {
  /** The first-launch wizard has been finished or skipped. */
  done: boolean
  interests: SetupInterest[]
  hardware: {
    os: string
    cpu: string
    cores: number
    ramBytes: number
    vramBytes: number
    gpu: string | null
    diskFreeBytes: number | null
    diskTotalBytes: number | null
  }
  checks: SetupCheck[]
  components: SetupComponent[]
  /** When the health check last ran, or null. */
  checkedAt: number | null
}
