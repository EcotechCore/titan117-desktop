/**
 * Agents working together and agents on request (features 4.6, 4.7, 18.1,
 * 18.2; decisions §59).
 *
 * `agent_delegate` hands parts of a task to other agents: each part is its
 * own task with that agent's tools and approvals, at most three at once, one
 * level deep. Handing work out runs at once (each part still asks for what it
 * does); the answers come back marked as data.
 *
 * `agent_create` writes a new agent's definition and its skills: a standing
 * instruction, so it asks every time, on the laptop only.
 */
import { TOOL_GROUPS } from '../../shared/protocol'
import { AgentError } from '../lib/agents'
import { defineTool, type NewAgent } from './lib/define-tool'

export const MAX_PARTS = 3

interface Part {
  agent: string
  brief: string
}

function parts(input: { parts: unknown }): Part[] {
  const list = Array.isArray(input.parts) ? input.parts : []
  return list.map((p) => ({
    agent: String((p as Record<string, unknown>)?.agent ?? '').trim(),
    brief: String((p as Record<string, unknown>)?.brief ?? '').trim()
  }))
}

export const agentDelegate = defineTool<{ parts: Part[] }>({
  name: 'agent_delegate',
  description: [
    'Hand parts of this task to other agents on your team. Each part runs as its own task with that agent, its own tools and approvals, and you get each agent’s final answer back.',
    `Several parts in one call run at the same time (at most ${MAX_PARTS}). Write each brief so it stands on its own: the agent sees only the brief, not this conversation.`,
    'Use it when a task has separate parts that fit different agents; do small things yourself.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      parts: {
        type: 'array',
        description:
          'The parts: [{"agent": "<agent name from your team>", "brief": "<what to do, with everything it needs>"}]'
      }
    },
    required: ['parts']
  },
  risk: 'read',
  permissions: { team: 'delegate' },
  // The answers were written by agents that may have read pages and files.
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) =>
    `Hand ${parts(input)
      .map((p) => p.agent || 'an agent')
      .join(', ')} a part of this task`,
  async run(input, ctx) {
    const list = parts(input)
    if (!list.length) throw new AgentError('Give at least one part: an agent and a brief.')
    if (list.length > MAX_PARTS)
      throw new AgentError(
        `At most ${MAX_PARTS} parts at once. Hand out the rest when these are done.`
      )
    for (const p of list) {
      if (!p.agent) throw new AgentError('Each part needs an agent.')
      if (p.brief.length < 10)
        throw new AgentError(`Write ${p.agent} a brief that says what to do.`)
    }
    const results = await ctx.team.delegate(list)
    const costUsd = results.reduce((sum, r) => sum + r.costUsd, 0)
    return {
      output: results
        .map((r) => `## ${r.agent} (${r.status})\n${r.answer || '(no answer)'}`)
        .join('\n\n'),
      summary: `Handed out ${results.length} part${results.length === 1 ? '' : 's'}: ${results
        .map((r) => `${r.agent} ${r.status}`)
        .join(', ')}`,
      costUsd
    }
  }
})

function newAgent(input: Record<string, unknown>): NewAgent {
  const skills = Array.isArray(input.skills) ? input.skills : []
  return {
    name: String(input.name ?? ''),
    role: String(input.role ?? ''),
    team: String(input.team ?? ''),
    tools: Array.isArray(input.tools) ? input.tools.map(String) : [],
    instructions: String(input.instructions ?? ''),
    manager: input.manager === true,
    memory: input.memory === 'own' ? 'own' : 'shared',
    color: typeof input.color === 'string' ? input.color : undefined,
    skills: skills.map((s) => {
      const r = (s ?? {}) as Record<string, unknown>
      return {
        name: String(r.name ?? ''),
        description: String(r.description ?? ''),
        steps: String(r.steps ?? '')
      }
    })
  }
}

function summaryOf(a: NewAgent): string {
  const skills = a.skills.map((s) => s.name).filter(Boolean)
  return (
    `Make a new agent "${a.name}" (${a.team || 'no team'}): ${a.role.trim().replace(/[.!]+$/, '')}. ` +
    `Tools: ${a.tools.join(', ') || 'none'}.` +
    (a.manager ? ' It may hand work to other agents.' : '') +
    (skills.length ? ` Skills: ${skills.join(', ')}.` : '')
  )
}

export const agentCreate = defineTool<Record<string, unknown>>({
  name: 'agent_create',
  description: [
    'Make a new agent when the user asks for one we don’t have (or agrees to your suggestion): its definition and the skills it needs.',
    `Tools are groups: ${TOOL_GROUPS.map((g) => g.id).join(', ')}. Give only what the job needs.`,
    'Instructions say how it works, in the second person. Each skill is a set of general steps for one kind of job, in Markdown.',
    'The user sees all of it and approves it; it then appears in the sidebar under its team.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A short name, e.g. "Invoice clerk".' },
      role: { type: 'string', description: 'One line: what it does.' },
      team: { type: 'string', description: 'The sidebar group, e.g. Finance or Operations.' },
      tools: { type: 'array', description: 'Tool groups it may use.' },
      instructions: { type: 'string', description: 'How it works, in Markdown.' },
      skills: {
        type: 'array',
        description:
          'Skills it needs: [{"name": "short-name", "description": "when to use it", "steps": "Markdown steps"}]'
      },
      manager: { type: 'boolean', description: 'May it hand parts of tasks to other agents?' },
      memory: {
        type: 'string',
        description: '"shared" (default): shared memory and its own. "own": only its own.',
        enum: ['shared', 'own']
      },
      color: { type: 'string', description: 'Its colour, like #2f6fed.' }
    },
    required: ['name', 'role', 'team', 'tools', 'instructions', 'skills']
  },
  risk: 'write',
  permissions: { team: 'build' },
  laptopOnly: true,
  describe: (input) => summaryOf(newAgent(input)),
  assess(input, ctx) {
    // A new agent is a standing instruction, like a skill: it asks every time.
    return {
      risk: 'write',
      summary:
        summaryOf(newAgent(input)) +
        (ctx.untrustedSeen ? ' (this task has read outside content; check its instructions)' : ''),
      alwaysAsks: true
    }
  },
  async run(input, ctx) {
    const def = ctx.team.create(newAgent(input))
    return {
      output: `Made the agent ${def.name}${def.skills.length ? ` with the skills ${def.skills.join(', ')}` : ''}. The user can start a task with it from the sidebar.`,
      summary: `Made the agent ${def.name}`
    }
  }
})

export const agentTools = [agentDelegate, agentCreate]
