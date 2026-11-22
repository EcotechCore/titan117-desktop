/**
 * The shared data layer for sidebar apps (6.11, 6.12; decisions §58): a
 * local SQLite database per app, in the engine's data folder, through
 * Node's built-in driver. Records are JSON documents in named collections,
 * so an app (or an agent fixing it, 6.14) never needs a migration. Every
 * change is also written to a change log, which end-to-end encrypted sync
 * (6.12) will send later; nothing here leaves the laptop.
 *
 * Who may read or write which collection is decided by the sidebar
 * (`sidebar.ts`); this module only keeps the data and checks its shape.
 */
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export class DataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataError'
  }
}

/** A stored record: the app's own fields plus its id and times. */
export type Row = { id: string; _created: number; _updated: number } & Record<string, unknown>

export type FieldValue = string | number | boolean | null

export interface Query {
  /** Fields that must equal these values. */
  where?: Record<string, FieldValue>
  /** Text anywhere in the record (case-insensitive). */
  search?: string
  orderBy?: string
  desc?: boolean
  limit?: number
  offset?: number
}

export interface CollectionInfo {
  name: string
  count: number
  /** Field names seen in the newest records. */
  fields: string[]
}

export interface Change {
  seq: number
  collection: string
  id: string
  op: 'put' | 'delete'
  at: number
}

export const APP_ID = /^[a-z0-9][a-z0-9-]{0,59}$/
export const COLLECTION = /^[a-z][a-z0-9_]{0,39}$/
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/
/** One record at most (a record is a row, not a file). */
export const MAX_RECORD_BYTES = 256_000
export const MAX_LIMIT = 500
/** Collections per app, and records per app, so a runaway app can't fill the disk. */
const MAX_COLLECTIONS = 100
const MAX_RECORDS = 200_000

export interface DataLayer {
  collections(app: string): CollectionInfo[]
  list(app: string, collection: string, query?: Query): Row[]
  count(app: string, collection: string, query?: Query): number
  get(app: string, collection: string, id: string): Row | null
  insert(app: string, collection: string, data: unknown): Row
  update(app: string, collection: string, id: string, patch: unknown): Row
  remove(app: string, collection: string, id: string): boolean
  /** The change log after `seq`, for sync (6.12). */
  changesSince(app: string, seq: number, limit?: number): Change[]
  /** Delete an app's data for good (the user's choice when removing it). */
  drop(app: string): void
  close(): void
}

const SCHEMA = `
  create table if not exists docs (
    collection text not null,
    id text not null,
    data text not null,
    created integer not null,
    updated integer not null,
    primary key (collection, id)
  );
  create index if not exists docs_updated on docs(collection, updated);
  create table if not exists changes (
    seq integer primary key autoincrement,
    collection text not null,
    id text not null,
    op text not null,
    at integer not null
  );
`

function checkApp(app: string): void {
  if (!APP_ID.test(app)) throw new DataError(`"${app}" isn't a sidebar app.`)
}

export function checkCollection(name: string): void {
  if (typeof name !== 'string' || !COLLECTION.test(name))
    throw new DataError(
      `"${String(name).slice(0, 60)}" isn't a collection name: lowercase letters, digits and _, starting with a letter, 40 at most.`
    )
}

function checkField(name: string): void {
  if (!FIELD.test(name)) throw new DataError(`"${name.slice(0, 70)}" isn't a field name.`)
}

/** A record's own fields: a plain object, field names checked, no id or times (those are ours). */
function cleanData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new DataError('A record is an object of fields, like { "name": "Ana" }.')
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key === 'id' || key === '_created' || key === '_updated') continue
    checkField(key)
    if (value !== undefined) out[key] = value
  }
  const text = JSON.stringify(out)
  if (Buffer.byteLength(text) > MAX_RECORD_BYTES)
    throw new DataError('That record is too big (256 KB at most). Keep files out of records.')
  return out
}

const like = (text: string): string => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export function createDataLayer(root: string): DataLayer {
  const open = new Map<string, DatabaseSync>()

  function db(app: string): DatabaseSync {
    checkApp(app)
    let handle = open.get(app)
    if (handle) return handle
    const dir = join(root, app)
    mkdirSync(dir, { recursive: true })
    handle = new DatabaseSync(join(dir, 'data.db'))
    handle.exec('pragma journal_mode = wal; pragma foreign_keys = on;')
    handle.exec(SCHEMA)
    open.set(app, handle)
    return handle
  }

  function where(query: Query | undefined, params: (string | number | null)[]): string {
    const parts: string[] = []
    for (const [field, value] of Object.entries(query?.where ?? {})) {
      checkField(field)
      if (value === null) parts.push(`json_extract(data, '$.${field}') is null`)
      else if (['string', 'number', 'boolean'].includes(typeof value)) {
        parts.push(`json_extract(data, '$.${field}') = ?`)
        params.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number))
      } else
        throw new DataError(
          `"${field}" can only be matched with text, a number, true, false or null.`
        )
    }
    if (query?.search) {
      parts.push(`lower(data) like lower(?) escape '\\'`)
      params.push(like(String(query.search).slice(0, 200)))
    }
    return parts.length ? ` and ${parts.join(' and ')}` : ''
  }

  function toRow(r: { id: string; data: string; created: number; updated: number }): Row {
    return {
      ...(JSON.parse(r.data) as Record<string, unknown>),
      id: r.id,
      _created: r.created,
      _updated: r.updated
    }
  }

  function logChange(handle: DatabaseSync, collection: string, id: string, op: Change['op']): void {
    handle
      .prepare('insert into changes (collection, id, op, at) values (?, ?, ?, ?)')
      .run(collection, id, op, Date.now())
  }

  const layer: DataLayer = {
    collections(app) {
      const handle = db(app)
      const names = handle
        .prepare(
          'select collection as name, count(*) as n from docs group by collection order by collection'
        )
        .all() as { name: string; n: number }[]
      return names.map(({ name, n }) => {
        const recent = handle
          .prepare('select data from docs where collection = ? order by updated desc limit 20')
          .all(name) as { data: string }[]
        const fields = new Set<string>()
        for (const r of recent) for (const k of Object.keys(JSON.parse(r.data))) fields.add(k)
        return { name, count: n, fields: [...fields].slice(0, 60) }
      })
    },

    list(app, collection, query) {
      checkCollection(collection)
      const params: (string | number | null)[] = [collection]
      const filter = where(query, params)
      let order = 'updated desc'
      if (query?.orderBy) {
        if (query.orderBy === '_created' || query.orderBy === '_updated')
          order = `${query.orderBy.slice(1)} ${query.desc ? 'desc' : 'asc'}`
        else {
          checkField(query.orderBy)
          order = `json_extract(data, '$.${query.orderBy}') ${query.desc ? 'desc' : 'asc'}`
        }
      }
      const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(query?.limit ?? 100)))
      const offset = Math.max(0, Math.floor(query?.offset ?? 0))
      const rows = db(app)
        .prepare(
          `select id, data, created, updated from docs where collection = ?${filter} order by ${order} limit ${limit} offset ${offset}`
        )
        .all(...params) as { id: string; data: string; created: number; updated: number }[]
      return rows.map(toRow)
    },

    count(app, collection, query) {
      checkCollection(collection)
      const params: (string | number | null)[] = [collection]
      const filter = where(query, params)
      return (
        db(app)
          .prepare(`select count(*) as n from docs where collection = ?${filter}`)
          .get(...params) as { n: number }
      ).n
    },

    get(app, collection, id) {
      checkCollection(collection)
      if (typeof id !== 'string' || !RECORD_ID.test(id)) return null
      const row = db(app)
        .prepare('select id, data, created, updated from docs where collection = ? and id = ?')
        .get(collection, id) as
        { id: string; data: string; created: number; updated: number } | undefined
      return row ? toRow(row) : null
    },

    insert(app, collection, data) {
      checkCollection(collection)
      const handle = db(app)
      const fields = cleanData(data)
      const given = (data as Record<string, unknown>).id
      const id =
        typeof given === 'string' && RECORD_ID.test(given)
          ? given
          : randomBytes(9).toString('base64url')
      const total = (handle.prepare('select count(*) as n from docs').get() as { n: number }).n
      if (total >= MAX_RECORDS)
        throw new DataError('This app has too many records (200,000 at most).')
      const known = handle
        .prepare('select 1 from docs where collection = ? limit 1')
        .get(collection)
      if (!known) {
        const n = (
          handle.prepare('select count(distinct collection) as n from docs').get() as { n: number }
        ).n
        if (n >= MAX_COLLECTIONS)
          throw new DataError('This app has too many collections (100 at most).')
      }
      if (handle.prepare('select 1 from docs where collection = ? and id = ?').get(collection, id))
        throw new DataError(`There's already a record "${id}" in ${collection}.`)
      const now = Date.now()
      handle
        .prepare('insert into docs (collection, id, data, created, updated) values (?, ?, ?, ?, ?)')
        .run(collection, id, JSON.stringify(fields), now, now)
      logChange(handle, collection, id, 'put')
      return { ...fields, id, _created: now, _updated: now }
    },

    update(app, collection, id, patch) {
      const current = layer.get(app, collection, id)
      if (!current)
        throw new DataError(`There's no record "${String(id).slice(0, 64)}" in ${collection}.`)
      const changes = cleanData(patch)
      const { id: _id, _created, _updated, ...fields } = current
      void _id
      void _updated
      const next: Record<string, unknown> = { ...fields }
      // A field set to null is removed.
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) delete next[k]
        else next[k] = v
      }
      const text = JSON.stringify(next)
      if (Buffer.byteLength(text) > MAX_RECORD_BYTES)
        throw new DataError('That record is too big (256 KB at most).')
      const now = Date.now()
      const handle = db(app)
      handle
        .prepare('update docs set data = ?, updated = ? where collection = ? and id = ?')
        .run(text, now, collection, id)
      logChange(handle, collection, id, 'put')
      return { ...next, id, _created, _updated: now }
    },

    remove(app, collection, id) {
      checkCollection(collection)
      if (typeof id !== 'string' || !RECORD_ID.test(id)) return false
      const handle = db(app)
      const result = handle
        .prepare('delete from docs where collection = ? and id = ?')
        .run(collection, id)
      if (!result.changes) return false
      logChange(handle, collection, id, 'delete')
      return true
    },

    changesSince(app, seq, limit = 1000) {
      return db(app)
        .prepare(
          'select seq, collection, id, op, at from changes where seq > ? order by seq limit ?'
        )
        .all(Math.max(0, seq), Math.min(5000, limit)) as unknown as Change[]
    },

    drop(app) {
      checkApp(app)
      open.get(app)?.close()
      open.delete(app)
      const dir = join(root, app)
      if (existsSync(dir)) rmSync(join(dir, 'data.db'), { force: true })
      rmSync(join(dir, 'data.db-wal'), { force: true })
      rmSync(join(dir, 'data.db-shm'), { force: true })
    },

    close() {
      for (const handle of open.values()) handle.close()
      open.clear()
    }
  }
  return layer
}
