/**
 * Artifacts (§17, decisions §44): what an agent makes for the user to see,
 * use and share. Kept in the local database with a version for every change
 * (17.10), by an agent or by the user's own edit, so any version can be
 * compared, restored and downloaded. Nothing leaves the laptop unless the user
 * presses Share (17.13).
 */
import { randomUUID } from 'node:crypto'

import {
  ARTIFACT_KINDS,
  type Artifact,
  type ArtifactDetail,
  type ArtifactKind,
  type ArtifactVersion
} from '../shared/protocol'
import type { Db } from './lib/db'

export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024

export class ArtifactError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'BAD_REQUEST',
    message: string
  ) {
    super(message)
    this.name = 'ArtifactError'
  }
}

/** A spreadsheet's content: column names and rows. */
export interface SheetData {
  columns: string[]
  rows: (string | number | boolean | null)[][]
}

/** A chart's content: labels along one axis and one or more series of numbers. */
export interface ChartData {
  type: 'bar' | 'line' | 'area' | 'pie'
  title?: string
  unit?: string
  labels: string[]
  series: { name: string; values: number[] }[]
}

function parseJson(content: string, what: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    throw new ArtifactError('BAD_REQUEST', `A ${what} is JSON; this isn't valid JSON.`)
  }
}

export function parseSheet(content: string): SheetData {
  const value = parseJson(content, 'spreadsheet') as Partial<SheetData>
  if (!Array.isArray(value.columns) || !value.columns.every((c) => typeof c === 'string'))
    throw new ArtifactError('BAD_REQUEST', 'A spreadsheet needs "columns": a list of names.')
  if (!Array.isArray(value.rows) || !value.rows.every((r) => Array.isArray(r)))
    throw new ArtifactError('BAD_REQUEST', 'A spreadsheet needs "rows": a list of lists.')
  for (const row of value.rows)
    for (const cell of row)
      if (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell))
        throw new ArtifactError(
          'BAD_REQUEST',
          'Spreadsheet cells are text, numbers, true/false or empty.'
        )
  return { columns: value.columns, rows: value.rows as SheetData['rows'] }
}

export function parseChart(content: string): ChartData {
  const value = parseJson(content, 'chart') as Partial<ChartData>
  if (!['bar', 'line', 'area', 'pie'].includes(value.type as string))
    throw new ArtifactError('BAD_REQUEST', 'A chart\'s "type" is bar, line, area or pie.')
  if (!Array.isArray(value.labels) || !value.labels.every((l) => typeof l === 'string'))
    throw new ArtifactError('BAD_REQUEST', 'A chart needs "labels": a list of text.')
  if (
    !Array.isArray(value.series) ||
    !value.series.length ||
    !value.series.every(
      (s) =>
        s &&
        typeof s.name === 'string' &&
        Array.isArray(s.values) &&
        s.values.every((n) => typeof n === 'number' && Number.isFinite(n))
    )
  )
    throw new ArtifactError(
      'BAD_REQUEST',
      'A chart needs "series": a list of { "name", "values": [numbers] }.'
    )
  return value as ChartData
}

/** Checks an artifact's content for its kind. */
export function checkContent(kind: ArtifactKind, content: string): void {
  if (typeof content !== 'string' || !content.trim())
    throw new ArtifactError('BAD_REQUEST', 'The artifact is empty.')
  if (Buffer.byteLength(content) > MAX_ARTIFACT_BYTES)
    throw new ArtifactError('BAD_REQUEST', 'The artifact is too large (2 MB at most).')
  if (kind === 'spreadsheet') parseSheet(content)
  if (kind === 'chart') parseChart(content)
}

interface Row {
  id: string
  task_id: string | null
  kind: ArtifactKind
  title: string
  version: number
  share_url: string | null
  created_at: number
  updated_at: number
}

function toArtifact(row: Row): Artifact {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    title: row.title,
    version: row.version,
    shareUrl: row.share_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

interface VersionRow {
  artifact_id: string
  version: number
  content: string
  author: string
  note: string
  created_at: number
}

function toVersion(row: VersionRow): ArtifactVersion {
  return {
    artifactId: row.artifact_id,
    version: row.version,
    content: row.content,
    author: row.author,
    note: row.note,
    createdAt: row.created_at
  }
}

export interface ArtifactStore {
  create(input: {
    taskId: string | null
    kind: string
    title: string
    content: string
    author: string
    note?: string
  }): Artifact
  /** A new version; the content, the title or both. */
  update(
    id: string,
    input: { content?: string; title?: string; author: string; note?: string }
  ): Artifact
  /** A new version with an older version's content. */
  restore(id: string, version: number, author: string): Artifact
  get(id: string): ArtifactDetail
  version(id: string, version: number): ArtifactVersion
  list(filter?: { taskId?: string; query?: string; limit?: number }): Artifact[]
  remove(id: string): void
  /** The share link (feature 17.13), or null when unshared. */
  setShare(id: string, share: { id: string; url: string } | null): Artifact
  shareId(id: string): string | null
}

export function createArtifactStore(
  db: Db,
  onChange: (artifact: Artifact | null, byAgent: boolean) => void = () => undefined,
  now: () => number = Date.now
): ArtifactStore {
  function row(id: string): Row {
    const found = db.prepare('select * from artifacts where id = ?').get(id) as Row | undefined
    if (!found) throw new ArtifactError('NOT_FOUND', 'There is no such artifact.')
    return found
  }

  function cleanTitle(title: unknown): string {
    const value = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
    if (!value) throw new ArtifactError('BAD_REQUEST', 'Give the artifact a title.')
    return value
  }

  function addVersion(
    id: string,
    version: number,
    content: string,
    author: string,
    note: string
  ): void {
    db.prepare(
      'insert into artifact_versions (artifact_id, version, content, author, note, created_at) values (?, ?, ?, ?, ?, ?)'
    ).run(id, version, content, author.slice(0, 120), note.slice(0, 300), now())
  }

  const store: ArtifactStore = {
    create(input) {
      const kind = input.kind as ArtifactKind
      if (!ARTIFACT_KINDS.includes(kind))
        throw new ArtifactError('BAD_REQUEST', `The kind is one of: ${ARTIFACT_KINDS.join(', ')}.`)
      const title = cleanTitle(input.title)
      checkContent(kind, input.content)
      const id = randomUUID()
      const at = now()
      db.exec('begin')
      try {
        db.prepare(
          'insert into artifacts (id, task_id, kind, title, version, created_at, updated_at) values (?, ?, ?, ?, 1, ?, ?)'
        ).run(id, input.taskId, kind, title, at, at)
        addVersion(id, 1, input.content, input.author, input.note ?? 'Created')
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
      const artifact = toArtifact(row(id))
      onChange(artifact, input.author !== 'you')
      return artifact
    },

    update(id, input) {
      const current = row(id)
      const previous = store.version(id, current.version)
      const content = input.content ?? previous.content
      const title = input.title === undefined ? current.title : cleanTitle(input.title)
      checkContent(current.kind, content)
      if (content === previous.content && title === current.title) return toArtifact(current)
      const next = current.version + 1
      db.exec('begin')
      try {
        addVersion(
          id,
          next,
          content,
          input.author,
          input.note ?? (input.content ? 'Edited' : 'Renamed')
        )
        db.prepare('update artifacts set version = ?, title = ?, updated_at = ? where id = ?').run(
          next,
          title,
          now(),
          id
        )
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
      const artifact = toArtifact(row(id))
      onChange(artifact, input.author !== 'you')
      return artifact
    },

    restore(id, version, author) {
      const old = store.version(id, version)
      return store.update(id, { content: old.content, author, note: `Restored version ${version}` })
    },

    get(id) {
      const artifact = toArtifact(row(id))
      const versions = (
        db
          .prepare(
            'select artifact_id, version, author, note, created_at from artifact_versions where artifact_id = ? order by version desc'
          )
          .all(id) as unknown as Omit<VersionRow, 'content'>[]
      ).map((v) => ({
        artifactId: v.artifact_id,
        version: v.version,
        author: v.author,
        note: v.note,
        createdAt: v.created_at
      }))
      return { artifact, current: store.version(id, artifact.version), versions }
    },

    version(id, version) {
      const found = db
        .prepare('select * from artifact_versions where artifact_id = ? and version = ?')
        .get(id, version) as VersionRow | undefined
      if (!found) throw new ArtifactError('NOT_FOUND', 'There is no such version.')
      return toVersion(found)
    },

    list(filter = {}) {
      const limit = Math.max(1, Math.min(500, filter.limit ?? 200))
      const where: string[] = []
      const args: (string | number)[] = []
      if (filter.taskId) {
        where.push('task_id = ?')
        args.push(filter.taskId)
      }
      if (filter.query?.trim()) {
        where.push('title like ?')
        args.push(`%${filter.query.trim().replace(/[%_]/g, '')}%`)
      }
      const sql = `select * from artifacts ${where.length ? `where ${where.join(' and ')}` : ''} order by updated_at desc limit ${limit}`
      return (db.prepare(sql).all(...args) as unknown as Row[]).map(toArtifact)
    },

    remove(id) {
      row(id)
      db.prepare('delete from artifacts where id = ?').run(id)
      onChange(null, false)
    },

    setShare(id, share) {
      row(id)
      db.prepare('update artifacts set share_id = ?, share_url = ? where id = ?').run(
        share?.id ?? null,
        share?.url ?? null,
        id
      )
      const artifact = toArtifact(row(id))
      onChange(artifact, false)
      return artifact
    },

    shareId(id) {
      return (
        (
          db.prepare('select share_id from artifacts where id = ?').get(id) as
            { share_id: string | null } | undefined
        )?.share_id ?? null
      )
    }
  }
  return store
}

/** What a tool sees (permission `artifacts`). */
export interface ArtifactAccess {
  create(input: { kind: string; title: string; content: string; note?: string }): Artifact
  update(id: string, input: { content?: string; title?: string; note?: string }): Artifact
  read(id: string, version?: number): { artifact: Artifact; content: string; version: number }
  list(query?: string): Artifact[]
  /** The artifact as a file (17.24). */
  export(id: string, format: string): Promise<{ name: string; data: Buffer }>
}
