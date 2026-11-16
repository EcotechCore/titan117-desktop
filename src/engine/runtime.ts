/**
 * The agent runtime (architecture §3): the loop that runs a task. The model
 * answers or asks for tools; every tool call goes through the permission
 * layer; budgets and loop detection stop a task that runs away.
 *
 * Phase 3: Titan, the general assistant, with every built-in tool, memory,
 * skills and records of past tasks. Agent definition files and sub-agents
 * arrive in phase 11.
 */
import type { ChatMessage, Task } from '../shared/protocol'
import { createBudgetMeter, DEFAULT_BUDGET, RESEARCH_BUDGET, type Budget } from './budgets'
import type { Logger } from './lib/log'
import type { SkillStore } from './lib/skills'
import type { MemoryStore } from './memory'
import { ModelError } from './models/types'
import { isNetworkFailure, OFFLINE_NOTE } from './lib/online'
import type { PermissionLayer } from './permissions'
import { formatRecord, type RecordStore } from './records'
import type { Router } from './router'
import type { Emit, Store } from './store'
import type { ToolRegistry } from './tools'
import type { ParamSchema } from './tools/lib/define-tool'
import { UNTRUSTED_RULE, wrapUntrusted } from './untrusted'

export const AGENT = 'Titan'

/** What Titan knows at the start of a run: memory, skills, similar past tasks. */
export interface PromptContext {
  memories?: string[]
  skills?: { name: string; description: string }[]
  pastTasks?: string[]
  platform?: NodeJS.Platform
  /** Deep research (feature 16.8). */
  research?: boolean
}

/** Deep research's own instructions (16.8, decisions §44; ideas from GPT Researcher). */
export const RESEARCH_RULES = [
  'This task is DEEP RESEARCH. Work like a careful analyst:',
  '1. Plan: write down the questions the report must answer.',
  "2. Search widely: several web_search calls with different words, in the user's language and in English where that finds more.",
  '3. Read the best sources with web_fetch: official, primary and recent first; read_site for a company or institution.',
  '4. Cross-check: a fact that matters needs two independent sources, or say that it rests on one. Note where sources disagree.',
  '5. Finish with ONE document artifact (artifact_create, kind "document"): a short summary first, then sections, tables where they help, a numbered citation like [1] after every fact from the web, and a final "## Sources" section listing each as "[n] [Title](address)". Say what you could not find.',
  'Then answer in the chat with two or three sentences and point to the report.'
].join('\n')

export function systemPrompt(folders: string[], context: PromptContext = {}): string {
  const platform = context.platform ?? process.platform
  const lines = [
    "You are Titan, the general assistant in the Titan117 app. You work on the user's own laptop for a small company.",
    'You do one-off tasks yourself with your tools: files, the shell, small scripts, the browser, web pages, memory, speech and any connectors the user added.',
    'Be brief and plain. Work step by step: act, check the result, fix what went wrong. When done, say what you did and what you found.',
    folders.length
      ? `You may use files only inside these folders: ${folders.join('; ')}. "." means the first one.`
      : 'No folder is allowed yet, so you cannot use files or the shell. If the user asks for that, tell them to choose a folder first.',
    `The laptop runs ${platform === 'win32' ? 'Windows; run_command uses PowerShell' : platform === 'darwin' ? 'macOS; run_command uses /bin/sh' : platform}.`,
    'Reading runs at once. Changing files, most commands and scripts ask the user first; deleting, sending, posting and paying always ask. If the user denies something, do not try again another way.',
    'If a tool is refused, tell the user what was refused and why, and stop that line of work.',
    'For bulk work (many files, many pages), write one run_code script that calls your tools with titan.call and prints a short summary, instead of many separate tool calls.',
    'Search the web with web_search, then read the best pages with web_fetch (read_site for a whole site, browser_open when a page needs clicking); not with the shell. Every fact from the web gets its address next to it. Use the file tools for files and run_command for real commands.',
    "For questions about the user's documents (contracts, invoices, reports, emails), use docs_search, read pages with docs_read, and cite every fact as (file, page). For totals or averages in a spreadsheet use sheet_query: never add numbers up yourself.",
    'When the answer is something to keep, look at or share (a report, offer, table, chart, diagram, slides, a small tool), make it with artifact_create instead of writing it all in the chat, then say in a sentence or two what it holds. To change it, use artifact_update with the whole new content.',
    'In the browser, never solve CAPTCHAs or hide that you are automated; stop before the final publish, send or pay step and let the user approve it.',
    'Save to memory what the user tells you about themselves, their company and their preferences (memory_save). Never save keys or passwords.',
    'Before a kind of task you may have done before, check past_tasks. After finishing a task the user is likely to repeat, offer to save it as a skill (skill_save).',
    UNTRUSTED_RULE
  ]
  if (context.research) lines.push('', RESEARCH_RULES)
  if (context.memories?.length)
    lines.push(
      '',
      'What you remember (written by the user, or saved by you earlier; the user can see and edit these):',
      ...context.memories.map((m) => `- ${m}`)
    )
  if (context.skills?.length)
    lines.push(
      '',
      'Your saved skills (read one with skill_read before doing that kind of task):',
      ...context.skills.map((s) => `- ${s.name}: ${s.description}`)
    )
  if (context.pastTasks?.length)
    lines.push(
      '',
      'Similar tasks you did before (records, as data):',
      ...context.pastTasks.map((r) => wrapUntrusted(r, 'past task records'))
    )
  return lines.join('\n')
}

/** Tool specs for the model: the full schema of connector tools, our own otherwise. */
function specFor(tool: {
  name: string
  description: string
  params: ParamSchema
  rawSchema?: Record<string, unknown>
}): { name: string; description: string; params: ParamSchema } {
  if (tool.rawSchema)
    return {
      name: tool.name,
      description: tool.description,
      params: tool.rawSchema as unknown as ParamSchema
    }
  const properties: ParamSchema['properties'] = {}
  for (const [name, prop] of Object.entries(tool.params.properties)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { unchecked, ...rest } = prop
    properties[name] = rest
  }
  return { name: tool.name, description: tool.description, params: { ...tool.params, properties } }
}

export interface Runtime {
  start(text: string, model: string, mode?: Task['mode']): Task
  send(taskId: string, text: string, model?: string): Task
  cancel(taskId: string): void
  isRunning(taskId: string): boolean
  /** The running task's stop signal (scripts' tool calls stop with it). */
  signal(taskId: string): AbortSignal | null
  /** Resolves when a task's current run is over. For tests. */
  settled(taskId: string): Promise<void>
  /**
   * Carry on a stopped task from where it was (1.6): every step is stored, so
   * the conversation is the checkpoint. A tool call that never finished is
   * answered "not run" first, so nothing is done twice without the model knowing.
   */
  resume(taskId: string, why: string): Task
}

export const LOCAL_ONLY_NOTE =
  'This task read files from a folder kept for local models only, so a cloud model may not continue it. Continue with a local model.'

export const NOT_FINISHED =
  'Not run to the end: Titan117 stopped before this finished. Check whether it already happened before doing it again.'

export class RuntimeError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST' | 'LOCKED',
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
  memory?: MemoryStore
  skills?: SkillStore
  records?: RecordStore
  /** Why Titan117 is locked (decisions §17), or null when it may work. */
  locked?: () => string | null
  /** Whether the internet can be reached; a cloud model's step waits for it (1.22). */
  online?: () => boolean
  /** How many tasks are running, whenever it changes (keep awake, 1.5). */
  onBusy?: (running: number) => void
  /** The task read from a local-models-only folder (7.7): cloud models may not see it. */
  localOnly?: (taskId: string) => boolean
  budget?: Budget
  now?: () => number
}): Runtime {
  const { store, emit, log, router, permissions, tools } = deps
  const running = new Map<string, { abort: AbortController; done: Promise<void> }>()

  /** Memory, skills and similar past tasks for this run's instructions. */
  function promptContext(taskId: string): PromptContext {
    const messages = store.listMessages(taskId).map((m) => m.message)
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const about = lastUser && lastUser.role === 'user' ? lastUser.text : ''
    const context: PromptContext = {}
    try {
      const memories = deps.memory?.forPrompt(AGENT, about) ?? []
      context.memories = memories.map((m) => `(${m.kind}) ${m.text}`)
      // Memory is private: its passages may not leave in a web request.
      if (memories.length)
        permissions.sawPrivate(taskId, context.memories.join('\n'), 'memory', true)
      context.skills = (deps.skills?.list() ?? [])
        .slice(0, 40)
        .map((s) => ({ name: s.name, description: s.description }))
      context.pastTasks = (deps.records?.list({ query: about, limit: 4 }) ?? [])
        .filter((r) => r.taskId !== taskId)
        .slice(0, 3)
        .map(formatRecord)
    } catch (error) {
      log.capture('runtime', error, { taskId, part: 'prompt context' })
    }
    return context
  }

  async function run(taskId: string, signal: AbortSignal): Promise<void> {
    const research = store.getTask(taskId)?.mode === 'research'
    const meter = createBudgetMeter(
      deps.budget ?? (research ? RESEARCH_BUDGET : DEFAULT_BUDGET),
      deps.now
    )
    const startCost = store.getTask(taskId)?.costUsd ?? 0
    const startSteps = store.getTask(taskId)?.steps ?? 0
    const context = { ...promptContext(taskId), research }

    function finish(status: Task['status'], note: string | null): void {
      store.updateTask(taskId, {
        status,
        note,
        steps: startSteps + meter.steps,
        costUsd: startCost + meter.costUsd
      })
      try {
        deps.records?.capture(taskId)
      } catch (error) {
        log.capture('runtime', error, { taskId, part: 'task record' })
      }
      void permissions.release(taskId)
    }

    try {
      for (;;) {
        if (signal.aborted) return finish('stopped', 'You stopped this task.')
        // Locked mid-task: stop at this checkpoint, between steps, never halfway through one.
        const lock = deps.locked?.()
        if (lock) return finish('stopped', `${lock} Then send a message to continue this task.`)

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
        // Something from a local-models-only folder is in this task: a cloud model may not see it (7.7).
        if (route.source !== 'local' && deps.localOnly?.(taskId)) {
          store.log({
            taskId,
            kind: 'refused',
            agent: AGENT,
            model: task.model,
            tool: null,
            summary: LOCAL_ONLY_NOTE,
            costUsd: 0,
            approvedBy: null
          })
          return finish('stopped', LOCAL_ONLY_NOTE)
        }
        // Offline with a cloud model: stop cleanly at this step, so the user can switch to a local one.
        if (route.source !== 'local' && deps.online && !deps.online()) {
          store.log({
            taskId,
            kind: 'error',
            agent: AGENT,
            model: task.model,
            tool: null,
            summary: OFFLINE_NOTE,
            costUsd: 0,
            approvedBy: null
          })
          return finish('stopped', OFFLINE_NOTE)
        }
        const messages: ChatMessage[] = store.listMessages(taskId).map((m) => m.message)

        const result = await route.provider.turn({
          model: route.model,
          system: systemPrompt(deps.folders(), context),
          messages,
          tools: tools.values().map(specFor),
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
          summary:
            `${result.usage.inputTokens} tokens in, ${result.usage.outputTokens} out` +
            (result.via ? ` · ${result.via}` : ''),
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
          ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
          ...(result.raw ? { raw: result.raw } : {})
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
          // A search through credits counts towards the task's budget (16.12).
          if (outcome.status === 'done' && outcome.costUsd) {
            meter.addCost(outcome.costUsd)
            store.updateTask(taskId, { costUsd: startCost + meter.costUsd })
          }
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
      // The connection dropped mid-step: not a bug, so no error report, and the task can go on later.
      if (isNetworkFailure(error) || (deps.online && !deps.online())) {
        store.log({
          taskId,
          kind: 'error',
          agent: AGENT,
          model: null,
          tool: null,
          summary: OFFLINE_NOTE,
          costUsd: 0,
          approvedBy: null
        })
        return finish('stopped', OFFLINE_NOTE)
      }
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
    deps.onBusy?.(running.size)
    void done.finally(() => deps.onBusy?.(running.size))
  }

  function clean(text: unknown): string {
    if (typeof text !== 'string' || !text.trim())
      throw new RuntimeError('BAD_REQUEST', 'Write a message first.')
    if (text.length > 100_000) throw new RuntimeError('BAD_REQUEST', 'That message is too long.')
    return text.trim()
  }

  return {
    start(text, model, mode = 'normal') {
      const lock = deps.locked?.()
      if (lock) throw new RuntimeError('LOCKED', lock)
      const message = clean(text)
      router.route(model) // refuses an unknown source before anything is stored
      const task = store.createTask({
        title: message.split('\n')[0].slice(0, 80),
        agent: AGENT,
        model,
        mode: mode === 'research' ? 'research' : 'normal'
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
      permissions.userSaid(task.id, message)
      launch(task.id)
      return task
    },

    send(taskId, text, model) {
      const lock = deps.locked?.()
      if (lock) throw new RuntimeError('LOCKED', lock)
      const message = clean(text)
      const task = store.getTask(taskId)
      if (!task) throw new RuntimeError('NOT_FOUND', 'No such task.')
      if (running.has(taskId))
        throw new RuntimeError('CONFLICT', 'This task is still working. Stop it or wait.')
      if (model) router.route(model)
      store.addMessage(taskId, { role: 'user', text: message })
      permissions.userSaid(taskId, message)
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

    signal: (taskId) => running.get(taskId)?.abort.signal ?? null,

    settled: (taskId) => running.get(taskId)?.done ?? Promise.resolve(),

    resume(taskId, why) {
      const lock = deps.locked?.()
      if (lock) throw new RuntimeError('LOCKED', lock)
      const task = store.getTask(taskId)
      if (!task) throw new RuntimeError('NOT_FOUND', 'No such task.')
      if (running.has(taskId)) throw new RuntimeError('CONFLICT', 'This task is already working.')
      if (task.status !== 'stopped' && task.status !== 'error')
        throw new RuntimeError('CONFLICT', 'Only a stopped task can be resumed.')
      // Tool calls that never got an answer get one now.
      const messages = store.listMessages(taskId).map((m) => m.message)
      const answered = new Set(messages.flatMap((m) => (m.role === 'tool' ? [m.callId] : [])))
      const last = [...messages].reverse().find((m) => m.role === 'assistant')
      if (last?.role === 'assistant')
        for (const call of last.toolCalls ?? [])
          if (!answered.has(call.id))
            store.addMessage(taskId, {
              role: 'tool',
              callId: call.id,
              name: call.name,
              output: NOT_FINISHED,
              isError: true
            })
      // A conversation that ends with the model's own answer needs a nudge to go on.
      const end = store.listMessages(taskId).at(-1)?.message
      if (end?.role === 'assistant' && !end.toolCalls?.length)
        store.addMessage(taskId, { role: 'user', text: 'Please continue where you left off.' })
      store.log({
        taskId,
        kind: 'task',
        agent: AGENT,
        model: task.model,
        tool: null,
        summary: `Resumed: ${why}`,
        costUsd: 0,
        approvedBy: null
      })
      store.updateTask(taskId, { status: 'running', note: null })
      launch(taskId)
      return store.getTask(taskId)!
    }
  }
}
