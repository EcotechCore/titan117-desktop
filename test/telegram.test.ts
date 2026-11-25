// The Telegram channel (decisions §64.11; security.md A4; guardrails §9):
// the user's own bot, private chats only, linked with a one-time code,
// laptop-only approvals stay on the laptop, and the token never leaks.
import { describe, expect, it } from 'vitest'

import type { RemoteCommands } from '../src/main/lib/remote-commands'
import { Telegram } from '../src/main/lib/telegram'
import { tempFolder } from './helpers'

const TOKEN = '123456789:' + 'A'.repeat(35)

interface FakeBotApi {
  sent: { method: string; params: Record<string, unknown> }[]
  fetch: typeof fetch
}

function fakeBotApi(): FakeBotApi {
  const sent: { method: string; params: Record<string, unknown> }[] = []
  const api = {
    sent,
    fetch: (async (url: string, init?: RequestInit) => {
      const method = String(url).split('/').pop()!
      const params = init?.body ? JSON.parse(String(init.body)) : {}
      sent.push({ method, params })
      if (method === 'getMe')
        return Response.json({ ok: true, result: { is_bot: true, username: 'ada_titan_bot' } })
      if (method === 'getUpdates') return new Promise(() => undefined) // long poll that never answers in tests
      return Response.json({ ok: true, result: true })
    }) as unknown as typeof fetch
  }
  return api
}

type Ran = { type: string; source: string; [k: string]: unknown }[]

function fakeCommands(approvals: { id: string; laptopOnly: boolean }[] = []): {
  commands: RemoteCommands
  ran: Ran
} {
  const ran: Ran = []
  const commands = {
    run: async (c: { type: string }, source: string) => {
      ran.push({ ...c, source })
      return { ok: true, taskId: 't_1' }
    },
    state: async () => ({
      tasks: [],
      approvals: approvals.map((a) => ({
        ...a,
        taskId: 't_1',
        tool: 'write_file',
        summary: 'Write out.txt'
      }))
    }),
    task: async () => null,
    saveFile: async () => 'x'
  } as unknown as RemoteCommands
  return { commands, ran }
}

const keychain = {
  encrypt: (t: string) => Buffer.from([...t].reverse().join('')),
  decrypt: (b: Buffer) => [...b.toString()].reverse().join('')
}

async function linkedBot(
  approvals: { id: string; laptopOnly: boolean }[] = [],
  remoteOn = true
): Promise<{ bot: Telegram; api: FakeBotApi; ran: Ran }> {
  const api = fakeBotApi()
  const { commands, ran } = fakeCommands(approvals)
  const bot = new Telegram({
    dataDir: tempFolder(),
    keychain,
    commands,
    remoteOn: () => remoteOn,
    onChange: () => undefined,
    fetch: api.fetch
  })
  expect(await bot.connect(TOKEN)).toEqual({ ok: true })
  bot.stop()
  bot.startLink()
  const code = bot.view().code!.code
  await bot.handle({
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 42, type: 'private' },
      from: { id: 7, first_name: 'Ada' },
      text: `/start ${code}`
    }
  })
  expect(bot.view().linked).toEqual({ name: 'Ada' })
  return { bot, api, ran }
}

const msg = (
  text: string,
  chat = { id: 42, type: 'private' },
  from = 7
): {
  update_id: number
  message: {
    message_id: number
    chat: { id: number; type: string }
    from: { id: number }
    text: string
  }
} => ({
  update_id: 2,
  message: { message_id: 2, chat, from: { id: from }, text }
})

describe('the Telegram channel', () => {
  it('checks the token with Telegram, removes any webhook, and keeps the token only in the keychain', async () => {
    const api = fakeBotApi()
    const dir = tempFolder()
    const bot = new Telegram({
      dataDir: dir,
      keychain,
      commands: fakeCommands().commands,
      remoteOn: () => true,
      onChange: () => undefined,
      fetch: api.fetch
    })
    expect(await bot.connect('not a token')).toMatchObject({ ok: false })
    expect(await bot.connect(TOKEN)).toEqual({ ok: true })
    bot.stop()
    expect(api.sent.map((s) => s.method)).toContain('deleteWebhook')
    const { readdirSync, readFileSync } = await import('fs')
    const { join } = await import('path')
    for (const f of readdirSync(join(dir, 'channels')))
      expect(readFileSync(join(dir, 'channels', f), 'utf8')).not.toContain(TOKEN)
    expect(JSON.stringify(bot.view())).not.toContain(TOKEN)
  })

  it('links only with the right code, and ignores everyone else without answering', async () => {
    const api = fakeBotApi()
    const { commands, ran } = fakeCommands()
    const bot = new Telegram({
      dataDir: tempFolder(),
      keychain,
      commands,
      remoteOn: () => true,
      onChange: () => undefined,
      fetch: api.fetch
    })
    await bot.connect(TOKEN)
    bot.stop()
    await bot.handle(msg('123456'))
    expect(bot.view().linked).toBeNull()
    bot.startLink()
    await bot.handle(msg('000000x'))
    expect(bot.view().linked).toBeNull()
    expect(ran).toEqual([])
    expect(api.sent.filter((s) => s.method === 'sendMessage')).toEqual([])
  })

  it('drops group messages and other people, and starts tasks from the linked private chat', async () => {
    const { bot, ran } = await linkedBot()
    await bot.handle(msg('delete everything', { id: -100, type: 'group' }))
    await bot.handle(msg('delete everything', { id: -100, type: 'supergroup' }))
    await bot.handle(msg('delete everything', { id: 43, type: 'private' }, 8))
    expect(ran).toEqual([])
    await bot.handle(msg('Summarise the invoices folder'))
    expect(ran).toEqual([
      { type: 'task.start', text: 'Summarise the invoices folder', source: 'Telegram' }
    ])
  })

  it('does nothing while remote control is off', async () => {
    const { bot, ran, api } = await linkedBot([], false)
    await bot.handle(msg('Summarise the invoices folder'))
    expect(ran).toEqual([])
    expect(api.sent.at(-1)?.params['text'] ?? '').toBeDefined()
  })

  it('offers buttons for ordinary approvals and says laptop-only ones stay on the laptop', async () => {
    const { bot, api, ran } = await linkedBot([
      { id: 'ap_1', laptopOnly: false },
      { id: 'ap_2', laptopOnly: true }
    ])
    await bot.watch()
    await new Promise((r) => setTimeout(r, 2500)) // one message a second
    const texts = api.sent.filter((s) => s.method === 'sendMessage')
    const ordinary = texts.find((s) => String(s.params['text']).startsWith('Approve?'))!
    expect(JSON.stringify(ordinary.params['reply_markup'])).toContain('a:ap_1:y')
    const onlyHere = texts.find((s) =>
      String(s.params['text']).includes('Approve this on your laptop')
    )!
    expect(onlyHere.params['reply_markup']).toBeUndefined()

    // A button pressed by someone else does nothing; the owner's press answers.
    await bot.handle({
      update_id: 3,
      callback_query: {
        id: 'q1',
        from: { id: 8 },
        data: 'a:ap_1:y',
        message: { message_id: 5, chat: { id: 42, type: 'private' } }
      }
    })
    expect(ran.filter((r) => r.type === 'approval.answer')).toEqual([])
    await bot.handle({
      update_id: 4,
      callback_query: {
        id: 'q2',
        from: { id: 7 },
        data: 'a:ap_1:y',
        message: { message_id: 5, chat: { id: 42, type: 'private' } }
      }
    })
    expect(ran.filter((r) => r.type === 'approval.answer')).toEqual([
      { type: 'approval.answer', approvalId: 'ap_1', answer: 'approve', source: 'Telegram' }
    ])
    expect(api.sent.filter((s) => s.method === 'answerCallbackQuery')).toHaveLength(2)
  })

  it('unlinks, and forgets the bot', async () => {
    const { bot } = await linkedBot()
    bot.unlink()
    expect(bot.view().linked).toBeNull()
    bot.disconnect()
    expect(bot.view()).toMatchObject({ connected: false, botName: null })
  })
})
