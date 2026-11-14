/**
 * The permission and approval layer (guardrails §4): the only way a tool
 * runs. Every call is checked, asked about when it's risky, given exactly
 * the access its tool declared, and written to the activity timeline.
 *
 *   read      runs without asking, inside allowed folders
 *   write     waits for the user, unless they allowed that tool for this task
 *   external  always waits for the user, whatever the settings
 */
import type { ApprovalAnswer, ToolCall } from '../shared/protocol'
import { createFileAccess, PermissionError, type FolderPolicy } from './lib/folders'
import type { Logger } from './lib/log'
import type { Store } from './store'
import { checkInput } from './tools/lib/define-tool'
import type { ToolRegistry } from './tools'
import { wrapUntrusted } from './untrusted'

export interface CallContext {
  taskId: string
  agent: string
  model: string
  signal: AbortSignal
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
}

interface Waiting {
  taskId: string
  resolve(answer: ApprovalAnswer | 'cancelled'): void
}

export function createPermissionLayer(deps: {
  tools: ToolRegistry
  store: Store
  log: Logger
  folders(): FolderPolicy
}): PermissionLayer {
  const { tools, store, log } = deps
  const waiting = new Map<string, Waiting>()

  function refuse(call: ToolCall, ctx: CallContext, why: string): CallOutcome {
    store.log({
      taskId: ctx.taskId,
      kind: 'refused',
      agent: ctx.agent,
      model: ctx.model,
      tool: call.name,
      summary: `Refused ${call.name}: ${why}`,
      costUsd: 0,
      approvedBy: null
    })
    return { status: 'refused', output: `Refused: ${why}` }
  }

  return {
    async execute(call, ctx) {
      const tool = tools.get(call.name)
      if (!tool) return refuse(call, ctx, 'there is no such tool.')

      const problem = checkInput(tool.params, call.input)
      if (problem) return refuse(call, ctx, problem)

      let approvedBy: string | null = null
      const mustAsk =
        tool.risk === 'external' ||
        (tool.risk === 'write' && !store.isAlwaysAllowed(ctx.taskId, tool.name))

      if (mustAsk) {
        let summary: string
        try {
          summary = tool.describe(call.input)
        } catch {
          summary = `Run ${tool.name}`
        }
        const approval = store.createApproval({
          taskId: ctx.taskId,
          callId: call.id,
          tool: tool.name,
          risk: tool.risk,
          summary,
          input: call.input,
          // "Always" is never offered for external actions: they always ask.
          canAlways: tool.risk === 'write'
        })
        store.updateTask(ctx.taskId, { status: 'waiting' })
        store.log({
          taskId: ctx.taskId,
          kind: 'approval',
          agent: ctx.agent,
          model: ctx.model,
          tool: tool.name,
          summary: `Asked: ${summary}`,
          costUsd: 0,
          approvedBy: null
        })

        const answer = await new Promise<ApprovalAnswer | 'cancelled'>((resolve) => {
          waiting.set(approval.id, { taskId: ctx.taskId, resolve })
          ctx.signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
        })
        waiting.delete(approval.id)

        if (answer === 'cancelled') {
          store.answerApproval(approval.id, 'expired', 'task cancelled')
          return refuse(call, ctx, 'the task was cancelled before you answered.')
        }
        store.updateTask(ctx.taskId, { status: 'running' })
        if (answer === 'deny') return refuse(call, ctx, 'you denied it.')
        if (answer === 'always' && tool.risk === 'write') store.allowAlways(ctx.taskId, tool.name)
        approvedBy = 'you'
      } else if (tool.risk === 'write') {
        approvedBy = 'you (always, this task)'
      }

      try {
        const result = await tool.run(call.input, {
          files: createFileAccess(deps.folders(), tool.permissions.folders),
          signal: ctx.signal
        })
        store.log({
          taskId: ctx.taskId,
          kind: 'tool',
          agent: ctx.agent,
          model: ctx.model,
          tool: tool.name,
          summary: result.summary,
          costUsd: 0,
          approvedBy
        })
        return {
          status: 'done',
          output: tool.untrustedOutput ? wrapUntrusted(result.output, tool.name) : result.output
        }
      } catch (error) {
        if (error instanceof PermissionError) return refuse(call, ctx, error.message)
        const id = log.capture('tool', error, { tool: tool.name, taskId: ctx.taskId })
        const message = error instanceof Error ? error.message : 'It failed.'
        store.log({
          taskId: ctx.taskId,
          kind: 'error',
          agent: ctx.agent,
          model: ctx.model,
          tool: tool.name,
          summary: `${tool.name} failed: ${message} (ref ${id.slice(0, 8)})`,
          costUsd: 0,
          approvedBy
        })
        return { status: 'failed', output: `The tool failed: ${message}` }
      }
    },

    answer(approvalId, answer, from) {
      const approval = store.getApproval(approvalId)
      if (!approval) throw new ApprovalError('NOT_FOUND', 'No such approval.')
      if (approval.status !== 'pending')
        throw new ApprovalError('CONFLICT', 'That approval was already answered.')
      const tool = tools.get(approval.tool)
      // Laptop-only approvals can't be answered remotely (guardrails §9).
      if (from !== 'window' && (!tool || tool.laptopOnly))
        throw new ApprovalError('FORBIDDEN', 'This one can only be answered on the laptop.')
      if (answer === 'always' && !approval.canAlways)
        throw new ApprovalError('FORBIDDEN', 'This action always asks.')
      const pending = waiting.get(approvalId)
      if (!pending) throw new ApprovalError('CONFLICT', 'That task is no longer waiting.')
      store.answerApproval(approvalId, answer === 'deny' ? 'denied' : 'approved', from)
      pending.resolve(answer)
    },

    cancelTask(taskId) {
      for (const pending of waiting.values())
        if (pending.taskId === taskId) pending.resolve('cancelled')
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
