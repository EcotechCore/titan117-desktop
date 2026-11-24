/**
 * The agent runtime (architecture §3): the loop that runs a task. The model
 * answers or asks for tools; every tool call goes through the permission
 * layer; budgets and loop detection stop a task that runs away.
 *
 * Phase 3: Titan, the general assistant, with every built-in tool, memory,
 * skills and records of past tasks. Phase 11 (decisions §59): any agent from
 * its definition file, with only its tools; parts of a task handed to other
 * agents; and smart routing between a main and a fast model.
 */
import type { AgentDef, ChatMessage, Task } from '../shared/protocol'
import { agentMayUse, BUILT_IN_AGENTS, TITAN, type AgentStore } from './lib/agents'
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

export const AGENT = TITAN

/** What an agent knows at the start of a run: memory, skills, similar past tasks. */
export interface PromptContext {
  memories?: string[]
  skills?: { name: string; description: string }[]
  pastTasks?: string[]
  platform?: NodeJS.Platform
  /** Deep research (feature 16.8). */
  research?: boolean
  /** The agent running (4.1); Titan when absent. */
  agent?: AgentDef
  /** The other agents a manager may hand parts to (4.6). */
  team?: { name: string; role: string }[]
  /** This run is a part of another agent's task (4.6). */
  partOf?: string
}

/** The fallback agent: Titan, as built in. */
export const TITAN_DEF: AgentDef = BUILT_IN_AGENTS.find((a) => a.name === TITAN)!

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
  const agent = context.agent ?? TITAN_DEF
  const titan = agent.builtIn && agent.name === TITAN
  const lines = [
    titan
      ? "You are Titan, the general assistant in the Titan117 app. You work on the user's own laptop for a small company."
      : `You are ${agent.name}, an agent in the Titan117 app. You work on the user's own laptop for a small company. Your role: ${agent.role}`,
    titan
      ? 'You do one-off tasks yourself with your tools: files, the shell, small scripts, the browser, web pages, memory, speech and any connectors the user added.'
      : 'Use only the tools you are given. If the task needs something you cannot do, say so plainly.',
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
    'When the user asks to search in the browser, or on a specific search engine such as Google or Bing, do that search in the browser (browser_open) instead of web_search, then read the results there.',
    'In the browser, never solve CAPTCHAs or hide that you are automated; stop before the final publish, send or pay step and let the user approve it.',
    'Save to memory what the user tells you about themselves, their company and their preferences (memory_save). Never save keys or passwords.',
    'When the user wants something done regularly ("every weekday at 8…", "each Monday…"), make a schedule with schedule_create instead of doing it once; a page to keep an eye on is a web watch (watch_save, watch_check).',
    'Before a kind of task you may have done before, check past_tasks. After finishing a task the user is likely to repeat, offer to save it as a skill (skill_save).',
    UNTRUSTED_RULE
  ]
  if (context.research) lines.push('', RESEARCH_RULES)
  if (context.team?.length)
    lines.push(
      '',
      'Your team. For a big task with separate parts, hand each part to the best agent with agent_delegate (several parts in one call run at the same time); give each a complete brief, since they see only what you write. Check their answers, then put the result together yourself:',
      ...context.team.map((a) => `- ${a.name}: ${a.role}`)
    )
  if (context.partOf)
    lines.push(
      '',
      `You are doing one part of a bigger task for ${context.partOf}. Do only that part. End with a clear, complete answer: ${context.partOf} reads your last message.`
    )
  if (!titan && agent.instructions)
    lines.push(
      '',
      'Your own instructions (from your definition file; the rules above still come first):',
      agent.instructions
    )
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

/** Who runs a task, and what that means for its tool calls (4.1, 4.6). */
export interface TaskAgent {
  def: AgentDef
  /** The task is a part of another one: it can't hand on. */
  isPart: boolean
}

export interface Runtime {
  /** `agent` is an agent's name; Titan when absent. */
  start(text: string, model: string, mode?: Task['mode'], agent?: string): Task
  /**
   * One tool call run as its own task, without a model (a scheduled replay or
   * watch check, decisions §61): the same permission layer, approvals and
   * activity log as any call. `allow` lists tools the user already agreed to
   * for this run (when they approved the schedule).
   */
  runDirect(input: {
    title: string
    agent: string
    text: string
    call: { name: string; input: Record<string, unknown> }
    allow?: string[]
    /**
     * Asked once the call is done: a message and a model to carry on with in the
     * same task (the watcher says what matters after a check found changes), or
     * null to end there. The task never shows as finished in between.
     */
    followUp?: () => { text: string; model: string } | null
  }): Task
  /** A part of a task, handed to another agent (4.6): its own task, linked to the first. */
  startPart(input: { parentId: string; agent: string; text: string; model: string }): Task
  /** The agent of a task, or null when it was removed. */
  agentOf(taskId: string): TaskAgent | null
  /** Whether a task's agent may use a tool (scripts' calls check this too). */
  mayUse(taskId: string, toolName: string): boolean
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

/** The "model" of a task that ran without one (a scheduled replay). */
export const NO_MODEL = 'none'

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
  /** Agent definitions (4.1); only Titan without them. */
  agents?: AgentStore
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

  function agentOf(taskId: string): TaskAgent | null {
    const task = store.getTask(taskId)
    if (!task) return null
    const def = deps.agents ? deps.agents.get(task.agent) : task.agent === TITAN ? TITAN_DEF : null
    return def ? { def, isPart: !!task.parentId } : null
  }

  function mayUse(taskId: string, toolName: string): boolean {
    const agent = agentOf(taskId)
    const tool = tools.get(toolName)
    return !!agent && !!tool && agentMayUse(agent.def, tool, { isPart: agent.isPart })
  }

  /** Memory, skills and similar past tasks for this run's instructions. */
  function promptContext(taskId: string, agent: TaskAgent): PromptContext {
    const messages = store.listMessages(taskId).map((m) => m.message)
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const about = lastUser && lastUser.role === 'user' ? lastUser.text : ''
    const { def } = agent
    const context: PromptContext = { agent: def }
    const task = store.getTask(taskId)
    if (task?.parentId) context.partOf = store.getTask(task.parentId)?.agent ?? TITAN
    if (def.manager && !agent.isPart && deps.agents)
      context.team = deps.agents
        .list()
        .filter((a) => a.name !== def.name && a.name !== TITAN)
        .slice(0, 30)
        .map((a) => ({ name: a.name, role: a.role }))
    try {
      const memories = deps.memory?.forPrompt(def.name, about, def.memory === 'own') ?? []
      context.memories = memories.map((m) => `(${m.kind}) ${m.text}`)
      // Memory is private: its passages may not leave in a web request.
      if (memories.length)
        permissions.sawPrivate(taskId, context.memories.join('\n'), 'memory', true)
      // The agent's own skills first (4.1).
      const all = deps.skills?.list() ?? []
      const mine = all.filter((s) => def.skills.includes(s.name))
      context.skills = [...mine, ...all.filter((s) => !def.skills.includes(s.name))]
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
    const agent = agentOf(taskId)
    const agentName = agent?.def.name ?? store.getTask(taskId)?.agent ?? AGENT
    const context = agent ? { ...promptContext(taskId, agent), research } : null
    // Smart routing (2.4): the main model plans each turn and steps after a failure; the fast one the rest.
    let firstStep = true
    let lastFailed = false

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
      if (!agent || !context) {
        const note = `The agent ${agentName} was removed, so this task can't go on.`
        store.log({
          taskId,
          kind: 'refused',
          agent: agentName,
          model: null,
          tool: null,
          summary: note,
          costUsd: 0,
          approvedBy: null
        })
        return finish('stopped', note)
      }
      const offered = tools
        .values()
        .filter((t) => agentMayUse(agent.def, t, { isPart: agent.isPart }))
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
            agent: agentName,
            model: null,
            tool: null,
            summary: over,
            costUsd: 0,
            approvedBy: null
          })
          return finish('stopped', over)
        }

        const task = store.getTask(taskId)!
        const fast = agent.def.fastModel
        const stepModel = fast && !firstStep && !lastFailed ? fast : task.model
        let route = router.route(task.model)
        let usedModel = task.model
        if (stepModel !== task.model)
          try {
            route = router.route(stepModel)
            usedModel = stepModel
          } catch {
            // The fast model can't be reached (no key for it): the main model takes the step.
          }
        // Something from a local-models-only folder is in this task: a cloud model may not see it (7.7).
        if (route.source !== 'local' && deps.localOnly?.(taskId)) {
          store.log({
            taskId,
            kind: 'refused',
            agent: agentName,
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
            agent: agentName,
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
          tools: offered.map(specFor),
          signal,
          onText: (text) => emit({ type: 'delta', taskId, text })
        })
        meter.addCost(result.usage.costUsd)
        firstStep = false
        // Steps and cost show while the task runs, not only at the end.
        store.updateTask(taskId, {
          steps: startSteps + meter.steps,
          costUsd: startCost + meter.costUsd
        })
        store.log({
          taskId,
          kind: 'model',
          agent: agentName,
          model: usedModel,
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
        let stepFailed = false
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
          const known = tools.get(call.name)
          const outcome =
            known && !agentMayUse(agent.def, known, { isPart: agent.isPart })
              ? refuseForAgent(taskId, agentName, call.name, agent.isPart)
              : await permissions.execute(call, {
                  taskId,
                  agent: agentName,
                  model: usedModel,
                  signal,
                  alwaysAsk: agent.def.alwaysAsk,
                  ownMemory: agent.def.memory === 'own'
                })
          meter.resume()
          if (outcome.status !== 'done') stepFailed = true
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
        lastFailed = stepFailed
        if (loop) {
          store.log({
            taskId,
            kind: 'budget',
            agent: agentName,
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
          agent: agentName,
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
        agent: agentName,
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

  /** A tool the agent wasn't given: refused without running, and logged (4.1). */
  function refuseForAgent(
    taskId: string,
    agentName: string,
    tool: string,
    isPart: boolean
  ): { status: 'refused'; output: string } {
    const why =
      tool.startsWith('agent_') && isPart
        ? "a part of a task can't hand work on to other agents."
        : `${agentName} wasn't given ${tool}. Its definition lists the tools it may use.`
    store.log({
      taskId,
      kind: 'refused',
      agent: agentName,
      model: null,
      tool,
      summary: `Refused ${tool}: ${why}`,
      costUsd: 0,
      approvedBy: null
    })
    return { status: 'refused', output: `Refused: ${why}` }
  }

  function findAgent(name: string | undefined): AgentDef {
    if (!name || name === TITAN) return deps.agents?.get(TITAN) ?? TITAN_DEF
    const def = deps.agents?.get(name)
    if (!def) throw new RuntimeError('NOT_FOUND', `There is no agent called ${name}.`)
    return def
  }

  function clean(text: unknown): string {
    if (typeof text !== 'string' || !text.trim())
      throw new RuntimeError('BAD_REQUEST', 'Write a message first.')
    if (text.length > 100_000) throw new RuntimeError('BAD_REQUEST', 'That message is too long.')
    return text.trim()
  }

  return {
    start(text, chosen, mode = 'normal', agentName) {
      const lock = deps.locked?.()
      if (lock) throw new RuntimeError('LOCKED', lock)
      const message = clean(text)
      const def = findAgent(agentName)
      // An agent with its own model uses it (2.3); otherwise the one chosen in the window.
      const model = def.model ?? chosen
      router.route(model) // refuses an unknown source before anything is stored
      const task = store.createTask({
        title: message.split('\n')[0].slice(0, 80),
        agent: def.name,
        model,
        mode: mode === 'research' ? 'research' : 'normal'
      })
      store.log({
        taskId: task.id,
        kind: 'task',
        agent: def.name,
        model,
        tool: null,
        summary: def.name === TITAN ? 'Task started' : `Task started with ${def.name}`,
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

    runDirect({ title, agent: agentName, text, call, allow = [], followUp }) {
      const lock = deps.locked?.()
      if (lock) throw new RuntimeError('LOCKED', lock)
      const def = findAgent(agentName)
      const tool = tools.get(call.name)
      if (!tool || !agentMayUse(def, tool, { isPart: false }))
        throw new RuntimeError('BAD_REQUEST', `${def.name} wasn't given ${call.name}.`)
      const task = store.createTask({
        title: title.slice(0, 80),
        agent: def.name,
        model: NO_MODEL
      })
      const taskId = task.id
      store.log({
        taskId,
        kind: 'task',
        agent: def.name,
        model: null,
        tool: null,
        summary: 'Run started without AI',
        costUsd: 0,
        approvedBy: null
      })
      store.addMessage(taskId, { role: 'user', text })
      permissions.userSaid(taskId, text)
      for (const name of allow) store.allowAlways(taskId, name)
      const toolCall = { id: `direct-${taskId.slice(0, 8)}`, ...call }
      store.addMessage(taskId, { role: 'assistant', text: '', toolCalls: [toolCall] })
      const abort = new AbortController()
      const done = (async () => {
        let status: Task['status'] = 'done'
        let note: string | null = null
        try {
          const outcome = await permissions.execute(toolCall, {
            taskId,
            agent: def.name,
            model: NO_MODEL,
            signal: abort.signal,
            alwaysAsk: def.alwaysAsk,
            ownMemory: def.memory === 'own'
          })
          store.addMessage(taskId, {
            role: 'tool',
            callId: toolCall.id,
            name: toolCall.name,
            output: outcome.output,
            ...(outcome.status === 'done' ? {} : { isError: true })
          })
          if (abort.signal.aborted) {
            status = 'stopped'
            note = 'You stopped this task.'
          } else if (outcome.status !== 'done') {
            status = 'error'
            note = outcome.output.slice(0, 300)
          }
        } catch (error) {
          const id = log.capture('runtime', error, { taskId })
          status = 'error'
          note = `Something went wrong (ref ${id.slice(0, 8)}). It was saved to the local log.`
        }
        let next: { text: string; model: string } | null = null
        if (status === 'done' && followUp && !deps.locked?.())
          try {
            next = followUp()
            if (next) router.route(next.model)
          } catch (error) {
            log.capture('runtime', error, { taskId, part: 'follow-up' })
            next = null
          }
        if (next) {
          store.addMessage(taskId, { role: 'user', text: next.text })
          store.updateTask(taskId, { model: next.model, steps: 1 })
          return true
        }
        store.updateTask(taskId, { status, note, steps: 1 })
        void permissions.release(taskId)
        return false
      })()
        .then((carryOn) => {
          if (running.get(taskId)?.abort === abort) running.delete(taskId)
          // The agent takes over in the same task, with the usual loop.
          if (carryOn) launch(taskId)
        })
        .catch((error) => {
          if (running.get(taskId)?.abort === abort) running.delete(taskId)
          log.capture('runtime', error, { taskId })
        })
      running.set(taskId, { abort, done })
      deps.onBusy?.(running.size)
      void done.finally(() => deps.onBusy?.(running.size))
      return task
    },

    startPart({ parentId, agent: agentName, text, model: chosen }) {
      const lock = deps.locked?.()
      if (lock) throw new RuntimeError('LOCKED', lock)
      const parent = store.getTask(parentId)
      if (!parent) throw new RuntimeError('NOT_FOUND', 'No such task.')
      if (parent.parentId)
        throw new RuntimeError('BAD_REQUEST', "A part of a task can't hand work on.")
      const def = findAgent(agentName)
      const message = clean(text)
      const model = def.model ?? chosen
      router.route(model)
      const task = store.createTask({
        title: `${def.name}: ${message.split('\n')[0]}`.slice(0, 80),
        agent: def.name,
        model,
        parentId
      })
      store.log({
        taskId: task.id,
        kind: 'task',
        agent: def.name,
        model,
        tool: null,
        summary: `Part handed over by ${parent.agent}`,
        costUsd: 0,
        approvedBy: null
      })
      store.addMessage(task.id, { role: 'user', text: message })
      permissions.userSaid(task.id, message)
      launch(task.id)
      return task
    },

    agentOf,

    mayUse,

    cancel(taskId) {
      // Its parts stop with it (4.6).
      for (const part of store.listParts(taskId))
        if (running.has(part.id)) {
          running.get(part.id)!.abort.abort()
          permissions.cancelTask(part.id)
        }
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
        agent: task.agent,
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
