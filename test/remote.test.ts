// Remote control on the laptop (decisions §64; guardrails §9): the command
// runner against a real engine, the remote bridge against a fake of our
// cloud's /desktop/remote route, and the cross-repo sealing test vectors.
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import type { Engine } from '../src/engine/lib/engine'
import { Remote } from '../src/main/lib/remote'
import { RemoteCommands, type EngineCall } from '../src/main/lib/remote-commands'
import {
  generateDeviceKey,
  importPrivateKey,
  open,
  pairingCode,
  publicKeyOf,
  randomId,
  seal,
  type SealHeader
} from '../src/shared/remote-protocol'
import { call, MODEL, scripted, tempFolder, testEngine, until } from './helpers'
import { fakeCloud, type CloudMessage, type FakeCloud } from './remote-fakes'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

const fill = (n: number): Uint8Array => new Uint8Array(32).fill(n)

describe('the sealing protocol', () => {
  // The same numbers as titan117-web packages/shared/src/remote.test.ts.
  it('matches the web repo’s test vector', async () => {
    const laptop = await importPrivateKey(fill(1))
    const phone = await importPrivateKey(fill(2))
    const L = await publicKeyOf(fill(1))
    const P = await publicKeyOf(fill(2))
    expect(L).toBe('pOCSkrZRwni5dyxWn1-puxPZBrRqtoyd-dwrRAn4ogk')
    expect(P).toBe('zo060cy2M-x7cMF4FKXHbs0CloUFDTRHRboFhw5YfVk')
    expect(await pairingCode(L, P)).toBe('8YN-2Y5')
    const header: SealHeader = { v: 1, from: P, to: L, kind: 'command', id: 'vector-1' }
    const payload = { v: 1, id: 'c1', sentAt: 1, expiresAt: 2, command: { type: 'task.list' } }
    const sealed = await seal(header, payload, phone, {
      ephemeral: await importPrivateKey(fill(3)),
      ephemeralPublic: await publicKeyOf(fill(3)),
      iv: new Uint8Array(12).fill(4)
    })
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sealed))
    )
    expect([...digest].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(
      'ed76ed31a0962b5fae44833fd54b80a133abb9f62c686e9cb533168e61c95132'
    )
    expect(await open(header, sealed, laptop)).toEqual(payload)
  })
})

function engineCall(e: Engine): EngineCall {
  return async <T>(method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await call(e, method, path, body)
    if (res.status !== 200) throw new Error(res.body?.message ?? 'refused')
    return res.body as T
  }
}

describe('remote commands on the engine', () => {
  it('a task started remotely asks like a local one and can be approved remotely', async () => {
    const folder = tempFolder()
    const or = scripted([
      {
        toolCalls: [{ name: 'write_file', input: { path: 'out.txt', content: 'from the phone' } }]
      },
      { text: 'Done. I wrote out.txt.' }
    ])
    engine = await testEngine({ fetch: or.fetch, folder })
    await call(engine, 'PUT', '/v1/settings', { defaultModel: MODEL })
    const alerts: string[] = []
    const commands = new RemoteCommands({
      engine: engineCall(engine),
      inboxFolder: () => null,
      notify: (title, body) => alerts.push(`${title}: ${body}`),
      alertOthers: () => undefined
    })
    const started = await commands.run({ type: 'task.start', text: 'write it' }, 'Telegram')
    expect(started.ok).toBe(true)
    const taskId = started.ok ? started.taskId! : ''
    expect(alerts[0]).toMatch(/started from Telegram/)

    const state = await until(async () => {
      const s = await commands.state()
      return s.approvals.length ? s : null
    })
    expect(state.approvals[0]).toMatchObject({ tool: 'write_file', laptopOnly: false })
    expect(state.tasks[0]).toMatchObject({ id: taskId, startedFrom: 'Telegram' })
    expect(existsSync(join(folder, 'out.txt'))).toBe(false)

    const answered = await commands.run(
      { type: 'approval.answer', approvalId: state.approvals[0]!.id, answer: 'approve' },
      'Telegram'
    )
    expect(answered.ok).toBe(true)
    await until(
      () =>
        existsSync(join(folder, 'out.txt')) &&
        readFileSync(join(folder, 'out.txt'), 'utf8') === 'from the phone'
    )
    const detail = await until(async () => {
      const d = await commands.task(taskId)
      return d.task.status === 'done' ? d : null
    })
    expect(detail.result).toMatch(/I wrote out.txt/)
    const approval = engine.parts.store.listApprovals({ taskId })[0]!
    expect(approval.answeredBy).toBe('remote')
  })

  it('a laptop-only approval is shown as such and refused remotely', async () => {
    const or = scripted([
      {
        toolCalls: [
          {
            name: 'agent_create',
            input: {
              name: 'Supplier chaser',
              role: 'Writes polite reminders to suppliers about late deliveries.',
              team: 'Operations',
              tools: ['files', 'memory', 'artifacts'],
              instructions: 'Be polite and short.',
              skills: []
            }
          }
        ]
      },
      { text: 'ok' }
    ])
    engine = await testEngine({ fetch: or.fetch })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'make an agent',
      model: MODEL
    })
    const remote = await until(async () => {
      const r = (await call(engine!, 'GET', '/v1/remote')).body
      return r.approvals.length ? r : null
    })
    expect(remote.approvals[0]).toMatchObject({ taskId: body.task.id, laptopOnly: true })
    const refused = await call(engine, 'POST', `/v1/remote-approvals/${remote.approvals[0].id}`, {
      answer: 'approve'
    })
    expect(refused.status).toBe(403)
    expect(refused.body.message).toMatch(/laptop/)
    // "always" is never accepted remotely, even for an ordinary approval.
    const always = await call(engine, 'POST', `/v1/remote-approvals/${remote.approvals[0].id}`, {
      answer: 'always'
    })
    expect(always.status).toBe(400)
    // Making an agent never gets a second-factor answer, whatever is switched on (decisions §65.7).
    expect(remote.approvals[0].secondFactor).toBe(false)
    expect(
      (await call(engine, 'PUT', '/v1/remote-settings', { secondFactor: ['everything'] })).status
    ).toBe(400)
    const on = await call(engine, 'PUT', '/v1/remote-settings', {
      secondFactor: ['external', 'commands']
    })
    expect(on.body).toEqual({ secondFactor: ['external', 'commands'] })
    const withFactor = await call(
      engine,
      'POST',
      `/v1/remote-approvals/${remote.approvals[0].id}`,
      {
        answer: 'approve',
        secondFactor: true
      }
    )
    expect(withFactor.status).toBe(403)
    expect((await call(engine, 'GET', '/v1/remote')).body.approvals[0].secondFactor).toBe(false)
    expect(engine.parts.agents.get('Supplier chaser')).toBeNull()
  })

  it('saves a sent file only inside an allowed inbox folder, never over another file', async () => {
    const folder = tempFolder()
    engine = await testEngine({ folder })
    let inbox: string | null = null
    const commands = new RemoteCommands({
      engine: engineCall(engine),
      inboxFolder: () => inbox,
      notify: () => undefined,
      alertOthers: () => undefined
    })
    const add = { type: 'file.add' as const, name: '../../evil.txt', data: btoa('hello') }
    expect(await commands.run(add, 'Phone')).toMatchObject({ ok: false })
    inbox = tempFolder() // not an allowed folder
    expect(await commands.run(add, 'Phone')).toMatchObject({ ok: false })
    inbox = folder
    expect(await commands.run(add, 'Phone')).toMatchObject({ ok: true, text: 'Saved as evil.txt' })
    expect(await commands.run(add, 'Phone')).toMatchObject({
      ok: true,
      text: 'Saved as evil (2).txt'
    })
    expect(readFileSync(join(folder, 'evil.txt'), 'utf8')).toBe('hello')
  })
})

// ------------------------------------------------------------------ the bridge

function bridge(
  cloud: FakeCloud,
  commands: RemoteCommands,
  extra: {
    revoked?: () => void
    checkProof?: (proof: string, key: string, approval: string) => boolean
  } = {}
): Remote {
  const dir = tempFolder()
  const keychain = {
    encrypt: (t: string) => Buffer.from(`enc:${t}`),
    decrypt: (b: Buffer) => b.toString().slice(4)
  }
  return new Remote({
    dataDir: dir,
    laptopName: 'Ada’s laptop',
    keychain,
    apiUrl: () => 'https://cloud.test',
    webUrl: () => 'https://web.test',
    deviceToken: () => 't117d_x',
    deviceId: () => 'dev_1',
    openExternal: async () => undefined,
    commands,
    notify: () => undefined,
    onRevokedAll: extra.revoked ?? (() => undefined),
    checkProof: extra.checkProof ?? (() => false),
    onChange: () => undefined,
    fetch: cloud.fetch,
    manual: true
  })
}

const approvals: {
  id: string
  taskId: string
  tool: string
  summary: string
  laptopOnly: boolean
}[] = []

function fakeCommands(): { commands: RemoteCommands; ran: string[] } {
  approvals.length = 0
  const ran: string[] = []
  const commands = {
    run: async (
      c: { type: string; text?: string },
      source: string,
      checked: { secondFactor?: boolean } = {}
    ) => {
      ran.push(`${source}:${c.type}:${c.text ?? ''}${checked.secondFactor ? ':second-factor' : ''}`)
      return { ok: true, taskId: 't_1' }
    },
    state: async () => ({ tasks: [], approvals: [...approvals] }),
    task: async () => ({
      task: {
        id: 't_1',
        title: 'x',
        status: 'running',
        agent: null,
        updatedAt: 1,
        startedFrom: null,
        lastLine: null
      },
      steps: [],
      result: null,
      approvals: []
    })
  } as unknown as RemoteCommands
  return { commands, ran }
}

async function command(
  from: { privateKey: CryptoKey; publicKey: string },
  to: string,
  cmd: object,
  id = randomId(),
  expiresAt = Date.now() + 60_000
): Promise<CloudMessage> {
  const header: SealHeader = { v: 1, from: from.publicKey, to, kind: 'command', id: randomId() }
  const sealed = await seal(
    header,
    { v: 1, id, sentAt: Date.now(), expiresAt, command: cmd },
    from.privateKey
  )
  return {
    id: randomId(),
    from: from.publicKey,
    to,
    kind: 'command' as const,
    msgId: header.id,
    sealed
  }
}

describe('the remote bridge', () => {
  it('is off by default and never calls our cloud', async () => {
    const cloud = fakeCloud()
    const { commands, ran } = fakeCommands()
    const remote = bridge(cloud, commands)
    await remote.tick()
    expect(cloud.calls).toBe(0)
    expect(remote.view()).toMatchObject({ on: false, confirmed: false })
    expect(ran).toEqual([])
  })

  it('runs commands only after the laptop confirmed the pairing, once, before they expire', async () => {
    const cloud = fakeCloud()
    const { commands, ran } = fakeCommands()
    const remote = bridge(cloud, commands)
    await remote.switchOn()
    await remote.tick()
    expect(remote.view().confirmed).toBe(false)
    cloud.enabled = true // the second factor was given on the web
    await remote.tick()
    expect(remote.view().confirmed).toBe(true)
    const laptopKey = cloud.laptopKey!

    // A browser claims a pairing; it isn't trusted until Allow.
    const phone = await generateDeviceKey(false)
    remote.startPairing()
    await remote.tick()
    expect(remote.view().pairing?.link).toMatch(/^https:\/\/web\.test\/remote\/pair#p=pair_1&k=/)
    cloud.pairings = [{ id: 'pair_1', publicKey: phone.publicKey, name: 'Chrome on Windows' }]
    cloud.keys = [{ publicKey: phone.publicKey, name: 'Chrome on Windows', kind: 'browser' }]
    cloud.toLaptop = [await command(phone, laptopKey, { type: 'task.start', text: 'too early' })]
    await remote.tick()
    expect(ran).toEqual([])
    const waiting = remote.view().waiting[0]!
    expect(waiting.code).toBe(await pairingCode(laptopKey, phone.publicKey))

    remote.answerPairing(waiting.pairingId, true)
    const replayId = randomId()
    cloud.toLaptop = [
      await command(phone, laptopKey, { type: 'task.start', text: 'summarise my week' }, replayId),
      await command(phone, laptopKey, { type: 'task.start', text: 'again' }, replayId),
      await command(
        phone,
        laptopKey,
        { type: 'task.start', text: 'late' },
        randomId(),
        Date.now() - 1
      ),
      await command(phone, laptopKey, { type: 'shell.run', text: 'dir' })
    ]
    await remote.tick()
    expect(cloud.answers).toEqual([{ pairingId: 'pair_1', accept: true }])
    expect(ran).toEqual(['Chrome on Windows:task.start:summarise my week'])

    // Replies are sealed to the phone and open only with its key.
    await remote.tick()
    const toPhone = cloud.fromLaptop.filter((m) => m.to === phone.publicKey)
    expect(toPhone.length).toBeGreaterThan(0)
    const opened = await Promise.all(
      toPhone.map((m) =>
        open(
          { v: 1, from: m.from, to: m.to, kind: m.kind, id: m.msgId },
          m.sealed,
          phone.privateKey
        )
      )
    )
    expect(opened.map((o) => (o as { event: { type: string } }).event.type)).toContain('done')
    expect(JSON.stringify(cloud.fromLaptop)).not.toContain('summarise')
    // A new approval on the laptop wakes the phone; the same state again doesn't.
    approvals.push({
      id: 'ap_1',
      taskId: 't_1',
      tool: 'write_file',
      summary: 'Write a file',
      laptopOnly: false
    })
    await remote.tick()
    expect(cloud.fromLaptop.filter((m) => m.notify)).toHaveLength(1)
    await remote.tick()
    expect(cloud.fromLaptop.filter((m) => m.notify)).toHaveLength(1)
  })

  it('removing a device rotates the key, announced under the old one; Revoke all unlinks chats', async () => {
    const cloud = fakeCloud()
    const { commands } = fakeCommands()
    let revoked = 0
    const remote = bridge(cloud, commands, { revoked: () => revoked++ })
    await remote.switchOn()
    cloud.enabled = true
    await remote.tick()
    const oldKey = cloud.laptopKey!
    const a = await generateDeviceKey(false)
    const b = await generateDeviceKey(false)
    for (const [i, d] of [a, b].entries()) {
      cloud.pairings = [{ id: `p${i}`, publicKey: d.publicKey, name: `Device ${i}` }]
      cloud.keys.push({ publicKey: d.publicKey, name: `Device ${i}`, kind: 'browser' })
      await remote.tick()
      remote.answerPairing(`p${i}`, true)
    }
    cloud.pairings = []
    await remote.tick()

    remote.removeDevice(a.publicKey)
    cloud.keys = cloud.keys.filter((k) => k.publicKey !== a.publicKey)
    await new Promise((r) => setTimeout(r, 50))
    await remote.tick()
    expect(cloud.revoked).toEqual([a.publicKey])
    const keyMsg = cloud.fromLaptop.find((m) => m.kind === 'key')!
    expect(keyMsg.to).toBe(b.publicKey)
    const announced = (await open(
      { v: 1, from: oldKey, to: b.publicKey, kind: 'key', id: keyMsg.msgId },
      keyMsg.sealed,
      b.privateKey
    )) as { newKey: string }
    await remote.tick()
    expect(cloud.laptopKey).toBe(announced.newKey)
    expect(cloud.laptopKey).not.toBe(oldKey)

    cloud.revokedAllAt = Date.now()
    await remote.tick()
    expect(remote.view().devices).toEqual([])
    expect(revoked).toBe(1)
  })

  it('passes a laptop-only answer on only when its second-factor proof checks out (decisions §65.7)', async () => {
    const cloud = fakeCloud()
    const { commands, ran } = fakeCommands()
    const checked: string[] = []
    const remote = bridge(cloud, commands, {
      checkProof: (proof, key, approval) => {
        checked.push(`${approval}:${key.slice(0, 4)}`)
        return proof.startsWith('good')
      }
    })
    await remote.switchOn()
    cloud.enabled = true
    await remote.tick()
    const laptopKey = cloud.laptopKey!
    const phone = await generateDeviceKey(false)
    remote.startPairing()
    await remote.tick()
    cloud.pairings = [{ id: 'pair_1', publicKey: phone.publicKey, name: 'Phone' }]
    cloud.keys = [{ publicKey: phone.publicKey, name: 'Phone', kind: 'phone' }]
    await remote.tick()
    remote.answerPairing(remote.view().waiting[0]!.pairingId, true)
    const proof = (start: string): string => `${start}${'a'.repeat(40)}.${'b'.repeat(86)}`
    cloud.toLaptop = [
      await command(phone, laptopKey, {
        type: 'approval.answer',
        approvalId: 'ap_1',
        answer: 'approve',
        proof: proof('bad')
      }),
      await command(phone, laptopKey, {
        type: 'approval.answer',
        approvalId: 'ap_2',
        answer: 'approve',
        proof: proof('good')
      }),
      await command(phone, laptopKey, {
        type: 'approval.answer',
        approvalId: 'ap_3',
        answer: 'approve'
      })
    ]
    await remote.tick()
    expect(checked).toEqual([
      `ap_1:${phone.publicKey.slice(0, 4)}`,
      `ap_2:${phone.publicKey.slice(0, 4)}`
    ])
    expect(ran).toEqual(['Phone:approval.answer::second-factor', 'Phone:approval.answer:'])
  })

  it('switching off stops everything and tells our cloud', async () => {
    const cloud = fakeCloud()
    const { commands, ran } = fakeCommands()
    const remote = bridge(cloud, commands)
    await remote.switchOn()
    cloud.enabled = true
    await remote.tick()
    remote.switchOff()
    await remote.tick()
    expect(cloud.enabled).toBe(false)
    const calls = cloud.calls
    await remote.tick()
    expect(cloud.calls).toBe(calls)
    expect(ran).toEqual([])
  })
})

describe('the phone’s share sheet', () => {
  it('gives a due post’s text with its tags and link, and the pictures that fit', async () => {
    const folder = tempFolder()
    const { writeFileSync } = await import('fs')
    writeFileSync(join(folder, 'small.png'), Buffer.alloc(2000, 1))
    writeFileSync(join(folder, 'big.png'), Buffer.alloc(600 * 1024, 1))
    engine = await testEngine({ folder })
    const saved = await call(engine, 'POST', '/v1/marketing/post', {
      post: {
        platform: 'linkedin',
        date: '2020-01-02',
        time: '09:00',
        text: 'Fresh sourdough every morning',
        hashtags: ['bakery'],
        link: 'https://bakery.test/',
        media: [join(folder, 'small.png'), join(folder, 'big.png')],
        status: 'ready'
      }
    })
    expect(saved.status).toBe(200)
    const { posts } = (await call(engine, 'GET', '/v1/remote-share')).body
    expect(posts).toHaveLength(1)
    expect(posts[0].platform).toBe('LinkedIn')
    expect(posts[0].text).toMatch(
      /Fresh sourdough every morning\n\n#bakery\n\nhttps:\/\/bakery\.test\/\?utm_source=linkedin/
    )
    expect(posts[0].files.map((f: { name: string }) => f.name)).toEqual(['small.png'])
    expect(posts[0].left).toEqual(['big.png'])
  })
})
