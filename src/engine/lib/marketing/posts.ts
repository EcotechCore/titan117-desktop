/**
 * Social posts and the content calendar (features 15.2-15.4; decisions §24,
 * §62). A post is a ready-to-post package: the text, hashtags and media for
 * one platform on one day. Nothing here posts anywhere: the user publishes
 * each post themselves with "Copy and open", which copies the text and opens
 * the platform's own post screen. V1 uses no platform API, so no platform
 * has to approve our app.
 *
 * Everything is kept on the laptop, in the local database.
 */
import { randomUUID } from 'node:crypto'

import type { Db } from '../db'
import { MarketingError } from './brand'

export const PLATFORMS = ['linkedin', 'facebook', 'instagram', 'x', 'tiktok'] as const
export type Platform = (typeof PLATFORMS)[number]

export interface PlatformInfo {
  id: Platform
  label: string
  /** The longest text the platform takes, hashtags included. */
  maxChars: number
  maxHashtags: number
  /** A post there is a picture or a video; text alone can't be posted. */
  needsMedia: boolean
  /** The shape that fits best: pictures first, then video. */
  image: { width: number; height: number }
  video: { width: number; height: number }
  /** Whether its post screen can be opened with the text already filled in. */
  prefills: boolean
}

/**
 * The platforms' limits and shapes (decisions §62; `external-services.md`).
 * Confirmed on the vendors' pages on 24 Nov 2026: X 280 (links 23), Instagram
 * 2,200 characters and 30 hashtags, feed pictures between 4:5 and 1.91:1,
 * Reels 9:16, TikTok captions 2,200. LinkedIn's 3,000 is to verify; Facebook's
 * 5,000 is our own limit (Meta states none), and the hashtag counts for
 * LinkedIn, Facebook, X and TikTok are our advice, not the platforms' rules.
 */
export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    maxChars: 3000,
    maxHashtags: 5,
    needsMedia: false,
    image: { width: 1200, height: 627 },
    video: { width: 1920, height: 1080 },
    prefills: true
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    maxChars: 5000,
    maxHashtags: 5,
    needsMedia: false,
    image: { width: 1200, height: 630 },
    video: { width: 1920, height: 1080 },
    prefills: false
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    maxChars: 2200,
    maxHashtags: 30,
    needsMedia: true,
    image: { width: 1080, height: 1350 },
    video: { width: 1080, height: 1920 },
    prefills: false
  },
  x: {
    id: 'x',
    label: 'X',
    maxChars: 280,
    maxHashtags: 3,
    needsMedia: false,
    image: { width: 1600, height: 900 },
    video: { width: 1920, height: 1080 },
    prefills: true
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    maxChars: 2200,
    maxHashtags: 10,
    needsMedia: true,
    image: { width: 1080, height: 1920 },
    video: { width: 1080, height: 1920 },
    prefills: false
  }
}

export const POST_STATUSES = ['draft', 'ready', 'posted', 'skipped'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

export interface Post {
  id: string
  platform: Platform
  /** The day it is meant for, `YYYY-MM-DD`, and the time, `HH:MM`, in the laptop's local time. */
  date: string
  time: string
  text: string
  /** Without the `#`. */
  hashtags: string[]
  /** Pictures or a video: paths inside the allowed folders. */
  media: string[]
  /** A link the post points to, or empty. */
  link: string
  /** The campaign or theme it belongs to ("Spring launch"), or empty. */
  campaign: string
  /** Draft: still being written. Ready: the user is reminded when it is time. */
  status: PostStatus
  /** When the "Time to post" reminder was shown. */
  remindedAt: number | null
  postedAt: number | null
  /** What the post brought, typed in by the user from the platform's own numbers (15.11). */
  results: PostResults
  source: string
  createdAt: number
  updatedAt: number
}

export const RESULT_KEYS = ['views', 'likes', 'comments', 'shares', 'clicks'] as const
export type PostResults = Partial<Record<(typeof RESULT_KEYS)[number], number>>

/** Whole numbers from 0 up; anything else is left out. */
export function cleanResults(input: unknown): PostResults {
  const value = (input ?? {}) as Record<string, unknown>
  const out: PostResults = {}
  for (const key of RESULT_KEYS) {
    const n = typeof value[key] === 'string' && value[key] !== '' ? Number(value[key]) : value[key]
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0)
      out[key] = Math.min(Math.round(n), 1_000_000_000)
  }
  return out
}

/**
 * A post's link with where the visit came from (`utm_source` the platform,
 * `utm_medium` social, `utm_campaign` the campaign), so the company's own
 * analytics show what each post brought. A link that already says is left alone.
 */
export function trackedLink(post: { platform: Platform; link: string; campaign?: string }): string {
  if (!post.link) return ''
  try {
    const url = new URL(post.link)
    if (url.searchParams.has('utm_source')) return post.link
    url.searchParams.set('utm_source', post.platform)
    url.searchParams.set('utm_medium', 'social')
    const campaign = (post.campaign ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
    if (campaign) url.searchParams.set('utm_campaign', campaign)
    return url.toString()
  } catch {
    return post.link
  }
}

export const MAX_POSTS = 2000
/** How many posts one call may save: a month on five platforms. */
export const MAX_BATCH = 160
const MAX_MEDIA = 10
/** A reminder for a post this late is no longer shown: the moment has passed. */
export const REMIND_WINDOW_MS = 3 * 24 * 60 * 60_000

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)
}

/** A real calendar day, `YYYY-MM-DD`. */
export function checkDate(value: unknown): string {
  const text = String(value ?? '').trim()
  if (DATE.test(text)) {
    const [y, m, d] = text.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    if (date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d) return text
  }
  throw new MarketingError('A post’s day is written like 2026-12-03.')
}

/** When a post is due, in the laptop's local time. */
export function dueAt(post: { date: string; time: string }): number {
  const [y, m, d] = post.date.split('-').map(Number)
  const [h, min] = post.time.split(':').map(Number)
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

/** The text exactly as it is posted: the words, then the hashtags on their own line. */
export function fullText(post: Pick<Post, 'text' | 'hashtags'>): string {
  const tags = post.hashtags.map((t) => `#${t}`).join(' ')
  return tags ? `${post.text}\n\n${tags}` : post.text
}

/** How X weighs a character: 1 for Latin and common punctuation, 2 for the rest (emoji, CJK). */
function xWeight(char: string): number {
  const c = char.codePointAt(0) ?? 0
  return c <= 0x10ff ||
    (c >= 0x2000 && c <= 0x200d) ||
    (c >= 0x2010 && c <= 0x201f) ||
    (c >= 0x2032 && c <= 0x2037)
    ? 1
    : 2
}

/**
 * How long the platform counts the text. X counts every link as 23
 * characters whatever its length, and emoji and most non-Latin characters
 * as 2 (docs.x.com, "Counting characters", read 24 Nov 2026); the others
 * count what is written.
 */
export function countChars(platform: Platform, text: string): number {
  if (platform !== 'x') return [...text].length
  const links = text.match(/https?:\/\/\S+/g) ?? []
  const rest = links.reduce((t, l) => t.replace(l, ''), text)
  return [...rest].reduce((sum, ch) => sum + xWeight(ch), 0) + links.length * 23
}

function cleanTags(value: unknown, max: number): string[] {
  const list = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(/[\s,]+/)
        .filter(Boolean)
  const tags = list
    .map((t) =>
      String(t)
        .trim()
        .replace(/^#+/, '')
        .replace(/[^\p{L}\p{N}_]/gu, '')
        .slice(0, 50)
    )
    .filter(Boolean)
  const seen = new Set<string>()
  return tags
    .filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true)))
    .slice(0, max)
}

function cleanLink(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('not web')
    return url.toString().slice(0, 500)
  } catch {
    throw new MarketingError('A post’s link is a web address, like https://your-site.com/offer.')
  }
}

export interface PostInput {
  id?: unknown
  platform?: unknown
  date?: unknown
  time?: unknown
  text?: unknown
  hashtags?: unknown
  media?: unknown
  link?: unknown
  campaign?: unknown
  status?: unknown
}

/** Check a post from an agent or the window; returns its fields cleaned, or throws saying what's wrong. */
export function checkPost(
  input: PostInput
): Pick<
  Post,
  'platform' | 'date' | 'time' | 'text' | 'hashtags' | 'media' | 'link' | 'campaign' | 'status'
> {
  if (!isPlatform(input.platform))
    throw new MarketingError(`A post is for one of: ${PLATFORMS.join(', ')}.`)
  const info = PLATFORM_INFO[input.platform]
  const date = checkDate(input.date)
  const time = String(input.time ?? '09:00').trim() || '09:00'
  if (!TIME.test(time)) throw new MarketingError('A post’s time is written like 09:30.')
  const text = String(input.text ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
  if (!text) throw new MarketingError('A post needs its text.')
  // A tag already written in the text isn't added again at the end.
  const written = new Set([...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase()))
  const hashtags = cleanTags(input.hashtags, info.maxHashtags).filter(
    (t) => !written.has(t.toLowerCase())
  )
  const count = countChars(input.platform, fullText({ text, hashtags }))
  if (count > info.maxChars)
    throw new MarketingError(
      `That is ${count} characters with its hashtags; ${info.label} takes ${info.maxChars}.`
    )
  const media = (Array.isArray(input.media) ? input.media : input.media ? [input.media] : [])
    .map((m) => String(m).trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, MAX_MEDIA)
  const status = (POST_STATUSES as readonly string[]).includes(String(input.status))
    ? (input.status as PostStatus)
    : 'draft'
  return {
    platform: input.platform,
    date,
    time,
    text,
    hashtags,
    media,
    link: cleanLink(input.link),
    campaign: String(input.campaign ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80),
    status
  }
}

/** What still stands between a post and publishing it, in plain words. */
export function postWarnings(post: Pick<Post, 'platform' | 'media'>): string[] {
  const info = PLATFORM_INFO[post.platform]
  const warnings: string[] = []
  if (info.needsMedia && !post.media.length)
    warnings.push(`${info.label} posts need a picture or a video.`)
  return warnings
}

/**
 * Where "Copy and open" goes: the platform's own post screen. The text is
 * always on the clipboard. X and LinkedIn are also asked to fill it in, as a
 * best effort: neither address is in their public docs (decisions §62), so
 * if they stop doing it the user pastes. The others open and the user pastes
 * and adds the media.
 */
export function composeUrl(
  post: Pick<Post, 'platform' | 'text' | 'hashtags' | 'link'> & { campaign?: string }
): string {
  const text = fullText(post)
  const link = trackedLink(post)
  switch (post.platform) {
    case 'x': {
      const url = new URL('https://x.com/intent/post')
      url.searchParams.set('text', text)
      if (post.link && !text.includes(post.link)) url.searchParams.set('url', link)
      return url.toString()
    }
    case 'linkedin': {
      const url = new URL('https://www.linkedin.com/feed/')
      url.searchParams.set('shareActive', 'true')
      url.searchParams.set(
        'text',
        post.link && !text.includes(post.link) ? `${text}\n\n${link}` : text
      )
      return url.toString()
    }
    case 'facebook':
      // Meta documents only its Share Dialog, which needs a Meta app of ours: the user pastes instead.
      return 'https://www.facebook.com/'
    case 'instagram':
      return 'https://www.instagram.com/'
    case 'tiktok':
      return 'https://www.tiktok.com/upload'
  }
}

// ---------------------------------------------------------------- exports

function icsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/([,;])/g, '\\$1')
}

/** Lines of at most 75 bytes, continued with a space, as RFC 5545 asks. */
function icsFold(line: string): string {
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = Buffer.byteLength(char)
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += char
    bytes += size
  }
  out.push(current)
  return out.join('\r\n ')
}

function icsStamp(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
}

function icsLocal(post: { date: string; time: string }, addMinutes = 0): string {
  const at = new Date(dueAt(post) + addMinutes * 60_000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}T${p(at.getHours())}${p(at.getMinutes())}00`
}

/**
 * The calendar as an .ics file (RFC 5545): one event per post at its local
 * time, with a reminder when it is due, for any calendar app.
 */
export function calendarIcs(posts: Post[], now = Date.now()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Titan117//Content calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ]
  for (const post of posts) {
    const info = PLATFORM_INFO[post.platform]
    const first = post.text.split('\n')[0].slice(0, 60)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${post.id}@titan117`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART:${icsLocal(post)}`,
      `DTEND:${icsLocal(post, 15)}`,
      icsFold(`SUMMARY:${icsText(`Post on ${info.label}: ${first}`)}`),
      icsFold(
        `DESCRIPTION:${icsText(
          [fullText(post), post.link, post.media.length ? `Media: ${post.media.join(', ')}` : '']
            .filter(Boolean)
            .join('\n\n')
        )}`
      ),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      icsFold(`DESCRIPTION:${icsText(`Time to post on ${info.label}`)}`),
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT'
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** A cell that a spreadsheet won't run as a formula (CSV injection) and that keeps its commas. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The calendar as a CSV table, one row per post, for a spreadsheet or a platform's own scheduler. */
export function calendarCsv(posts: Post[]): string {
  const rows = [
    ['Date', 'Time', 'Platform', 'Text', 'Hashtags', 'Link', 'Media', 'Campaign', 'Status']
  ]
  for (const post of posts)
    rows.push([
      post.date,
      post.time,
      PLATFORM_INFO[post.platform].label,
      post.text,
      post.hashtags.map((t) => `#${t}`).join(' '),
      post.link,
      post.media.join('; '),
      post.campaign,
      post.status
    ])
  // A byte-order mark so Excel reads the accents right.
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------- the store

interface PostRow {
  id: string
  platform: string
  date: string
  time: string
  text: string
  hashtags: string
  media: string
  link: string
  campaign: string
  status: string
  reminded_at: number | null
  posted_at: number | null
  results: string
  source: string
  created_at: number
  updated_at: number
}

export interface PostFilter {
  /** `YYYY-MM`: one month. */
  month?: string
  from?: string
  to?: string
  platform?: Platform
  status?: PostStatus
  campaign?: string
}

export interface PostStore {
  list(filter?: PostFilter): Post[]
  get(id: string): Post | null
  /** New posts, or changes to existing ones (by id): all checked first, then saved together. */
  save(inputs: PostInput[], source: string): Post[]
  setStatus(id: string, status: PostStatus): Post
  /** What the platform shows for a post; given numbers replace, the others stay. */
  setResults(id: string, results: unknown): Post
  remove(id: string): void
  /** Ready posts whose time has come and that haven't been reminded yet; marks them reminded. */
  takeDue(): Post[]
  /** Ready posts whose time has come and that aren't posted yet. */
  due(): Post[]
}

export function createPostStore(deps: {
  db: Db
  onChange?: () => void
  now?: () => number
}): PostStore {
  const { db } = deps
  const now = deps.now ?? Date.now
  const changed = deps.onChange ?? (() => undefined)

  const toPost = (r: PostRow): Post => ({
    id: r.id,
    platform: r.platform as Platform,
    date: r.date,
    time: r.time,
    text: r.text,
    hashtags: JSON.parse(r.hashtags) as string[],
    media: JSON.parse(r.media) as string[],
    link: r.link,
    campaign: r.campaign,
    status: r.status as PostStatus,
    remindedAt: r.reminded_at,
    postedAt: r.posted_at,
    results: cleanResults(JSON.parse(r.results || '{}')),
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  })

  const get = (id: string): Post | null => {
    const row = db.prepare('select * from posts where id = ?').get(String(id)) as unknown as
      PostRow | undefined
    return row ? toPost(row) : null
  }

  function dueRows(): Post[] {
    const at = now()
    return (
      db
        .prepare("select * from posts where status = 'ready' order by date, time")
        .all() as unknown as PostRow[]
    )
      .map(toPost)
      .filter((p) => dueAt(p) <= at)
  }

  const store: PostStore = {
    list(filter = {}) {
      const where: string[] = []
      const args: string[] = []
      if (filter.month) {
        if (!/^\d{4}-\d{2}$/.test(filter.month))
          throw new MarketingError('A month is written like 2026-12.')
        where.push('date like ?')
        args.push(`${filter.month}-%`)
      }
      if (filter.from) {
        where.push('date >= ?')
        args.push(checkDate(filter.from))
      }
      if (filter.to) {
        where.push('date <= ?')
        args.push(checkDate(filter.to))
      }
      if (filter.platform) {
        where.push('platform = ?')
        args.push(filter.platform)
      }
      if (filter.status) {
        where.push('status = ?')
        args.push(filter.status)
      }
      if (filter.campaign) {
        where.push('lower(campaign) = lower(?)')
        args.push(filter.campaign)
      }
      return (
        db
          .prepare(
            `select * from posts ${where.length ? `where ${where.join(' and ')}` : ''} order by date, time, platform`
          )
          .all(...args) as unknown as PostRow[]
      ).map(toPost)
    },

    get,

    save(inputs, source) {
      if (!inputs.length) throw new MarketingError('There are no posts to save.')
      if (inputs.length > MAX_BATCH)
        throw new MarketingError(`Save at most ${MAX_BATCH} posts at a time.`)
      // Everything is checked before anything is saved.
      const checked = inputs.map((input, i) => {
        const existing = input.id ? get(String(input.id)) : null
        if (input.id && !existing)
          throw new MarketingError(`Post ${i + 1}: there is no post with that id.`)
        try {
          return { existing, fields: checkPost(existing ? { ...existing, ...input } : input) }
        } catch (error) {
          throw new MarketingError(`Post ${i + 1}: ${(error as Error).message}`)
        }
      })
      const count = (db.prepare('select count(*) as n from posts').get() as { n: number }).n
      const added = checked.filter((c) => !c.existing).length
      if (count + added > MAX_POSTS)
        throw new MarketingError(
          `The calendar holds ${MAX_POSTS} posts. Remove old ones before adding more.`
        )
      const at = now()
      const saved: string[] = []
      db.exec('begin')
      try {
        for (const { existing, fields } of checked) {
          const id = existing?.id ?? randomUUID()
          // A post moved to another time is reminded again; a posted one keeps its mark.
          const moved = !existing || existing.date !== fields.date || existing.time !== fields.time
          db.prepare(
            `insert into posts (id, platform, date, time, text, hashtags, media, link, campaign, status,
               reminded_at, posted_at, source, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             on conflict(id) do update set platform = excluded.platform, date = excluded.date,
               time = excluded.time, text = excluded.text, hashtags = excluded.hashtags,
               media = excluded.media, link = excluded.link, campaign = excluded.campaign,
               status = excluded.status, reminded_at = excluded.reminded_at,
               posted_at = excluded.posted_at, updated_at = excluded.updated_at`
          ).run(
            id,
            fields.platform,
            fields.date,
            fields.time,
            fields.text,
            JSON.stringify(fields.hashtags),
            JSON.stringify(fields.media),
            fields.link,
            fields.campaign,
            fields.status,
            moved ? null : (existing?.remindedAt ?? null),
            fields.status === 'posted' ? (existing?.postedAt ?? at) : null,
            existing?.source ?? source,
            existing?.createdAt ?? at,
            at
          )
          saved.push(id)
        }
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
      changed()
      return saved.map((id) => get(id)!)
    },

    setStatus(id, status) {
      const post = get(id)
      if (!post) throw new MarketingError('There is no such post.')
      if (!(POST_STATUSES as readonly string[]).includes(status))
        throw new MarketingError(`A post is ${POST_STATUSES.join(', ')}.`)
      db.prepare('update posts set status = ?, posted_at = ?, updated_at = ? where id = ?').run(
        status,
        status === 'posted' ? (post.postedAt ?? now()) : null,
        now(),
        post.id
      )
      changed()
      return get(post.id)!
    },

    setResults(id, results) {
      const post = get(id)
      if (!post) throw new MarketingError('There is no such post.')
      const next = { ...post.results, ...cleanResults(results) }
      db.prepare('update posts set results = ?, updated_at = ? where id = ?').run(
        JSON.stringify(next),
        now(),
        post.id
      )
      changed()
      return get(post.id)!
    },

    remove(id) {
      if (!get(id)) throw new MarketingError('There is no such post.')
      db.prepare('delete from posts where id = ?').run(String(id))
      changed()
    },

    due: dueRows,

    takeDue() {
      const at = now()
      const fresh = dueRows().filter((p) => p.remindedAt === null)
      if (!fresh.length) return []
      for (const post of fresh)
        db.prepare('update posts set reminded_at = ? where id = ?').run(at, post.id)
      changed()
      // One that came due long ago (the laptop was off for days) is marked but not announced.
      return fresh.filter((p) => at - dueAt(p) <= REMIND_WINDOW_MS)
    }
  }
  return store
}
