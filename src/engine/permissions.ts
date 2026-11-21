/**
 * The permission and approval layer (guardrails §4): the only way a tool
 * runs. Every call is checked, asked about when it's risky, given exactly
 * the access its tool declared, and written to the activity timeline.
 *
 *   read      runs without asking, inside allowed folders
 *   write     waits for the user, unless they allowed it ("always in this
 *             task", or for a shell command "always in this folder")
 *   external  always waits for the user, whatever the settings
 *
 * It also keeps what each task has seen (security.md A3): private output
 * makes the task private, and its passages may not leave in a web request.
 */
import type { ApprovalAnswer, Risk, ToolCall } from '../shared/protocol'
import type { BrowserAccess, BrowserHost } from './lib/browser'
import {
  checkWritable,
  createFileAccess,
  PermissionError,
  resolveAllowed,
  type FolderPolicy
} from './lib/folders'
import type { Logger } from './lib/log'
import { createShell, type ShellAccess, type ToolApi } from './lib/shell'
import { SkillError, type SkillAccess, type SkillStore } from './lib/skills'
import type { SpeechAccess } from './lib/speech'
import { createTaskNet, hostsIn, type TaskNet } from './lib/web'
import { createMemoryAccess, MemoryError, type MemoryAccess, type MemoryStore } from './memory'
import { createTaskPrivacy, type TaskPrivacy } from './privacy'
import type { RecordAccess, RecordStore } from './records'
import type { Store } from './store'
import { checkInput, type Assessment, type ToolContext } from './tools/lib/define-tool'
import type { AnyTool, ToolRegistry } from './tools'
import { wrapUntrusted } from './untrusted'
import { ArtifactError, type ArtifactAccess, type ArtifactStore } from './artifacts'
import { convert, ConvertError, type ExportFormat } from './lib/convert'
import { ReadError, type PageReader } from './lib/read'
import { SearchError, type SearchAccess, type SearchService } from './lib/search'
import { isNetworkFailure } from './lib/online'
import type { DocumentsAccess, PageAccess } from './tools/lib/define-tool'
import type { DocIndex } from './lib/doc-index'
import type { CodeService } from './lib/code/service'
import type {
  AppAccess,
  AppModels,
  CodeAccess,
  GitAccess,
  ServerAccess
} from './tools/lib/define-tool'
import { AppError, type AppService } from './lib/apps/service'
import { NodeDownloadError } from './lib/apps/node'
import { runOnServer, SshError, type Server } from './lib/ssh'
import {
  GitError,
  gitBranch,
  gitCommit,
  gitDiff,
  gitPush,
  gitStatus,
  openPullRequest,
  projectRootOf
} from './lib/git'
import { querySheet, SheetError } from './lib/sheets'
import { DocumentError } from './lib/documents'

export interface CallContext {
  taskId: string
  agent: string
  model: string
  signal: AbortSignal
  /** Where the call came from: the agent itself, or a script it wrote (feature 4.10). */
  via?: 'agent' | 'script'
}

export type CallOutcome =
  | { status: 'done'; output: string; costUsd?: number }
  /** The layer or the user said no. The tool did not run. */
  | { status: 'refused'; output: string }
  /** The tool ran and failed. */
  | { status: 'failed'; output: string }

export interface PermissionLayer {
  execute(call: ToolCall, ctx: CallContext): Promise<CallOutcome>
  /** The user's answer to an approval. `from` is where it was answered. */
  answer(approvalId: string, answer: ApprovalAnswer, from: 'window' | 'remote'): void
  /** Give up on a task's waiting approvals (the task was cancelled). */
  cancelTask(taskId: string): void
  /** The user wrote a message: the sites it names join the task's site list. */
  userSaid(taskId: string, text: string): void
  /** Keep passages of private content the task was given (memory in the prompt) from leaving. */
  sawPrivate(taskId: string, text: string, source: string, quiet?: boolean): void
  /** The task ended: let go of its browser page. */
  release(taskId: string): Promise<void>
  /** Services made after the layer (search needs the model router). */
  useServices(more: Partial<Services>): void
  /** The task read from a local-models-only folder: cloud models may not see it (7.7). */
  isLocalOnly(taskId: string): boolean
  /**
   * Decide on an action another program wants to take for a task (the coding
   * engine's permission prompts, decisions §53): the same rules, approvals,
   * "always" answers and activity log as our own tools, without running anything.
   */
  decide(ctx: CallContext, request: OutsideAction): Promise<Decision>
}

/** An action asked about by a program we run (OpenCode), already assessed by its adapter. */
export interface OutsideAction {
  callId: string
  /** The name shown and remembered for "always in this task", e.g. `code_edit`. */
  tool: string
  input: Record<string, unknown>
  assessment: Assessment
  /** The project folder it happens in (the real path), for a plan approved there (6.7). */
  folder?: string
}

export type Decision =
  { allowed: true; approvedBy: string | null } | { allowed: false; why: string }

/** Optional services; a tool that needs a missing one is refused. */
export interface Services {
  memory?: MemoryStore
  skills?: SkillStore
  records?: RecordStore
  browser?: BrowserHost
  speech?: (files: ReturnType<typeof createFileAccess>) => SpeechAccess
  /** Where each task's scratch folder lives (scripts). */
  scratchRoot?: string
  /** The local tool API for scripts (feature 4.10). */
  toolApi?: (taskId: string) => ToolApi | null
  /** Ports of the engine's own servers: never reachable by a tool. */
  enginePorts?: () => number[]
  /** Remembered answers (sites that forbid automation). */
  answers?: { get(key: string): boolean | null; set(key: string, value: boolean): void }
  /** The network for tools (tests pass a fake). */
  fetch?: typeof fetch
  /** Web search (§16). */
  search?: SearchService
  /** Reading pages as clean text (16.5). */
  pages?: PageReader
  /** Artifacts (§17). */
  artifacts?: ArtifactStore
  /** The document folders' index (§7). */
  documents?: DocIndex
  /** Tasks that read from a local-models-only folder (7.7), kept across runs. */
  localOnlyTasks?: { has(taskId: string): boolean; add(taskId: string): void }
  /** The coding engine (§13, decisions §53). */
  code?: CodeService
  /** Whether agent commits carry the Titan117 co-author line (decisions §25); on by default. */
  gitCoAuthor?: () => boolean
  /** The user's GitHub sign-in through our app (decisions §25); null when signed out. */
  githubToken?: () => string | null
  /** The servers the user added (3.15). */
  servers?: () => Server[]
  /** The app builder's projects (§6, decisions §56). */
  apps?: AppService
  /** The models chosen for each role in an app build (6.10). */
  appModels?: () => AppModels
  /** The brand kit applied to new apps (6.8, 15.1). */
  brandKit?: () => import('./lib/apps/starters').BrandKit | null
}

interface Waiting {
  taskId: string
  laptopOnly: boolean
  resolve(answer: ApprovalAnswer | 'cancelled'): void
}

interface TaskState {
  privacy: TaskPrivacy
  /** True once the task has seen outside content (pages, files, tool output). */
  untrusted: boolean
}

/** Something that refuses every use: what a tool gets for a permission it didn't declare. */
function denied<T extends object>(what: string): T {
  return new Proxy({} as T, {
    get() {
      return () => {
        throw new PermissionError(`This tool did not declare access to ${what}.`)
      }
    }
  })
}

function needService<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new PermissionError(`${what} isn't available here.`)
  return value
}

export function createPermissionLayer(deps: {
  tools: ToolRegistry
  store: Store
  log: Logger
  folders(): FolderPolicy
  services?: Services
}): PermissionLayer {
  const { tools, store, log } = deps
  const services = deps.services ?? {}
  const waiting = new Map<string, Waiting>()
  const states = new Map<string, TaskState>()
  /**
   * App folders whose build plan the user approved, per task (6.7): the build's file changes
   * and the app's checks there don't ask one by one. Only that folder, only that task, and
   * only until the engine restarts.
   */
  const approvedPlans = new Map<string, Set<string>>()
  const planCovers = (taskId: string, folder: string | undefined): boolean =>
    !!folder && !!approvedPlans.get(taskId)?.has(folder)

  /** A task's privacy state; after a restart it's rebuilt from the conversation. */
  function stateOf(taskId: string): TaskState {
    let state = states.get(taskId)
    if (state) return state
    state = { privacy: createTaskPrivacy(), untrusted: false }
    for (const { message } of store.listMessages(taskId)) {
      if (message.role !== 'tool' || message.isError) continue
      const tool = tools.get(message.name)
      if (tool?.privateOutput) state.privacy.saw(message.output, tool.name)
      if (tool?.untrustedOutput) state.untrusted = true
    }
    states.set(taskId, state)
    return state
  }

  function activity(
    ctx: CallContext,
    kind: 'refused' | 'approval' | 'tool' | 'error',
    tool: string,
    summary: string,
    approvedBy: string | null = null,
    costUsd = 0
  ): void {
    store.log({
      taskId: ctx.taskId,
      kind,
      agent: ctx.agent,
      model: ctx.model,
      tool,
      summary: ctx.via === 'script' && kind === 'tool' ? `${summary} (from a script)` : summary,
      costUsd,
      approvedBy
    })
  }

  function refuse(call: ToolCall, ctx: CallContext, why: string): CallOutcome {
    activity(ctx, 'refused', call.name, `Refused ${call.name}: ${why}`)
    return { status: 'refused', output: `Refused: ${why}` }
  }

  /** Create an approval and wait for the user's answer. */
  async function waitFor(
    ctx: CallContext,
    input: {
      callId: string
      tool: string
      risk: Risk
      summary: string
      args: Record<string, unknown>
      canAlways: boolean
      alwaysLabel?: string | null
      laptopOnly: boolean
    }
  ): Promise<ApprovalAnswer | 'cancelled'> {
    const approval = store.createApproval({
      taskId: ctx.taskId,
      callId: input.callId,
      tool: input.tool,
      risk: input.risk,
      summary: input.summary,
      input: input.args,
      canAlways: input.canAlways,
      alwaysLabel: input.alwaysLabel ?? null
    })
    store.updateTask(ctx.taskId, { status: 'waiting' })
    activity(ctx, 'approval', input.tool, `Asked: ${input.summary}`)
    const answer = await new Promise<ApprovalAnswer | 'cancelled'>((resolve) => {
      if (ctx.signal.aborted) return resolve('cancelled')
      waiting.set(approval.id, { taskId: ctx.taskId, laptopOnly: input.laptopOnly, resolve })
      ctx.signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
    })
    waiting.delete(approval.id)
    if (answer === 'cancelled') store.answerApproval(approval.id, 'expired', 'task cancelled')
    else store.updateTask(ctx.taskId, { status: 'running' })
    return answer
  }

  /**
   * The rules every action passes, ours or another program's: refusals,
   * private content leaving, then asking the user unless they already said
   * "always" (in this task, or for a command in this folder).
   */
  async function gate(
    ctx: CallContext,
    callId: string,
    name: string,
    input: Record<string, unknown>,
    assessment: Assessment,
    laptopOnlyTool: boolean
  ): Promise<Decision> {
    if (assessment.refuse) return { allowed: false, why: assessment.refuse }
    // Private content on its way out is blocked before the user is even asked (security.md A3).
    const leak = assessment.outgoing ? stateOf(ctx.taskId).privacy.leak(assessment.outgoing) : null
    if (leak)
      return {
        allowed: false,
        why: `this would send private content (from ${leak.source}) over the internet. Nothing ran.`
      }

    const standing = assessment.standing
    const risk = assessment.risk
    const allowedBefore =
      !assessment.alwaysAsks &&
      risk === 'write' &&
      (store.isAlwaysAllowed(ctx.taskId, name) ||
        (standing ? store.hasStanding(standing.folder, standing.command) : false))

    if (risk === 'external' || (risk === 'write' && !allowedBefore)) {
      const canAlways = risk === 'write' && !assessment.alwaysAsks
      const answer = await waitFor(ctx, {
        callId,
        tool: name,
        risk,
        summary: assessment.summary,
        args: input,
        // "Always" is never offered for external actions or the always-ask list.
        canAlways,
        alwaysLabel: canAlways && standing ? standing.label : null,
        laptopOnly: laptopOnlyTool || risk === 'external' || !!assessment.alwaysAsks
      })
      if (answer === 'cancelled')
        return { allowed: false, why: 'the task was cancelled before you answered.' }
      if (answer === 'deny') return { allowed: false, why: 'you denied it.' }
      if (answer === 'always' && canAlways) {
        if (standing) store.addStanding(standing.folder, standing.command)
        else store.allowAlways(ctx.taskId, name)
      }
      return { allowed: true, approvedBy: 'you' }
    }
    if (risk === 'write')
      return {
        allowed: true,
        approvedBy:
          standing && store.hasStanding(standing.folder, standing.command)
            ? 'you (always, in this folder)'
            : 'you (always, this task)'
      }
    return { allowed: true, approvedBy: null }
  }

  function toolContext(tool: AnyTool, ctx: CallContext, callId: string): ToolContext {
    const p = tool.permissions
    const state = stateOf(ctx.taskId)
    // Reading inside a local-models-only folder keeps this task on local models (7.7).
    const markLocalOnly = (): void => services.localOnlyTasks?.add(ctx.taskId)
    const policy = { ...deps.folders(), onLocalOnly: markLocalOnly }
    const files = createFileAccess(policy, p.folders)

    const ask = async (summary: string): Promise<boolean> => {
      const answer = await waitFor(ctx, {
        callId,
        tool: tool.name,
        risk: 'external',
        summary,
        args: {},
        canAlways: false,
        laptopOnly: true
      })
      return answer === 'approve' || answer === 'always'
    }

    const net: TaskNet = createTaskNet({
      taskId: ctx.taskId,
      privacy: state.privacy,
      sites: store.sites,
      fetch: services.fetch,
      enginePorts: services.enginePorts ?? (() => []),
      log: (summary) => activity(ctx, 'tool', tool.name, summary),
      ask: async ({ summary }) => {
        const answer = await waitFor(ctx, {
          callId,
          tool: 'open_site',
          risk: 'external',
          summary,
          args: {},
          canAlways: false,
          laptopOnly: true
        })
        return answer === 'approve' || answer === 'always' ? 'once' : 'deny'
      }
    })

    const shell: ShellAccess = p.shell
      ? createShell({
          policy: deps.folders,
          scratchRoot: needService(services.scratchRoot, 'The shell'),
          taskId: ctx.taskId,
          signal: ctx.signal,
          toolApi: () => services.toolApi?.(ctx.taskId) ?? null,
          guard(commandLine, network) {
            if (!network) return
            const leak = state.privacy.leak(commandLine)
            if (leak)
              throw new PermissionError(
                `Blocked: this command would send private content (from ${leak.source}) over the internet. Nothing ran.`
              )
          }
        })
      : denied<ShellAccess>('the shell')

    const browser: BrowserAccess = p.browser
      ? needService(services.browser, 'The browser').forTask(ctx.taskId, net)
      : denied<BrowserAccess>('the browser')

    const memory: MemoryAccess = p.memory
      ? createMemoryAccess({
          store: needService(services.memory, 'Memory'),
          agent: ctx.agent,
          taskId: ctx.taskId,
          taskTitle: () => store.getTask(ctx.taskId)?.title ?? '',
          mode: p.memory,
          // A project's memory is written only for a folder the user allowed (13.8).
          projectRoot: async (folder) => projectRootOf(await resolveAllowed(policy, folder))
        })
      : denied<MemoryAccess>('memory')

    const skillStore = services.skills
    const skills: SkillAccess = p.skills
      ? {
          list: () => needService(skillStore, 'Skills').list(),
          read(name) {
            const skill = needService(skillStore, 'Skills').get(name)
            if (!skill) throw new SkillError(`There is no skill called "${name}".`)
            return skill
          },
          save(input) {
            if (p.skills !== 'write')
              throw new PermissionError('This tool may read skills, not write them.')
            return needService(skillStore, 'Skills').save({
              ...input,
              source: `${ctx.agent}, in the task "${(store.getTask(ctx.taskId)?.title ?? '').slice(0, 80)}"`
            })
          }
        }
      : denied<SkillAccess>('skills')

    const records: RecordAccess = p.records
      ? {
          search: (query, limit = 5) =>
            needService(services.records, 'Past tasks').list({ query: query || undefined, limit })
        }
      : denied<RecordAccess>('past tasks')

    const speech: SpeechAccess = p.speech
      ? needService(services.speech, 'Speech')(files)
      : denied<SpeechAccess>('speech')

    const searchService = services.search
    const search: SearchAccess = p.search
      ? needService(searchService, 'Web search').forAgent(ctx.agent, (query) => {
          // A query is a request too: private passages never leave in one (security.md A3).
          const leak = state.privacy.leak(query)
          if (leak)
            throw new PermissionError(
              `Blocked: this search would send private content (from ${leak.source}). Nothing was sent.`
            )
        })
      : denied<SearchAccess>('web search')

    const siteOk = (host: string): boolean => searchService?.allowedSite(ctx.agent, host) ?? true
    const pages: PageAccess = p.network
      ? {
          async read(url) {
            let host: string
            try {
              host = new URL(url).hostname
            } catch {
              throw new PermissionError('That is not a web address.')
            }
            if (!siteOk(host))
              throw new PermissionError(`${host} is not on ${ctx.agent}'s list of sites to use.`)
            return needService(services.pages, 'Reading pages').read(url, net, ctx.signal)
          },
          allowedByRobots: (url) =>
            needService(services.pages, 'Reading pages').allowedByRobots(url, net, ctx.signal),
          allowedSite: siteOk
        }
      : denied<PageAccess>('the network')

    const artifactStore = services.artifacts
    const artifacts: ArtifactAccess = p.artifacts
      ? {
          create(input) {
            if (p.artifacts !== 'write')
              throw new PermissionError('This tool may read artifacts, not make them.')
            return needService(artifactStore, 'Artifacts').create({
              ...input,
              taskId: ctx.taskId,
              author: ctx.agent
            })
          },
          update(id, input) {
            if (p.artifacts !== 'write')
              throw new PermissionError('This tool may read artifacts, not change them.')
            return needService(artifactStore, 'Artifacts').update(id, {
              ...input,
              author: ctx.agent
            })
          },
          read(id, version) {
            const detail = needService(artifactStore, 'Artifacts').get(id)
            const v = version ?? detail.artifact.version
            return {
              artifact: detail.artifact,
              content: needService(artifactStore, 'Artifacts').version(id, v).content,
              version: v
            }
          },
          list: (query) => needService(artifactStore, 'Artifacts').list({ query }),
          async export(id, format) {
            const store = needService(artifactStore, 'Artifacts')
            const { artifact, current } = store.get(id)
            const file = await convert(artifact, current.content, format as ExportFormat)
            return { name: file.name, data: file.data }
          }
        }
      : denied<ArtifactAccess>('artifacts')

    const docIndex = services.documents
    const docFile = (file: string): { path: string; localOnly: boolean } => {
      const found = needService(docIndex, 'Documents').resolve(file)
      if (!found)
        throw new PermissionError(
          `"${file}" isn't in a document folder that is turned on in Documents.`
        )
      return found
    }
    const documents: DocumentsAccess = p.documents
      ? {
          async search(query, limit) {
            const index = needService(docIndex, 'Documents')
            const hits = await index.search(query, { limit })
            const localOnly = new Set(
              index
                .folders()
                .filter((f) => f.localOnly)
                .map((f) => f.path)
            )
            if (hits.some((h) => localOnly.has(h.folder))) markLocalOnly()
            return hits
          },
          async page(file, page) {
            const found = docFile(file)
            if (found.localOnly) markLocalOnly()
            const result = needService(docIndex, 'Documents').page(found.path, page)
            if (!result) throw new DocumentError(`"${file}" has no page ${page}.`)
            return result
          },
          async sheet(file, query) {
            if (!/\.xlsx$/i.test(file)) throw new SheetError('sheet_query reads .xlsx files.')
            // Through the folder rules, so a local-only folder is noticed and the path is checked.
            const data = await files.readBytes(file)
            return querySheet(data, query)
          }
        }
      : denied<DocumentsAccess>('documents')

    const code: CodeAccess = p.code
      ? {
          run: (job) =>
            needService(services.code, 'The coding engine').run(ctx, job, (event) => {
              if (event.type === 'tool' && event.status === 'completed' && event.title)
                activity(ctx, 'tool', 'code_task', `Coding engine: ${event.title}`.slice(0, 200))
            })
        }
      : denied<CodeAccess>('the coding engine')

    const repoToRead = (folder: string): Promise<string> => resolveAllowed(policy, folder)
    const repoToChange = (folder: string): Promise<string> => {
      if (p.git !== 'write') throw new PermissionError('This tool may look at git, not change it.')
      return checkWritable(policy, folder)
    }
    const git: GitAccess = p.git
      ? {
          status: async (folder) => gitStatus(await repoToRead(folder)),
          diff: async (folder, options) => gitDiff(await repoToRead(folder), options),
          branch: async (folder, name) => gitBranch(await repoToChange(folder), name),
          commit: async (folder, input) =>
            gitCommit(await repoToChange(folder), {
              ...input,
              coAuthor: services.gitCoAuthor?.() ?? true
            }),
          push: async (folder) => gitPush(await repoToChange(folder)),
          pullRequest: async (folder, input) =>
            openPullRequest(await repoToChange(folder), input, {
              githubToken: services.githubToken?.() ?? null
            })
        }
      : denied<GitAccess>('git')

    const servers: ServerAccess = p.servers
      ? {
          list: () => (services.servers?.() ?? []).map(({ name, target }) => ({ name, target })),
          run(name, command, timeoutMs) {
            const server = (services.servers?.() ?? []).find((s) => s.name === name)
            if (!server)
              throw new PermissionError(
                `"${name}" isn't one of your servers. Servers are added by you, on the Code screen.`
              )
            return runOnServer(server, command, { timeoutMs, signal: ctx.signal })
          }
        }
      : denied<ServerAccess>('servers')

    // The app builder (§6, decisions §56). Running an app (install, checks, preview) runs its code,
    // so it asks like a command, with "always run this app"; an approved plan covers it for the task.
    const appService = (): AppService => needService(services.apps, 'The app builder')
    const appFolder = (folder: string): Promise<string> => checkWritable(policy, folder)
    const mayRunApp = async (folder: string, real: string, what: string): Promise<void> => {
      if (planCovers(ctx.taskId, real)) {
        activity(ctx, 'approval', 'app_run', `Running the app in ${folder}`, 'you (the plan)')
        return
      }
      const decision = await gate(
        ctx,
        `${callId}-run`,
        'app_run',
        { folder },
        {
          risk: 'write',
          summary: `Run the app in ${folder}: ${what}`,
          standing: { folder: real, command: 'app:run', label: 'Always run this app' }
        },
        false
      )
      if (!decision.allowed) throw new PermissionError(`Not run: ${decision.why}`)
      activity(ctx, 'approval', 'app_run', `Running the app in ${folder}`, decision.approvedBy)
    }
    const apps: AppAccess = p.apps
      ? {
          async create(input) {
            const parent = await appFolder(input.folder)
            // The brand kit's logo is read only from the allowed folders.
            const brand = services.brandKit?.() ?? undefined
            const logo = brand?.logo ? await resolveAllowed(policy, brand.logo) : ''
            return appService().create(parent, {
              ...input,
              ...(brand ? { brand: { ...brand, logo } } : {})
            })
          },
          info: async (folder) => appService().info(await resolveAllowed(policy, folder)),
          async approvePlan(folder, plan) {
            const real = await appFolder(folder)
            const name = appService().info(real).title
            const answer = await waitFor(ctx, {
              callId: `${callId}-plan`,
              tool: 'app_plan',
              risk: 'write',
              summary: `Build this plan in "${name}"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each change still shows as a diff.`,
              args: { plan: plan.slice(0, 20_000) },
              canAlways: false,
              laptopOnly: false
            })
            const approved = answer === 'approve' || answer === 'always'
            activity(
              ctx,
              'approval',
              'app_plan',
              approved ? `Plan approved for ${name}` : `Plan not approved for ${name}`,
              approved ? 'you' : null
            )
            if (approved) {
              // The plan was the approval: its file changes and the app's checks in this app don't ask one by one.
              const set = approvedPlans.get(ctx.taskId) ?? new Set<string>()
              set.add(real)
              approvedPlans.set(ctx.taskId, set)
            }
            return approved
          },
          async check(folder, options) {
            const real = await appFolder(folder)
            // Only an app made with the builder, and only then ask.
            appService().info(real)
            await mayRunApp(
              folder,
              real,
              'install its packages from npm, typecheck, build, run its tests and open it in local browsers'
            )
            return appService().check(real, {
              browsers: options?.browsers,
              signal: ctx.signal,
              onProgress: (note) => activity(ctx, 'tool', 'app_check', note)
            })
          },
          async preview(folder, action) {
            const real = await appFolder(folder)
            if (action === 'stop') {
              appService().stopPreview(real)
              return { url: null }
            }
            appService().info(real)
            await mayRunApp(folder, real, 'install its packages from npm and start its preview')
            return appService().startPreview(real)
          },
          saveVersion: async (folder, message) =>
            appService().saveVersion(await appFolder(folder), message),
          versions: async (folder) => appService().versions(await resolveAllowed(policy, folder)),
          restore: async (folder, sha) => appService().restore(await appFolder(folder), sha),
          async saveToGitHub(folder, options) {
            const real = await appFolder(folder)
            const app = appService().info(real)
            const isPrivate = options?.private !== false
            // An outward action (decisions §25): asks every time, on the laptop only.
            const decision = await gate(
              ctx,
              `${callId}-github`,
              'app_github',
              { folder, private: isPrivate },
              {
                risk: 'external',
                summary: app.github
                  ? `Push "${app.title}" to ${app.github.url}`
                  : `Save "${app.title}" to your GitHub as a ${isPrivate ? 'private' : 'public'} repository, as you, and push each new version to it`
              },
              true
            )
            if (!decision.allowed) throw new PermissionError(`Not saved: ${decision.why}`)
            activity(
              ctx,
              'approval',
              'app_github',
              `Saving ${app.title} to GitHub`,
              decision.approvedBy
            )
            return appService().saveToGitHub(real, { private: isPrivate })
          },
          models: () => services.appModels?.() ?? { planner: null, coder: null, fixer: null }
        }
      : denied<AppAccess>('the app builder')

    return {
      taskId: ctx.taskId,
      agent: ctx.agent,
      files,
      code,
      git,
      servers,
      apps,
      search,
      documents,
      pages,
      artifacts,
      net: p.network ? net : denied<TaskNet>('the network'),
      shell,
      browser,
      memory,
      skills,
      records,
      speech,
      ask,
      remembered: (key) => services.answers?.get(key) ?? null,
      remember: (key, value) => services.answers?.set(key, value),
      signal: ctx.signal
    }
  }

  return {
    async execute(call, ctx) {
      const tool = tools.get(call.name)
      if (!tool) return refuse(call, ctx, 'there is no such tool.')

      const problem = checkInput(tool.params, call.input)
      if (problem) return refuse(call, ctx, problem)

      const state = stateOf(ctx.taskId)
      let assessment: Assessment
      try {
        assessment = tool.assess
          ? tool.assess(call.input, {
              folders: deps.folders().allowed,
              untrustedSeen: state.untrusted
            })
          : { risk: tool.risk, summary: tool.describe(call.input) }
      } catch {
        assessment = { risk: tool.risk, summary: `Run ${tool.name}` }
      }
      const gated = await gate(ctx, call.id, tool.name, call.input, assessment, !!tool.laptopOnly)
      if (!gated.allowed) return refuse(call, ctx, gated.why)
      const approvedBy = gated.approvedBy

      try {
        const result = await tool.run(call.input, toolContext(tool, ctx, call.id))
        const costUsd = result.costUsd && result.costUsd > 0 ? result.costUsd : 0
        activity(ctx, 'tool', tool.name, result.summary, approvedBy, costUsd)
        if (tool.privateOutput) state.privacy.saw(result.output, tool.name)
        if (tool.untrustedOutput) state.untrusted = true
        return {
          status: 'done',
          output: tool.untrustedOutput ? wrapUntrusted(result.output, tool.name) : result.output,
          ...(costUsd ? { costUsd } : {})
        }
      } catch (error) {
        if (error instanceof PermissionError) return refuse(call, ctx, error.message)
        // Offline (1.22): say so plainly; it isn't a bug to report.
        if (isNetworkFailure(error)) {
          activity(ctx, 'error', tool.name, `${tool.name}: no internet connection`, approvedBy)
          return {
            status: 'failed',
            output:
              'No internet connection: this needs the internet. Work offline with files and local tools, or try again later.'
          }
        }
        if (
          error instanceof MemoryError ||
          error instanceof SkillError ||
          error instanceof SearchError ||
          error instanceof ReadError ||
          error instanceof ArtifactError ||
          error instanceof ConvertError ||
          error instanceof DocumentError ||
          error instanceof SheetError ||
          error instanceof GitError ||
          error instanceof SshError ||
          error instanceof AppError ||
          error instanceof NodeDownloadError
        ) {
          activity(ctx, 'error', tool.name, `${tool.name}: ${error.message}`, approvedBy)
          return { status: 'failed', output: error.message }
        }
        const id = log.capture('tool', error, { tool: tool.name, taskId: ctx.taskId })
        const message = error instanceof Error ? error.message : 'It failed.'
        activity(
          ctx,
          'error',
          tool.name,
          `${tool.name} failed: ${message} (ref ${id.slice(0, 8)})`,
          approvedBy
        )
        return { status: 'failed', output: `The tool failed: ${message}` }
      }
    },

    answer(approvalId, answer, from) {
      const approval = store.getApproval(approvalId)
      if (!approval) throw new ApprovalError('NOT_FOUND', 'No such approval.')
      if (approval.status !== 'pending')
        throw new ApprovalError('CONFLICT', 'That approval was already answered.')
      const pending = waiting.get(approvalId)
      const tool = tools.get(approval.tool)
      // Laptop-only approvals can't be answered remotely (guardrails §9).
      if (from !== 'window' && (!tool || tool.laptopOnly || !pending || pending.laptopOnly))
        throw new ApprovalError('FORBIDDEN', 'This one can only be answered on the laptop.')
      if (answer === 'always' && !approval.canAlways)
        throw new ApprovalError('FORBIDDEN', 'This action always asks.')
      if (!pending) throw new ApprovalError('CONFLICT', 'That task is no longer waiting.')
      store.answerApproval(approvalId, answer === 'deny' ? 'denied' : 'approved', from)
      pending.resolve(answer)
    },

    cancelTask(taskId) {
      for (const pending of waiting.values())
        if (pending.taskId === taskId) pending.resolve('cancelled')
    },

    userSaid(taskId, text) {
      for (const host of hostsIn(text)) store.sites.add(taskId, host)
    },

    sawPrivate(taskId, text, source, quiet) {
      stateOf(taskId).privacy.saw(text, source, quiet)
    },

    async release(taskId) {
      states.delete(taskId)
      await services.browser?.release(taskId)
    },

    useServices(more) {
      Object.assign(services, more)
    },

    isLocalOnly: (taskId) => services.localOnlyTasks?.has(taskId) ?? false,

    async decide(ctx, request) {
      // A file change inside an app whose plan the user approved in this task (6.7); refusals still apply.
      if (
        request.tool === 'code_edit' &&
        !request.assessment.refuse &&
        planCovers(ctx.taskId, request.folder)
      ) {
        activity(ctx, 'tool', request.tool, request.assessment.summary, 'you (the plan)')
        return { allowed: true, approvedBy: 'you (the plan)' }
      }
      const decision = await gate(
        ctx,
        request.callId,
        request.tool,
        request.input,
        request.assessment,
        false
      )
      if (!decision.allowed)
        activity(ctx, 'refused', request.tool, `Refused ${request.tool}: ${decision.why}`)
      else activity(ctx, 'tool', request.tool, request.assessment.summary, decision.approvedBy)
      return decision
    }
  }
}

export class ApprovalError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN',
    message: string
  ) {
    super(message)
    this.name = 'ApprovalError'
  }
}
