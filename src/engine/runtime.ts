/**
 * The agent runtime (architecture §3): the loop that runs a task. The model
 * answers or asks for tools; every tool call goes through the permission
 * layer; budgets and loop detection stop a task that runs away.
 *
 * Phase 1 has one agent, Titan, with the file tools. Agent definition files,
 * memory and sub-agents arrive in phases 3 and 11.
 */
import type { ChatMessage, Task } from '../shared/protocol'
import { createBudgetMeter, DEFAULT_BUDGET, type Budget } from './budgets'
import type { Logger } from './lib/log'
import { ModelError } from './models/types'
import type { PermissionLayer } from './permissions'
import type { Router } from './router'
import type { Emit, Store } from './store'
import type { ToolRegistry } from './tools'
import { UNTRUSTED_RULE } from './untrusted'

export const AGENT = 'Titan'

export function systemPrompt(folders: string[]): string {
  return [
    "You are Titan, an assistant that works on the user's own laptop inside the Titan117 app.",
    'Be brief and plain. Say what you did and what you found.',
    folders.length
      ? `You may read and write only inside these folders: ${folders.join('; ')}. "." means the first one.`
      : 'No folder is allowed yet, so you cannot use files. If the user asks for files, tell them to choose a folder first.',
    'Reading runs at once. Writing a file asks the user first; if they deny it, do not try again another way.',
    'If a tool is refused, tell the user what was refused and why, and stop.',
    UNTRUSTED_RULE
  ].join('\n')
}

export interface Runtime {
  start(text: string, model: string): Task
  send(taskId: string, text: string, model?: string): Task
  cancel(taskId: string): void
  isRunning(taskId: string): boolean
  /** Resolves when a task's current run is over. For tests. */
  settled(taskId: string): Promise<void>
}

export class RuntimeError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST',
    message: string
  ) {
    super(message)
    this.name = 'RuntimeError'
  }
}

export function createRuntime(deps: {
  store: Store
  emit: Emit
  log: Logger
  router: Router
  permissions: PermissionLayer
  tools: ToolRegistry
  folders(): string[]
  budget?: Budget
  now?: () => number
}): Runtime {
  const { store, emit, log, router, permissions, tools } = deps
  const running = new Map<string, { abort: AbortController; done: Promise<void> }>()

  const toolSpecs = [...tools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    params: t.params
  }))

  async function run(taskId: string, signal: AbortSignal): Promise<void> {
    const meter = createBudgetMeter(deps.budget ?? DEFAULT_BUDGET, deps.now)
    const startCost = store.getTask(taskId)?.costUsd ?? 0
    const startSteps = store.getTask(taskId)?.steps ?? 0

    function finish(status: Task['status'], note: string | null): void {
      store.updateTask(taskId, {
        status,
        note,
        steps: startSteps + meter.steps,
        costUsd: startCost + meter.costUsd
      })
    }

    try {
      for (;;) {
        if (signal.aborted) return finish('stopped', 'You stopped this task.')

        const over = meter.beforeStep()
        if (over) {
          store.log({
            taskId,
            kind: 'budget',
            agent: AGENT,
            model: null,
            tool: null,
            summary: over,
            costUsd: 0,
            approvedBy: null
          })
          return finish('stopped', over)
        }

        const task = store.getTask(taskId)!
        const route = router.route(task.model)
        const messages: ChatMessage[] = store.listMessages(taskId).map((m) => m.message)

        const result = await route.provider.turn({
          model: route.model,
          system: systemPrompt(deps.folders()),
          messages,
          tools: toolSpecs,
          signal,
          onText: (text) => emit({ type: 'delta', taskId, text })
        })
        meter.addCost(result.usage.costUsd)
        // Steps and cost show while the task runs, not only at the end.
        store.updateTask(taskId, {
          steps: startSteps + meter.steps,
          costUsd: startCost + meter.costUsd
        })
        store.log({
          taskId,
          kind: 'model',
          agent: AGENT,
          model: task.model,
          tool: null,
          summary: `${result.usage.inputTokens} tokens in, ${result.usage.outputTokens} out`,
          costUsd: result.usage.costUsd,
          approvedBy: null
        })

        if (signal.aborted) {
          if (result.text) store.addMessage(taskId, { role: 'assistant', text: result.text })
          return finish('stopped', 'You stopped this task.')
        }

        store.addMessage(taskId, {
          role: 'assistant',
          text: result.text,
          ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {})
        })
        if (result.toolCalls.length === 0) return finish('done', null)

        let loop: string | null = null
        for (const call of result.toolCalls) {
          loop ??= meter.onToolCall(call)
          if (loop) {
            // Every call still gets an answer, so the conversation stays valid.
            store.addMessage(taskId, {
              role: 'tool',
              callId: call.id,
              name: call.name,
              output: 'Not run: the task was stopped.',
              isError: true
            })
            continue
          }
          meter.pause()
          const outcome = await permissions.execute(call, {
            taskId,
            agent: AGENT,
            model: task.model,
            signal
          })
          meter.resume()
          store.addMessage(taskId, {
            role: 'tool',
            callId: call.id,
            name: call.name,
            output: outcome.output,
            ...(outcome.status === 'done' ? {} : { isError: true })
          })
        }
        if (loop) {
          store.log({
            taskId,
            kind: 'budget',
            agent: AGENT,
            model: null,
            tool: null,
            summary: loop,
            costUsd: 0,
            approvedBy: null
          })
          return finish('stopped', loop)
        }
      }
    } catch (error) {
      if (signal.aborted) return finish('stopped', 'You stopped this task.')
      const friendly = error instanceof ModelError
      const id = log.capture('runtime', error, { taskId })
      const note = friendly
        ? (error as Error).message
        : `Something went wrong (ref ${id.slice(0, 8)}). It was saved to the local log.`
      store.log({
        taskId,
        kind: 'error',
        agent: AGENT,
        model: null,
        tool: null,
        summary: note,
        costUsd: 0,
        approvedBy: null
      })
      finish('error', note)
    }
  }

  function launch(taskId: string): void {
    const abort = new AbortController()
    const done = run(taskId, abort.signal)
      .catch((error) => {
        log.capture('runtime', error, { taskId })
      })
      .finally(() => {
        if (running.get(taskId)?.abort === abort) running.delete(taskId)
      })
    running.set(taskId, { abort, done })
  }

  function clean(text: unknown): string {
    if (typeof text !== 'string' || !text.trim())
      throw new RuntimeError('BAD_REQUEST', 'Write a message first.')
    if (text.length > 100_000) throw new RuntimeError('BAD_REQUEST', 'That message is too long.')
    return text.trim()
  }

  return {
    start(text, model) {
      const message = clean(text)
      router.route(model) // refuses an unknown source before anything is stored
      const task = store.createTask({
        title: message.split('\n')[0].slice(0, 80),
        agent: AGENT,
        model
      })
      store.log({
        taskId: task.id,
        kind: 'task',
        agent: AGENT,
        model,
        tool: null,
        summary: 'Task started',
        costUsd: 0,
        approvedBy: null
      })
      store.addMessage(task.id, { role: 'user', text: message })
      launch(task.id)
      return task
    },

    send(taskId, text, model) {
      const message = clean(text)
      const task = store.getTask(taskId)
      if (!task) throw new RuntimeError('NOT_FOUND', 'No such task.')
      if (running.has(taskId))
        throw new RuntimeError('CONFLICT', 'This task is still working. Stop it or wait.')
      if (model) router.route(model)
      store.addMessage(taskId, { role: 'user', text: message })
      const updated = store.updateTask(taskId, {
        status: 'running',
        note: null,
        ...(model ? { model } : {})
      })
      launch(taskId)
      return updated
    },

    cancel(taskId) {
      const entry = running.get(taskId)
      if (!entry) return
      entry.abort.abort()
      permissions.cancelTask(taskId)
    },

    isRunning: (taskId) => running.has(taskId),

    settled: (taskId) => running.get(taskId)?.done ?? Promise.resolve()
  }
}
