/**
 * Agents working together (4.6, 4.7) and agents on request (18.2), decisions
 * §59. A manager's parts run as their own tasks through the same runtime and
 * permission layer; every brief and answer goes on the message bus.
 */
import type { AgentDef, Task } from '../shared/protocol'
import { AgentError, checkAgent, TITAN, type AgentStore } from './lib/agents'
import { skillName, type SkillStore } from './lib/skills'
import type { CallContext, TeamService } from './permissions'
import type { Runtime } from './runtime'
import type { Store } from './store'
import type { NewAgent, PartResult } from './tools/lib/define-tool'

const MAX_SKILLS = 8
const MAX_SKILL_BODY = 20_000

/** The last thing an agent said in its task, or why it stopped. */
export function answerOf(store: Store, task: Task): string {
  const said = [...store.listMessages(task.id)]
    .reverse()
    .find((m) => m.message.role === 'assistant' && m.message.text.trim())
  const text = said?.message.role === 'assistant' ? said.message.text.trim() : ''
  if (task.status === 'done') return text
  const why = task.note ?? `It ended ${task.status}.`
  return text ? `${text}\n\n(Stopped: ${why})` : `Stopped: ${why}`
}

export function createTeamService(deps: {
  store: Store
  agents: AgentStore
  skills: SkillStore
  runtime: () => Runtime
}): TeamService {
  const { store, agents, skills } = deps

  return {
    async delegate(ctx: CallContext, parts): Promise<PartResult[]> {
      const task = store.getTask(ctx.taskId)
      if (!task) throw new AgentError('No such task.')
      if (task.parentId) throw new AgentError("A part of a task can't hand work on.")
      // Check every part before any starts.
      const team = agents.list().filter((a) => a.name !== task.agent)
      const chosen: AgentDef[] = parts.map((p) => {
        const def = agents.get(p.agent)
        if (!def || def.name === task.agent)
          throw new AgentError(
            `There is no agent called "${p.agent}" to hand this to. Your team: ${team
              .map((a) => a.name)
              .join(', ')}.`
          )
        return def
      })
      const runtime = deps.runtime()
      const started = chosen.map((def, i) => {
        const part = runtime.startPart({
          parentId: task.id,
          agent: def.name,
          text: parts[i].brief,
          model: task.model
        })
        store.addAgentMessage({
          rootTaskId: task.id,
          taskId: part.id,
          from: task.agent,
          to: def.name,
          kind: 'brief',
          text: parts[i].brief
        })
        return part
      })
      // Stopping the manager stops its parts.
      const stop = (): void => started.forEach((p) => runtime.cancel(p.id))
      ctx.signal.addEventListener('abort', stop, { once: true })
      try {
        await Promise.all(started.map((p) => runtime.settled(p.id)))
      } finally {
        ctx.signal.removeEventListener('abort', stop)
      }
      return started.map((p) => {
        const done = store.getTask(p.id) ?? p
        const answer = answerOf(store, done)
        store.addAgentMessage({
          rootTaskId: task.id,
          taskId: p.id,
          from: done.agent,
          to: task.agent,
          kind: 'answer',
          text: answer || '(no answer)'
        })
        return {
          agent: done.agent,
          taskId: p.id,
          status: done.status,
          answer,
          costUsd: done.costUsd
        }
      })
    },

    create(ctx: CallContext, input: NewAgent): AgentDef {
      const task = store.getTask(ctx.taskId)
      if (task?.agent !== TITAN) throw new AgentError('Only Titan makes new agents.')
      const source = `Titan, in the task "${(task.title ?? '').slice(0, 80)}"`
      // Check the agent and every skill before anything is written.
      const list = (input.skills ?? []).slice(0, MAX_SKILLS + 1)
      if (list.length > MAX_SKILLS) throw new AgentError(`At most ${MAX_SKILLS} skills at once.`)
      const named = list.map((s) => {
        let name: string
        try {
          name = skillName(s.name)
        } catch (error) {
          throw new AgentError((error as Error).message)
        }
        if (!s.steps.trim()) throw new AgentError(`The skill ${name} needs its steps.`)
        if (s.steps.length > MAX_SKILL_BODY) throw new AgentError(`The skill ${name} is too long.`)
        return { ...s, name }
      })
      const def = checkAgent(
        {
          name: input.name,
          role: input.role,
          team: input.team,
          tools: input.tools,
          instructions: input.instructions,
          manager: input.manager === true,
          memory: input.memory,
          color: input.color,
          skills: named.map((s) => s.name)
        },
        source
      )
      if (agents.get(def.name) || agents.get(def.id))
        throw new AgentError(`There is already an agent called ${def.name}.`)
      for (const s of named)
        skills.save({
          name: s.name,
          description: s.description,
          body: s.steps,
          source: `${source}, for ${def.name}`
        })
      return agents.save(def)
    }
  }
}
