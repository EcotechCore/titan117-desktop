// Layout v2 (decisions §67): what the sidebar, the folded steps and the right
// panel show, and the window's history for Back and Forward.
import { describe, expect, it } from 'vitest'

import type { Activity, ChatMessage, StoredMessage, Task } from '../src/shared/protocol'
import {
  age,
  contextUse,
  duration,
  filesMade,
  fullPath,
  groupTasks,
  sitesReached,
  smallUsd,
  turns,
  turnSummary
} from '../src/renderer/src/layout-lib'
import { initialState, reducer } from '../src/renderer/src/state'

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    agent: 'Titan',
    model: 'openrouter:anthropic/claude-haiku-5.5',
    status: 'done',
    note: null,
    steps: 0,
    costUsd: 0,
    mode: 'normal',
    parentId: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch
  }
}

let seq = 0
function msg(message: ChatMessage, createdAt: number): StoredMessage {
  seq++
  return { id: `m${seq}`, taskId: 't', seq, createdAt, message }
}

const conversation: StoredMessage[] = [
  msg({ role: 'user', text: 'Total the invoices' }, 1_000),
  msg(
    {
      role: 'assistant',
      text: '',
      toolCalls: [
        { id: 'a', name: 'read_file', input: { path: 'invoices.csv' } },
        { id: 'b', name: 'web_fetch', input: { url: 'https://www.ecb.europa.eu/rates.xml' } }
      ]
    },
    2_000
  ),
  msg({ role: 'tool', callId: 'a', name: 'read_file', output: 'rows' }, 3_000),
  msg({ role: 'tool', callId: 'b', name: 'web_fetch', output: 'rates' }, 4_000),
  msg(
    {
      role: 'assistant',
      text: '',
      toolCalls: [
        { id: 'c', name: 'write_file', input: { path: 'totals.csv', content: 'a,1' } },
        { id: 'd', name: 'write_file', input: { path: 'nope.csv', content: 'x' } }
      ]
    },
    5_000
  ),
  msg({ role: 'tool', callId: 'c', name: 'write_file', output: 'ok' }, 6_000),
  msg({ role: 'tool', callId: 'd', name: 'write_file', output: 'denied', isError: true }, 7_000),
  msg({ role: 'assistant', text: 'Done: 3 clients.' }, 49_000),
  msg({ role: 'user', text: 'Thanks' }, 60_000)
]

describe('the sidebar', () => {
  it('nests tasks under the folder they worked in; the rest are loose', () => {
    const tasks = [
      task('a', { folder: 'C:\\Work\\Invoices' }),
      task('b', { folder: 'c:\\work\\invoices\\' }),
      task('c'),
      task('d', { folder: 'C:\\Gone' }),
      task('e', { folder: 'C:\\Work\\Invoices', parentId: 'a' })
    ]
    const grouped = groupTasks(tasks, ['C:\\Work\\Invoices', 'C:\\Site'])
    expect(grouped.folders.map((g) => g.tasks.map((t) => t.id))).toEqual([['a', 'b'], []])
    // A folder no longer allowed lets its tasks go loose; parts stay with their task.
    expect(grouped.loose.map((t) => t.id)).toEqual(['c', 'd'])
  })

  it('says ages short', () => {
    const now = 10 * 24 * 3600_000
    expect(age(now - 5_000, now)).toBe('now')
    expect(age(now - 5 * 60_000, now)).toBe('5m')
    expect(age(now - 3 * 3600_000, now)).toBe('3h')
    expect(age(now - 2 * 24 * 3600_000, now)).toBe('2d')
    expect(age(now - 9 * 24 * 3600_000, now)).toBe('1w')
  })
})

describe('the chat', () => {
  it('folds each ask with what the agent did for it, with time, steps and cost', () => {
    const all = turns(conversation)
    expect(all).toHaveLength(2)
    expect(all[0].replies).toHaveLength(7)
    const activity = [
      { at: 2_500, costUsd: 0.001 },
      { at: 48_000, costUsd: 0.003 },
      { at: 70_000, costUsd: 0.5 }
    ] as Activity[]
    expect(turnSummary(all[0], activity, null)).toEqual({ seconds: 48, steps: 4, costUsd: 0.004 })
    expect(duration(48)).toBe('48s')
    expect(duration(185)).toBe('3m 05s')
    expect(smallUsd(0.004)).toBe('$0.004')
    expect(smallUsd(0)).toBe('free')
  })
})

describe('the right panel', () => {
  it('lists only the files that were written, and the sites reached', () => {
    expect(filesMade(conversation)).toEqual([
      { path: 'totals.csv', name: 'totals.csv', content: 'a,1' }
    ])
    expect(sitesReached(conversation)).toEqual({ hosts: ['www.ecb.europa.eu'], searched: false })
  })

  it('places a relative file in the first allowed folder', () => {
    expect(fullPath('out/totals.csv', ['C:\\Work\\Invoices'])).toBe(
      'C:\\Work\\Invoices\\out\\totals.csv'
    )
    expect(fullPath('D:\\x.csv', ['C:\\Work'])).toBe('D:\\x.csv')
    expect(fullPath('x.csv', ['/home/ana/work/'])).toBe('/home/ana/work/x.csv')
  })

  it('measures the context against the cloud model’s length, when known', () => {
    const cloud = [{ id: 'anthropic/claude-haiku-5.5', contextLength: 200 }] as never
    const use = contextUse(conversation, 'openrouter:anthropic/claude-haiku-5.5', cloud)
    expect(use.limit).toBe(200)
    expect(use.tokens).toBeGreaterThan(0)
    expect(contextUse(conversation, 'local:qwen', cloud).limit).toBeNull()
  })
})

describe('Back and Forward', () => {
  it('walks the views the user opened', () => {
    let s = reducer(initialState, { type: 'view', view: { kind: 'memory' } })
    s = reducer(s, { type: 'view', view: { kind: 'task', id: 't1' } })
    s = reducer(s, { type: 'view', view: { kind: 'task', id: 't1' } })
    expect(s.back.map((v) => v.kind)).toEqual(['start', 'memory'])
    s = reducer(s, { type: 'back' })
    expect(s.view).toEqual({ kind: 'memory' })
    s = reducer(s, { type: 'forward' })
    expect(s.view).toEqual({ kind: 'task', id: 't1' })
    s = reducer(s, { type: 'back' })
    s = reducer(s, { type: 'view', view: { kind: 'apps' } })
    expect(s.forward).toEqual([])
  })

  it('opens the drawer on what an agent makes, and goes back to the Task tab when it closes', () => {
    let s = reducer({ ...initialState, showDetails: false }, { type: 'artifact', id: 'a1' })
    expect(s).toMatchObject({ showDetails: true, rightTab: 'artifact', artifact: 'a1' })
    s = reducer(s, { type: 'artifact', id: null })
    expect(s.rightTab).toBe('task')
  })
})
