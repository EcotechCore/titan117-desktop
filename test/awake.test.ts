// Keep awake, checkpoints and notifications (features 1.5, 1.6, 1.9;
// decisions §48): a task carries on after the app stops or the internet comes
// back, a tool call that never finished is never silently repeated, the shell
// hears when tasks run, and the user hears what happened.
import { afterEach, describe, expect, it } from 'vitest'

import type { Engine } from '../src/engine/lib/engine'
import { NOT_FINISHED } from '../src/engine/runtime'
import { INTERRUPTED_NOTE } from '../src/engine/store'
import { call, MODEL, scripted, tempFolder, testEngine, until } from './helpers'

let engines: Engine[] = []
afterEach(async () => {
  for (const e of engines) await e.close().catch(() => undefined)
  engines = []
})

async function start(options: Parameters<typeof testEngine>[0]): Promise<Engine> {
  const engine = await testEngine(options)
  engines.push(engine)
  return engine
}

async function finished(
  engine: Engine,
  id: string
): Promise<{
  task: { status: string; note: string | null }
  messages: { message: { role: string; output?: string; text?: string } }[]
  activity: { summary: string }[]
}> {
  await until(() => !engine.parts.runtime.isRunning(id), 20_000)
  return (await call(engine, 'GET', `/v1/tasks/${id}`)).body
}

describe('checkpoints (1.6)', () => {
  it('a task the app was running when it closed carries on when it starts again, and the unfinished step is not silently repeated', async () => {
    const dataDir = tempFolder()
    const folder = tempFolder()
    // First run: the model asks to write a file and the app closes while waiting for the OK.
    const first = await start({
      dataDir,
      folder,
      fetch: scripted([
        { toolCalls: [{ name: 'write_file', input: { path: 'a.txt', content: 'x' } }] }
      ]).fetch
    })
    const { body } = await call(first, 'POST', '/v1/tasks', { text: 'Write a.txt', model: MODEL })
    await until(
      () => first.parts.store.listApprovals({ taskId: body.task.id, status: 'pending' })[0]
    )
    await first.close()
    engines = engines.filter((e) => e !== first)

    // Second run: it resumes by itself, the model is told the write didn't finish.
    const or = scripted([{ text: 'I checked: a.txt was not written. Done.' }])
    const second = await start({ dataDir, fetch: or.fetch })
    const done = await finished(second, body.task.id)
    expect(done.task.status).toBe('done')
    const tool = done.messages.map((m) => m.message).find((m) => m.role === 'tool')
    expect(tool?.output).toBe(NOT_FINISHED)
    expect(done.activity.some((a) => a.summary === 'Resumed: Titan117 started again')).toBe(true)
  })

  it('resumes by itself at most twice; after that it waits for Resume', async () => {
    const dataDir = tempFolder()
    // A model that never answers, so the task is always running when the app closes.
    const hang = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        )
      )) as typeof fetch
    let id = ''
    for (let round = 0; round < 4; round++) {
      const engine = await start({ dataDir, fetch: hang })
      if (!id)
        id = (await call(engine, 'POST', '/v1/tasks', { text: 'Go', model: MODEL })).body.task.id
      await new Promise((r) => setTimeout(r, 50))
      const status = engine.parts.store.getTask(id)!.status
      if (round > 0) expect(status).toBe(round <= 2 ? 'running' : 'stopped')
      await engine.close()
      engines = engines.filter((e) => e !== engine)
    }
    const last = await start({ dataDir, fetch: hang })
    expect(last.parts.store.getTask(id)).toMatchObject({
      status: 'stopped',
      note: INTERRUPTED_NOTE
    })
    // The user can still resume it.
    expect((await call(last, 'POST', `/v1/tasks/${id}/resume`)).status).toBe(200)
  })

  it('only a stopped task can be resumed', async () => {
    const engine = await start({ fetch: scripted([{ text: 'Done.' }]).fetch })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL })
    await finished(engine, body.task.id)
    expect((await call(engine, 'POST', `/v1/tasks/${body.task.id}/resume`)).status).toBe(409)
    expect((await call(engine, 'POST', '/v1/tasks/nope/resume')).status).toBe(404)
  })

  it('a task paused by the lost internet carries on when it’s back', async () => {
    let up = false
    const or = scripted([{ text: 'Done after the break.' }])
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!up) throw new TypeError('fetch failed')
      if (String(input).endsWith('/api/v1/key')) return new Response('', { status: 401 })
      return or.fetch(input, init)
    }) as typeof fetch
    const engine = await start({ fetch: fetchFn })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL })
    expect((await finished(engine, body.task.id)).task.status).toBe('stopped')
    up = true
    await engine.parts.connectivity.probe()
    await until(() => engine.parts.store.getTask(body.task.id)?.status === 'done')
  })
})

describe('keep awake and notifications (1.5, 1.9)', () => {
  it('tells the shell when tasks run and stop, and what to tell the user', async () => {
    const busy: number[] = []
    const notes: { title: string; body: string }[] = []
    const engine = await start({
      folder: tempFolder(),
      fetch: scripted([
        { toolCalls: [{ name: 'write_file', input: { path: 'a.txt', content: 'x' } }] },
        { text: 'Done.' }
      ]).fetch,
      onBusy: (n) => busy.push(n),
      onNotify: (n) => notes.push(n)
    })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'Write a.txt', model: MODEL })
    const approval = await until(
      () => engine.parts.store.listApprovals({ taskId: body.task.id, status: 'pending' })[0]
    )
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
    await finished(engine, body.task.id)
    await until(() => busy.at(-1) === 0)
    expect(busy[0]).toBe(1)
    expect(notes.map((n) => n.title)).toEqual(['Titan needs your OK', 'Titan finished'])
    // The task's title, then what it ended with.
    expect(notes[1].body.split(String.fromCharCode(10))).toEqual(['Write a.txt', 'Done.'])

    // Turned off in Setup: nothing more.
    expect((await call(engine, 'PUT', '/v1/notifications', { on: false })).status).toBe(200)
    const again = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL })
    await finished(engine, again.body.task.id)
    expect(notes).toHaveLength(2)
    expect((await call(engine, 'GET', '/v1/setup')).body.notifications).toBe(false)
  })
})
