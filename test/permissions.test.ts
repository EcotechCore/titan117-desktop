// The permission and approval layer (guardrails §4): a risky call waits for
// the user, a denial stops it, external actions always ask, and laptop-only
// approvals can't be answered remotely (guardrails §9).
import { describe, expect, it } from 'vitest'

import type { Risk } from '../src/shared/protocol'
import { openDb } from '../src/engine/lib/db'
import { createLogger } from '../src/engine/lib/log'
import {
  ApprovalError,
  createPermissionLayer,
  type PermissionLayer
} from '../src/engine/permissions'
import { createStore, type Store } from '../src/engine/store'
import { createRegistry } from '../src/engine/tools'
import { defineTool } from '../src/engine/tools/lib/define-tool'
import { until } from './helpers'

function fakeTool(name: string, risk: Risk, ran: string[]): ReturnType<typeof defineTool> {
  return defineTool({
    name,
    description: name,
    params: {
      type: 'object',
      properties: { what: { type: 'string', description: 'what' } },
      required: ['what']
    },
    risk,
    permissions: {},
    describe: (input) => `${name} ${String(input.what)}`,
    async run(input) {
      ran.push(`${name}:${String(input.what)}`)
      return { output: 'ok', summary: `${name} done` }
    }
  })
}

function setup(): {
  layer: PermissionLayer
  store: Store
  ran: string[]
  taskId: string
  abort: AbortController
  exec(name: string, what?: string): ReturnType<PermissionLayer['execute']>
  pending(): Promise<string>
} {
  const ran: string[] = []
  const db = openDb(':memory:')
  const store = createStore(db, () => undefined)
  const layer = createPermissionLayer({
    tools: createRegistry([
      fakeTool('look', 'read', ran),
      fakeTool('change', 'write', ran),
      fakeTool('publish', 'external', ran),
      defineTool({
        name: 'sneaky',
        description: 'Declares no folder access but tries to read a file.',
        params: { type: 'object', properties: {}, required: [] },
        risk: 'read',
        permissions: {},
        describe: () => 'sneak',
        async run(_, ctx) {
          const { text } = await ctx.files.read('C:/Windows/win.ini')
          return { output: text, summary: 'sneaked' }
        }
      })
    ]),
    store,
    log: createLogger(db, null),
    folders: () => ({ allowed: ['C:/Windows'], core: [] })
  })
  const task = store.createTask({ title: 't', agent: 'Titan', model: 'm' })
  const abort = new AbortController()
  let n = 0
  return {
    layer,
    store,
    ran,
    taskId: task.id,
    abort,
    exec: (name, what = 'x') =>
      layer.execute(
        { id: `c${++n}`, name, input: name === 'sneaky' ? {} : { what } },
        { taskId: task.id, agent: 'Titan', model: 'm', signal: abort.signal }
      ),
    pending: async () =>
      (await until(() => store.listApprovals({ taskId: task.id, status: 'pending' })[0])).id
  }
}

describe('permission layer', () => {
  it('runs a read without asking, and logs it', async () => {
    const s = setup()
    expect((await s.exec('look')).status).toBe('done')
    expect(s.store.listApprovals({})).toHaveLength(0)
    expect(s.store.listActivity(s.taskId).at(-1)).toMatchObject({ kind: 'tool', tool: 'look' })
  })

  it('holds a write until the user approves', async () => {
    const s = setup()
    const outcome = s.exec('change')
    const id = await s.pending()
    // Waiting: the tool has not run, and the task says so.
    expect(s.ran).toEqual([])
    expect(s.store.getTask(s.taskId)?.status).toBe('waiting')
    s.layer.answer(id, 'approve', 'window')
    expect((await outcome).status).toBe('done')
    expect(s.ran).toEqual(['change:x'])
    expect(s.store.listActivity(s.taskId).at(-1)).toMatchObject({ approvedBy: 'you' })
  })

  it('does not run a denied call', async () => {
    const s = setup()
    const outcome = s.exec('change')
    s.layer.answer(await s.pending(), 'deny', 'window')
    expect(await outcome).toMatchObject({ status: 'refused' })
    expect(s.ran).toEqual([])
    expect(s.store.listActivity(s.taskId).at(-1)).toMatchObject({ kind: 'refused' })
  })

  it('"always" lets later writes of that tool through, in that task only', async () => {
    const s = setup()
    const first = s.exec('change', 'one')
    s.layer.answer(await s.pending(), 'always', 'window')
    await first
    expect((await s.exec('change', 'two')).status).toBe('done')
    expect(s.store.listApprovals({})).toHaveLength(1)

    const other = s.store.createTask({ title: 'other', agent: 'Titan', model: 'm' })
    const asked = s.layer.execute(
      { id: 'o1', name: 'change', input: { what: 'three' } },
      { taskId: other.id, agent: 'Titan', model: 'm', signal: s.abort.signal }
    )
    const again = await until(
      () => s.store.listApprovals({ taskId: other.id, status: 'pending' })[0]
    )
    s.layer.answer(again.id, 'deny', 'window')
    expect((await asked).status).toBe('refused')
  })

  it('external actions always ask, and "always" is refused for them', async () => {
    const s = setup()
    const first = s.exec('publish', 'one')
    const id = await s.pending()
    expect(s.store.getApproval(id)?.canAlways).toBe(false)
    expect(() => s.layer.answer(id, 'always', 'window')).toThrow(ApprovalError)
    s.layer.answer(id, 'approve', 'window')
    await first

    const second = s.exec('publish', 'two')
    s.layer.answer(await s.pending(), 'approve', 'window')
    await second
    expect(s.store.listApprovals({})).toHaveLength(2)
  })

  it('refuses a remote answer to a laptop-only approval', async () => {
    const s = setup()
    const outcome = s.exec('publish')
    const id = await s.pending()
    expect(() => s.layer.answer(id, 'approve', 'remote')).toThrow(/laptop/)
    expect(s.ran).toEqual([])
    s.layer.answer(id, 'deny', 'window')
    await outcome
  })

  it('refuses an unknown tool and bad input', async () => {
    const s = setup()
    expect(await s.exec('format_disk')).toMatchObject({ status: 'refused' })
    const bad = await s.layer.execute(
      { id: 'b', name: 'look', input: { what: 1, extra: true } },
      { taskId: s.taskId, agent: 'Titan', model: 'm', signal: s.abort.signal }
    )
    expect(bad.status).toBe('refused')
    expect(s.ran).toEqual([])
  })

  it('gives a tool only what it declared', async () => {
    const s = setup()
    const outcome = await s.exec('sneaky')
    expect(outcome.status).toBe('refused')
    expect(outcome.output).toMatch(/did not declare/)
  })

  it('an answered approval cannot be answered again', async () => {
    const s = setup()
    const outcome = s.exec('change')
    const id = await s.pending()
    s.layer.answer(id, 'deny', 'window')
    await outcome
    expect(() => s.layer.answer(id, 'approve', 'window')).toThrow(ApprovalError)
    expect(s.ran).toEqual([])
  })

  it('cancelling the task refuses what was waiting', async () => {
    const s = setup()
    const outcome = s.exec('change')
    await s.pending()
    s.abort.abort()
    expect((await outcome).status).toBe('refused')
    expect(s.ran).toEqual([])
    expect(s.store.listApprovals({ status: 'pending' })).toHaveLength(0)
  })
})

describe('defineTool', () => {
  it('refuses a tool with no risk level or a wrong one', () => {
    const base = {
      name: 'thing',
      description: 'x',
      params: { type: 'object' as const, properties: {}, required: [] },
      permissions: {},
      describe: () => 'x',
      run: async () => ({ output: '', summary: '' })
    }
    expect(() => defineTool({ ...base, risk: undefined as unknown as Risk })).toThrow()
    expect(() => defineTool({ ...base, risk: 'read', permissions: { folders: 'write' } })).toThrow()
    expect(defineTool({ ...base, risk: 'external' }).laptopOnly).toBe(true)
  })
})
