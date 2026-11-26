// Sync between laptops (decisions §58.12, §65): the shell's packages open
// with the engine's sync core and back, conversations travel only when
// finished and never replace one running here, and two laptops sync through a
// fake of our cloud's relay that sees only ciphertext. A laptop joins only
// after codes are checked on both, and one leaving changes the key.
import { describe, expect, it } from 'vitest'

import { openDb } from '../src/engine/lib/db'
import { newSyncKey, open as engineOpen, seal as engineSeal } from '../src/engine/lib/apps/sync'
import { createStore, type SyncedTask } from '../src/engine/store'
import { LaptopSync } from '../src/main/lib/laptop-sync'
import type { EngineCall } from '../src/main/lib/remote-commands'
import { openPackage, sealPackage } from '../src/main/lib/sync-package'
import { randomId } from '../src/shared/remote-protocol'
import { tempFolder } from './helpers'

describe('sync packages', () => {
  it('the shell and the engine open each other’s packages, and nothing else', () => {
    const key = newSyncKey()
    const entries = [
      {
        collection: 'clients',
        id: 'c1',
        op: 'put' as const,
        at: 5,
        data: { name: 'Brasov Logistics' }
      }
    ]
    expect(engineOpen(key, sealPackage(key, { app: 'crm', entries }))).toEqual({
      app: 'crm',
      entries
    })
    expect(openPackage(key, engineSeal(key, 'crm', entries))).toEqual({ app: 'crm', entries })
    expect(openPackage(newSyncKey(), sealPackage(key, { app: 'crm', entries }))).toBeNull()
    expect(
      Buffer.from(sealPackage(key, { app: 'crm', entries }), 'base64').toString('latin1')
    ).not.toContain('Brasov')
  })
})

describe('conversations', () => {
  const record = (over: Partial<SyncedTask> = {}): SyncedTask => ({
    id: 'task_1',
    title: 'Write the thank-you note',
    agent: 'Titan',
    model: 'anthropic/claude-haiku-5.5',
    status: 'done',
    note: null,
    steps: 2,
    costUsd: 0.01,
    mode: 'normal',
    createdAt: 1000,
    updatedAt: 2000,
    messages: [
      { createdAt: 1000, message: { role: 'user', text: 'Thank Brasov Logistics' } },
      { createdAt: 1500, message: { role: 'assistant', text: 'Done.' } }
    ],
    ...over
  })

  it('travel finished, are kept only when newer, and never replace one running here', () => {
    const db = openDb(':memory:')
    const store = createStore(db, () => undefined)
    expect(store.importSyncedTask(record(), 'Office laptop')).toBe(true)
    expect(store.getTask('task_1')).toMatchObject({
      title: 'Write the thank-you note',
      syncedFrom: 'Office laptop',
      updatedAt: 2000
    })
    expect(store.listMessages('task_1').map((m) => m.message.text)).toEqual([
      'Thank Brasov Logistics',
      'Done.'
    ])
    // An older or equal copy changes nothing.
    expect(store.importSyncedTask(record({ updatedAt: 1500, title: 'old' }), 'Office laptop')).toBe(
      false
    )
    expect(store.importSyncedTask(record({ status: 'running' as never }), 'Office laptop')).toBe(
      false
    )
    expect(store.importSyncedTask(record({ id: '../x' }), 'Office laptop')).toBe(false)
    // Carried on here: while it runs, a newer copy from elsewhere waits.
    store.updateTask('task_1', { status: 'running' })
    expect(
      store.importSyncedTask(
        record({ updatedAt: Date.now() + 10_000, title: 'newer' }),
        'Office laptop'
      )
    ).toBe(false)
    store.updateTask('task_1', { status: 'done' })
    // What goes out: finished top-level conversations after a time, with their messages.
    const out = store.syncedTasksSince(0)
    expect(out).toHaveLength(1)
    expect(out[0]!.messages).toHaveLength(2)
    const running = store.createTask({ title: 'still going', agent: 'Titan', model: 'm' })
    expect(store.syncedTasksSince(0).map((t) => t.id)).not.toContain(running.id)
    expect(store.syncedTasksSince(Date.now() + 60_000)).toEqual([])
  })
})

// ------------------------------------------------------------------ a fake relay

interface FakeMember {
  id: string
  device: string
  name: string
  publicKey: string
  status: 'waiting' | 'in'
  sealedKey?: string
  sealedBy?: string
  keyMsgId?: string
  keyGen?: number
  cursor: number
}

/** The rules of convex/sync.ts that matter to the laptops, in memory. */
interface FakeRelay {
  members: FakeMember[]
  changes: { seq: number; device: string; keyGen: number; body: string }[]
  keyGen: number
  resendAt: number
  seq: number
  seen: string[]
  fetch: typeof fetch
}

interface FakeEngine {
  engine: EngineCall
  records: { app: string; entries: { id: string; at: number; data?: unknown }[] }[]
  tasks: (SyncedTask & { from?: string })[]
  write(app: string, id: string, data: unknown): void
}

function fakeRelay(): FakeRelay {
  const relay: FakeRelay = {
    members: [] as FakeMember[],
    changes: [] as { seq: number; device: string; keyGen: number; body: string }[],
    keyGen: 0,
    resendAt: 0,
    seq: 0,
    /** Everything the laptops sent, to check nothing readable went out. */
    seen: [] as string[],
    fetch: (async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.startsWith('https://storage.test/')) {
        const c = relay.changes.find((x) => String(x.seq) === u.split('/').pop())
        return c ? new Response(c.body) : new Response('', { status: 404 })
      }
      const device = String((init?.headers as Record<string, string>).Authorization).slice(7)
      relay.seen.push(String(init?.body))
      if (u.endsWith('/desktop/sync/package')) {
        const me = relay.members.find((m) => m.device === device)
        const gen = Number((init?.headers as Record<string, string>)['X-Titan117-Key-Gen'])
        if (!me || me.status !== 'in' || gen !== relay.keyGen)
          return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
        relay.changes.push({ seq: ++relay.seq, device, keyGen: gen, body: String(init?.body) })
        if (me.cursor === relay.seq - 1) me.cursor = relay.seq
        return Response.json({ seq: relay.seq })
      }
      const body = JSON.parse(String(init?.body))
      let me = relay.members.find((m) => m.device === device)
      if (!body.on) {
        relay.members = relay.members.filter((m) => m.device !== device)
        return Response.json({ on: false })
      }
      if (!me) {
        const anyoneIn = relay.members.some((m) => m.status === 'in')
        if (!anyoneIn) relay.keyGen++
        me = {
          id: randomId(),
          device,
          name: device,
          publicKey: body.publicKey,
          status: anyoneIn ? 'waiting' : 'in',
          cursor: anyoneIn ? 0 : relay.seq,
          ...(anyoneIn ? {} : { keyGen: relay.keyGen })
        }
        relay.members.push(me)
      }
      let rekeyRefused = false
      if (me.status === 'in') {
        if (body.admit) {
          const t = relay.members.find(
            (m) => m.id === body.admit.memberId && m.status === 'waiting'
          )
          if (t && body.admit.keyGen === relay.keyGen) {
            Object.assign(t, {
              status: 'in',
              sealedKey: body.admit.sealedKey,
              sealedBy: me.publicKey,
              keyMsgId: body.admit.keyMsgId,
              keyGen: relay.keyGen,
              cursor: relay.seq
            })
            relay.resendAt = Date.now()
          }
        }
        if (body.remove)
          relay.members = relay.members.filter((m) => m.id !== body.remove || m.id === me!.id)
        if (body.rekey) {
          const others = relay.members.filter((m) => m.status === 'in' && m.id !== me!.id)
          if (body.rekey.keyGen === relay.keyGen + 1 && body.rekey.keys.length === others.length) {
            for (const k of body.rekey.keys)
              Object.assign(
                relay.members.find((m) => m.id === k.memberId)!,
                {
                  sealedKey: k.sealedKey,
                  sealedBy: me.publicKey,
                  keyMsgId: k.keyMsgId,
                  keyGen: body.rekey.keyGen
                }
              )
            me.keyGen = body.rekey.keyGen
            relay.keyGen = body.rekey.keyGen
          } else rekeyRefused = true
        }
        if (typeof body.cursor === 'number' && body.cursor > me.cursor && body.cursor <= relay.seq)
          me.cursor = body.cursor
      }
      return Response.json({
        on: true,
        me: {
          id: me.id,
          status: me.status,
          keyGen: me.keyGen ?? null,
          sealedKey: me.sealedKey ?? null,
          sealedBy: me.sealedBy ?? null,
          keyMsgId: me.keyMsgId ?? null,
          cursor: me.cursor
        },
        keyGen: relay.keyGen,
        rekeyRefused,
        members: relay.members.map((m) => ({
          id: m.id,
          name: m.name,
          publicKey: m.publicKey,
          status: m.status,
          keyGen: m.keyGen ?? null
        })),
        changes:
          me.status === 'in'
            ? relay.changes
                .filter((c) => c.seq > me!.cursor)
                .map((c) => ({
                  seq: c.seq,
                  keyGen: c.keyGen,
                  size: c.body.length,
                  own: c.device === device,
                  url: c.device === device ? null : `https://storage.test/${c.seq}`
                }))
            : [],
        top: relay.seq,
        gap: false,
        resendAt: relay.resendAt || null
      })
    }) as unknown as typeof fetch
  }
  return relay
}

/** One laptop's engine as the shell sees it: one sidebar app and its conversations. */
function fakeEngine(apps: string[]): FakeEngine {
  const records: { app: string; entries: { id: string; at: number; data?: unknown }[] }[] = []
  const log: {
    seq: number
    app: string
    entry: { collection: string; id: string; op: 'put'; at: number; data: unknown }
  }[] = []
  const tasks: (SyncedTask & { from?: string })[] = []
  const engine: EngineCall = async <T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> => {
    const url = new URL(path, 'http://engine')
    if (path === '/v1/sync/apps') return { apps } as T
    const app = decodeURIComponent(url.pathname.split('/')[4] ?? '')
    if (method === 'GET' && url.pathname.startsWith('/v1/sync/apps/')) {
      const since = Number(url.searchParams.get('since'))
      const mine = log.filter((l) => l.app === app && l.seq > since)
      return {
        upTo: mine.length ? mine[mine.length - 1]!.seq : since,
        entries: mine.map((l) => l.entry)
      } as T
    }
    if (method === 'POST' && url.pathname.startsWith('/v1/sync/apps/')) {
      records.push({ app, entries: (body as { entries: never[] }).entries })
      return { applied: 1, skipped: 0, refused: 0 } as T
    }
    if (method === 'GET' && url.pathname === '/v1/sync/tasks') {
      const since = Number(url.searchParams.get('since'))
      return { tasks: tasks.filter((t) => !t.from && t.updatedAt > since) } as T
    }
    if (method === 'POST' && url.pathname === '/v1/sync/tasks') {
      const b = body as { from: string; tasks: SyncedTask[] }
      for (const t of b.tasks) tasks.push({ ...t, from: b.from })
      return { applied: b.tasks.length } as T
    }
    throw new Error(`Unexpected ${method} ${path}`)
  }
  let seq = 0
  return {
    engine,
    records,
    tasks,
    write(app: string, id: string, data: unknown) {
      log.push({
        seq: ++seq,
        app,
        entry: { collection: 'clients', id, op: 'put', at: Date.now(), data }
      })
    }
  }
}

function laptop(
  relay: FakeRelay,
  token: string,
  name: string,
  apps = ['crm']
): FakeEngine & { sync: LaptopSync; notes: string[] } {
  const e = fakeEngine(apps)
  const notes: string[] = []
  const sync = new LaptopSync({
    dataDir: tempFolder(),
    laptopName: name,
    keychain: { encrypt: (t) => Buffer.from(`enc:${t}`), decrypt: (b) => b.toString().slice(4) },
    apiUrl: () => 'https://cloud.test',
    deviceToken: () => token,
    engine: e.engine,
    notify: (title) => notes.push(title),
    onChange: () => undefined,
    fetch: relay.fetch,
    manual: true
  })
  return { sync, ...e, notes }
}

describe('two laptops', () => {
  it('join with matching codes on both, then records and finished conversations travel sealed', async () => {
    const relay = fakeRelay()
    const office = laptop(relay, 'office', 'Office laptop')
    const home = laptop(relay, 'home', 'Home laptop', ['crm', 'stock'])
    expect(office.sync.view().status).toBe('off')

    await office.sync.switchOn()
    await office.sync.tick()
    expect(office.sync.view().status).toBe('in')
    office.write('crm', 'c1', { name: 'Brasov Logistics' })
    office.tasks.push({
      id: 'task_1',
      title: 'Thank Brasov Logistics',
      agent: 'Titan',
      model: 'm',
      status: 'done',
      note: null,
      steps: 1,
      costUsd: 0,
      mode: 'normal',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { createdAt: 1, message: { role: 'user', text: 'Thank Brasov Logistics for Thursday' } }
      ]
    })
    await office.sync.tick()

    await home.sync.switchOn()
    await home.sync.tick()
    expect(home.sync.view().status).toBe('waiting')
    // The office laptop sees it waiting, with the same code the home laptop will show.
    await office.sync.tick()
    const waiting = office.sync.view().waiting[0]!
    expect(waiting.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/)
    await office.sync.allow(waiting.id)
    await office.sync.tick()

    // The home laptop has the key sealed to it, but keeps it only after the code check.
    await home.sync.tick()
    expect(home.sync.view().confirm).toEqual({ by: 'office', code: waiting.code })
    expect(home.records).toEqual([])
    home.sync.confirmKey(true)
    await home.sync.tick()
    await home.sync.tick()
    expect(home.records.map((r) => r.app)).toEqual(['crm'])
    expect(JSON.stringify(home.records)).toContain('Brasov Logistics')
    expect(home.tasks.find((t) => t.id === 'task_1')).toMatchObject({ from: 'Office laptop' })

    // And back: the home laptop's own record reaches the office one; an app the office doesn't have is skipped.
    home.write('crm', 'c2', { name: 'Cluj Bakery' })
    home.write('stock', 's1', { item: 'flour' })
    await home.sync.tick()
    await office.sync.tick()
    expect(JSON.stringify(office.records)).toContain('Cluj Bakery')
    expect(JSON.stringify(office.records)).not.toContain('flour')

    // Our cloud saw keys, cursors and ciphertext, never a name or a message.
    const all = relay.seen.join('\n') + relay.changes.map((c) => c.body).join('\n')
    for (const word of ['Brasov', 'Cluj', 'flour', 'Thursday', 'crm', 'clients'])
      expect(all).not.toContain(word)
  })

  it('a key from a laptop never checked asks for the code, and refusing keeps it out', async () => {
    const relay = fakeRelay()
    const office = laptop(relay, 'office', 'Office laptop')
    const home = laptop(relay, 'home', 'Home laptop')
    await office.sync.switchOn()
    await office.sync.tick()
    await home.sync.switchOn()
    await home.sync.tick()
    await office.sync.tick()
    await office.sync.allow(office.sync.view().waiting[0]!.id)
    await office.sync.tick()
    await home.sync.tick()
    home.sync.confirmKey(false)
    expect(home.sync.view().problem).toMatch(/didn’t confirm/)
    office.write('crm', 'c1', { name: 'Brasov Logistics' })
    await office.sync.tick()
    await home.sync.tick()
    expect(home.records).toEqual([])
  })

  it('one leaving changes the key; it can’t read what comes after', async () => {
    const relay = fakeRelay()
    const office = laptop(relay, 'office', 'Office laptop')
    const home = laptop(relay, 'home', 'Home laptop')
    const spare = laptop(relay, 'spare', 'Spare laptop')
    await office.sync.switchOn()
    await office.sync.tick()
    for (const l of [home, spare]) {
      await l.sync.switchOn()
      await l.sync.tick()
      await office.sync.tick()
      await office.sync.allow(office.sync.view().waiting[0]!.id)
      await office.sync.tick()
      await l.sync.tick()
      l.sync.confirmKey(true)
      await l.sync.tick()
    }
    expect(relay.keyGen).toBe(1)
    const spareId = office.sync.view().laptops.find((l) => l.name === 'spare')!.id
    office.sync.remove(spareId)
    await office.sync.tick()
    await office.sync.tick()
    expect(relay.keyGen).toBe(2)
    // The home laptop trusts the office one (it checked its code), so it takes the new key at once.
    await home.sync.tick()
    expect(home.sync.view().confirm).toBeNull()
    office.write('crm', 'c9', { name: 'After the change' })
    await office.sync.tick()
    await home.sync.tick()
    expect(JSON.stringify(home.records)).toContain('After the change')
    // The removed laptop isn't in any more: it joins only as a waiting one.
    await spare.sync.tick()
    expect(spare.sync.view().status).toBe('waiting')
    expect(spare.records).toEqual([])
  })

  it('switching off forgets the keys and tells our cloud', async () => {
    const relay = fakeRelay()
    const office = laptop(relay, 'office', 'Office laptop')
    await office.sync.switchOn()
    await office.sync.tick()
    office.sync.switchOff()
    await office.sync.tick()
    expect(relay.members).toEqual([])
    expect(office.sync.view()).toMatchObject({ on: false, status: 'off', laptops: [] })
  })
})
