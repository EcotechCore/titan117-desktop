/**
 * Newsletters and email sequences (features 15.5, 15.6; decisions §31, §63):
 * subscriber lists with the consent each person gave, newsletters written in
 * Markdown and rendered in the brand kit, and sequences sent to new
 * subscribers day by day.
 *
 * Lists live on the laptop. Mail goes out through the user's own email
 * provider account (their key in the keychain), which also handles
 * unsubscribing; what the provider says about who unsubscribed or bounced is
 * read back before every send. Nothing passes through our servers.
 *
 * Consent is recorded per list and per person (GDPR): nobody is added
 * without saying how they agreed, and an unsubscribe is kept for good.
 */
import { randomUUID } from 'node:crypto'
import { marked } from 'marked'

import type { Db } from '../db'
import { MarketingError, type MarketingBrand } from './brand'
import { textOn } from './video'

export const MAIL_PROVIDERS = ['brevo', 'postmark'] as const
export type MailProviderId = (typeof MAIL_PROVIDERS)[number]

export interface MailSettings {
  provider: MailProviderId | null
  fromName: string
  fromEmail: string
  replyTo: string
  /** The company's postal address, shown in every footer (anti-spam laws ask for it). */
  address: string
  /** Postmark only: the id of the broadcast message stream. */
  postmarkStream: string
}

export const MAX_LISTS = 50
export const MAX_SUBSCRIBERS = 50_000
export const MAX_ADD = 5000
export const MAX_SEQUENCE_STEPS = 12
const EMAIL = /^[^\s@<>"',;]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i
/** Mailbox providers that refuse bulk mail sent "from" their own addresses. */
const FREE_MAIL =
  /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|icloud|me|aol|proton|protonmail|gmx)\.[a-z.]+$/i

function line(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

export function cleanEmail(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return text.length <= 254 && EMAIL.test(text) ? text : null
}

export function cleanMailSettings(input: unknown): MailSettings {
  const v = (input ?? {}) as Partial<Record<keyof MailSettings, unknown>>
  return {
    provider: MAIL_PROVIDERS.includes(v.provider as MailProviderId)
      ? (v.provider as MailProviderId)
      : null,
    fromName: line(v.fromName, 80).replace(/[<>"]/g, ''),
    fromEmail: cleanEmail(v.fromEmail) ?? '',
    replyTo: cleanEmail(v.replyTo) ?? '',
    address: line(v.address, 200),
    postmarkStream: line(v.postmarkStream, 60).replace(/[^A-Za-z0-9_-]/g, '')
  }
}

/** What is still missing before anything can be sent, in plain words. */
export function settingsProblems(settings: MailSettings, hasKey: boolean): string[] {
  const out: string[] = []
  if (!settings.provider) out.push('Choose your email provider.')
  else if (!hasKey) out.push('Add your provider’s API key.')
  if (!settings.fromEmail) out.push('Say which address the mail comes from.')
  else if (FREE_MAIL.test(settings.fromEmail))
    out.push(
      'Newsletters can’t be sent from a free mailbox address (Gmail, Yahoo, Outlook): use an address on your own domain.'
    )
  if (!settings.fromName) out.push('Say who the mail is from (your company’s name).')
  if (!settings.address) out.push('Add your company’s postal address for the footer.')
  if (settings.provider === 'postmark' && !settings.postmarkStream)
    out.push('Name your Postmark broadcast stream.')
  return out
}

// ---------------------------------------------------------------- lists and subscribers

export type SubscriberStatus = 'subscribed' | 'unsubscribed' | 'bounced'

export interface MailList {
  id: string
  name: string
  /** What people on this list signed up for, shown in every footer. */
  about: string
  createdAt: number
  subscribed: number
  unsubscribed: number
}

export interface Subscriber {
  id: string
  listId: string
  email: string
  name: string
  status: SubscriberStatus
  /** How this person agreed to get this list's mail, in the user's words. */
  consent: string
  consentAt: number
  addedAt: number
  changedAt: number
}

export interface Newsletter {
  id: string
  listId: string
  subject: string
  /** The line mail apps show after the subject. */
  preheader: string
  /** Markdown. */
  body: string
  status: 'draft' | 'sent' | 'failed'
  sentAt: number | null
  sentTo: number
  /** The provider's own reference for the send (a campaign or list id), to read results back. */
  providerRef: string
  note: string
  testedAt: number | null
  source: string
  createdAt: number
  updatedAt: number
}

export interface SequenceStep {
  /** Days after the person joined the list (0 = the same day). */
  day: number
  subject: string
  preheader: string
  body: string
}

export interface Sequence {
  id: string
  listId: string
  name: string
  enabled: boolean
  steps: SequenceStep[]
  source: string
  createdAt: number
  lastRunAt: number | null
  lastNote: string
}

/** Rows of a CSV with an "email" column (and optionally "name"); a plain list of addresses works too. */
export function parseSubscribers(text: string): { email: string; name: string }[] {
  const rows = text
    .replace(String.fromCharCode(0xfeff), '')
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean)
  if (!rows.length) return []
  const split = (row: string): string[] =>
    (row.match(/("([^"]|"")*"|[^,;\t]*)([,;\t]|$)/g) ?? [])
      .map((c) => c.replace(/[,;\t]$/, '').trim())
      .map((c) => (c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c))
  const header = split(rows[0]).map((h) => h.toLowerCase())
  const emailAt = header.findIndex((h) => h === 'email' || h === 'e-mail' || h === 'email address')
  const nameAt = header.findIndex((h) => h === 'name' || h === 'full name' || h === 'first name')
  const out: { email: string; name: string }[] = []
  for (const row of emailAt >= 0 ? rows.slice(1) : rows) {
    const cells = split(row)
    const email = cleanEmail(emailAt >= 0 ? cells[emailAt] : cells.find((c) => c.includes('@')))
    if (email) out.push({ email, name: line(nameAt >= 0 ? cells[nameAt] : '', 80) })
  }
  return out
}

function checkStep(raw: unknown, i: number): SequenceStep {
  const s = (raw ?? {}) as Record<string, unknown>
  const day = typeof s.day === 'number' && Number.isFinite(s.day) ? Math.round(s.day) : -1
  if (day < 0 || day > 365)
    throw new MarketingError(`Step ${i + 1}: "day" is 0 to 365 days after joining.`)
  const subject = line(s.subject, 150)
  const body = typeof s.body === 'string' ? s.body.trim().slice(0, 20_000) : ''
  if (!subject || !body) throw new MarketingError(`Step ${i + 1}: it needs a subject and a body.`)
  return { day, subject, preheader: line(s.preheader, 150), body }
}

interface ListRow {
  id: string
  name: string
  about: string
  created_at: number
}
interface SubscriberRow {
  id: string
  list_id: string
  email: string
  name: string
  status: string
  consent: string
  consent_at: number
  added_at: number
  changed_at: number
}
interface NewsletterRow {
  id: string
  list_id: string
  subject: string
  preheader: string
  body: string
  status: string
  sent_at: number | null
  sent_to: number
  provider_ref: string
  note: string
  tested_at: number | null
  source: string
  created_at: number
  updated_at: number
}
interface SequenceRow {
  id: string
  list_id: string
  name: string
  enabled: number
  steps: string
  source: string
  created_at: number
  last_run_at: number | null
  last_note: string
}

export interface MailStore {
  lists(): MailList[]
  list(idOrName: string): MailList | null
  saveList(input: { name: unknown; about?: unknown }): MailList
  /** The list, its subscribers, newsletters and sequences. */
  removeList(id: string): void
  subscribers(listId: string, status?: SubscriberStatus): Subscriber[]
  /**
   * Add people who agreed. `consent` says how (a form on the site, a paper
   * sign-up sheet…): without it nobody is added. Someone who unsubscribed
   * from this list is never added back this way.
   */
  addSubscribers(
    listId: string,
    people: { email: unknown; name?: unknown }[],
    consent: { how: unknown; at?: number }
  ): { added: number; already: number; unsubscribed: number; invalid: number }
  /** Mark addresses as unsubscribed or bounced, on every list: what the provider reported, or the user's own click. */
  suppress(emails: string[], status: 'unsubscribed' | 'bounced'): number
  removeSubscriber(id: string): void
  newsletters(listId?: string): Newsletter[]
  newsletter(id: string): Newsletter | null
  saveNewsletter(
    input: { id?: unknown; list?: unknown; subject?: unknown; preheader?: unknown; body?: unknown },
    source: string
  ): Newsletter
  markNewsletter(
    id: string,
    patch: Partial<
      Pick<Newsletter, 'status' | 'sentAt' | 'sentTo' | 'providerRef' | 'note' | 'testedAt'>
    >
  ): Newsletter
  removeNewsletter(id: string): void
  sequences(): Sequence[]
  sequence(idOrName: string): Sequence | null
  saveSequence(input: { name: unknown; list: unknown; steps: unknown }, source: string): Sequence
  setSequence(id: string, enabled: boolean): Sequence
  removeSequence(id: string): void
  noteSequence(id: string, note: string): void
  /** Subscribers of the sequence's list who are due a step and haven't had it: step index → people. */
  sequenceDue(id: string): Map<number, Subscriber[]>
  markSequenceSent(id: string, step: number, subscriberIds: string[]): void
}

export function createMailStore(deps: {
  db: Db
  onChange?: () => void
  now?: () => number
}): MailStore {
  const { db } = deps
  const now = deps.now ?? Date.now
  const changed = deps.onChange ?? (() => undefined)

  const count = (listId: string, status: string): number =>
    (
      db
        .prepare('select count(*) as n from subscribers where list_id = ? and status = ?')
        .get(listId, status) as { n: number }
    ).n
  const toList = (r: ListRow): MailList => ({
    id: r.id,
    name: r.name,
    about: r.about,
    createdAt: r.created_at,
    subscribed: count(r.id, 'subscribed'),
    unsubscribed: count(r.id, 'unsubscribed') + count(r.id, 'bounced')
  })
  const toSubscriber = (r: SubscriberRow): Subscriber => ({
    id: r.id,
    listId: r.list_id,
    email: r.email,
    name: r.name,
    status: r.status as SubscriberStatus,
    consent: r.consent,
    consentAt: r.consent_at,
    addedAt: r.added_at,
    changedAt: r.changed_at
  })
  const toNewsletter = (r: NewsletterRow): Newsletter => ({
    id: r.id,
    listId: r.list_id,
    subject: r.subject,
    preheader: r.preheader,
    body: r.body,
    status: r.status as Newsletter['status'],
    sentAt: r.sent_at,
    sentTo: r.sent_to,
    providerRef: r.provider_ref,
    note: r.note,
    testedAt: r.tested_at,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  })
  const toSequence = (r: SequenceRow): Sequence => ({
    id: r.id,
    listId: r.list_id,
    name: r.name,
    enabled: r.enabled === 1,
    steps: JSON.parse(r.steps) as SequenceStep[],
    source: r.source,
    createdAt: r.created_at,
    lastRunAt: r.last_run_at,
    lastNote: r.last_note
  })

  const store: MailStore = {
    lists: () =>
      (db.prepare('select * from mail_lists order by name').all() as unknown as ListRow[]).map(
        toList
      ),

    list(idOrName) {
      const key = String(idOrName ?? '').trim()
      const row = db
        .prepare('select * from mail_lists where id = ? or lower(name) = lower(?)')
        .get(key, key) as unknown as ListRow | undefined
      return row ? toList(row) : null
    },

    saveList(input) {
      const name = line(input.name, 80)
      if (!name) throw new MarketingError('Give the list a name, like "Monthly news".')
      const about = line(input.about, 200)
      const existing = store.list(name)
      if (existing) {
        db.prepare('update mail_lists set about = ? where id = ?').run(
          about || existing.about,
          existing.id
        )
        changed()
        return store.list(existing.id)!
      }
      if (store.lists().length >= MAX_LISTS)
        throw new MarketingError(`There are already ${MAX_LISTS} lists.`)
      const id = randomUUID()
      db.prepare('insert into mail_lists (id, name, about, created_at) values (?, ?, ?, ?)').run(
        id,
        name,
        about,
        now()
      )
      changed()
      return store.list(id)!
    },

    removeList(id) {
      if (!store.list(id)) throw new MarketingError('There is no such list.')
      db.prepare('delete from mail_lists where id = ?').run(id)
      changed()
    },

    subscribers(listId, status) {
      return (
        db
          .prepare(
            `select * from subscribers where list_id = ? ${status ? 'and status = ?' : ''} order by email`
          )
          .all(...(status ? [listId, status] : [listId])) as unknown as SubscriberRow[]
      ).map(toSubscriber)
    },

    addSubscribers(listId, people, consent) {
      const list = store.list(listId)
      if (!list) throw new MarketingError('There is no such list.')
      const how = line(consent.how, 300)
      if (how.length < 10)
        throw new MarketingError(
          'Say how these people agreed to get this list’s mail (for example "Signed up through the form on our site, October 2026"). Nobody is added without it.'
        )
      if (people.length > MAX_ADD)
        throw new MarketingError(`Add at most ${MAX_ADD} people at a time.`)
      const total = (db.prepare('select count(*) as n from subscribers').get() as { n: number }).n
      if (total + people.length > MAX_SUBSCRIBERS)
        throw new MarketingError(`Titan117 keeps up to ${MAX_SUBSCRIBERS} subscribers.`)
      const at = now()
      const result = { added: 0, already: 0, unsubscribed: 0, invalid: 0 }
      const seen = new Set<string>()
      db.exec('begin')
      try {
        for (const person of people) {
          const email = cleanEmail(person.email)
          if (!email || seen.has(email)) {
            if (!email) result.invalid++
            continue
          }
          seen.add(email)
          const existing = db
            .prepare('select status from subscribers where list_id = ? and email = ?')
            .get(list.id, email) as { status: string } | undefined
          if (existing) {
            // An unsubscribe stands: only the person can come back, by signing up again themselves.
            if (existing.status === 'subscribed') result.already++
            else result.unsubscribed++
            continue
          }
          db.prepare(
            `insert into subscribers (id, list_id, email, name, status, consent, consent_at, added_at, changed_at)
             values (?, ?, ?, ?, 'subscribed', ?, ?, ?, ?)`
          ).run(randomUUID(), list.id, email, line(person.name, 80), how, consent.at ?? at, at, at)
          result.added++
        }
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
      changed()
      return result
    },

    suppress(emails, status) {
      let n = 0
      for (const raw of emails) {
        const email = cleanEmail(raw)
        if (!email) continue
        n += Number(
          db
            .prepare(
              "update subscribers set status = ?, changed_at = ? where email = ? and status = 'subscribed'"
            )
            .run(status, now(), email).changes
        )
      }
      if (n) changed()
      return n
    },

    removeSubscriber(id) {
      // Kept as "unsubscribed", so a later import can't add the person back.
      db.prepare("update subscribers set status = 'unsubscribed', changed_at = ? where id = ?").run(
        now(),
        String(id)
      )
      changed()
    },

    newsletters(listId) {
      return (
        db
          .prepare(
            `select * from newsletters ${listId ? 'where list_id = ?' : ''} order by updated_at desc`
          )
          .all(...(listId ? [listId] : [])) as unknown as NewsletterRow[]
      ).map(toNewsletter)
    },

    newsletter(id) {
      const row = db
        .prepare('select * from newsletters where id = ?')
        .get(String(id)) as unknown as NewsletterRow | undefined
      return row ? toNewsletter(row) : null
    },

    saveNewsletter(input, source) {
      const existing = input.id ? store.newsletter(String(input.id)) : null
      if (input.id && !existing) throw new MarketingError('There is no such newsletter.')
      if (existing?.status === 'sent')
        throw new MarketingError('That newsletter was sent; write a new one instead.')
      const list =
        input.list !== undefined
          ? store.list(String(input.list))
          : existing
            ? store.list(existing.listId)
            : null
      if (!list) throw new MarketingError('Say which list the newsletter is for.')
      const subject =
        input.subject !== undefined ? line(input.subject, 150) : (existing?.subject ?? '')
      const body =
        input.body !== undefined
          ? typeof input.body === 'string'
            ? input.body.trim().slice(0, 50_000)
            : ''
          : (existing?.body ?? '')
      if (!subject) throw new MarketingError('A newsletter needs a subject.')
      if (!body) throw new MarketingError('A newsletter needs its text.')
      const preheader =
        input.preheader !== undefined ? line(input.preheader, 150) : (existing?.preheader ?? '')
      const at = now()
      const id = existing?.id ?? randomUUID()
      db.prepare(
        `insert into newsletters (id, list_id, subject, preheader, body, status, source, created_at, updated_at)
         values (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
         on conflict(id) do update set list_id = excluded.list_id, subject = excluded.subject,
           preheader = excluded.preheader, body = excluded.body, status = 'draft', tested_at = null,
           updated_at = excluded.updated_at`
      ).run(
        id,
        list.id,
        subject,
        preheader,
        body,
        existing?.source ?? source,
        existing?.createdAt ?? at,
        at
      )
      changed()
      return store.newsletter(id)!
    },

    markNewsletter(id, patch) {
      const map: Record<string, string> = {
        status: 'status',
        sentAt: 'sent_at',
        sentTo: 'sent_to',
        providerRef: 'provider_ref',
        note: 'note',
        testedAt: 'tested_at'
      }
      const keys = Object.keys(patch).filter((k) => k in map)
      if (keys.length)
        db.prepare(
          `update newsletters set ${keys.map((k) => `${map[k]} = ?`).join(', ')}, updated_at = ? where id = ?`
        ).run(...keys.map((k) => (patch as Record<string, string | number | null>)[k]), now(), id)
      changed()
      return store.newsletter(id)!
    },

    removeNewsletter(id) {
      db.prepare('delete from newsletters where id = ?').run(String(id))
      changed()
    },

    sequences: () =>
      (
        db.prepare('select * from mail_sequences order by name').all() as unknown as SequenceRow[]
      ).map(toSequence),

    sequence(idOrName) {
      const key = String(idOrName ?? '').trim()
      const row = db
        .prepare('select * from mail_sequences where id = ? or lower(name) = lower(?)')
        .get(key, key) as unknown as SequenceRow | undefined
      return row ? toSequence(row) : null
    },

    saveSequence(input, source) {
      const name = line(input.name, 80)
      if (!name) throw new MarketingError('Give the sequence a name, like "Welcome".')
      const list = store.list(String(input.list ?? ''))
      if (!list) throw new MarketingError('Say which list the sequence is for.')
      const raw = Array.isArray(input.steps) ? input.steps : []
      if (!raw.length || raw.length > MAX_SEQUENCE_STEPS)
        throw new MarketingError(`A sequence has 1 to ${MAX_SEQUENCE_STEPS} emails.`)
      const steps = raw.map(checkStep).sort((a, b) => a.day - b.day)
      const existing = store.sequence(name)
      const id = existing?.id ?? randomUUID()
      // Changed steps start again for new subscribers only: who got what stays recorded.
      db.prepare(
        `insert into mail_sequences (id, list_id, name, enabled, steps, source, created_at, last_note)
         values (?, ?, ?, 1, ?, ?, ?, '')
         on conflict(id) do update set list_id = excluded.list_id, steps = excluded.steps, enabled = 1`
      ).run(id, list.id, name, JSON.stringify(steps), source, now())
      changed()
      return store.sequence(id)!
    },

    setSequence(id, enabled) {
      if (!store.sequence(id)) throw new MarketingError('There is no such sequence.')
      db.prepare('update mail_sequences set enabled = ? where id = ?').run(enabled ? 1 : 0, id)
      changed()
      return store.sequence(id)!
    },

    removeSequence(id) {
      db.prepare('delete from mail_sequences where id = ?').run(String(id))
      changed()
    },

    noteSequence(id, note) {
      db.prepare('update mail_sequences set last_run_at = ?, last_note = ? where id = ?').run(
        now(),
        note.slice(0, 300),
        id
      )
      changed()
    },

    sequenceDue(id) {
      const sequence = store.sequence(id)
      const due = new Map<number, Subscriber[]>()
      if (!sequence) return due
      const sent = new Set(
        (
          db
            .prepare('select subscriber_id, step from mail_sequence_sent where sequence_id = ?')
            .all(id) as { subscriber_id: string; step: number }[]
        ).map((r) => `${r.subscriber_id}:${r.step}`)
      )
      const at = now()
      for (const person of store.subscribers(sequence.listId, 'subscribed')) {
        // Only people who joined after the sequence was made: turning one on never mails the whole list.
        if (person.addedAt < sequence.createdAt) continue
        // One email per person per run: the earliest step that is due and not yet sent.
        const step = sequence.steps.findIndex(
          (s, i) => !sent.has(`${person.id}:${i}`) && person.addedAt + s.day * 86_400_000 <= at
        )
        if (step >= 0) due.set(step, [...(due.get(step) ?? []), person])
      }
      return due
    },

    markSequenceSent(id, step, subscriberIds) {
      const at = now()
      for (const subscriber of subscriberIds)
        db.prepare(
          'insert or ignore into mail_sequence_sent (sequence_id, subscriber_id, step, sent_at) values (?, ?, ?, ?)'
        ).run(id, subscriber, step, at)
    }
  }
  return store
}

// ---------------------------------------------------------------- rendering

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/**
 * A newsletter's Markdown as an email: a single column that works in mail
 * apps (tables and inline styles), in the brand kit's colours, with a footer
 * that says who sent it, why, and how to unsubscribe. Raw HTML in the
 * Markdown is shown as text, never run.
 */
export function renderEmail(input: {
  subject: string
  preheader: string
  body: string
  brand: Pick<MarketingBrand, 'name' | 'primary' | 'website'> | null
  settings: Pick<MailSettings, 'fromName' | 'address'>
  listAbout: string
  /** The provider's own placeholder for the unsubscribe link. */
  unsubscribe: string
}): { html: string; text: string } {
  const primary = input.brand?.primary ?? '#ff6347'
  const company = input.settings.fromName || input.brand?.name || ''
  const renderer = new marked.Renderer()
  renderer.html = ({ text }) => escapeHtml(text)
  renderer.link = function ({ href, tokens }) {
    const safe = /^(https?:|mailto:)/i.test(href) ? href : '#'
    return `<a href="${escapeHtml(safe)}" style="color:${primary};text-decoration:underline">${this.parser.parseInline(tokens)}</a>`
  }
  renderer.image = ({ href, text }) =>
    /^https:/i.test(href)
      ? `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" style="max-width:100%;height:auto;border:0;border-radius:6px">`
      : escapeHtml(text)
  renderer.heading = function ({ tokens, depth }) {
    const size = depth === 1 ? 26 : depth === 2 ? 21 : 17
    return `<h${depth} style="margin:24px 0 10px;font-size:${size}px;line-height:1.3;color:#18181b">${this.parser.parseInline(tokens)}</h${depth}>`
  }
  renderer.paragraph = function ({ tokens }) {
    return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#27272a">${this.parser.parseInline(tokens)}</p>`
  }
  let content = marked.parse(input.body, { async: false, renderer }) as string
  // A link alone on its line, written as [text](url){button}, becomes the call to action.
  content = content.replace(
    /<p[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>\{button\}\s*<\/p>/g,
    (_m, href: string, label: string) =>
      `<p style="margin:8px 0 24px"><a href="${href}" style="display:inline-block;background:${primary};color:${textOn(primary)};padding:12px 22px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none">${label}</a></p>`
  )
  const why = input.listAbout
    ? `You get this because you signed up for ${escapeHtml(input.listAbout)}.`
    : 'You get this because you signed up for our emails.'
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(input.subject)}</title></head>`,
    '<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">',
    input.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>`
      : '',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:24px 12px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px">',
    `<tr><td style="padding:20px 28px;border-bottom:3px solid ${primary};font-size:18px;font-weight:700;color:#18181b">${escapeHtml(company)}</td></tr>`,
    `<tr><td style="padding:24px 28px 8px">${content}</td></tr>`,
    '<tr><td style="padding:16px 28px 24px;border-top:1px solid #e7e7ea;font-size:12px;line-height:1.6;color:#71717a">',
    `${escapeHtml(company)}${input.settings.address ? ` · ${escapeHtml(input.settings.address)}` : ''}<br>`,
    `${why} <a href="${input.unsubscribe}" style="color:#71717a;text-decoration:underline">Unsubscribe</a>`,
    '</td></tr></table></td></tr></table></body></html>'
  ].join('')
  const text = [
    input.body
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)(\{button\})?/g, '$1: $2')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/[*_`]{1,3}/g, ''),
    '',
    '--',
    `${company}${input.settings.address ? ` · ${input.settings.address}` : ''}`,
    `${why.replace(/&#\d+;/g, "'")} Unsubscribe: ${input.unsubscribe}`
  ].join('\n')
  return { html, text }
}

// ---------------------------------------------------------------- the sending-setup check

export interface SetupCheck {
  name: string
  ok: boolean
  /** A warning doesn't stop a send; a failed check does. */
  blocks: boolean
  detail: string
}

/**
 * What Gmail and Yahoo ask of senders (their sender guidelines, in force
 * since February 2024): SPF or DKIM for everyone, and for bulk senders both
 * plus a DMARC record. Read from the domain's public DNS.
 */
export async function dnsChecks(
  fromEmail: string,
  resolveTxt: (name: string) => Promise<string[][]>
): Promise<SetupCheck[]> {
  const domain = fromEmail.split('@')[1] ?? ''
  const txt = async (name: string): Promise<string[] | null> => {
    try {
      return (await resolveTxt(name)).map((parts) => parts.join(''))
    } catch (error) {
      const code = (error as { code?: string }).code
      return code === 'ENOTFOUND' || code === 'ENODATA' ? [] : null
    }
  }
  const [root, dmarc] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)])
  const spf = root?.find((r) => /^v=spf1\b/i.test(r))
  const policy = dmarc?.find((r) => /^v=DMARC1\b/i.test(r))
  return [
    {
      name: 'SPF',
      ok: !!spf,
      blocks: false,
      detail:
        root === null
          ? `${domain}'s DNS couldn't be read just now.`
          : spf
            ? `${domain} has an SPF record.`
            : `${domain} has no SPF record. Your provider's set-up page gives the record to add at your domain's DNS.`
    },
    {
      name: 'DMARC',
      ok: !!policy,
      blocks: false,
      detail:
        dmarc === null
          ? `_dmarc.${domain} couldn't be read just now.`
          : policy
            ? `${domain} has a DMARC record (${/p=(\w+)/i.exec(policy)?.[1] ?? 'no policy'}).`
            : `${domain} has no DMARC record. Gmail and Yahoo ask bulk senders for one: add a TXT record at _dmarc.${domain}, starting with "v=DMARC1; p=none".`
    }
  ]
}
