/**
 * The web watcher (feature 5.5; decisions §61): a watch is a short list of
 * public pages and what the user cares about in them. A check reads each
 * page again (politely, as robots.txt allows, through the task's network
 * policy), compares its text with the last time, and says what was added
 * and removed. The agent then says what matters to the company.
 *
 * Everything is kept on the laptop, in the local database. Pages are data,
 * never instructions (guardrails §5).
 */
import { createHash, randomUUID } from 'node:crypto'

import type { Db } from '../db'
import { AutomationError, checkName } from './schedule'

export const MAX_WATCH_PAGES = 10
export const MAX_WATCHES = 50
const MAX_TEXT = 300_000
const MAX_DIFF_LINES = 60
const KEEP_CHANGES = 30

export interface Watch {
  id: string
  name: string
  urls: string[]
  /** What matters to the user in these pages, in their words. */
  about: string
  /**
   * Read in the browser instead of by our plain reader: the user's choice, for
   * a site that turns automated readers away (decisions §29, §61).
   */
  browser: boolean
  source: string
  createdAt: number
  lastCheckedAt: number | null
  lastChangedAt: number | null
}

export interface PageChange {
  url: string
  /** First time this page was read: nothing to compare with yet. */
  first: boolean
  changed: boolean
  added: string[]
  removed: string[]
  /** More lines changed than are listed. */
  more: number
  /** Why the page couldn't be read this time; its last text is kept. */
  error: string | null
}

export interface WatchCheck {
  watch: Watch
  at: number
  pages: PageChange[]
}

export interface StoredChange {
  url: string
  at: number
  added: string[]
  removed: string[]
}

/** Lines worth comparing: trimmed, without blanks, numbers-only lines and clocks. */
export function linesOf(text: string): string[] {
  return text
    .slice(0, MAX_TEXT)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 2 && !/^[\d\s.:,/-]+$/.test(l))
}

function plain(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A feed (RSS or Atom) as one line per item, "Title (address)", so a new item
 * is one new line; null when the text isn't a feed. Official sources publish
 * feeds for exactly this (EUR-Lex's predefined RSS alerts, decisions §61).
 */
export function feedLines(text: string): string[] | null {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 3000))) return null
  const items = text.slice(0, 3_000_000).match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? []
  return items
    .slice(0, 500)
    .map((item) => {
      const title = plain(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(item)?.[1] ?? '').slice(0, 400)
      const link =
        plain(/<link[^>]*>([^<]+)<\/link>/i.exec(item)?.[1] ?? '') ||
        plain(/<link[^>]*href="([^"]+)"/i.exec(item)?.[1] ?? '')
      return [title, /^https?:\/\//i.test(link) ? `(${link.slice(0, 500)})` : '']
        .filter(Boolean)
        .join(' ')
    })
    .filter(Boolean)
}

/** What's in `next` and not in `before`, and the other way round, in page order. */
export function diffLines(
  before: string,
  next: string
): { added: string[]; removed: string[]; more: number } {
  const a = linesOf(before)
  const b = linesOf(next)
  const count = (lines: string[]): Map<string, number> => {
    const map = new Map<string, number>()
    for (const l of lines) map.set(l, (map.get(l) ?? 0) + 1)
    return map
  }
  const only = (lines: string[], other: Map<string, number>): string[] => {
    const left = new Map(other)
    const out: string[] = []
    for (const l of lines) {
      const n = left.get(l) ?? 0
      if (n > 0) left.set(l, n - 1)
      else out.push(l)
    }
    return out
  }
  const added = only(b, count(a))
  const removed = only(a, count(b))
  const more =
    Math.max(0, added.length - MAX_DIFF_LINES) + Math.max(0, removed.length - MAX_DIFF_LINES)
  const cut = (lines: string[]): string[] =>
    lines.slice(0, MAX_DIFF_LINES).map((l) => l.slice(0, 500))
  return { added: cut(added), removed: cut(removed), more }
}

export function checkUrls(input: unknown): string[] {
  const list = (Array.isArray(input) ? input : [input]).map((u) => String(u ?? '').trim())
  const urls: string[] = []
  for (const raw of list) {
    if (!raw) continue
    let url: URL
    // Another kind of address (file:, ftp:) is never turned into a web one.
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw))
      throw new AutomationError('A watch reads web pages (http or https).')
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    } catch {
      throw new AutomationError(`"${raw.slice(0, 80)}" is not a web address.`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new AutomationError('A watch reads web pages (http or https).')
    if (url.username || url.password)
      throw new AutomationError('Addresses with a login in them are not watched.')
    url.hash = ''
    if (!urls.includes(url.toString())) urls.push(url.toString())
  }
  if (!urls.length) throw new AutomationError('Name at least one page to watch.')
  if (urls.length > MAX_WATCH_PAGES)
    throw new AutomationError(`A watch has at most ${MAX_WATCH_PAGES} pages.`)
  return urls
}

interface WatchRow {
  id: string
  name: string
  urls: string
  about: string
  via: string
  source: string
  created_at: number
  last_checked_at: number | null
  last_changed_at: number | null
}

export interface WatchStore {
  list(): Watch[]
  /** By id or name (any case). */
  get(idOrName: string): Watch | null
  save(input: {
    name: unknown
    urls: unknown
    about?: unknown
    browser?: unknown
    source: string
  }): Watch
  remove(idOrName: string): void
  /**
   * Compare freshly read pages with the last time and remember them.
   * `read` gives a page's text, or throws with the reason it couldn't.
   */
  check(idOrName: string, read: (url: string) => Promise<string>): Promise<WatchCheck>
  /** The latest changes seen, newest first. */
  changes(idOrName: string, limit?: number): StoredChange[]
}

export function createWatchStore(deps: {
  db: Db
  onChange?: () => void
  now?: () => number
}): WatchStore {
  const { db } = deps
  const now = deps.now ?? Date.now
  const changed = deps.onChange ?? (() => undefined)

  const toWatch = (r: WatchRow): Watch => ({
    id: r.id,
    name: r.name,
    urls: JSON.parse(r.urls) as string[],
    about: r.about,
    browser: r.via === 'browser',
    source: r.source,
    createdAt: r.created_at,
    lastCheckedAt: r.last_checked_at,
    lastChangedAt: r.last_changed_at
  })

  const store: WatchStore = {
    list: () =>
      (db.prepare('select * from watches order by name').all() as unknown as WatchRow[]).map(
        toWatch
      ),

    get(idOrName) {
      const key = String(idOrName ?? '').trim()
      const row = db
        .prepare('select * from watches where id = ? or lower(name) = lower(?)')
        .get(key, key) as unknown as WatchRow | undefined
      return row ? toWatch(row) : null
    },

    save(input) {
      const name = checkName(input.name)
      const urls = checkUrls(input.urls)
      const about = String(input.about ?? '')
        .trim()
        .slice(0, 1000)
      const via = input.browser === true ? 'browser' : 'reader'
      const existing = store.get(name)
      if (existing) {
        db.prepare('update watches set urls = ?, about = ?, via = ? where id = ?').run(
          JSON.stringify(urls),
          about,
          // Left as it was unless said.
          input.browser === undefined ? (existing.browser ? 'browser' : 'reader') : via,
          existing.id
        )
        // Pages no longer watched are forgotten.
        for (const row of db
          .prepare('select url from watch_pages where watch_id = ?')
          .all(existing.id) as { url: string }[])
          if (!urls.includes(row.url))
            db.prepare('delete from watch_pages where watch_id = ? and url = ?').run(
              existing.id,
              row.url
            )
        changed()
        return store.get(existing.id)!
      }
      if (store.list().length >= MAX_WATCHES)
        throw new AutomationError(`There are already ${MAX_WATCHES} watches. Remove one first.`)
      const id = randomUUID()
      db.prepare(
        'insert into watches (id, name, urls, about, via, source, created_at) values (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, name, JSON.stringify(urls), about, via, input.source.slice(0, 200), now())
      changed()
      return store.get(id)!
    },

    remove(idOrName) {
      const watch = store.get(idOrName)
      if (!watch) throw new AutomationError('There is no such watch.')
      db.prepare('delete from watches where id = ?').run(watch.id)
      changed()
    },

    async check(idOrName, read) {
      const watch = store.get(idOrName)
      if (!watch)
        throw new AutomationError(`There is no watch called "${String(idOrName).slice(0, 80)}".`)
      const at = now()
      const pages: PageChange[] = []
      for (const url of watch.urls) {
        const before = db
          .prepare('select text, hash from watch_pages where watch_id = ? and url = ?')
          .get(watch.id, url) as { text: string; hash: string } | undefined
        let text: string
        try {
          const raw = await read(url)
          // A feed is compared item by item; a page line by line.
          text = (feedLines(raw) ?? linesOf(raw)).join('\n')
        } catch (error) {
          pages.push({
            url,
            first: !before,
            changed: false,
            added: [],
            removed: [],
            more: 0,
            error: String((error as Error).message ?? error).slice(0, 300)
          })
          continue
        }
        const hash = createHash('sha256').update(text).digest('hex')
        const diff =
          before && before.hash !== hash
            ? diffLines(before.text, text)
            : { added: [], removed: [], more: 0 }
        const isChanged = diff.added.length + diff.removed.length > 0
        db.prepare(
          `insert into watch_pages (watch_id, url, text, hash, checked_at) values (?, ?, ?, ?, ?)
           on conflict(watch_id, url) do update set text = excluded.text, hash = excluded.hash, checked_at = excluded.checked_at`
        ).run(watch.id, url, text, hash, at)
        if (isChanged)
          db.prepare(
            'insert into watch_changes (id, watch_id, url, at, added, removed) values (?, ?, ?, ?, ?, ?)'
          ).run(
            randomUUID(),
            watch.id,
            url,
            at,
            JSON.stringify(diff.added),
            JSON.stringify(diff.removed)
          )
        pages.push({ url, first: !before, changed: isChanged, ...diff, error: null })
      }
      const anyChange = pages.some((p) => p.changed)
      db.prepare(
        'update watches set last_checked_at = ?, last_changed_at = coalesce(?, last_changed_at) where id = ?'
      ).run(at, anyChange ? at : null, watch.id)
      // Only the latest changes are kept.
      db.prepare(
        `delete from watch_changes where watch_id = ? and id not in
         (select id from watch_changes where watch_id = ? order by at desc limit ?)`
      ).run(watch.id, watch.id, KEEP_CHANGES)
      changed()
      return { watch: store.get(watch.id)!, at, pages }
    },

    changes(idOrName, limit = 10) {
      const watch = store.get(idOrName)
      if (!watch) return []
      return (
        db
          .prepare(
            'select url, at, added, removed from watch_changes where watch_id = ? order by at desc limit ?'
          )
          .all(watch.id, Math.min(KEEP_CHANGES, Math.max(1, limit))) as {
          url: string
          at: number
          added: string
          removed: string
        }[]
      ).map((r) => ({
        url: r.url,
        at: r.at,
        added: JSON.parse(r.added) as string[],
        removed: JSON.parse(r.removed) as string[]
      }))
    }
  }
  return store
}

/** A check as text for the model and the report. */
export function checkText(check: WatchCheck): string {
  const lines: string[] = [
    `Watch "${check.watch.name}", checked ${new Date(check.at).toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    check.watch.about ? `What matters to the user: ${check.watch.about}` : ''
  ]
  for (const p of check.pages) {
    lines.push('', `Page: ${p.url}`)
    if (p.error) lines.push(`Could not be read this time: ${p.error}`)
    else if (p.first)
      lines.push('Read for the first time: this is the starting point for later checks.')
    else if (!p.changed) lines.push('No change since the last check.')
    else {
      if (p.added.length) lines.push('New since the last check:', ...p.added.map((l) => `+ ${l}`))
      if (p.removed.length)
        lines.push('Gone since the last check:', ...p.removed.map((l) => `- ${l}`))
      if (p.more) lines.push(`(and ${p.more} more changed lines)`)
    }
  }
  return lines.filter((l, i) => l !== '' || i > 1).join('\n')
}
