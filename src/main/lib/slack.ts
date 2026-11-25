/**
 * Slack, a chat channel (decisions §28, §64.11; security.md A4).
 *
 * An app the user makes in their own workspace, with Socket Mode: the laptop
 * opens one WebSocket to Slack with the app-level token (`xapp-`,
 * apps.connections.open) and posts replies with the bot token (`xoxb-`), so no
 * public address is needed and nothing passes through our servers
 * (docs.slack.dev, Socket Mode, read 25 Nov 2026). Both tokens are kept
 * encrypted by the OS keychain. Slack can read these messages.
 *
 * - **Linked with a one-time code** sent to the app in a direct message; only
 *   that person's direct messages count.
 * - **Direct messages only** (`channel_type: "im"`); channels are dropped.
 * - Every Socket Mode envelope is acknowledged; about one message a second.
 */
import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { RemoteApproval } from '../../shared/remote-protocol'
import type { SlackView } from '../../shared/remote-views'
import type { RemoteCommands } from './remote-commands'

export type { SlackView }

const API = 'https://slack.com/api'
const APP_TOKEN = /^xapp-[A-Za-z0-9-]{20,200}$/
const BOT_TOKEN = /^xoxb-[A-Za-z0-9-]{20,200}$/
const CODE_TTL_MS = 10 * 60_000
export const SOURCE = 'Slack'

/** The manifest the setup card offers, for "Create an app → From a manifest". */
export const SLACK_MANIFEST = {
  display_information: { name: 'Titan117' },
  features: {
    bot_user: { display_name: 'Titan117', always_online: false },
    app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false }
  },
  oauth_config: { scopes: { bot: ['chat:write', 'im:history', 'im:read'] } },
  settings: {
    event_subscriptions: { bot_events: ['message.im'] },
    interactivity: { is_enabled: true },
    socket_mode_enabled: true
  }
}

interface Stored {
  team: string | null
  linked: { userId: string; channel: string; name: string } | null
}

interface Envelope {
  envelope_id?: string
  type: string
  payload?: {
    event?: {
      type: string
      channel_type?: string
      channel?: string
      user?: string
      text?: string
      bot_id?: string
      subtype?: string
    }
    type?: string
    user?: { id: string }
    channel?: { id: string }
    container?: { channel_id?: string; message_ts?: string }
    actions?: { value?: string }[]
  }
}

interface SocketLike {
  send(data: string): void
  close(): void
  onmessage: ((e: { data: unknown }) => void) | null
  onclose: (() => void) | null
}

export interface SlackDeps {
  dataDir: string
  keychain: { encrypt(text: string): Buffer; decrypt(data: Buffer): string } | null
  commands: RemoteCommands
  remoteOn(): boolean
  onChange(view: SlackView): void
  fetch?: typeof fetch
  socket?: (url: string) => SocketLike
  now?: () => number
}

export class Slack {
  private stored: Stored
  private tokens: { app: string; bot: string } | null = null
  private code: SlackView['code'] = null
  private problem: string | null = null
  private ws: SocketLike | null = null
  private stopped = false
  private announced = new Set<string>()
  private finished = new Set<string>()
  private queue: { channel: string; text: string; blocks?: unknown[] }[] = []
  private sending = false
  private watchTimer: NodeJS.Timeout | null = null
  private readonly dir: string
  private readonly fetch: typeof fetch
  private readonly now: () => number

  constructor(private readonly deps: SlackDeps) {
    this.dir = join(deps.dataDir, 'channels')
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
    this.stored = this.load()
    this.tokens = this.readTokens()
  }

  view(): SlackView {
    return {
      connected: this.tokens !== null,
      team: this.stored.team,
      linked: this.stored.linked ? { name: this.stored.linked.name } : null,
      code: this.code && this.code.expiresAt > this.now() ? this.code : null,
      problem: this.problem,
      manifest: JSON.stringify(SLACK_MANIFEST, null, 2)
    }
  }

  start(): void {
    this.stopped = false
    if (this.tokens) void this.open()
    if (!this.watchTimer) {
      this.watchTimer = setInterval(() => void this.watch(), 3000)
      this.watchTimer.unref?.()
    }
  }

  stop(): void {
    this.stopped = true
    this.ws?.close()
    this.ws = null
    if (this.watchTimer) clearInterval(this.watchTimer)
    this.watchTimer = null
  }

  /** Checks the bot token (auth.test) and keeps both tokens in the keychain. */
  async connect(
    app: unknown,
    bot: unknown
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (typeof app !== 'string' || !APP_TOKEN.test(app.trim()))
      return {
        ok: false,
        message: 'The app-level token starts with xapp- (Basic Information → App-Level Tokens).'
      }
    if (typeof bot !== 'string' || !BOT_TOKEN.test(bot.trim()))
      return {
        ok: false,
        message:
          'The bot token starts with xoxb- (OAuth & Permissions, after installing to your workspace).'
      }
    if (!this.deps.keychain)
      return { ok: false, message: 'This laptop has no keychain to keep the tokens safe.' }
    const tokens = { app: app.trim(), bot: bot.trim() }
    const auth = await this.call<{ team?: string }>('auth.test', {}, tokens.bot).catch(() => null)
    if (!auth) return { ok: false, message: 'Slack didn’t accept the bot token. Copy it again.' }
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(
      join(this.dir, 'slack-tokens.bin'),
      this.deps.keychain.encrypt(JSON.stringify(tokens))
    )
    this.tokens = tokens
    this.stored = { team: auth.team ?? null, linked: null }
    this.save()
    this.problem = null
    this.changed()
    this.start()
    return { ok: true }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
    rmSync(join(this.dir, 'slack-tokens.bin'), { force: true })
    this.tokens = null
    this.stored = { team: null, linked: null }
    this.code = null
    this.save()
    this.changed()
  }

  startLink(): void {
    this.code = {
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      expiresAt: this.now() + CODE_TTL_MS
    }
    this.changed()
  }

  unlink(): void {
    this.stored.linked = null
    this.code = null
    this.save()
    this.changed()
  }

  announce(text: string): void {
    if (this.stored.linked && this.tokens && this.deps.remoteOn())
      this.say(this.stored.linked.channel, text)
  }

  // ---------------------------------------------------------------- the socket

  private async open(): Promise<void> {
    if (this.ws || !this.tokens || this.stopped) return
    try {
      const { url } = await this.call<{ url: string }>('apps.connections.open', {}, this.tokens.app)
      if (!/^wss:\/\//.test(url)) throw new Error('No socket.')
      const ws = this.deps.socket
        ? this.deps.socket(url)
        : (new WebSocket(url) as unknown as SocketLike)
      this.ws = ws
      ws.onmessage = (e) => void this.receive(String(e.data)).catch(() => undefined)
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null
        if (!this.stopped) setTimeout(() => void this.open(), 5000).unref?.()
      }
      if (this.problem) {
        this.problem = null
        this.changed()
      }
    } catch {
      this.problem = 'Can’t reach Slack right now; trying again.'
      this.changed()
      if (!this.stopped) setTimeout(() => void this.open(), 15_000).unref?.()
    }
  }

  /** One Socket Mode envelope. Exposed for tests. */
  async receive(raw: string): Promise<void> {
    let env: Envelope
    try {
      env = JSON.parse(raw) as Envelope
    } catch {
      return
    }
    // Every envelope is acknowledged, or Slack sends it again.
    if (env.envelope_id) this.ws?.send(JSON.stringify({ envelope_id: env.envelope_id }))
    if (env.type === 'disconnect') return this.ws?.close()
    if (env.type === 'events_api' && env.payload?.event) return this.message(env.payload.event)
    if (env.type === 'interactive' && env.payload?.type === 'block_actions')
      return this.button(env.payload)
  }

  private async message(ev: NonNullable<NonNullable<Envelope['payload']>['event']>): Promise<void> {
    // Direct messages from a person only.
    if (
      ev.type !== 'message' ||
      ev.channel_type !== 'im' ||
      ev.bot_id ||
      ev.subtype ||
      !ev.user ||
      !ev.channel
    )
      return
    const linked = this.stored.linked
    const text = (ev.text ?? '').trim()
    if (!linked || linked.userId !== ev.user) {
      if (!linked && this.code && this.code.expiresAt > this.now() && text === this.code.code) {
        this.stored.linked = { userId: ev.user, channel: ev.channel, name: 'you' }
        this.code = null
        this.save()
        this.changed()
        this.say(
          ev.channel,
          'Linked to Titan117 on your laptop. Write what you need. Messages here are visible to Slack.'
        )
      }
      return
    }
    if (!this.deps.remoteOn())
      return this.say(ev.channel, 'Remote control is switched off on the laptop.')
    if (!text) return
    if (text === 'tasks') {
      const { tasks } = await this.deps.commands.state()
      return this.say(
        ev.channel,
        tasks.length
          ? tasks
              .slice(0, 10)
              .map((t, i) => `${i + 1}. ${t.title} (${t.status})`)
              .join('\n')
          : 'No tasks yet.'
      )
    }
    const r = await this.deps.commands.run(
      { type: 'task.start', text: text.slice(0, 20_000) },
      SOURCE
    )
    this.say(
      ev.channel,
      r.ok
        ? 'Started on your laptop. I’ll write here when it needs you or when it’s done.'
        : r.error
    )
  }

  private async button(p: NonNullable<Envelope['payload']>): Promise<void> {
    const linked = this.stored.linked
    const value = p.actions?.[0]?.value ?? ''
    const match = value.match(/^a:([A-Za-z0-9_-]{1,80}):(y|n)$/)
    if (!linked || p.user?.id !== linked.userId || !match || !this.deps.remoteOn()) return
    const r = await this.deps.commands.run(
      {
        type: 'approval.answer',
        approvalId: match[1]!,
        answer: match[2] === 'y' ? 'approve' : 'deny'
      },
      SOURCE
    )
    this.say(linked.channel, r.ok ? (match[2] === 'y' ? 'Approved.' : 'Denied.') : r.error)
  }

  async watch(): Promise<void> {
    const linked = this.stored.linked
    if (!linked || !this.tokens || !this.deps.remoteOn()) return
    const state = await this.deps.commands.state().catch(() => null)
    if (!state) return
    for (const a of state.approvals) {
      if (this.announced.has(a.id)) continue
      this.announced.add(a.id)
      this.approval(linked.channel, a)
    }
    for (const t of state.tasks) {
      if (t.startedFrom !== SOURCE || this.finished.has(t.id)) continue
      if (!['done', 'stopped', 'error'].includes(t.status)) continue
      this.finished.add(t.id)
      const detail = await this.deps.commands.task(t.id).catch(() => null)
      const result = detail?.result ?? t.lastLine ?? ''
      this.say(
        linked.channel,
        `${t.status === 'done' ? 'Done' : 'Stopped'}: ${t.title}${result ? `\n\n${result}` : ''}`
      )
    }
  }

  private approval(channel: string, a: RemoteApproval): void {
    if (a.laptopOnly)
      return this.say(
        channel,
        `Needs you on the laptop: ${a.summary}\nApprove this on your laptop.`
      )
    this.say(channel, `Approve? ${a.summary}`, [
      {
        type: 'section',
        text: { type: 'plain_text', text: `Approve? ${a.summary}`.slice(0, 2900) }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            value: `a:${a.id}:y`
          },
          { type: 'button', text: { type: 'plain_text', text: 'Deny' }, value: `a:${a.id}:n` }
        ]
      }
    ])
  }

  private say(channel: string, text: string, blocks?: unknown[]): void {
    this.queue.push({ channel, text: text.slice(0, 3900), ...(blocks ? { blocks } : {}) })
    void this.drain()
  }

  /** About one message a second per channel (chat.postMessage). */
  private async drain(): Promise<void> {
    if (this.sending || !this.tokens) return
    this.sending = true
    try {
      while (this.queue.length && this.tokens) {
        const m = this.queue.shift()!
        await this.call('chat.postMessage', m, this.tokens.bot).catch(() => undefined)
        if (this.queue.length) await new Promise((r) => setTimeout(r, 1100))
      }
    } finally {
      this.sending = false
    }
  }

  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    token: string
  ): Promise<T> {
    const res = await this.fetch(`${API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(20_000)
    })
    const body = (await res.json().catch(() => null)) as ({ ok?: boolean } & T) | null
    if (!res.ok || !body?.ok) throw new Error(`Slack refused ${method}.`)
    return body
  }

  private readTokens(): { app: string; bot: string } | null {
    const file = join(this.dir, 'slack-tokens.bin')
    if (!this.deps.keychain || !existsSync(file)) return null
    try {
      const t = JSON.parse(this.deps.keychain.decrypt(readFileSync(file))) as {
        app: string
        bot: string
      }
      return APP_TOKEN.test(t.app) && BOT_TOKEN.test(t.bot) ? t : null
    } catch {
      return null
    }
  }

  private load(): Stored {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'slack.json'), 'utf8')) as Partial<Stored>
      return {
        team: typeof raw.team === 'string' ? raw.team : null,
        linked:
          raw.linked &&
          typeof raw.linked.userId === 'string' &&
          typeof raw.linked.channel === 'string'
            ? {
                userId: raw.linked.userId,
                channel: raw.linked.channel,
                name: String(raw.linked.name ?? 'you')
              }
            : null
      }
    } catch {
      return { team: null, linked: null }
    }
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, 'slack.json'), JSON.stringify(this.stored))
  }

  private changed(): void {
    this.deps.onChange(this.view())
  }
}
