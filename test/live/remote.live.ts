// Phase 15 for real (decisions §64): a task started from a paired phone runs
// on the laptop with a real model and is approved from the Telegram chat.
// Real engine, real model, real sealing and the real Telegram channel code;
// our cloud's route and Telegram's servers are fakes here, because the real
// ones need the owner's Clerk Pro two-factor and their own bot (owner checklist).
//
//   pnpm eval:remote                  (Claude Haiku 5.5 by default)
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'

import { startEngine, type Engine } from '../../src/engine/lib/engine'
import { Remote } from '../../src/main/lib/remote'
import { RemoteCommands, type EngineCall } from '../../src/main/lib/remote-commands'
import { Telegram } from '../../src/main/lib/telegram'
import {
  generateDeviceKey,
  open,
  randomId,
  seal,
  type SealHeader
} from '../../src/shared/remote-protocol'
import { call, tempFolder, until } from '../helpers'
import { fakeCloud } from '../remote-fakes'

const MODEL = `openrouter:${process.env.TITAN_EVAL_MODEL ?? 'anthropic/claude-haiku-5.5'}`

function devKey(): string | null {
  try {
    const env = readFileSync(join(__dirname, '../../.env'), 'utf8')
    return /^OPENROUTER_API_KEY=(.+)$/m.exec(env)?.[1]?.trim() || null
  } catch {
    return process.env.OPENROUTER_API_KEY ?? null
  }
}

const key = devKey()
let engine: Engine | null = null
afterAll(async () => {
  await engine?.close()
})

describe.skipIf(!key)('remote control with a real model', () => {
  it('a task from the phone runs on the laptop and is approved from the chat', async () => {
    const folder = tempFolder()
    engine = await startEngine({
      dataDir: null,
      appVersion: '0.0.0-live',
      coreDirs: [],
      allowedOrigins: ['titan117://app'],
      openRouterKey: key,
      locked: false
    })
    engine.addFolder(folder)
    await call(engine, 'PUT', '/v1/settings', { defaultModel: MODEL })
    const e = engine
    const engineCall: EngineCall = async <T>(
      method: 'GET' | 'POST',
      path: string,
      body?: unknown
    ) => {
      const res = await call(e, method, path, body)
      if (res.status !== 200) throw new Error(res.body?.message ?? 'refused')
      return res.body as T
    }

    // The laptop: remote control switched on (the second factor is the fake cloud's `enabled`).
    const cloud = fakeCloud()
    const notices: string[] = []
    let remote: Remote | null = null
    const commands = new RemoteCommands({
      engine: engineCall,
      inboxFolder: () => folder,
      notify: (t, b) => notices.push(`${t}: ${b}`),
      alertOthers: (text, except) => remote?.broadcast({ type: 'alert', text }, except)
    })
    remote = new Remote({
      dataDir: tempFolder(),
      laptopName: 'Ada’s laptop',
      keychain: { encrypt: (t) => Buffer.from(t), decrypt: (b) => b.toString() },
      apiUrl: () => 'https://cloud.test',
      webUrl: () => 'https://web.test',
      deviceToken: () => 't117d_live',
      deviceId: () => 'dev_1',
      openExternal: async () => undefined,
      commands,
      notify: (t, b) => notices.push(`${t}: ${b}`),
      onRevokedAll: () => undefined,
      onChange: () => undefined,
      fetch: cloud.fetch,
      manual: true
    })
    await remote.switchOn()
    cloud.enabled = true
    await remote.tick()
    const laptopKey = cloud.laptopKey!

    // The phone pairs; the laptop's user compares the code and allows it.
    const phone = await generateDeviceKey(false)
    remote.startPairing()
    await remote.tick()
    cloud.pairings = [{ id: 'pair_1', publicKey: phone.publicKey, name: 'Safari on iPhone' }]
    cloud.keys = [{ publicKey: phone.publicKey, name: 'Safari on iPhone', kind: 'phone' }]
    await remote.tick()
    remote.answerPairing('pair_1', true)

    // Telegram, linked to the user's private chat.
    const sent: { method: string; params: Record<string, unknown> }[] = []
    const bot = new Telegram({
      dataDir: tempFolder(),
      keychain: { encrypt: (t) => Buffer.from(t), decrypt: (b) => b.toString() },
      commands,
      remoteOn: () => remote!.view().confirmed,
      onChange: () => undefined,
      fetch: (async (url: string, init?: RequestInit) => {
        const method = String(url).split('/').pop()!
        sent.push({ method, params: init?.body ? JSON.parse(String(init.body)) : {} })
        if (method === 'getMe')
          return Response.json({ ok: true, result: { is_bot: true, username: 'ada_bot' } })
        if (method === 'getUpdates') return new Promise(() => undefined)
        return Response.json({ ok: true, result: true })
      }) as unknown as typeof fetch
    })
    await bot.connect('123456789:' + 'A'.repeat(35))
    bot.stop()
    bot.startLink()
    await bot.handle({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 7, first_name: 'Ada' },
        text: bot.view().code!.code
      }
    })

    // From the phone: a sealed task.
    const header: SealHeader = {
      v: 1,
      from: phone.publicKey,
      to: laptopKey,
      kind: 'command',
      id: randomId()
    }
    const task =
      'Create a file named supplier-note.txt in the allowed folder with one short line thanking Brasov Logistics for Thursday’s delivery. Use write_file.'
    const sealed = await seal(
      header,
      {
        v: 1,
        id: randomId(),
        sentAt: Date.now(),
        expiresAt: Date.now() + 600_000,
        command: { type: 'task.start', text: task }
      },
      phone.privateKey
    )
    cloud.toLaptop = [
      { id: 'm1', from: phone.publicKey, to: laptopKey, kind: 'command', msgId: header.id, sealed }
    ]
    await remote.tick()
    expect(notices.some((n) => n.includes('Task started from Safari on iPhone'))).toBe(true)

    // The approval appears in the chat with buttons; the user taps Approve there.
    const button = await until(async () => {
      await bot.watch()
      const msg = sent.find(
        (s) => s.method === 'sendMessage' && String(s.params['text']).startsWith('Approve?')
      )
      return msg
        ? JSON.stringify(msg.params['reply_markup']).match(/a:([A-Za-z0-9_-]+):y/)?.[1]
        : null
    }, 90_000)
    expect(existsSync(join(folder, 'supplier-note.txt'))).toBe(false)
    await bot.handle({
      update_id: 2,
      callback_query: {
        id: 'q1',
        from: { id: 7 },
        data: `a:${button}:y`,
        message: { message_id: 9, chat: { id: 42, type: 'private' } }
      }
    })
    await until(() => existsSync(join(folder, 'supplier-note.txt')), 90_000)
    const written = readFileSync(join(folder, 'supplier-note.txt'), 'utf8')
    expect(written).toMatch(/Brasov/i)

    // The phone gets the state back, sealed to it, and the laptop's record says it was answered remotely.
    await until(async () => {
      await remote!.tick()
      return cloud.fromLaptop.some((m) => m.to === phone.publicKey)
    }, 30_000)
    const opened = await Promise.all(
      cloud.fromLaptop
        .filter((m) => m.to === phone.publicKey)
        .map((m) =>
          open(
            { v: 1, from: m.from, to: m.to, kind: m.kind, id: m.msgId },
            m.sealed,
            phone.privateKey
          )
        )
    )
    expect(opened.some((o) => (o as { event?: { type: string } })?.event?.type === 'state')).toBe(
      true
    )
    expect(JSON.stringify(cloud.fromLaptop)).not.toContain('Brasov')
    const approval = e.parts.store.listApprovals({}).find((a) => a.id === button)!
    expect(approval.answeredBy).toBe('remote')
    const cost = e.parts.store.listTasks().reduce((n, t) => n + t.costUsd, 0)
    console.log(`Wrote: ${written.trim()} | cost $${cost.toFixed(4)}`)
  }, 180_000)
})
