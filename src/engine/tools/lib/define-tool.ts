/**
 * `defineTool` is the only way to make a tool (guardrails §4). A tool
 * declares what it needs and how risky it is; the permission layer gives it
 * exactly that and nothing else. A tool never imports `fs`, `child_process`
 * or the network itself: ESLint blocks those outside the building blocks.
 */
import type { Risk } from '../../../shared/protocol'
import type { FileAccess } from '../../lib/folders'
import type { ShellAccess } from '../../lib/shell'
import type { TaskNet } from '../../lib/web'
import type { BrowserAccess } from '../../lib/browser'
import type { MemoryAccess } from '../../memory'
import type { SkillAccess } from '../../lib/skills'
import type { RecordAccess } from '../../records'
import type { SpeechAccess } from '../../lib/speech'
import type { SearchAccess } from '../../lib/search'
import type { Page } from '../../lib/read'
import type { ArtifactAccess } from '../../artifacts'

/** A small JSON schema: what models are told and what input is checked against. */
export interface ParamSchema {
  type: 'object'
  properties: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array'
      description: string
      enum?: string[]
      /** A connector's property with a type we don't check (a union): passed through. */
      unchecked?: boolean
    }
  >
  required: string[]
}

export interface ToolPermissions {
  /** Access to the folders the user allowed. Without it, `ctx.files` refuses. */
  folders?: 'read' | 'write'
  /** Web requests through the task's network policy (security.md A3). */
  network?: boolean
  /** Commands in the sandboxed shell (feature 3.8). */
  shell?: boolean
  /** The browser (feature 3.10). */
  browser?: boolean
  /** Memory: reading it, or also saving to it (features 3.2-3.4). */
  memory?: 'read' | 'write'
  /** Learned skills (feature 3.5). */
  skills?: 'read' | 'write'
  /** Records of past tasks (feature 3.13). */
  records?: boolean
  /** Speech to text and text to speech (feature 3.14). */
  speech?: boolean
  /** Web search through the user's chosen source (features 16.1-16.3). */
  search?: boolean
  /** Artifacts: reading them, or also making and changing them (§17). */
  artifacts?: 'read' | 'write'
  /** The document folders' index (§7). */
  documents?: boolean
  /** The coding engine, in a project folder (§13, decisions §53). */
  code?: boolean
  /** Git in a repository inside the allowed folders: looking, or also changing (13.7). */
  git?: 'read' | 'write'
}

/** Git as the user (13.7, decisions §25), inside the allowed folders. */
export interface GitAccess {
  status(folder: string): Promise<import('../../lib/git').GitStatus>
  diff(
    folder: string,
    options?: { staged?: boolean; file?: string; base?: string }
  ): Promise<string>
  branch(folder: string, name: string): Promise<{ created: boolean }>
  commit(
    folder: string,
    input: { message: string; files?: string[] }
  ): Promise<{ sha: string; files: string[] }>
  push(folder: string): Promise<{ branch: string; remote: string }>
  pullRequest(
    folder: string,
    input: { title: string; body: string; base?: string }
  ): Promise<import('../../lib/git').PullRequestResult>
}

/** The code builder's view of the coding engine (§13): every change it makes still asks. */
export interface CodeAccess {
  run(
    job: import('../../lib/code/service').CodeJob
  ): Promise<import('../../lib/code/opencode').CodeResult & { costUsd: number; steps: number }>
}

/** The folder agent's view of the document folders (§7, decisions §51). */
export interface DocumentsAccess {
  search(query: string, limit?: number): Promise<import('../../../shared/protocol').DocHit[]>
  page(file: string, page: number): Promise<{ label: string; text: string; pages: number }>
  sheet(
    file: string,
    query: import('../../lib/sheets').SheetQuery
  ): Promise<{ sheet: string; rows: number; result: Record<string, number | string[]> }>
}

/** Reading pages as clean text (16.5), through the task's network policy and the agent's site lists. */
export interface PageAccess {
  read(url: string): Promise<Page>
  allowedByRobots(url: string): Promise<boolean>
  /** Whether the agent's trusted and blocked lists allow this site (16.9). */
  allowedSite(host: string): boolean
}

export interface ToolContext {
  taskId: string
  agent: string
  files: FileAccess
  net: TaskNet
  shell: ShellAccess
  browser: BrowserAccess
  memory: MemoryAccess
  skills: SkillAccess
  records: RecordAccess
  speech: SpeechAccess
  search: SearchAccess
  pages: PageAccess
  artifacts: ArtifactAccess
  documents: DocumentsAccess
  code: CodeAccess
  git: GitAccess
  /**
   * Ask the user mid-run (a final step on a page, a site that forbids
   * automation). Resolves true when they approve. Laptop-only.
   */
  ask(summary: string): Promise<boolean>
  /** A remembered answer for this tool (e.g. per site), or null. */
  remembered(key: string): boolean | null
  remember(key: string, answer: boolean): void
  signal: AbortSignal
}

export interface ToolResult {
  /** What goes back to the model. */
  output: string
  /** One line for the activity timeline. */
  summary: string
  /** What this call cost (a search through credits); counts towards the task's budget (16.12). */
  costUsd?: number
}

/**
 * How risky one particular call is, for tools whose risk depends on the
 * input (a shell command). Never lower than `read`, and `alwaysAsks` can't
 * be overridden by an earlier "always".
 */
export interface Assessment {
  risk: Risk
  summary: string
  /** A standing "always allow" this call may use or create, e.g. a command in a folder. */
  standing?: { folder: string; command: string; label: string }
  /** On the always-ask list (decisions §33.1): asks every time, never "always". */
  alwaysAsks?: boolean
  /** Refused outright, with the reason. */
  refuse?: string
  /**
   * What this call would send over the internet (a networked command, a
   * script's code). Checked for private content before the user is asked.
   */
  outgoing?: string
}

export interface ToolDefinition<Input = Record<string, unknown>> {
  name: string
  description: string
  params: ParamSchema
  risk: Risk
  permissions: ToolPermissions
  /**
   * True when the output comes from outside (files, pages, mail): it is
   * passed to the model marked as data, never as instructions (guardrails §5).
   */
  untrustedOutput: boolean
  /**
   * True when the output is the user's private data (files, memory, mail,
   * command output): the task becomes private and its passages may not
   * leave in a web request (security.md A3).
   */
  privateOutput: boolean
  /** Answerable only on the laptop, never remotely (guardrails §9). */
  laptopOnly: boolean
  /** One line for the approval card: what will happen. */
  describe(input: Input): string
  /** The full JSON schema for the model, when richer than `params` (connector tools). */
  rawSchema?: Record<string, unknown>
  /** Optional: a risk for this call that depends on its input. */
  assess?(input: Input, ctx: { folders: string[]; untrustedSeen: boolean }): Assessment
  run(input: Input, ctx: ToolContext): Promise<ToolResult>
}

const TOOL_NAME = /^[a-z][a-z0-9_]{1,63}$/

export function defineTool<Input = Record<string, unknown>>(
  definition: Omit<ToolDefinition<Input>, 'laptopOnly' | 'untrustedOutput' | 'privateOutput'> &
    Partial<Pick<ToolDefinition<Input>, 'laptopOnly' | 'untrustedOutput' | 'privateOutput'>>
): ToolDefinition<Input> {
  if (!TOOL_NAME.test(definition.name)) throw new Error(`Bad tool name: ${definition.name}`)
  if (!['read', 'write', 'external'].includes(definition.risk))
    throw new Error(`Tool ${definition.name} needs a risk level.`)
  const p = definition.permissions
  if (
    definition.risk === 'read' &&
    !definition.assess &&
    (p.folders === 'write' || p.shell || p.memory === 'write' || p.skills === 'write')
  )
    throw new Error(`Tool ${definition.name} changes things, so its risk can't be "read".`)
  return Object.freeze({
    untrustedOutput: false,
    privateOutput: false,
    // External actions are laptop-only unless a tool says otherwise.
    laptopOnly: definition.risk === 'external',
    ...definition
  })
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

/** Check a model's arguments against the tool's schema. Returns what's wrong, or null. */
export function checkInput(schema: ParamSchema, input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return 'The input must be an object.'
  const record = input as Record<string, unknown>
  for (const name of schema.required)
    if (record[name] === undefined || record[name] === null) return `"${name}" is missing.`
  for (const [name, value] of Object.entries(record)) {
    const property = schema.properties[name]
    if (!property) return `"${name}" is not a parameter of this tool.`
    if (value === undefined || value === null || property.unchecked) continue
    if (typeOf(value) !== property.type) return `"${name}" must be a ${property.type}.`
    if (property.enum && !property.enum.includes(value as string))
      return `"${name}" must be one of: ${property.enum.join(', ')}.`
  }
  return null
}
