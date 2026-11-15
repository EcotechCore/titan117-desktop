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
import { createFileAccess, PermissionError, type FolderPolicy } from './lib/folders'
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

export interface CallContext {
  taskId: string
  agent: string
  model: string
  signal: AbortSignal
  /** Where the call came from: the agent itself, or a script it wrote (feature 4.10). */
  via?: 'agent' | 'script'
}

export type CallOutcome =
  | { status: 'done'; output: string }
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
}

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
    approvedBy: string | null = null
  ): void {
    store.log({
      taskId: ctx.taskId,
      kind,
      agent: ctx.agent,
      model: ctx.model,
      tool,
      summary: ctx.via === 'script' && kind === 'tool' ? `${summary} (from a script)` : summary,
      costUsd: 0,
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

  function toolContext(tool: AnyTool, ctx: CallContext, callId: string): ToolContext {
    const p = tool.permissions
    const policy = deps.folders()
    const state = stateOf(ctx.taskId)
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
          mode: p.memory
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

    return {
      taskId: ctx.taskId,
      agent: ctx.agent,
      files,
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
      if (assessment.refuse) return refuse(call, ctx, assessment.refuse)
      // Private content on its way out is blocked before the user is even asked (security.md A3).
      const leak = assessment.outgoing ? state.privacy.leak(assessment.outgoing) : null
      if (leak)
        return refuse(
          call,
          ctx,
          `this would send private content (from ${leak.source}) over the internet. Nothing ran.`
        )

      let approvedBy: string | null = null
      const standing = assessment.standing
      const risk = assessment.risk
      const allowedBefore =
        !assessment.alwaysAsks &&
        risk === 'write' &&
        (store.isAlwaysAllowed(ctx.taskId, tool.name) ||
          (standing ? store.hasStanding(standing.folder, standing.command) : false))

      if (risk === 'external' || (risk === 'write' && !allowedBefore)) {
        const canAlways = risk === 'write' && !assessment.alwaysAsks
        const answer = await waitFor(ctx, {
          callId: call.id,
          tool: tool.name,
          risk,
          summary: assessment.summary,
          args: call.input,
          // "Always" is never offered for external actions or the always-ask list.
          canAlways,
          alwaysLabel: canAlways && standing ? standing.label : null,
          laptopOnly: tool.laptopOnly || risk === 'external' || !!assessment.alwaysAsks
        })
        if (answer === 'cancelled')
          return refuse(call, ctx, 'the task was cancelled before you answered.')
        if (answer === 'deny') return refuse(call, ctx, 'you denied it.')
        if (answer === 'always' && canAlways) {
          if (standing) store.addStanding(standing.folder, standing.command)
          else store.allowAlways(ctx.taskId, tool.name)
        }
        approvedBy = 'you'
      } else if (risk === 'write') {
        approvedBy =
          standing && store.hasStanding(standing.folder, standing.command)
            ? 'you (always, in this folder)'
            : 'you (always, this task)'
      }

      try {
        const result = await tool.run(call.input, toolContext(tool, ctx, call.id))
        activity(ctx, 'tool', tool.name, result.summary, approvedBy)
        if (tool.privateOutput) state.privacy.saw(result.output, tool.name)
        if (tool.untrustedOutput) state.untrusted = true
        return {
          status: 'done',
          output: tool.untrustedOutput ? wrapUntrusted(result.output, tool.name) : result.output
        }
      } catch (error) {
        if (error instanceof PermissionError) return refuse(call, ctx, error.message)
        if (error instanceof MemoryError || error instanceof SkillError) {
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
