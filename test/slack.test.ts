// The Slack channel (decisions §64.11): the user's own app in Socket Mode,
// direct messages only, linked with a one-time code, every envelope
// acknowledged, laptop-only approvals stay on the laptop.
import { describe, expect, it } from 'vitest'

import type { RemoteCommands } from '../src/main/lib/remote-commands'
import { Slack } from '../src/main/lib/slack'
import { tempFolder } from './helpers'

const APP = 'xapp-1-' + 'A'.repeat(30)
const BOT = 'xoxb-1-' + 'B'.repeat(30)
type Ran = { type: string; source: string; [k: string]: unknown }[]

function setup(approvals: { id: string; laptopOnly: boolean }[] = []): {
  slack: Slack
  ran: Ran
  posted: Record<string, unknown>[]
  acks: string[]
  calls: { url: string; init?: RequestInit }[]
  saved: { name: string; bytes: number }[]
} {
  const calls: { url: string; init?: RequestInit }[] = []
  const saved: { name: string; bytes: number }[] = []
  const ran: Ran = []
  const posted: Record<string, unknown>[] = []
  const acks: string[] = []
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
    saveFile: async (name: string, bytes: Uint8Array) => {
      saved.push({ name, bytes: bytes.length })
      return name
    }
  } as unknown as RemoteCommands
  const slack = new Slack({
    dataDir: tempFolder(),
    keychain: { encrypt: (t) => Buffer.from(t), decrypt: (b) => b.toString() },
    commands,
    remoteOn: () => true,
    onChange: () => undefined,
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).startsWith('https://files.slack.com/')) return new Response('invoice bytes')
      const method = String(url).split('/').pop()
      if (method === 'auth.test') return Response.json({ ok: true, team: 'Bakery' })
      if (method === 'apps.connections.open')
        return Response.json({ ok: true, url: 'wss://slack.test/socket' })
      if (method === 'chat.postMessage') posted.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true })
    }) as unknown as typeof fetch,
    socket: () => ({
      send: (d: string) => acks.push(JSON.parse(d).envelope_id),
      close: () => undefined,
      onmessage: null,
      onclose: null
    })
  })
  return { slack, ran, posted, acks, calls, saved }
}

const dm = (text: string, user = 'U1', channelType = 'im'): string =>
  JSON.stringify({
    envelope_id: `e_${Math.random()}`,
    type: 'events_api',
    payload: { event: { type: 'message', channel_type: channelType, channel: 'D1', user, text } }
  })

describe('the Slack channel', () => {
  it('checks the tokens’ shape and the bot token with Slack', async () => {
    const { slack } = setup()
    expect(await slack.connect('xoxb-wrong', BOT)).toMatchObject({ ok: false })
    expect(await slack.connect(APP, 'nope')).toMatchObject({ ok: false })
    expect(await slack.connect(APP, BOT)).toEqual({ ok: true })
    slack.stop()
    expect(slack.view()).toMatchObject({ connected: true, team: 'Bakery' })
    expect(JSON.stringify(slack.view())).not.toContain(BOT)
  })

  it('acknowledges every envelope, links only with the code, and drops channels and other people', async () => {
    const { slack, ran, acks } = setup()
    await slack.connect(APP, BOT)
    await new Promise((r) => setTimeout(r, 20))
    await slack.receive(dm('hello'))
    expect(slack.view().linked).toBeNull()
    slack.startLink()
    await slack.receive(dm(slack.view().code!.code))
    expect(slack.view().linked).toEqual({ name: 'you' })
    await slack.receive(dm('delete everything', 'U1', 'channel'))
    await slack.receive(dm('delete everything', 'U2'))
    expect(ran).toEqual([])
    await slack.receive(dm('Summarise the invoices'))
    expect(ran).toEqual([{ type: 'task.start', text: 'Summarise the invoices', source: 'Slack' }])
    expect(acks).toHaveLength(5)
    slack.stop()
  })

  it('offers buttons for ordinary approvals, not for laptop-only ones, and only the linked person can press them', async () => {
    const { slack, ran, posted } = setup([
      { id: 'ap_1', laptopOnly: false },
      { id: 'ap_2', laptopOnly: true }
    ])
    await slack.connect(APP, BOT)
    slack.startLink()
    await slack.receive(dm(slack.view().code!.code))
    await slack.watch()
    await new Promise((r) => setTimeout(r, 2500))
    expect(JSON.stringify(posted)).toContain('a:ap_1:y')
    expect(JSON.stringify(posted)).not.toContain('a:ap_2:y')
    expect(posted.some((p) => String(p['text']).includes('Approve this on your laptop'))).toBe(true)
    const press = (user: string): string =>
      JSON.stringify({
        envelope_id: 'x',
        type: 'interactive',
        payload: { type: 'block_actions', user: { id: user }, actions: [{ value: 'a:ap_1:y' }] }
      })
    await slack.receive(press('U2'))
    expect(ran.filter((r) => r.type === 'approval.answer')).toEqual([])
    await slack.receive(press('U1'))
    expect(ran.filter((r) => r.type === 'approval.answer')).toEqual([
      { type: 'approval.answer', approvalId: 'ap_1', answer: 'approve', source: 'Slack' }
    ])
    slack.stop()
  })

  it('saves a file sent in the direct message, sending the bot token only to Slack’s file host (decisions §65.9)', async () => {
    const { slack, saved, calls, posted } = setup()
    await slack.connect(APP, BOT)
    slack.startLink()
    await slack.receive(dm(slack.view().code!.code))
    const withFiles = (files: unknown[], user = 'U1'): string =>
      JSON.stringify({
        envelope_id: `e_${Math.random()}`,
        type: 'events_api',
        payload: {
          event: {
            type: 'message',
            subtype: 'file_share',
            channel_type: 'im',
            channel: 'D1',
            user,
            files
          }
        }
      })
    await slack.receive(
      withFiles([
        {
          name: 'invoice.pdf',
          size: 13,
          url_private_download: 'https://files.slack.com/files-pri/T1-F1/download/invoice.pdf'
        },
        { name: 'elsewhere.pdf', size: 13, url_private: 'https://evil.example/x.pdf' },
        {
          name: 'lookalike.pdf',
          size: 13,
          url_private: 'https://files.slack.com.evil.example/x.pdf'
        },
        {
          name: 'drive.pdf',
          size: 13,
          is_external: true,
          url_private: 'https://files.slack.com/x'
        },
        { name: 'huge.mov', size: 30 * 1024 * 1024, url_private: 'https://files.slack.com/huge' }
      ])
    )
    await new Promise((r) => setTimeout(r, 2500))
    expect(saved).toEqual([{ name: 'invoice.pdf', bytes: 13 }])
    const fileCalls = calls.filter((c) => !c.url.startsWith('https://slack.com/api/'))
    expect(fileCalls.map((c) => c.url)).toEqual([
      'https://files.slack.com/files-pri/T1-F1/download/invoice.pdf'
    ])
    expect(fileCalls[0]!.init).toMatchObject({
      redirect: 'manual',
      headers: { Authorization: `Bearer ${BOT}` }
    })
    expect(JSON.stringify(posted)).toContain('isn’t on Slack’s file host')
    // Another person's file is dropped like their messages.
    await slack.receive(
      withFiles([{ name: 'theirs.pdf', size: 1, url_private: 'https://files.slack.com/y' }], 'U2')
    )
    expect(saved).toHaveLength(1)
    slack.stop()
  })
})
