/**
 * The code builder's link between a task and the coding engine (decisions
 * §53): which folder it may work in, how each model step is paid and
 * limited, and who decides on each of the engine's asks. The engine
 * (OpenCode) only sees the bridge and the answers.
 */
import { stat } from 'node:fs/promises'

import { createBudgetMeter, type Budget } from '../../budgets'
import {
  checkWritable,
  isInsideFolder,
  PermissionError,
  resolveAllowed,
  type FolderPolicy
} from '../folders'
import { OFFLINE_NOTE } from '../online'
import type { Logger } from '../log'
import type { CallContext, PermissionLayer } from '../../permissions'
import type { Router } from '../../router'
import type { Store } from '../../store'
import { projectScope, type MemoryStore } from '../../memory'
import { projectRootOf } from '../git'
import { assessAsk, type EngineAsk } from './assess'
import { OWN_TOOLS, type OwnToolId, type OwnTools } from './own-tools'
import type { CodeAgent, CodeEvent, CodeResult, CodingEngine } from './opencode'

/** A coding job takes many small steps: more than a chat task, still capped. */
export const CODE_BUDGET: Budget = {
  maxSteps: 150,
  // Time waiting for approvals doesn't count; the model steps are what's limited.
  maxSeconds: 60 * 60,
  maxCostUsd: 3,
  maxRepeats: 4
}

export const CODE_LOCAL_ONLY_NOTE =
  'This project is in a folder kept for local models only, so a cloud model may not work on it. Choose a local model.'

export interface CodeJob {
  /** The project folder, inside the allowed folders. */
  folder: string
  request: string
  mode: CodeAgent
  /** A review (13.10): every file change is refused, whatever is approved. */
  readOnly?: boolean
  /** The user's own coding tool to use instead of our engine (13.14). */
  tool?: OwnToolId
}

export interface CodeService {
  run(
    ctx: CallContext,
    job: CodeJob,
    onEvent?: (event: CodeEvent) => void
  ): Promise<CodeResult & { costUsd: number; steps: number }>
  /** The task ended: stop its engine. */
  release(taskId: string): Promise<void>
}

export function createCodeService(deps: {
  engine: CodingEngine
  router: Router
  store: Store
  permissions: PermissionLayer
  folders(): FolderPolicy
  online?(): boolean
  log: Logger
  /** Project memory (13.8). */
  memory?: MemoryStore
  /** The user's own coding tools (13.14). */
  ownTools?: OwnTools
  budget?: Budget
}): CodeService {
  const { store, permissions } = deps

  /** The real folder, checked like a write: allowed, not the app's, not credentials, not read-only. */
  async function projectFolder(folder: string): Promise<string> {
    const real = await checkWritable(deps.folders(), folder)
    const info = await stat(real).catch(() => null)
    if (!info?.isDirectory()) throw new PermissionError(`"${folder}" is not a folder.`)
    return real
  }

  return {
    async run(ctx, job, onEvent) {
      const repo = await projectFolder(job.folder)
      const policy = deps.folders()
      const localOnlyRepo = (policy.localOnly ?? []).some((f) => isInsideFolder(repo, f))
      const meter = createBudgetMeter(deps.budget ?? CODE_BUDGET)
      // Project memory (13.8): the conventions and decisions the user keeps for this repository.
      const root = await projectRootOf(repo)
      const notes = deps.memory?.list({ scopes: [projectScope(root)], limit: 50 }) ?? []
      const system = notes.length
        ? [
            'Project memory: conventions and decisions the user keeps for this project. Follow them.',
            ...notes.map((m) => `- ${m.text}`)
          ].join('\n')
        : undefined
      if (system) permissions.sawPrivate(ctx.taskId, system, 'memory', true)
      let seenToolMessages = 0

      // Every ask, from our engine or the user's own tool, is decided by the same rules.
      const decide = async (ask: EngineAsk): Promise<{ allowed: boolean; why?: string }> => {
        const assessed = await assessAsk(ask, repo, deps.folders())
        if (job.readOnly && ask.permission === 'edit')
          assessed.assessment = {
            ...assessed.assessment,
            refuse: 'this is a review: it changes nothing.'
          }
        // The user's own tool asking: its name on the card and in the activity log.
        const asker = job.tool ? OWN_TOOLS.find((t) => t.id === job.tool)?.name : undefined
        return permissions.decide(ctx, {
          callId: ask.tool?.callID ?? ask.id,
          tool: assessed.tool,
          input: assessed.input,
          assessment: asker
            ? { ...assessed.assessment, summary: `${asker}: ${assessed.assessment.summary}` }
            : assessed.assessment
        })
      }

      // The user's own coding tool (13.14), on their own plan; our engine is the fallback.
      let note: string | undefined
      if (job.tool && deps.ownTools) {
        const own = await deps.ownTools.run({
          tool: job.tool,
          repo,
          prompt: system ? `${system}\n\n${job.request}` : job.request,
          mode: job.readOnly ? 'plan' : job.mode,
          signal: ctx.signal,
          decide,
          async readAllowed(path) {
            try {
              const real = await resolveAllowed(deps.folders(), path)
              return isInsideFolder(real, repo)
            } catch {
              return false
            }
          },
          approveJob: (summary) =>
            permissions.decide(ctx, {
              callId: `own-tool-${job.tool}`,
              tool: `code_tool_${job.tool}`,
              input: { tool: job.tool, folder: repo },
              assessment: { risk: 'external', summary }
            }),
          onEvent: (text) => onEvent?.({ type: 'note', text })
        })
        if (own.usedTool) {
          store.log({
            taskId: ctx.taskId,
            kind: 'tool',
            agent: ctx.agent,
            model: null,
            tool: 'code_task',
            summary: `Ran ${OWN_TOOLS.find((t) => t.id === job.tool)?.name ?? job.tool} on your own plan: ${own.status}`,
            costUsd: 0,
            approvedBy: null
          })
          // Their usage is on the user's own plan: no credits, no steps of ours.
          return {
            status: own.status,
            text: own.text,
            error: own.error,
            files: own.files,
            costUsd: 0,
            steps: 0
          }
        }
        note = `${own.note ?? 'That coding tool isn’t available.'} Titan117’s own coding engine did the job instead.`
      }

      const result = await deps.engine.run({
        taskId: ctx.taskId,
        repo,
        prompt: job.request,
        system,
        agent: job.mode,
        signal: ctx.signal,
        onEvent,
        async step({ system, messages, tools, signal, onText }) {
          const over = meter.beforeStep()
          if (over) return { refused: over }
          const model = store.getTask(ctx.taskId)?.model ?? ctx.model
          const route = deps.router.route(model)
          if (route.source !== 'local' && (localOnlyRepo || permissions.isLocalOnly(ctx.taskId)))
            return { refused: CODE_LOCAL_ONLY_NOTE }
          if (route.source !== 'local' && deps.online && !deps.online())
            return { refused: OFFLINE_NOTE }

          // What the engine read (files, command output) is private: it may not leave in a web request.
          const toolMessages = messages.filter((m) => m.role === 'tool')
          for (const m of toolMessages.slice(seenToolMessages))
            if (m.role === 'tool') permissions.sawPrivate(ctx.taskId, m.output, 'the coding engine')
          seenToolMessages = toolMessages.length

          const turn = await route.provider.turn({
            model: route.model,
            system,
            messages,
            tools,
            signal,
            onText
          })
          meter.addCost(turn.usage.costUsd)
          store.log({
            taskId: ctx.taskId,
            kind: 'model',
            agent: ctx.agent,
            model,
            tool: 'code_task',
            summary:
              `Coding engine: ${turn.usage.inputTokens} tokens in, ${turn.usage.outputTokens} out` +
              (turn.via ? ` · ${turn.via}` : ''),
            costUsd: turn.usage.costUsd,
            approvedBy: null
          })
          for (const call of turn.toolCalls) {
            const loop = meter.onToolCall(call)
            if (loop) return { refused: loop }
          }
          return turn
        },
        decide
      })
      return {
        ...result,
        text: note ? `${note}\n\n${result.text}` : result.text,
        costUsd: meter.costUsd,
        steps: meter.steps
      }
    },

    release: (taskId) => deps.engine.release(taskId)
  }
}
