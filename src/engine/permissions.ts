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
import { dirname } from 'node:path'
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
import type {
  DocumentsAccess,
  MediaAccess,
  PageAccess,
  SiteAccess,
  TeamAccess
} from './tools/lib/define-tool'
import { SiteError, type SiteService } from './lib/sites/service'
import { MediaError, type MediaService } from './lib/media'
import type { DocIndex } from './lib/doc-index'
import type { CodeService } from './lib/code/service'
import type {
  AppAccess,
  SidebarAccess,
  AppModels,
  CodeAccess,
  GitAccess,
  ServerAccess
} from './tools/lib/define-tool'
import { AppError, countsVisits, type AppService } from './lib/apps/service'
import { DataError } from './lib/apps/data'
import type { SidebarService } from './lib/apps/sidebar'
import { NodeDownloadError } from './lib/apps/node'
import { PublishError } from './lib/apps/cloudflare'
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
import { AgentError } from './lib/agents'
import type { AddonAccess, AutomationAccess, MarketingAccess } from './tools/lib/define-tool'
import type { AddonService } from './lib/addons/service'
import { publishAddon } from './lib/addons/publish'
import type { MarketingService } from './lib/marketing/service'
import { MarketingError } from './lib/marketing/brand'
import { checkVideo } from './lib/marketing/video'
import { AutomationError } from './lib/automation/schedule'
import { checkRecording } from './lib/automation/recorder'
import type { AutomationService } from './lib/automation/service'

export interface CallContext {
  taskId: string
  agent: string
  model: string
  signal: AbortSignal
  /** Where the call came from: the agent itself, or a script it wrote (feature 4.10). */
  via?: 'agent' | 'script'
  /** Tools that ask every time for this agent (its definition, decisions §59.3). */
  alwaysAsk?: string[]
  /** The agent reads only its own memory, not the shared one (§59.4). */
  ownMemory?: boolean
}

export type CallOutcome =
  | { status: 'done'; output: string; costUsd?: number }
  /** The layer or the user said no. The tool did not run. */
  | { status: 'refused'; output: string }
  /** The tool ran and failed. */
  | { status: 'failed'; output: string }

export interface PermissionLayer {
  execute(call: ToolCall, ctx: CallContext): Promise<CallOutcome>
  /**
   * The user's answer to an approval. `from` is where it was answered:
   * `remote-second-factor` is a paired device's answer that carried Convex's
   * checked proof of a fresh second factor (decisions §65.7).
   */
  answer(
    approvalId: string,
    answer: ApprovalAnswer,
    from: 'window' | 'remote' | 'remote-second-factor'
  ): void
  /** Whether an approval can only be answered on the laptop (guardrails §9); true when unsure. */
  laptopOnly(approvalId: string): boolean
  /**
   * A laptop-only approval whose category the user lets be answered remotely
   * with a fresh second factor (decisions §65.7); false for everything else.
   */
  secondFactorAllowed(approvalId: string): boolean
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
  /** Sidebar apps and their shared data (6.2, 6.11; decisions §58). */
  sidebar?: SidebarService
  /** Agents working together and agents on request (4.6, 18.2; decisions §59). */
  team?: TeamService
  /** Images and video through OpenRouter (2.7, decisions §59.10). */
  media?: MediaService
  /** Site checks for the QA tester and the SEO agent (5.2, 5.8; decisions §60). */
  sites?: SiteService
  /** Schedules, web watches, recordings and saved logins (phase 13; decisions §61). */
  automation?: AutomationService
  /** The brand kit, the content calendar and the promo video (phase 14; decisions §62). */
  marketing?: MarketingService
  /** Installed add-ons and the marketplace (phase 16; decisions §66). */
  addons?: AddonService
}

/** The engine's side of the team tools; the layer hands each call its own task. */
export interface TeamService {
  delegate(
    ctx: CallContext,
    parts: { agent: string; brief: string }[]
  ): Promise<import('./tools/lib/define-tool').PartResult[]>
  create(
    ctx: CallContext,
    input: import('./tools/lib/define-tool').NewAgent
  ): import('../shared/protocol').AgentDef
}

/**
 * Laptop-only approvals the user may let be answered remotely after a second
 * factor (decisions §65.7): actions that go outside or can't be taken back
 * (sending, publishing, pushing, deleting a file, opening a new site), and
 * commands that always ask (deleting, installing). Tools marked laptop-only
 * for anything else (agents, schedules, standing instructions, the sidebar)
 * and the always-ask list outside commands never are.
 */
export type RemoteCategory = 'external' | 'commands'
export const REMOTE_CATEGORIES: RemoteCategory[] = ['external', 'commands']
const COMMAND_TOOLS = new Set(['run_command', 'server_command', 'code_command'])

interface Waiting {
  taskId: string
  laptopOnly: boolean
  category: RemoteCategory | null
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
  /** The categories the user switched on for a second factor (decisions §65.7). */
  remoteSecondFactor?: () => RemoteCategory[]
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
  /** Tools marked laptop-only for something other than acting outside: permissions, agents, schedules. */
  const neverRemote = (tool: { laptopOnly?: boolean; risk: Risk } | undefined): boolean =>
    !!tool?.laptopOnly && tool.risk !== 'external'
  const secondFactorOk = (pending: Waiting): boolean =>
    pending.laptopOnly &&
    pending.category !== null &&
    (deps.remoteSecondFactor?.() ?? []).includes(pending.category)
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
      category?: RemoteCategory | null
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
      waiting.set(approval.id, {
        taskId: ctx.taskId,
        laptopOnly: input.laptopOnly,
        category: input.laptopOnly ? (input.category ?? null) : null,
        resolve
      })
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
    laptopOnlyTool: boolean,
    /** The asking tool's own risk: a laptop-only tool that isn't external never gets a second-factor answer. */
    toolRisk?: Risk
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
        laptopOnly: laptopOnlyTool || risk === 'external' || !!assessment.alwaysAsks,
        category:
          laptopOnlyTool && toolRisk !== 'external'
            ? null
            : assessment.alwaysAsks
              ? COMMAND_TOOLS.has(name)
                ? 'commands'
                : null
              : risk === 'external'
                ? 'external'
                : null
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
          laptopOnly: true,
          category: tool.laptopOnly ? null : 'external'
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
          ownOnly: !!ctx.ownMemory,
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

    const team: TeamAccess = p.team
      ? {
          async delegate(parts) {
            if (p.team !== 'delegate' && p.team !== 'build')
              throw new PermissionError('This tool may not hand work to other agents.')
            return needService(services.team, 'Agents working together').delegate(ctx, parts)
          },
          create(input) {
            if (p.team !== 'build') throw new PermissionError('This tool may not make agents.')
            return needService(services.team, 'Making agents').create(ctx, input)
          }
        }
      : denied<TeamAccess>('other agents')

    const media: MediaAccess = p.media
      ? {
          pick: (kind, asked) => needService(services.media, 'Images and video').pick(kind, asked),
          image: (input) =>
            needService(services.media, 'Images and video').image({ ...input, signal: ctx.signal }),
          video: (input) =>
            needService(services.media, 'Images and video').video({ ...input, signal: ctx.signal })
        }
      : denied<MediaAccess>('images and video')

    const sites: SiteAccess = p.sites
      ? (() => {
          const service = (): SiteService => needService(services.sites, 'Site checks')
          const reader = (): PageReader => needService(services.pages, 'Reading pages')
          return {
            audit: (url, maxPages) =>
              service().audit(url, maxPages, {
                net,
                robots: (u) => reader().allowedByRobots(u, net, ctx.signal),
                signal: ctx.signal
              }),
            qa: (urls, options = {}) => service().qa(urls, options, { net, signal: ctx.signal }),
            runTests: (tests) => service().runTests(tests, { net, signal: ctx.signal }),
            speed: (url, strategy) => service().speed(url, strategy, net, ctx.signal),
            visibility: (input) => service().visibility(input, ctx.signal),
            history: (site) => service().history(site),
            remember: (audit) => service().remember(audit)
          }
        })()
      : denied<SiteAccess>('site checks')

    const auto = (): AutomationService => needService(services.automation, 'Automation')
    const autoWrite = (): void => {
      if (p.automation !== 'write')
        throw new PermissionError('This tool may read schedules, watches and recordings only.')
    }
    const madeBy = (): string =>
      `${ctx.agent}, in the task "${(store.getTask(ctx.taskId)?.title ?? '').slice(0, 80)}"`
    const automation: AutomationAccess = p.automation
      ? {
          schedules: () => auto().schedules.list(),
          createSchedule(input) {
            autoWrite()
            return auto().schedules.create({ ...input, source: madeBy() })
          },
          changeSchedule(name, action) {
            autoWrite()
            if (action === 'remove') {
              auto().schedules.remove(name)
              return null
            }
            if (action === 'run_now') return auto().schedules.runNow(name)
            return auto().schedules.setEnabled(name, action === 'resume')
          },
          watches: () => auto().watches.list(),
          watchChanges: (name) => auto().watches.changes(name),
          saveWatch(input) {
            autoWrite()
            return auto().watches.save({ ...input, source: madeBy() })
          },
          checkWatch(name, read) {
            autoWrite()
            return auto().watches.check(name, read)
          },
          recordings: () => auto().recordings.list(),
          recording: (name) => auto().recordings.get(name),
          saveRecording(input) {
            autoWrite()
            return auto().recordings.save(checkRecording(input, madeBy()))
          },
          login(site) {
            // Only a tool that replays in the browser gets a saved login.
            if (p.automation !== 'write' || !p.browser)
              throw new PermissionError('This tool may not use saved logins.')
            return auto().logins.get(site)
          }
        }
      : denied<AutomationAccess>('schedules, watches and recordings')

    const addonService = (): AddonService => needService(services.addons, 'Add-ons')
    const addons: AddonAccess =
      p.addons === 'manage'
        ? {
            list: () => addonService().store.list(),
            inspect(address) {
              if (!p.network)
                throw new PermissionError('This tool did not declare access to the network.')
              // GitHub and OSV are reached through this task's own network policy.
              return addonService().inspect(address, (url, init) => net.fetch(url, init))
            },
            read: (key, path) => addonService().readInspected(key, path),
            card(key, summary) {
              const i = addonService().inspection(key)
              if (!i) throw new PermissionError('Inspect the add-on first.')
              return addonService().card(i, summary)
            },
            async install(key, folder) {
              const service = addonService()
              const i = service.inspection(key)
              if (!i) throw new PermissionError('Inspect the add-on first.')
              // An app template's files go into a new folder inside the allowed folders.
              let target: string | null = null
              if (i.manifest.app) {
                if (p.folders !== 'write')
                  throw new PermissionError('This tool may not write files.')
                if (!folder)
                  throw new PermissionError('Say which new folder the app’s files go into.')
                target = await files.resolve(folder)
                const existing = await files.list(folder).catch(() => null)
                if (existing && existing.length)
                  throw new PermissionError('That folder isn’t empty. Pick a new one.')
              }
              const { addon, templateFiles } = service.install(key, madeBy())
              if (target && templateFiles) {
                await files.makeFolder(folder!)
                for (const [path, data] of templateFiles)
                  await files.writeBytes(
                    `${folder!.replace(/[\\/]+$/, '')}/${path}`,
                    Buffer.from(data)
                  )
              }
              return { addon, copiedTo: target }
            },
            checkTool: (input) => addonService().checkTool(input),
            createTool: (input) => addonService().createTool(input, madeBy()),
            rollback: (name) => addonService().rollback(name),

            async readFolder(folder) {
              if (!p.folders) throw new PermissionError('This tool may not read files.')
              const files = await readTree(folder)
              const { manifest, card } = await addonService().checkLocal(files)
              return { files, card, title: manifest.title }
            },
            installFolder: (files) => addonService().installLocal(files, madeBy()),

            async download(address, folder) {
              if (!p.network)
                throw new PermissionError('This tool did not declare access to the network.')
              if (p.folders !== 'write') throw new PermissionError('This tool may not write files.')
              const existing = await files.list(folder).catch(() => null)
              if (existing && existing.length)
                throw new PermissionError('That folder isn’t empty. Pick a new one.')
              const target = await files.resolve(folder)
              const got = await addonService().download(address, (url, init) =>
                net.fetch(url, init)
              )
              const base = folder.replace(/[\\/]+$/, '')
              await files.makeFolder(folder)
              for (const [path, data] of got.files)
                await files.writeBytes(`${base}/${path}`, Buffer.from(data))
              const SETUP =
                /^(readme(\.md|\.txt|\.rst)?|package\.json|requirements\.txt|pyproject\.toml|setup\.py|dockerfile|docker-compose\.ya?ml|makefile|cargo\.toml|go\.mod|\.env\.example)$/i
              const texts: { path: string; text: string }[] = []
              let budget = 30_000
              for (const [path, data] of got.files) {
                if (path.includes('/') || !SETUP.test(path) || budget <= 0) continue
                const text = new TextDecoder().decode(data.subarray(0, Math.min(budget, 12_000)))
                budget -= text.length
                texts.push({ path, text })
              }
              return {
                key: got.key,
                folder: target,
                files: [...got.files.keys()].slice(0, 300),
                checks: got.checks,
                texts
              }
            },

            async publish(name, repoName, licence) {
              if (!p.network)
                throw new PermissionError('This tool did not declare access to the network.')
              const token = services.githubToken?.() ?? null
              if (!token) throw new PermissionError('Sign in with GitHub on the Code screen first.')
              return publishAddon(addonService(), name, repoName, licence, token, (url, init) =>
                net.fetch(url, init)
              )
            }
          }
        : denied<AddonAccess>('add-ons')

    /** An add-on folder's files (titan.json and what it names, up to 2 MB). */
    async function readTree(folder: string): Promise<Map<string, Uint8Array>> {
      const out = new Map<string, Uint8Array>()
      let total = 0
      const base = folder.replace(/[\\/]+$/, '')
      const walk = async (rel: string, depth: number): Promise<void> => {
        if (depth > 4) return
        for (const e of await files.list(rel ? `${base}/${rel}` : base)) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue
          const r = rel ? `${rel}/${e.name}` : e.name
          if (e.kind === 'folder') await walk(r, depth + 1)
          else {
            if (out.size >= 500) throw new PermissionError('The folder has more than 500 files.')
            const data = await files.readBytes(`${base}/${r}`, 1024 * 1024)
            total += data.byteLength
            if (total > 2 * 1024 * 1024)
              throw new PermissionError('The folder is larger than 2 MB.')
            out.set(r, new Uint8Array(data))
          }
        }
      }
      await walk('', 0)
      return out
    }

    const market = (): MarketingService => needService(services.marketing, 'Marketing')
    const marketWrite = (): void => {
      if (p.marketing !== 'write')
        throw new PermissionError('This tool may read the brand kit and the calendar only.')
    }
    const marketing: MarketingAccess = p.marketing
      ? {
          brand: () => market().brand.get(),
          saveBrand(input) {
            marketWrite()
            return market().brand.save(input)
          },
          readSite(urls, options = {}) {
            // A site is read through this task's own network policy, or not at all.
            if (!p.network)
              throw new PermissionError('This tool did not declare access to the network.')
            return market().readSite(urls, options, { net, signal: ctx.signal })
          },
          posts: (filter) => market().posts.list(filter),
          savePosts(inputs) {
            marketWrite()
            return market().posts.save(inputs, madeBy())
          },
          changePost(id, action) {
            marketWrite()
            if (action === 'remove') {
              market().posts.remove(id)
              return null
            }
            return market().posts.setStatus(id, action)
          },
          setResults(id, results) {
            marketWrite()
            return market().posts.setResults(id, results)
          },
          visits: (site, days) => market().visits(site, days),
          mail: {
            state: () => market().mail.state(),
            saveList(input) {
              marketWrite()
              return market().mail.store.saveList(input)
            },
            addSubscribers(list, people, how) {
              marketWrite()
              const found = market().mail.store.list(list)
              if (!found)
                throw new PermissionError(`There is no list called "${String(list).slice(0, 80)}".`)
              return market().mail.store.addSubscribers(found.id, people, { how })
            },
            saveNewsletter(input) {
              marketWrite()
              return market().mail.store.saveNewsletter(input, madeBy())
            },
            audience: (id) => market().mail.audience(id),
            test(id) {
              marketWrite()
              return market().mail.test(id, ctx.signal)
            },
            send(id) {
              marketWrite()
              return market().mail.send(id, ctx.signal)
            },
            saveSequence(input) {
              marketWrite()
              return market().mail.store.saveSequence(input, madeBy())
            }
          },
          checkVideo(input) {
            const brand = market().brand.get()
            return checkVideo(
              input,
              brand
                ? {
                    primary: brand.primary,
                    accent: brand.accent,
                    font: brand.headingFont,
                    name: brand.name,
                    logo: brand.logo
                  }
                : {}
            )
          },
          video(spec, load) {
            marketWrite()
            return market().video(spec, load, { signal: ctx.signal })
          }
        }
      : denied<MarketingAccess>('the brand kit, posts and videos')

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
          async read(url, options) {
            let host: string
            try {
              host = new URL(url).hostname
            } catch {
              throw new PermissionError('That is not a web address.')
            }
            if (!siteOk(host))
              throw new PermissionError(`${host} is not on ${ctx.agent}'s list of sites to use.`)
            return needService(services.pages, 'Reading pages').read(url, net, ctx.signal, options)
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
          async phone(folder) {
            const real = await appFolder(folder)
            const app = appService().info(real)
            if (app.kind !== 'mobile')
              throw new PermissionError('Only a mobile app opens on a phone.')
            // It opens the app's dev server to the local network (decisions §57): asks every time, on the laptop only.
            const decision = await gate(
              ctx,
              `${callId}-phone`,
              'app_phone',
              { folder },
              {
                risk: 'external',
                summary: `Open "${app.title}" to phones on this Wi-Fi (Expo Go): while it runs, devices on the same network can load the app's code from this laptop`
              },
              true
            )
            if (!decision.allowed) throw new PermissionError(`Not opened: ${decision.why}`)
            activity(
              ctx,
              'approval',
              'app_phone',
              `Opening ${app.title} to phones`,
              decision.approvedBy
            )
            return appService().startPhone(real)
          },
          saveVersion: async (folder, message) =>
            appService().saveVersion(await appFolder(folder), message),
          versions: async (folder) => appService().versions(await resolveAllowed(policy, folder)),
          restore: async (folder, sha) => appService().restore(await appFolder(folder), sha),
          async addTarget(folder, kind) {
            const real = await appFolder(folder)
            // The new app is made beside this one: that folder must be writable too.
            await checkWritable(policy, dirname(real))
            return appService().addTarget(real, kind)
          },
          async shareCode(folder) {
            const real = await appFolder(folder)
            for (const target of appService().info(real).linked)
              await checkWritable(policy, target.folder)
            return appService().shareCode(real)
          },
          async publish(folder) {
            const real = await appFolder(folder)
            const app = appService().info(real)
            // Outward and public (decisions §30): asks every time, on the laptop only.
            const decision = await gate(
              ctx,
              `${callId}-publish`,
              'app_publish',
              { folder },
              {
                risk: 'external',
                summary: `Publish "${app.title}" to your Cloudflare account: anyone with its address can see it${app.published ? ` (it replaces ${app.published.url})` : ''}. ${countsVisits(real) ? 'It counts its visits in your own Cloudflare account, without cookies or IP addresses ("analytics": false in site.config.json turns that off).' : 'It doesn’t count visits.'}`
              },
              true
            )
            if (!decision.allowed) throw new PermissionError(`Not published: ${decision.why}`)
            activity(ctx, 'approval', 'app_publish', `Publishing ${app.title}`, decision.approvedBy)
            return appService().publish(real, (note) => activity(ctx, 'tool', 'app_publish', note))
          },
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

    // Sidebar apps (decisions §58): reading their data is like reading memory; changing it is the
    // tool's own approval; adding an app shows exactly what other apps' data it may reach, every time.
    const sidebarService = (): SidebarService => needService(services.sidebar, 'Sidebar apps')
    const sidebarWrite = (): void => {
      if (p.sidebar !== 'write')
        throw new PermissionError('This tool may read sidebar apps’ data, not change it.')
    }
    const knownApp = (app: string): void => {
      if (!sidebarService().get(app))
        throw new PermissionError(
          `There's no sidebar app "${String(app).slice(0, 60)}". List them with sidebar_data (action "apps").`
        )
    }
    const sidebar: SidebarAccess = p.sidebar
      ? {
          apps: () =>
            sidebarService()
              .list()
              .map((a) => ({
                id: a.id,
                title: a.title,
                folder: a.folder,
                collections: sidebarService().data.collections(a.id),
                reads: a.grants.reads,
                writes: a.grants.writes,
                error: a.error?.message ?? null
              })),
          list(app, collection, query) {
            knownApp(app)
            return sidebarService().data.list(app, collection, query)
          },
          count(app, collection, query) {
            knownApp(app)
            return sidebarService().data.count(app, collection, query)
          },
          get(app, collection, id) {
            knownApp(app)
            return sidebarService().data.get(app, collection, id)
          },
          insert(app, collection, data) {
            sidebarWrite()
            knownApp(app)
            return sidebarService().data.insert(app, collection, data)
          },
          update(app, collection, id, data) {
            sidebarWrite()
            knownApp(app)
            return sidebarService().data.update(app, collection, id, data)
          },
          remove(app, collection, id) {
            sidebarWrite()
            knownApp(app)
            return sidebarService().data.remove(app, collection, id)
          },
          async add(folder) {
            sidebarWrite()
            const real = await appFolder(folder)
            const review = sidebarService().review(real)
            const name = (ref: string, app: string | null): string =>
              `${app ?? ref.split('/')[0]}'s ${ref.split('/')[1] === '*' ? 'data' : ref.split('/')[1]}`
            const reach = [
              ...review.reads.map((r) => `read ${name(r.ref, r.app)}`),
              ...review.writes.map((w) => `change ${name(w.ref, w.app)}`)
            ]
            // The user agrees to exactly what titan.json asks for (decisions §58): every time, on the laptop.
            const decision = await gate(
              ctx,
              `${callId}-sidebar`,
              'sidebar_add',
              {
                folder,
                reads: review.manifest.reads,
                writes: review.manifest.writes,
                ai: review.manifest.ai
              },
              {
                risk: 'write',
                alwaysAsks: true,
                summary: `${review.added ? 'Update' : 'Add'} "${review.title}" ${review.added ? 'in' : 'to'} the Titan117 sidebar: Titan117 saves a version, runs its checks (its own code) and shows it with no network; it keeps its own data on this laptop${reach.length ? ` and may ${reach.join(', ')}` : ''}${review.manifest.ai ? '. It may also send questions to your default AI model (costs credits, at most 100 a day)' : ''}`
              },
              true
            )
            if (!decision.allowed) throw new PermissionError(`Not added: ${decision.why}`)
            activity(
              ctx,
              'approval',
              'sidebar_add',
              `Adding ${review.title} to the sidebar`,
              decision.approvedBy
            )
            return sidebarService().add(
              real,
              {
                reads: review.manifest.reads,
                writes: review.manifest.writes,
                ai: review.manifest.ai
              },
              (note) => activity(ctx, 'tool', 'sidebar_add', note)
            )
          },
          async refresh(folder) {
            sidebarWrite()
            const real = await appFolder(folder)
            if (!sidebarService().byFolder(real))
              throw new PermissionError('That app isn’t in the sidebar; adding it is sidebar_add.')
            await mayRunApp(
              folder,
              real,
              'save a version, run its checks and update it in the sidebar'
            )
            return sidebarService().update(real, (note) =>
              activity(ctx, 'tool', 'sidebar_update', note)
            )
          },
          async refreshSdk(folder) {
            sidebarWrite()
            // No sidebar here (tests, an engine without it): nothing to refresh.
            if (!services.sidebar) return false
            return services.sidebar.refreshSdk(await appFolder(folder))
          },
          async inSidebar(folder) {
            const real = await resolveAllowed(policy, folder)
            return !!services.sidebar?.byFolder(real)
          }
        }
      : denied<SidebarAccess>('sidebar apps')

    return {
      taskId: ctx.taskId,
      agent: ctx.agent,
      files,
      code,
      git,
      servers,
      apps,
      sidebar,
      team,
      media,
      sites,
      automation,
      marketing,
      addons,
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
              untrustedSeen: state.untrusted,
              core: deps.folders().core,
              addonCard: (key, summary) => {
                const inspection = services.addons?.inspection(key)
                return inspection ? services.addons!.card(inspection, summary) : null
              }
            })
          : { risk: tool.risk, summary: tool.describe(call.input) }
      } catch {
        assessment = { risk: tool.risk, summary: `Run ${tool.name}` }
      }
      // The agent's definition may make a tool ask every time; never ask less (decisions §59.3).
      if (ctx.alwaysAsk?.includes(tool.name))
        assessment = {
          ...assessment,
          risk: assessment.risk === 'read' ? 'write' : assessment.risk,
          alwaysAsks: true
        }
      const gated = await gate(
        ctx,
        call.id,
        tool.name,
        call.input,
        assessment,
        !!tool.laptopOnly,
        tool.risk
      )
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
          error instanceof NodeDownloadError ||
          error instanceof PublishError ||
          error instanceof DataError ||
          error instanceof AgentError ||
          error instanceof MediaError ||
          error instanceof SiteError ||
          error instanceof AutomationError ||
          error instanceof MarketingError
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
      // Laptop-only approvals can't be answered remotely (guardrails §9), except a category
      // the user switched on, with a checked second factor (decisions §65.7).
      const remoteOk =
        from === 'remote'
          ? !!tool && !tool.laptopOnly && !!pending && !pending.laptopOnly
          : from === 'remote-second-factor'
            ? // Its category was set from the tool that asked (open_site and code_command aren't tools).
              !neverRemote(tool) && !!pending && secondFactorOk(pending)
            : true
      if (!remoteOk)
        throw new ApprovalError('FORBIDDEN', 'This one can only be answered on the laptop.')
      if (answer === 'always' && !approval.canAlways)
        throw new ApprovalError('FORBIDDEN', 'This action always asks.')
      if (!pending) throw new ApprovalError('CONFLICT', 'That task is no longer waiting.')
      store.answerApproval(approvalId, answer === 'deny' ? 'denied' : 'approved', from)
      pending.resolve(answer)
    },

    secondFactorAllowed(approvalId) {
      const approval = store.getApproval(approvalId)
      const pending = waiting.get(approvalId)
      const tool = approval ? tools.get(approval.tool) : undefined
      return !!approval && !neverRemote(tool) && !!pending && secondFactorOk(pending)
    },

    laptopOnly(approvalId) {
      const approval = store.getApproval(approvalId)
      const pending = waiting.get(approvalId)
      const tool = approval ? tools.get(approval.tool) : undefined
      return !approval || !tool || !pending || tool.laptopOnly || pending.laptopOnly
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
