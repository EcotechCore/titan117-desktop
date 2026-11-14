// Every tool has a denial test (guardrails §4): called without the
// permission, it refuses. The coverage test fails for any built-in tool that
// has no entry here, so a new tool can't ship without one.
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { ToolCall } from '../src/shared/protocol'
import { openDb } from '../src/engine/lib/db'
import { createLogger } from '../src/engine/lib/log'
import { createPermissionLayer, type CallOutcome } from '../src/engine/permissions'
import { createStore, type Store } from '../src/engine/store'
import { builtInTools, createRegistry } from '../src/engine/tools'
import { tempFolder, until } from './helpers'

interface Bench {
  allowed: string
  outside: string
  store: Store
  taskId: string
  /** Run a call; `answer` is what the user says if asked. */
  run(call: Omit<ToolCall, 'id'>, answer?: 'approve' | 'deny'): Promise<CallOutcome>
  asked(): number
}

function bench(options: { noFolders?: boolean } = {}): Bench {
  const allowed = tempFolder('titan117-allowed-')
  const outside = tempFolder('titan117-outside-')
  mkdirSync(join(allowed, 'docs'))
  writeFileSync(join(allowed, 'docs', 'note.txt'), 'hello')
  writeFileSync(join(outside, 'secret.txt'), 'outside')

  const db = openDb(':memory:')
  const store = createStore(db, () => undefined)
  const layer = createPermissionLayer({
    tools: createRegistry(builtInTools),
    store,
    log: createLogger(db, null),
    folders: () => ({ allowed: options.noFolders ? [] : [allowed], core: [] })
  })
  const task = store.createTask({ title: 't', agent: 'Titan', model: 'm' })
  let n = 0

  return {
    allowed,
    outside,
    store,
    taskId: task.id,
    asked: () => store.listApprovals({ taskId: task.id }).length,
    async run(call, answer) {
      const outcome = layer.execute(
        { id: `c${++n}`, ...call },
        { taskId: task.id, agent: 'Titan', model: 'm', signal: new AbortController().signal }
      )
      if (answer) {
        const approval = await until(
          () => store.listApprovals({ taskId: task.id, status: 'pending' })[0]
        )
        layer.answer(approval.id, answer, 'window')
      }
      return outcome
    }
  }
}

// tool name → its denial tests.
const DENIALS: Record<string, () => Promise<void>> = {
  async list_folder() {
    const b = bench()
    expect((await b.run({ name: 'list_folder', input: { path: b.outside } })).status).toBe(
      'refused'
    )
    expect((await b.run({ name: 'list_folder', input: { path: '..' } })).status).toBe('refused')
    const none = bench({ noFolders: true })
    expect((await none.run({ name: 'list_folder', input: { path: '.' } })).status).toBe('refused')
  },

  async read_file() {
    const b = bench()
    const outside = await b.run({
      name: 'read_file',
      input: { path: join(b.outside, 'secret.txt') }
    })
    expect(outside.status).toBe('refused')
    expect(outside.output).not.toContain('outside\n')
    expect((await b.run({ name: 'read_file', input: { path: '../x' } })).status).toBe('refused')
    expect((await b.run({ name: 'read_file', input: {} })).status).toBe('refused')
  },

  async write_file() {
    const b = bench()
    // Denied by the user: nothing is written.
    const denied = await b.run(
      { name: 'write_file', input: { path: 'docs/new.txt', content: 'x' } },
      'deny'
    )
    expect(denied.status).toBe('refused')
    expect(existsSync(join(b.allowed, 'docs', 'new.txt'))).toBe(false)

    // Approved by the user, but outside the allowed folders: still refused.
    const target = join(b.outside, 'new.txt')
    const escaped = await b.run(
      { name: 'write_file', input: { path: target, content: 'x' } },
      'approve'
    )
    expect(escaped.status).toBe('refused')
    expect(existsSync(target)).toBe(false)

    // It never runs before the user answers.
    expect(b.asked()).toBe(2)
  }
}

describe('tool denial tests', () => {
  it('cover every built-in tool', () => {
    const missing = builtInTools.map((t) => t.name).filter((name) => !DENIALS[name])
    expect(missing, `tools without a denial test: ${missing.join(', ')}`).toEqual([])
  })

  it.each(Object.keys(DENIALS))('%s refuses without the permission', async (name) => {
    await DENIALS[name]()
  })

  it('every tool declares a risk and its permissions', () => {
    for (const tool of builtInTools) {
      expect(['read', 'write', 'external']).toContain(tool.risk)
      expect(tool.permissions).toBeTypeOf('object')
      expect(tool.describe({ path: 'x', content: 'y' })).toBeTypeOf('string')
    }
  })
})
