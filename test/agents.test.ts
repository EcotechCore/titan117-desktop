// Phase 11, the agent builder (decisions §59): agent files, built-in agents,
// clone and edit, only an agent's own tools, parts handed to other agents with
// the message bus, Titan making an agent and its skills, smart routing and
// comparing models. OpenRouter is faked.
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { Engine } from '../src/engine/lib/engine'
import type { TaskDetail } from '../src/shared/protocol'
import { TOOL_GROUPS } from '../src/shared/protocol'
import {
  BUILT_IN_AGENTS,
  checkAgent,
  createAgentStore,
  parseAgent,
  serializeAgent,
  toolGroup
} from '../src/engine/lib/agents'
import { builtInTools } from '../src/engine/tools'
import { call, MODEL, scripted, tempFolder, testEngine, until, type ScriptedTurn } from './helpers'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

async function detail(taskId: string): Promise<TaskDetail> {
  return (await call(engine!, 'GET', `/v1/tasks/${taskId}`)).body
}

async function finished(taskId: string): Promise<TaskDetail> {
  await until(() => !engine!.parts.runtime.isRunning(taskId), 8000)
  return detail(taskId)
}

function toolNames(body: Record<string, unknown>): string[] {
  return ((body.tools as { function: { name: string } }[] | undefined) ?? []).map(
    (t) => t.function.name
  )
}

const CLERK = {
  name: 'Invoice clerk',
  role: 'Reads invoices in the allowed folders and totals them.',
  team: 'Finance',
  tools: ['files'],
  instructions: 'Always give totals in EUR.'
}

describe('agent files (4.1-4.3)', () => {
  it('round-trips a definition and refuses what it does not know', () => {
    const def = checkAgent({ ...CLERK, alwaysAsk: 'read_file', skills: 'monthly-totals' }, 'you')
    const again = parseAgent(serializeAgent(def))
    expect(again).toMatchObject({
      name: 'Invoice clerk',
      id: 'invoice-clerk',
      team: 'Finance',
      tools: ['files'],
      alwaysAsk: ['read_file'],
      skills: ['monthly-totals'],
      instructions: 'Always give totals in EUR.',
      builtIn: false
    })
    expect(() => checkAgent({ ...CLERK, tools: ['files', 'everything'] }, 'you')).toThrow(
      /Unknown tool groups: everything/
    )
    expect(() => checkAgent({ ...CLERK, name: '../core' }, 'you')).toThrow(/name/)
    expect(() => checkAgent({ ...CLERK, model: 'gpt-4' }, 'you')).toThrow(/model/)
  })

  it('keeps ours fixed, clones them, and keeps files in the data folder', () => {
    const dir = tempFolder()
    const store = createAgentStore({ dir })
    expect(store.list().map((a) => a.name)).toEqual(BUILT_IN_AGENTS.map((a) => a.name))
    expect(() => store.save(checkAgent({ ...CLERK, name: 'Writer' }, 'you'))).toThrow(/built in/)
    expect(() => store.remove('Titan')).toThrow(/built in/)

    const writer = store.get('writer')!
    const mine = store.save(checkAgent({ ...writer, name: 'Offer writer' }, 'you (from Writer)'))
    expect(readFileSync(join(dir, 'offer-writer.md'), 'utf8')).toContain('name: Offer writer')
    expect(store.get('Offer Writer')).toMatchObject({ id: mine.id, tools: writer.tools })
    expect(() => store.save(mine)).toThrow(/already/)

    // A built-in's models are a setting; the file can't change.
    store.setModels('Researcher', { model: MODEL, fastModel: null })
    expect(store.get('Researcher')!.model).toBe(MODEL)

    // A file that pretends to be one of ours, or is broken, is skipped.
    writeFileSync(join(dir, 'titan.md'), serializeAgent({ ...writer, name: 'Titan', id: 'titan' }))
    writeFileSync(join(dir, 'broken.md'), 'no header')
    expect(store.list().filter((a) => a.name === 'Titan')).toHaveLength(1)
    store.remove('Offer writer')
    expect(existsSync(join(dir, 'offer-writer.md'))).toBe(false)
  })

  it('puts every built-in tool in a group, so a definition covers it', () => {
    const groups = new Set<string>(TOOL_GROUPS.map((g) => g.id))
    for (const tool of builtInTools) {
      const group = toolGroup(tool)
      expect(group === 'team' || (groups.has(group) && group !== 'connectors'), tool.name).toBe(
        true
      )
    }
    expect(toolGroup({ name: 'x', permissions: {}, rawSchema: {} })).toBe('connectors')
  })
})

describe('an agent runs with only its own tools (§59.3)', () => {
  it('is offered its tools, refused the rest, and asks where its file says', async () => {
    const folder = tempFolder()
    writeFileSync(join(folder, 'inv.txt'), 'Invoice 1: 100 EUR')
    const or = scripted([
      { toolCalls: [{ name: 'web_search', input: { query: 'x' } }] },
      { toolCalls: [{ name: 'read_file', input: { path: 'inv.txt' } }] },
      { text: 'Total: 100 EUR.' }
    ])
    engine = await testEngine({ fetch: or.fetch, folder })
    const made = await call(engine, 'POST', '/v1/agents', { ...CLERK, alwaysAsk: ['read_file'] })
    expect(made.status).toBe(200)

    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'Total my invoices',
      model: MODEL,
      agent: 'Invoice clerk'
    })
    expect(body.task.agent).toBe('Invoice clerk')
    // read_file normally runs at once; this agent's file makes it ask, without "always".
    const approval = await until(
      () => engine!.parts.store.listApprovals({ taskId: body.task.id, status: 'pending' })[0]
    )
    expect(approval).toMatchObject({ tool: 'read_file', canAlways: false })
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
    const done = await finished(body.task.id)
    expect(done.task.status).toBe('done')

    const offered = toolNames(or.requests[0].body)
    expect(offered).toContain('read_file')
    expect(offered).not.toContain('web_search')
    expect(offered).not.toContain('agent_delegate')
    expect(JSON.stringify(or.requests[0].body)).toContain('You are Invoice clerk')
    expect(JSON.stringify(or.requests[0].body)).toContain('Always give totals in EUR.')
    expect(done.activity.find((a) => a.kind === 'refused')?.summary).toMatch(
      /Invoice clerk wasn't given web_search/
    )
    expect(done.activity.every((a) => a.agent === 'Invoice clerk')).toBe(true)
  })

  it('refuses a task for an agent that does not exist', async () => {
    engine = await testEngine({ fetch: scripted([{ text: 'x' }]).fetch })
    const r = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL, agent: 'Nobody' })
    expect(r.status).toBe(404)
  })
})

describe('agents working together (4.6, 4.7)', () => {
  it('a manager splits a task between two agents, each in its own task', async () => {
    const or = scripted((body) => {
      const text = JSON.stringify(body)
      const turns = (body.messages as unknown[]).length
      if (text.includes('You are Researcher'))
        return { text: 'Three competitors: A, B and C.', cost: 0.01 }
      if (text.includes('You are Writer')) return { text: 'Draft offer: ...', cost: 0.02 }
      // Titan: first hands out two parts, then puts the answers together.
      if (turns <= 2)
        return {
          toolCalls: [
            {
              name: 'agent_delegate',
              input: {
                parts: [
                  { agent: 'Researcher', brief: 'List our three main competitors in Brasov.' },
                  { agent: 'Writer', brief: 'Draft a one-page offer for office cleaning.' }
                ]
              }
            }
          ]
        } satisfies ScriptedTurn
      return { text: 'Here is the offer, with the competitors in mind.' }
    })
    engine = await testEngine({ fetch: or.fetch })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'Research competitors and write an offer',
      model: MODEL
    })
    const done = await finished(body.task.id)
    expect(done.task.status).toBe('done')
    expect(done.parts!.map((p) => p.agent).sort()).toEqual(['Researcher', 'Writer'])
    expect(done.parts!.every((p) => p.parentId === body.task.id && p.status === 'done')).toBe(true)
    // The parts' cost counts in the first task's.
    expect(done.task.costUsd).toBeGreaterThanOrEqual(0.03)
    // The message bus: two briefs, two answers.
    expect(done.talk!.map((m) => `${m.from}>${m.to}:${m.kind}`).sort()).toEqual([
      'Researcher>Titan:answer',
      'Titan>Researcher:brief',
      'Titan>Writer:brief',
      'Writer>Titan:answer'
    ])
    // The answers came back to Titan marked as data.
    const toolMessage = done.messages.find((m) => m.message.role === 'tool')!.message
    expect(toolMessage.role === 'tool' && toolMessage.output).toContain('Three competitors')
    // A part is offered no team tools.
    const researcherCall = or.requests.find((r) =>
      JSON.stringify(r.body).includes('You are Researcher')
    )!
    expect(toolNames(researcherCall.body)).not.toContain('agent_delegate')
    expect(toolNames(researcherCall.body)).toContain('web_search')
    expect(toolNames(researcherCall.body)).not.toContain('run_command')
  })

  it('refuses an unknown agent, too many parts, and a part handing on', async () => {
    const or = scripted((body) => {
      const text = JSON.stringify(body)
      if (text.includes('You are Writer'))
        return (body.messages as unknown[]).length <= 2
          ? {
              toolCalls: [
                {
                  name: 'agent_delegate',
                  input: { parts: [{ agent: 'Researcher', brief: 'Find something else please.' }] }
                }
              ]
            }
          : { text: 'Done anyway.' }
      const n = (body.messages as unknown[]).length
      if (n <= 2)
        return {
          toolCalls: [
            {
              name: 'agent_delegate',
              input: { parts: [{ agent: 'Ghost', brief: 'Do something for me please.' }] }
            }
          ]
        }
      if (n <= 4)
        return {
          toolCalls: [
            {
              name: 'agent_delegate',
              input: {
                parts: ['Writer', 'Researcher', 'Builder', 'Folder agent'].map((agent) => ({
                  agent,
                  brief: 'A part that is long enough.'
                }))
              }
            }
          ]
        }
      if (n <= 6)
        return {
          toolCalls: [
            {
              name: 'agent_delegate',
              input: { parts: [{ agent: 'Writer', brief: 'Write a short note and hand on.' }] }
            }
          ]
        }
      return { text: 'Finished.' }
    })
    engine = await testEngine({ fetch: or.fetch })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'go', model: MODEL })
    const done = await finished(body.task.id)
    const outputs = done.messages.flatMap((m) =>
      m.message.role === 'tool' ? [m.message.output] : []
    )
    expect(outputs[0]).toMatch(/no agent called "Ghost"/)
    expect(outputs[1]).toMatch(/At most 3 parts/)
    const part = (await detail(done.parts![0].id)).activity
    expect(part.find((a) => a.kind === 'refused')?.summary).toMatch(/can't hand work on/)
  })
})

describe('agents and skills on request (18.1, 18.2)', () => {
  const REQUEST = {
    name: 'agent_create',
    input: {
      name: 'Supplier chaser',
      role: 'Writes polite reminders to suppliers about late deliveries.',
      team: 'Operations',
      tools: ['files', 'memory', 'artifacts'],
      instructions: 'Be polite and short.',
      skills: [
        {
          name: 'late-delivery-reminder',
          description: 'When a supplier is late',
          steps: '1. Check the order.\n2. Write the reminder.'
        }
      ]
    }
  }

  it('asks every time, on the laptop only, then makes the agent and its skills', async () => {
    const or = scripted([{ toolCalls: [REQUEST] }, { text: 'Made it.' }])
    engine = await testEngine({ fetch: or.fetch })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'I need an agent that chases late suppliers',
      model: MODEL
    })
    const approval = await until(
      () => engine!.parts.store.listApprovals({ taskId: body.task.id, status: 'pending' })[0]
    )
    expect(approval).toMatchObject({ tool: 'agent_create', canAlways: false })
    expect(approval.summary).toMatch(/Supplier chaser.*Operations.*late-delivery-reminder/)
    // Nothing is written before the user says yes.
    expect(engine.parts.agents.get('Supplier chaser')).toBeNull()
    expect(() => engine!.parts.permissions.answer(approval.id, 'approve', 'remote')).toThrow()
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
    await finished(body.task.id)

    const agents = (await call(engine, 'GET', '/v1/agents')).body.agents
    const made = agents.find((a: { name: string }) => a.name === 'Supplier chaser')
    expect(made).toMatchObject({
      team: 'Operations',
      skills: ['late-delivery-reminder'],
      builtIn: false,
      manager: false
    })
    expect(made.source).toMatch(/^Titan, in the task/)
    expect(engine.parts.skills.get('late-delivery-reminder')!.source).toMatch(/for Supplier chaser/)
  })

  it('writes nothing when denied, and only Titan may make agents', async () => {
    const or = scripted([{ toolCalls: [REQUEST] }, { text: 'OK.' }])
    engine = await testEngine({ fetch: or.fetch })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'make it', model: MODEL })
    const approval = await until(
      () => engine!.parts.store.listApprovals({ taskId: body.task.id, status: 'pending' })[0]
    )
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'deny' })
    await finished(body.task.id)
    expect(engine.parts.agents.get('Supplier chaser')).toBeNull()
    expect(engine.parts.skills.get('late-delivery-reminder')).toBeNull()
    // A manager of the user's own can hand work out but never make agents.
    await call(engine, 'POST', '/v1/agents', { ...CLERK, name: 'Boss', manager: true })
    const or2 = scripted([{ toolCalls: [REQUEST] }, { text: 'OK.' }])
    await engine.close()
    engine = await testEngine({ fetch: or2.fetch })
    await call(engine, 'POST', '/v1/agents', { ...CLERK, name: 'Boss', manager: true })
    const boss = await call(engine, 'POST', '/v1/tasks', { text: 'x', model: MODEL, agent: 'Boss' })
    const bossDone = await finished(boss.body.task.id)
    expect(toolNames(or2.requests[0].body)).toContain('agent_delegate')
    expect(toolNames(or2.requests[0].body)).not.toContain('agent_create')
    expect(bossDone.activity.find((a) => a.kind === 'refused')?.summary).toMatch(
      /wasn't given agent_create/
    )
  })
})

describe('smart routing (2.4)', () => {
  it('plans with the main model, steps with the fast one, and goes back after a failure', async () => {
    const folder = tempFolder()
    writeFileSync(join(folder, 'a.txt'), 'A')
    const or = scripted([
      { toolCalls: [{ name: 'read_file', input: { path: 'a.txt' } }] },
      { toolCalls: [{ name: 'read_file', input: { path: 'missing.txt' } }] },
      { toolCalls: [{ name: 'read_file', input: { path: 'a.txt' } }] },
      { text: 'Done.' }
    ])
    engine = await testEngine({ fetch: or.fetch, folder })
    await call(engine, 'POST', '/v1/agents', { ...CLERK, fastModel: 'openrouter:test/fast' })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'read',
      model: MODEL,
      agent: 'Invoice clerk'
    })
    const done = await finished(body.task.id)
    expect(or.requests.map((r) => r.body.model)).toEqual([
      'test/model', // the plan
      'test/fast',
      'test/model', // after the failed read
      'test/fast'
    ])
    expect(done.activity.filter((a) => a.kind === 'model').map((a) => a.model)).toContain(
      'openrouter:test/fast'
    )
  })
})

describe('compare models (2.8)', () => {
  it('runs one prompt on several models with no tools and shows each cost', async () => {
    const or = scripted((body) => ({ text: `I am ${String(body.model)}`, cost: 0.004 }))
    engine = await testEngine({ fetch: or.fetch })
    const r = await call(engine, 'POST', '/v1/compare', {
      prompt: 'Say who you are',
      models: [MODEL, 'openrouter:test/other']
    })
    expect(r.status).toBe(200)
    expect(r.body.results.map((x: { text: string }) => x.text)).toEqual([
      'I am test/model',
      'I am test/other'
    ])
    expect(r.body.results[0]).toMatchObject({ costUsd: 0.004, error: null })
    expect(
      or.requests.every((q) => !q.body.tools || (q.body.tools as unknown[]).length === 0)
    ).toBe(true)
    // Nothing is kept as a task.
    expect(engine.parts.store.listTasks()).toEqual([])
    const one = await call(engine, 'POST', '/v1/compare', { prompt: 'x', models: [MODEL] })
    expect(one.status).toBe(400)
  })
})

describe('own memory only (§59.4)', () => {
  it("doesn't put shared memory in an own-memory agent's instructions", async () => {
    const or = scripted([{ text: 'ok' }])
    engine = await testEngine({ fetch: or.fetch })
    engine.parts.memory.add({
      scope: 'shared',
      kind: 'profile',
      text: 'We are Acme Cleaning.',
      source: 'you'
    })
    await call(engine, 'POST', '/v1/agents', { ...CLERK, memory: 'own' })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'hi',
      model: MODEL,
      agent: 'Invoice clerk'
    })
    await finished(body.task.id)
    expect(JSON.stringify(or.requests[0].body)).not.toContain('Acme Cleaning')
  })
})
