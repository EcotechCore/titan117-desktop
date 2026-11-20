/**
 * The code builder's link between a task and the coding engine (decisions
 * §53): which folder it may work in, how each model step is paid and
 * limited, and who decides on each of the engine's asks. The engine
 * (OpenCode) only sees the bridge and the answers.
 */
import { stat } from 'node:fs/promises'

import { createBudgetMeter, type Budget } from '../../budgets'
import { checkWritable, isInsideFolder, PermissionError, type FolderPolicy } from '../folders'
import { OFFLINE_NOTE } from '../online'
import type { Logger } from '../log'
import type { CallContext, PermissionLayer } from '../../permissions'
import type { Router } from '../../router'
import type { Store } from '../../store'
import { assessAsk } from './assess'
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
      let seenToolMessages = 0

      const result = await deps.engine.run({
        taskId: ctx.taskId,
        repo,
        prompt: job.request,
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
        async decide(ask) {
          const assessed = await assessAsk(ask, repo, deps.folders())
          return permissions.decide(ctx, {
            callId: ask.tool?.callID ?? ask.id,
            tool: assessed.tool,
            input: assessed.input,
            assessment: assessed.assessment
          })
        }
      })
      return { ...result, costUsd: meter.costUsd, steps: meter.steps }
    },

    release: (taskId) => deps.engine.release(taskId)
  }
}
