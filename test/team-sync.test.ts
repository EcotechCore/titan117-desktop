// Teams (11.6; decisions §68): three people (owner, member, viewer) share an
// agent and a sidebar app's records through a fake of our cloud's team relay
// that sees only ciphertext. Laptops join only after an owner's laptop lets
// them in and the codes match; roles are enforced by the sender, the relay
// and every receiving laptop.
import { describe, expect, it } from 'vitest'

import type { EngineCall } from '../src/main/lib/remote-commands'
import { openPackage, sealPackage } from '../src/main/lib/sync-package'
import { TeamSync } from '../src/main/lib/team-sync'
import { randomId } from '../src/shared/remote-protocol'
import { teamCan, type TeamRole } from '../src/shared/team-roles'
import { tempFolder } from './helpers'

const TEAM = 'team0000000001'

interface FakeLaptop {
  id: string
  device: string
  userId: string
  publicKey: string
  status: 'waiting' | 'in'
  sealedKey?: string
  sealedBy?: string
  keyMsgId?: string
  keyGen?: number
  cursor: number
}

/** The rules of convex/teamSync.ts that matter to the laptops, in memory. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helpers, types inferred
function fakeRelay(people: { userId: string; name: string; role: TeamRole; device: string }[]) {
  const relay = {
    people,
    laptops: [] as FakeLaptop[],
    changes: [] as {
      seq: number
      device: string
      userId: string
      kind: 'item' | 'data'
      role: TeamRole
      keyGen: number
      body: string
    }[],
    keyGen: 1,
    resendAt: 0,
    seq: 0,
    seen: [] as string[],
    refused: [] as string[],
    notes: [] as { by: string; action: string }[],
    fetch: (async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.startsWith('https://storage.test/')) {
        const c = relay.changes.find((x) => String(x.seq) === u.split('/').pop())
        return c ? new Response(c.body) : new Response('', { status: 404 })
      }
      const headers = init?.headers as Record<string, string>
      const device = String(headers.Authorization).slice(7)
      const person = relay.people.find((p) => p.device === device)!
      relay.seen.push(String(init?.body))
      if (u.endsWith('/desktop/teams'))
        return Response.json({
          teams: [{ id: TEAM, name: 'Acme', role: person.role, active: true }],
          brand: null
        })
      if (u.endsWith('/desktop/team/package')) {
        const me = relay.laptops.find((l) => l.device === device)
        const kind = headers['X-Titan117-Kind'] as 'item' | 'data'
        const gen = Number(headers['X-Titan117-Key-Gen'])
        if (!me || me.status !== 'in' || gen !== relay.keyGen)
          return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
        if (!teamCan(person.role, kind === 'item' ? 'shareItems' : 'writeData')) {
          relay.refused.push(person.name)
          return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
        }
        relay.changes.push({
          seq: ++relay.seq,
          device,
          userId: person.userId,
          kind,
          role: person.role,
          keyGen: gen,
          body: String(init?.body)
        })
        if (me.cursor === relay.seq - 1) me.cursor = relay.seq
        return Response.json({ seq: relay.seq })
      }
      const body = JSON.parse(String(init?.body))
      let me = relay.laptops.find((l) => l.device === device)
      if (!body.on) {
        relay.laptops = relay.laptops.filter((l) => l.device !== device)
        return Response.json({ on: false })
      }
      if (!me) {
        const anyoneIn = relay.laptops.some((l) => l.status === 'in')
        if (!anyoneIn && person.role !== 'owner')
          return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
        if (!anyoneIn) relay.keyGen++
        me = {
          id: randomId(),
          device,
          userId: person.userId,
          publicKey: body.publicKey,
          status: anyoneIn ? 'waiting' : 'in',
          cursor: anyoneIn ? 0 : relay.seq,
          ...(anyoneIn ? {} : { keyGen: relay.keyGen })
        }
        relay.laptops.push(me)
      }
      if (me.status === 'in') {
        if (body.admit && teamCan(person.role, 'admitLaptop')) {
          const t = relay.laptops.find(
            (l) => l.id === body.admit.laptopId && l.status === 'waiting'
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
        for (const n of body.notes ?? [])
          if (teamCan(person.role, 'shareItems'))
            relay.notes.push({ by: person.name, action: n.action })
        if (typeof body.cursor === 'number' && body.cursor > me.cursor && body.cursor <= relay.seq)
          me.cursor = body.cursor
      }
      return Response.json({
        on: true,
        team: { id: TEAM, name: 'Acme', myRole: person.role, myUserId: person.userId },
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
        laptops: relay.laptops.map((l) => {
          const who = relay.people.find((p) => p.userId === l.userId)!
          return {
            id: l.id,
            name: `${who.name}'s laptop`,
            publicKey: l.publicKey,
            status: l.status,
            keyGen: l.keyGen ?? null,
            person: who.name,
            userId: l.userId,
            role: who.role
          }
        }),
        people: relay.people.map(({ userId, name, role }) => ({ userId, name, role })),
        changes:
          me.status === 'in'
            ? relay.changes
                .filter((c) => c.seq > me!.cursor)
                .map((c) => ({
                  seq: c.seq,
                  keyGen: c.keyGen,
                  kind: c.kind,
                  role: c.role,
                  from: c.userId,
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

/** One laptop's engine as the shell sees it: agents and one sidebar app. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helpers, types inferred
function fakeEngine(agentFiles: Record<string, string> = {}) {
  const imported: { text: string; source: string }[] = []
  const applied: { app: string; entries: unknown[] }[] = []
  const log: { seq: number; entry: unknown }[] = []
  const engine: EngineCall = async <T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> => {
    const url = new URL(path, 'http://engine')
    if (path === '/v1/agents')
      return { agents: Object.keys(agentFiles).map((name) => ({ name, updatedAt: 10 })) } as T
    if (method === 'GET' && url.pathname.endsWith('/file'))
      return { text: agentFiles[decodeURIComponent(url.pathname.split('/')[3]!)] } as T
    if (method === 'POST' && path === '/v1/agents/team/import') {
      imported.push(body as { text: string; source: string })
      return { agent: {} } as T
    }
    if (path === '/v1/sync/apps') return { apps: ['crm'] } as T
    if (method === 'GET' && url.pathname === '/v1/sync/apps/crm') {
      const since = Number(url.searchParams.get('since'))
      const mine = log.filter((l) => l.seq > since)
      return {
        upTo: mine.length ? mine[mine.length - 1]!.seq : since,
        entries: mine.map((l) => l.entry)
      } as T
    }
    if (method === 'POST' && url.pathname === '/v1/sync/apps/crm') {
      applied.push({ app: 'crm', entries: (body as { entries: unknown[] }).entries })
      return { applied: 1 } as T
    }
    throw new Error(`Unexpected ${method} ${path}`)
  }
  let seq = 0
  return {
    engine,
    imported,
    applied,
    write(name: string) {
      log.push({
        seq: ++seq,
        entry: { collection: 'clients', id: `c${seq}`, op: 'put', at: seq, data: { name } }
      })
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helpers, types inferred
function laptop(
  relay: ReturnType<typeof fakeRelay>,
  device: string,
  agents: Record<string, string> = {}
) {
  const e = fakeEngine(agents)
  const notes: string[] = []
  const team = new TeamSync({
    dataDir: tempFolder(),
    laptopName: device,
    keychain: { encrypt: (t) => Buffer.from(`enc:${t}`), decrypt: (b) => b.toString().slice(4) },
    apiUrl: () => 'https://cloud.test',
    deviceToken: () => device,
    engine: e.engine,
    notify: (title) => notes.push(title),
    onChange: () => undefined,
    fetch: relay.fetch,
    manual: true
  })
  return { team, notes, ...e, view: () => team.view().teams[0]! }
}

const AGENT = `---
name: Invoices
role: Reads supplier invoices and files them.
team: Operations
tools: files
---
File every invoice from Brasov Logistics under clients.`

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helpers, types inferred
async function teamOfThree() {
  const relay = fakeRelay([
    { userId: 'u_ana', name: 'Ana', role: 'owner', device: 'ana' },
    { userId: 'u_bo', name: 'Bo', role: 'member', device: 'bo' },
    { userId: 'u_cy', name: 'Cy', role: 'viewer', device: 'cy' }
  ])
  const ana = laptop(relay, 'ana')
  const bo = laptop(relay, 'bo', { Invoices: AGENT })
  const cy = laptop(relay, 'cy', { Mine: AGENT.replace('Invoices', 'Mine') })
  for (const l of [ana, bo, cy]) await l.team.tick()
  // A member's laptop can't start the team: it waits for the owner's.
  await bo.team.join(TEAM)
  await bo.team.tick()
  expect(bo.view().status).toBe('joining')
  await ana.team.join(TEAM)
  await ana.team.tick()
  expect(ana.view().status).toBe('in')
  for (const l of [bo, cy]) {
    await l.team.join(TEAM)
    await l.team.tick()
    expect(l.view().status).toBe('waiting')
  }
  await ana.team.tick()
  const waiting = ana.view().waiting
  expect(waiting.map((w) => w.person).sort()).toEqual(['Bo', 'Cy'])
  // Both people compare the code: the one Ana's laptop shows is the one theirs shows.
  for (const [l, name] of [
    [bo, 'Bo'],
    [cy, 'Cy']
  ] as const) {
    const code = waiting.find((w) => w.person === name)!.code
    expect(l.view().laptops.find((x) => x.person === 'Ana')?.code).toBe(code)
    await ana.team.allow(TEAM, waiting.find((w) => w.person === name)!.id)
    await ana.team.tick()
    await l.team.tick()
    expect(l.view().confirm?.code).toBe(code)
    l.team.confirmKey(TEAM, true)
    await l.team.tick()
    expect(l.view().status).toBe('in')
  }
  return { relay, ana, bo, cy }
}

describe('a team of three', () => {
  it('shares an agent: it waits in the inbox and is added only with a click, as the team and person', async () => {
    const { relay, ana, bo, cy } = await teamOfThree()
    await bo.team.shareAgent(TEAM, 'Invoices', true)
    await bo.team.tick()
    await ana.team.tick()
    await cy.team.tick()
    for (const l of [ana, cy]) {
      expect(l.view().inbox.map((e) => [e.name, e.from])).toEqual([['Invoices', 'Bo']])
      expect(l.imported).toEqual([])
    }
    expect(await ana.team.addFromInbox(TEAM, ana.view().inbox[0]!.id)).toBeNull()
    expect(ana.imported).toEqual([{ text: AGENT, source: 'team Acme · Bo' }])
    expect(ana.view().inbox).toEqual([])
    // The sealed note for the audit log goes with Bo's next round.
    await bo.team.tick()
    expect(relay.notes).toEqual([{ by: 'Bo', action: 'item.shared' }])
    // Nothing readable passed through the relay.
    for (const sent of relay.seen.concat(relay.changes.map((c) => c.body))) {
      expect(sent).not.toContain('Brasov')
      expect(sent).not.toContain('Invoices')
    }
  })

  it('lets a viewer receive but never share or change data', async () => {
    const { relay, ana, bo, cy } = await teamOfThree()
    await cy.team.shareAgent(TEAM, 'Mine', true)
    expect(cy.view().sharedAgents).toEqual([])
    for (const l of [ana, bo, cy]) l.team.shareApp(TEAM, 'crm', true)
    cy.write('Viewer edit')
    bo.write('Brasov Logistics')
    for (const l of [cy, bo, ana, cy]) await l.team.tick()
    expect(relay.changes.map((c) => [c.kind, c.role])).toEqual([['data', 'member']])
    expect(ana.applied).toHaveLength(1)
    expect(cy.applied).toHaveLength(1)
    expect(JSON.stringify(ana.applied)).toContain('Brasov Logistics')
    expect(JSON.stringify(ana.applied)).not.toContain('Viewer edit')
  })

  it('drops a package whose sender’s role no longer allows it, and data for apps not shared here', async () => {
    const { relay, ana, bo } = await teamOfThree()
    bo.team.shareApp(TEAM, 'crm', true)
    bo.write('Sent while a member')
    await bo.team.tick()
    // Bo is made a viewer before Ana's laptop reads the package.
    relay.people.find((p) => p.name === 'Bo')!.role = 'viewer'
    ana.team.shareApp(TEAM, 'crm', true)
    await ana.team.tick()
    expect(ana.applied).toEqual([])
    // And an app this laptop doesn't share with the team gets nothing even from a member.
    relay.people.find((p) => p.name === 'Bo')!.role = 'member'
    ana.team.shareApp(TEAM, 'crm', false)
    bo.write('Another')
    await bo.team.tick()
    await ana.team.tick()
    expect(ana.applied).toEqual([])
  })

  it('seals a team’s packages to that team: another team’s key or label opens nothing', () => {
    const key = Buffer.alloc(32, 7)
    const sealed = sealPackage(
      key,
      { type: 'agent-removed', name: 'X' },
      Buffer.from('titan117-team-v1:a')
    )
    expect(openPackage(key, sealed, Buffer.from('titan117-team-v1:a'))).toEqual({
      type: 'agent-removed',
      name: 'X'
    })
    expect(openPackage(key, sealed, Buffer.from('titan117-team-v1:b'))).toBeNull()
    expect(openPackage(key, sealed)).toBeNull()
  })
})
