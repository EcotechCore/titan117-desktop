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
  /** Commands on the user's own servers over SSH (3.15). */
  servers?: boolean
  /** The app builder's projects: create, check, preview, versions (§6, decisions §56). */
  apps?: boolean
  /** Sidebar apps' data (6.11): reading it, or also changing it and adding apps (decisions §58). */
  sidebar?: 'read' | 'write'
  /** Other agents (decisions §59): handing them parts of a task, or also making new agents. */
  team?: 'delegate' | 'build'
  /** Images and video through OpenRouter, which cost credits (2.7, decisions §59.10). */
  media?: boolean
  /** Site checks for QA and SEO: the audit crawler, QA runs, PageSpeed, AI visibility (5.2, 5.8; decisions §60). */
  sites?: boolean
}

/** Site checks (5.2, 5.8): every request goes through the task's network policy. */
export interface SiteAccess {
  audit(url: string, maxPages?: number): Promise<import('../../lib/sites/audit').SiteAudit>
  qa(
    urls: string[],
    options?: { screenshots?: boolean }
  ): Promise<import('../../lib/sites/qa').QaPage[]>
  runTests(
    tests: import('../../lib/sites/qa').SavedTest[]
  ): Promise<import('../../lib/sites/qa').TestRun[]>
  speed(
    url: string,
    strategy: 'mobile' | 'desktop'
  ): Promise<import('../../lib/sites/service').SpeedResult>
  visibility(input: {
    brand: string
    domain: string
    questions: string[]
    models?: string[]
  }): Promise<import('../../lib/sites/service').VisibilityAnswer[]>
  history(site: string): import('../../lib/sites/service').AuditHistory[]
  remember(audit: import('../../lib/sites/audit').SiteAudit): void
}

/** Images and video (2.7): the task's stop signal goes with every call. */
export interface MediaAccess {
  pick(kind: 'image' | 'video', asked?: string): Promise<string>
  image(input: {
    model: string
    prompt: string
    aspectRatio?: string
    format?: 'png' | 'jpeg' | 'webp'
  }): Promise<import('../../lib/media').MediaResult>
  video(input: {
    model: string
    prompt: string
    seconds?: number
    aspectRatio?: string
  }): Promise<import('../../lib/media').MediaResult>
}

/** What came back from one part handed to another agent (4.6). */
export interface PartResult {
  agent: string
  taskId: string
  status: import('../../../shared/protocol').TaskStatus
  /** The agent's last message, or why the part stopped. */
  answer: string
  costUsd: number
}

/** A new agent and the skills it needs, as Titan writes them (18.2). */
export interface NewAgent {
  name: string
  role: string
  team: string
  tools: string[]
  instructions: string
  manager?: boolean
  memory?: 'shared' | 'own'
  color?: string
  skills: { name: string; description: string; steps: string }[]
}

/** Other agents, for a manager (4.6) and for Titan making agents (18.2). */
export interface TeamAccess {
  /** Each part runs as its own task with that agent; resolves when all are over. */
  delegate(parts: { agent: string; brief: string }[]): Promise<PartResult[]>
  create(input: NewAgent): import('../../../shared/protocol').AgentDef
}

/** The user's own servers (3.15): only the ones they added in the app. */
export interface ServerAccess {
  list(): { name: string; target: string }[]
  run(name: string, command: string, timeoutMs: number): Promise<import('../../lib/ssh').SshResult>
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

/** The models for each role in an app build (6.10); null means the task's own model. */
export interface AppModels {
  planner: string | null
  coder: string | null
  fixer: string | null
  /** Small changes, like a visual edit (6.9). */
  quick?: string | null
}

/** The app builder (§6, decisions §56): running an app's code asks first, like a command. */
export interface AppAccess {
  create(input: {
    folder: string
    title: string
    description: string
    lang?: string
    starter?: import('../../lib/apps/starters').StarterId
    kind?: import('../../lib/apps/template').AppKind
    /** Ready for the Titan117 sidebar (6.2). */
    sidebar?: boolean
  }): Promise<import('../../lib/apps/service').AppInfo>
  info(folder: string): Promise<import('../../lib/apps/service').AppInfo>
  /** Show the plan for approval (6.7). Approved: the build's file changes and the app's checks run without asking again in this task. */
  approvePlan(folder: string, plan: string): Promise<boolean>
  check(
    folder: string,
    options?: { browsers?: boolean }
  ): Promise<import('../../lib/apps/service').AppReport>
  preview(folder: string, action: 'start' | 'stop'): Promise<{ url: string | null }>
  /** Open a mobile app to phones on this Wi-Fi for Expo Go (6.24): asks every time, on the laptop only. */
  phone(folder: string): Promise<{ url: string; phone: string }>
  saveVersion(
    folder: string,
    message: string
  ): Promise<{ sha: string; pushed: string | null; pushError: string | null } | null>
  versions(folder: string): Promise<import('../../lib/git').GitVersion[]>
  restore(folder: string, sha: string): Promise<{ sha: string }>
  /** Another target for the same project (6.6), made beside the app. */
  addTarget(
    folder: string,
    kind: import('../../lib/apps/template').AppKind
  ): Promise<import('../../lib/apps/service').AppInfo>
  /** Copy the app's `src/shared/` to its other targets. */
  shareCode(folder: string): Promise<{ updated: string[] }>
  /** Save to the user's own GitHub (6.18): asks every time, on the laptop only. */
  saveToGitHub(
    folder: string,
    options?: { private?: boolean }
  ): Promise<import('../../lib/apps/service').GitHubSave>
  /** Publish to the user's own hosting (6.15): asks every time, on the laptop only. */
  publish(folder: string): Promise<import('../../lib/apps/service').Published>
  models(): AppModels
}

/** Sidebar apps and their shared data (6.2, 6.11, 6.14; decisions §58). */
export interface SidebarAccess {
  /** The apps in the sidebar, each with its collections. */
  apps(): {
    id: string
    title: string
    folder: string
    collections: import('../../lib/apps/data').CollectionInfo[]
    reads: string[]
    writes: string[]
    error: string | null
  }[]
  list(
    app: string,
    collection: string,
    query?: import('../../lib/apps/data').Query
  ): import('../../lib/apps/data').Row[]
  count(app: string, collection: string, query?: import('../../lib/apps/data').Query): number
  get(app: string, collection: string, id: string): import('../../lib/apps/data').Row | null
  insert(app: string, collection: string, data: unknown): import('../../lib/apps/data').Row
  update(
    app: string,
    collection: string,
    id: string,
    data: unknown
  ): import('../../lib/apps/data').Row
  remove(app: string, collection: string, id: string): boolean
  /** Add a web app to the sidebar: asks every time, on the laptop only, showing what data it may reach. */
  add(folder: string): Promise<import('../../lib/apps/sidebar').SidebarApp>
  /** A new build of a sidebar app; runs its checks (asks like running the app). */
  refresh(folder: string): Promise<import('../../lib/apps/sidebar').UpdateResult>
  /** Whether the app in this folder is in the sidebar. */
  inSidebar(folder: string): Promise<boolean>
  /** A sidebar app gets the current SDK before it's built (inside its own folder). */
  refreshSdk(folder: string): Promise<boolean>
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
  servers: ServerAccess
  apps: AppAccess
  sidebar: SidebarAccess
  team: TeamAccess
  media: MediaAccess
  sites: SiteAccess
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
