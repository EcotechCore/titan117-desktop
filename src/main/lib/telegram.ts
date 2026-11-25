/**
 * Telegram, the first chat channel (decisions §28, §64.11; security.md A4).
 *
 * The user's own bot, made with BotFather; its token is kept encrypted by the
 * OS keychain and the laptop talks to api.telegram.org directly by long
 * polling (`getUpdates`), so nothing passes through our servers and no public
 * address is needed. Telegram can read these messages: they are not end to
 * end, and the setup card says so.
 *
 * - **Linked with a one-time code:** the laptop shows six digits; the user
 *   sends them to the bot in a private chat. Only that chat and that person
 *   count; everything else is dropped without an answer.
 * - **Private chats only:** group, supergroup and channel updates are dropped.
 * - **Same commands as the web** (remote-commands.ts): text starts a task,
 *   /tasks lists, buttons answer approvals; laptop-only approvals say so.
 * - Messages up to 4,096 characters, about one a second (Telegram's limits).
 */
import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { RemoteApproval } from '../../shared/remote-protocol'
import type { TelegramView } from '../../shared/remote-views'
import { CHANNEL_MAX_FILE_BYTES, type RemoteCommands } from './remote-commands'

const API = 'https://api.telegram.org'
const TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/
const CODE_TTL_MS = 10 * 60_000
const WATCH_MS = 3_000
const MAX_TEXT = 4000
export const SOURCE = 'Telegram'

export type { TelegramView }

interface Stored {
  botName: string | null
  linked: { chatId: number; userId: number; name: string } | null
  offset: number
}

interface Update {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number; type: string }
    from?: { id: number; first_name?: string; is_bot?: boolean }
    text?: string
    caption?: string
    document?: { file_id: string; file_name?: string; file_size?: number }
  }
  callback_query?: {
    id: string
    from: { id: number }
    data?: string
    message?: { message_id: number; chat: { id: number; type: string } }
  }
}

export interface TelegramDeps {
  dataDir: string
  keychain: { encrypt(text: string): Buffer; decrypt(data: Buffer): string } | null
  commands: RemoteCommands
  /** Remote control is on and confirmed: chat works only then, like every remote way in. */
  remoteOn(): boolean
  onChange(view: TelegramView): void
  fetch?: typeof fetch
  now?: () => number
}

export class Telegram {
  private stored: Stored
  private token: string | null = null
  private code: TelegramView['code'] = null
  private problem: string | null = null
  private polling = false
  private stopped = false
  private announced = new Set<string>()
  private finished = new Set<string>()
  private queue: { chatId: number; text: string; buttons?: { text: string; data: string }[][] }[] =
    []
  private sending = false
  private watchTimer: NodeJS.Timeout | null = null
  private readonly dir: string
  private readonly fetch: typeof fetch
  private readonly now: () => number

  constructor(private readonly deps: TelegramDeps) {
    this.dir = join(deps.dataDir, 'channels')
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
    this.stored = this.load()
    this.token = this.readToken()
  }

  view(): TelegramView {
    return {
      connected: this.token !== null,
      botName: this.stored.botName,
      linked: this.stored.linked ? { name: this.stored.linked.name } : null,
      code: this.code && this.code.expiresAt > this.now() ? this.code : null,
      problem: this.problem
    }
  }

  start(): void {
    this.stopped = false
    if (this.token) void this.poll()
    if (!this.watchTimer) {
      this.watchTimer = setInterval(() => void this.watch(), WATCH_MS)
      this.watchTimer.unref?.()
    }
  }

  stop(): void {
    this.stopped = true
    if (this.watchTimer) clearInterval(this.watchTimer)
    this.watchTimer = null
  }

  /** Check the bot's token with Telegram (getMe) and keep it in the keychain. */
  async connect(token: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
    if (typeof token !== 'string' || !TOKEN.test(token.trim()))
      return {
        ok: false,
        message:
          'That doesn’t look like a bot token from BotFather (numbers, a colon, then letters).'
      }
    if (!this.deps.keychain)
      return { ok: false, message: 'This laptop has no keychain to keep the token safe.' }
    const clean = token.trim()
    const me = await this.call<{ username?: string; is_bot?: boolean }>('getMe', {}, clean).catch(
      () => null
    )
    if (!me?.is_bot)
      return {
        ok: false,
        message: 'Telegram didn’t accept that token. Copy it again from BotFather.'
      }
    // Long polling and a webhook can't be used together (core.telegram.org/bots/api).
    await this.call('deleteWebhook', { drop_pending_updates: false }, clean).catch(() => null)
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, 'telegram-token.bin'), this.deps.keychain.encrypt(clean))
    this.token = clean
    this.stored = { botName: me.username ?? null, linked: null, offset: 0 }
    this.save()
    this.problem = null
    this.changed()
    this.start()
    return { ok: true }
  }

  /** Forget the bot: the token leaves the keychain and the chat is unlinked. */
  disconnect(): void {
    rmSync(join(this.dir, 'telegram-token.bin'), { force: true })
    this.token = null
    this.stored = { botName: null, linked: null, offset: 0 }
    this.code = null
    this.save()
    this.changed()
  }

  /** Six digits to send to the bot, valid ten minutes. */
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

  // ---------------------------------------------------------------- receiving

  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      while (!this.stopped && this.token) {
        try {
          const updates = await this.call<Update[]>('getUpdates', {
            offset: this.stored.offset,
            timeout: 25,
            allowed_updates: ['message', 'callback_query']
          })
          for (const u of updates) {
            this.stored.offset = u.update_id + 1
            await this.handle(u).catch(() => undefined)
          }
          if (updates.length) this.save()
          if (this.problem) {
            this.problem = null
            this.changed()
          }
        } catch (error) {
          this.problem =
            error instanceof TelegramError && error.status === 401
              ? 'Telegram refused the bot’s token. Connect the bot again.'
              : 'Can’t reach Telegram right now; trying again.'
          this.changed()
          await new Promise((r) => setTimeout(r, 10_000))
        }
      }
    } finally {
      this.polling = false
    }
  }

  /** One update. Exposed for tests. */
  async handle(u: Update): Promise<void> {
    if (u.callback_query) return this.button(u.callback_query)
    const m = u.message
    // Private chats only (guardrails §9): groups, supergroups and channels are dropped.
    if (!m || m.chat.type !== 'private' || !m.from || m.from.is_bot) return
    const linked = this.stored.linked
    if (!linked || linked.userId !== m.from.id || linked.chatId !== m.chat.id) {
      // Not linked: only the right code, sent while it's valid, links this chat. Nothing else gets an answer.
      const text = (m.text ?? '').replace(/^\/start\s*/, '').trim()
      if (!linked && this.code && this.code.expiresAt > this.now() && text === this.code.code) {
        this.stored.linked = {
          chatId: m.chat.id,
          userId: m.from.id,
          name: (m.from.first_name ?? 'you').slice(0, 40)
        }
        this.code = null
        this.save()
        this.changed()
        this.say(
          m.chat.id,
          'Linked to Titan117 on your laptop. Write what you need and the laptop does it while it’s on. Messages here are visible to Telegram.'
        )
      }
      return
    }
    if (!this.deps.remoteOn()) {
      this.say(m.chat.id, 'Remote control is switched off on the laptop.')
      return
    }

    if (m.document) return this.file(m.chat.id, m.document)
    const text = (m.text ?? '').trim()
    if (!text) return
    if (text === '/start' || text === '/help') {
      this.say(
        m.chat.id,
        'Write a task to start it. /tasks shows the latest tasks; /cancel <number> stops one. Send a file to save it in the inbox folder.'
      )
      return
    }
    if (text === '/tasks') {
      const { tasks } = await this.deps.commands.state()
      this.say(
        m.chat.id,
        tasks.length
          ? tasks
              .slice(0, 10)
              .map((t, i) => `${i + 1}. ${t.title} (${t.status})`)
              .join('\n')
          : 'No tasks yet.'
      )
      return
    }
    const cancel = text.match(/^\/cancel\s+(\d{1,2})$/)
    if (cancel) {
      const { tasks } = await this.deps.commands.state()
      const task = tasks[Number(cancel[1]) - 1]
      if (!task) return this.say(m.chat.id, 'No task with that number. /tasks lists them.')
      const r = await this.deps.commands.run({ type: 'task.cancel', taskId: task.id }, SOURCE)
      return this.say(m.chat.id, r.ok ? `Cancelled: ${task.title}` : r.error)
    }
    if (text.startsWith('/'))
      return this.say(m.chat.id, 'I don’t know that command. /help lists them.')
    const r = await this.deps.commands.run(
      { type: 'task.start', text: text.slice(0, 20_000) },
      SOURCE
    )
    this.say(
      m.chat.id,
      r.ok
        ? 'Started on your laptop. I’ll write here when it needs you or when it’s done.'
        : r.error
    )
  }

  private async button(q: NonNullable<Update['callback_query']>): Promise<void> {
    const linked = this.stored.linked
    const ok = linked && q.from.id === linked.userId && q.message?.chat.type === 'private'
    const match = q.data?.match(/^a:([A-Za-z0-9_-]{1,80}):(y|n)$/)
    let answer = 'Not available.'
    if (ok && match && this.deps.remoteOn()) {
      const r = await this.deps.commands.run(
        {
          type: 'approval.answer',
          approvalId: match[1]!,
          answer: match[2] === 'y' ? 'approve' : 'deny'
        },
        SOURCE
      )
      answer = r.ok ? (match[2] === 'y' ? 'Approved.' : 'Denied.') : r.error
      if (q.message)
        await this.call('editMessageReplyMarkup', {
          chat_id: q.message.chat.id,
          message_id: q.message.message_id,
          reply_markup: { inline_keyboard: [] }
        }).catch(() => undefined)
    }
    // Every button press is answered, or the button keeps spinning (core.telegram.org/bots/api).
    await this.call('answerCallbackQuery', {
      callback_query_id: q.id,
      text: answer.slice(0, 190)
    }).catch(() => undefined)
  }

  private async file(
    chatId: number,
    doc: NonNullable<NonNullable<Update['message']>['document']>
  ): Promise<void> {
    if ((doc.file_size ?? 0) > CHANNEL_MAX_FILE_BYTES)
      return this.say(chatId, 'Files up to 20 MB only.')
    try {
      const file = await this.call<{ file_path?: string }>('getFile', { file_id: doc.file_id })
      if (!file.file_path || !this.token) throw new Error('No file.')
      const res = await this.fetch(`${API}/file/bot${this.token}/${file.file_path}`)
      if (!res.ok) throw new Error('Download failed.')
      const bytes = new Uint8Array(await res.arrayBuffer())
      const saved = await this.deps.commands.saveFile(doc.file_name ?? 'file', bytes)
      this.say(chatId, `Saved on your laptop as ${saved}.`)
    } catch (error) {
      this.say(chatId, error instanceof Error ? error.message : 'Couldn’t save that file.')
    }
  }

  // ---------------------------------------------------------------- telling the user

  /** A line for the linked chat (a schedule's result, decisions §61.5), while remote control is on. */
  announce(text: string): void {
    if (this.stored.linked && this.token && this.deps.remoteOn())
      this.say(this.stored.linked.chatId, text)
  }

  /** Every few seconds: approvals waiting and tasks from this chat that finished. */
  async watch(): Promise<void> {
    const linked = this.stored.linked
    if (!linked || !this.token || !this.deps.remoteOn()) return
    const state = await this.deps.commands.state().catch(() => null)
    if (!state) return
    for (const a of state.approvals) {
      if (this.announced.has(a.id)) continue
      this.announced.add(a.id)
      this.approval(linked.chatId, a)
    }
    for (const t of state.tasks) {
      if (t.startedFrom !== SOURCE || this.finished.has(t.id)) continue
      if (!['done', 'stopped', 'error'].includes(t.status)) continue
      this.finished.add(t.id)
      const detail = await this.deps.commands.task(t.id).catch(() => null)
      const result = detail?.result ?? t.lastLine ?? ''
      this.say(
        linked.chatId,
        `${t.status === 'done' ? 'Done' : 'Stopped'}: ${t.title}${result ? `\n\n${result}` : ''}`
      )
    }
  }

  private approval(chatId: number, a: RemoteApproval): void {
    if (a.laptopOnly) {
      // Laptop-only approvals stay laptop-only in chat (security.md A4).
      this.say(chatId, `Needs you on the laptop: ${a.summary}\nApprove this on your laptop.`)
      return
    }
    this.say(chatId, `Approve? ${a.summary}`, [
      [
        { text: 'Approve', data: `a:${a.id}:y` },
        { text: 'Deny', data: `a:${a.id}:n` }
      ]
    ])
  }

  private say(chatId: number, text: string, buttons?: { text: string; data: string }[][]): void {
    this.queue.push({ chatId, text: text.slice(0, MAX_TEXT), ...(buttons ? { buttons } : {}) })
    void this.drain()
  }

  /** About one message a second per chat (core.telegram.org/bots/faq). */
  private async drain(): Promise<void> {
    if (this.sending) return
    this.sending = true
    try {
      while (this.queue.length) {
        const m = this.queue.shift()!
        await this.call('sendMessage', {
          chat_id: m.chatId,
          text: m.text,
          ...(m.buttons
            ? {
                reply_markup: {
                  inline_keyboard: m.buttons.map((row) =>
                    row.map((b) => ({ text: b.text, callback_data: b.data }))
                  )
                }
              }
            : {})
        }).catch(() => undefined)
        if (this.queue.length) await new Promise((r) => setTimeout(r, 1100))
      }
    } finally {
      this.sending = false
    }
  }

  // ---------------------------------------------------------------- the Bot API

  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    token = this.token
  ): Promise<T> {
    if (!token) throw new TelegramError(0)
    const res = await this.fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(40_000)
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T } | null
    // Never the address in an error: it holds the token.
    if (!res.ok || !body?.ok) throw new TelegramError(res.status)
    return body.result as T
  }

  private readToken(): string | null {
    const file = join(this.dir, 'telegram-token.bin')
    if (!this.deps.keychain || !existsSync(file)) return null
    try {
      return this.deps.keychain.decrypt(readFileSync(file))
    } catch {
      return null
    }
  }

  private load(): Stored {
    try {
      const raw = JSON.parse(
        readFileSync(join(this.dir, 'telegram.json'), 'utf8')
      ) as Partial<Stored>
      return {
        botName: typeof raw.botName === 'string' ? raw.botName : null,
        linked:
          raw.linked &&
          typeof raw.linked.chatId === 'number' &&
          typeof raw.linked.userId === 'number'
            ? {
                chatId: raw.linked.chatId,
                userId: raw.linked.userId,
                name: String(raw.linked.name ?? 'you')
              }
            : null,
        offset: typeof raw.offset === 'number' ? raw.offset : 0
      }
    } catch {
      return { botName: null, linked: null, offset: 0 }
    }
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, 'telegram.json'), JSON.stringify(this.stored))
  }

  private changed(): void {
    this.deps.onChange(this.view())
  }
}

export class TelegramError extends Error {
  constructor(readonly status: number) {
    super(`Telegram answered ${status}.`)
    this.name = 'TelegramError'
  }
}
