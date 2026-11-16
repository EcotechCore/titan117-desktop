/**
 * The folder agent's index (features 7.1, 7.4, 7.5; decisions §51). Document
 * folders are allowed folders the user turned on in Documents: their files
 * are read into passages that know their file and page, kept in the local
 * database with full-text search, and, once the embedding model is on the
 * laptop, with vectors for search by meaning. Both are combined (reciprocal
 * rank fusion). New and changed files are picked up as they change.
 *
 * Nothing here leaves the laptop: the embedding model runs locally.
 */
import { watch, type FSWatcher } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import type { DocFolder, DocHit, DocFolderStatus } from '../../shared/protocol'
import type { Db } from './db'
import { getMeta, setMeta } from './db'
import { chunkPages, parseDocument, readable } from './documents'

export type { DocFolder, DocHit, DocFolderStatus }

/** Files larger than this are skipped (decisions §51). */
export const MAX_DOC_BYTES = 50 * 1024 * 1024
const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])

/** Turns text into vectors; null until the model is on the laptop. */
export interface Embedder {
  /** `kind` matters for e5-style models: queries and passages are marked differently. */
  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>
}

function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

function fromBlob(b: Uint8Array): Float32Array {
  const copy = new Uint8Array(b)
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4)
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]
  return s
}

function comparable(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** A query as FTS5 terms: words only, each quoted, any of them (ranked by bm25). */
export function ftsQuery(query: string): string | null {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 24)
  return words.length ? words.map((w) => `"${w}"`).join(' OR ') : null
}

export interface DocIndex {
  folders(): DocFolder[]
  /** Settings for one allowed folder; turning indexing on starts it. */
  setFolder(path: string, next: Partial<Omit<DocFolder, 'path'>>): DocFolder[]
  status(): DocFolderStatus[]
  /** Read changed files again (all of them with `full`). */
  reindex(path?: string, full?: boolean): Promise<void>
  search(query: string, options?: { limit?: number; folders?: string[] }): Promise<DocHit[]>
  /** The text of one file's page, as indexed. */
  page(path: string, page: number): { label: string; text: string; pages: number } | null
  /** An indexed file, by its path inside a document folder ("Contracts/Lease.pdf") or its full path. */
  resolve(file: string): { path: string; localOnly: boolean } | null
  /** Watch the indexed folders; call once at start. */
  start(): void
  close(): void
}

export function createDocIndex(deps: {
  db: Db
  /** The allowed folders right now (a document folder must be one). */
  allowed(): string[]
  embedder(): Embedder | null
  onChange?: () => void
  log?: (error: unknown, context: Record<string, unknown>) => void
}): DocIndex {
  const { db } = deps
  const watchers = new Map<string, FSWatcher>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const running = new Map<string, Promise<void>>()
  const progress = new Map<string, { done: number; total: number }>()
  /** Vectors in memory for search; dropped when a folder is read again. */
  let vectors: Map<number, Float32Array> | null = null

  function settings(): DocFolder[] {
    const allowed = new Set(deps.allowed().map(comparable))
    return getMeta<DocFolder[]>(db, 'docFolders', []).filter((f) => allowed.has(comparable(f.path)))
  }

  function fileRow(path: string): { id: number; size: number; mtime: number } | undefined {
    return db.prepare('select id, size, mtime from doc_files where path = ?').get(path) as
      { id: number; size: number; mtime: number } | undefined
  }

  function removeFile(id: number): void {
    db.prepare('delete from doc_chunks where file_id = ?').run(id)
    db.prepare('delete from doc_files where id = ?').run(id)
  }

  async function walk(dir: string, out: string[]): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= 50_000) return
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(p, out)
      } else if (e.isFile() && readable(p)) out.push(p)
    }
  }

  async function indexFile(folder: string, path: string): Promise<void> {
    let info
    try {
      info = await stat(path)
    } catch {
      const gone = fileRow(path)
      if (gone) removeFile(gone.id)
      return
    }
    const known = fileRow(path)
    if (known && known.size === info.size && known.mtime === Math.floor(info.mtimeMs)) return
    if (known) removeFile(known.id)
    const base = {
      folder,
      path,
      size: info.size,
      mtime: Math.floor(info.mtimeMs),
      indexed_at: Date.now()
    }
    const insertFile = (row: Record<string, unknown>): number =>
      Number(
        db
          .prepare(
            `insert into doc_files (folder, path, size, mtime, indexed_at, title, pages, empty_pages, status, error)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            base.folder,
            base.path,
            base.size,
            base.mtime,
            base.indexed_at,
            (row.title as string) ?? '',
            (row.pages as number) ?? 0,
            (row.empty as number) ?? 0,
            row.status as string,
            (row.error as string) ?? null
          ).lastInsertRowid
      )
    if (info.size > MAX_DOC_BYTES) {
      insertFile({ status: 'skipped', error: 'Larger than 50 MB.' })
      return
    }
    let parsed
    try {
      parsed = await parseDocument(path, await readFile(path))
    } catch (error) {
      insertFile({ status: 'error', error: (error as Error).message.slice(0, 300) })
      return
    }
    const chunks = chunkPages(parsed.pages)
    let vecs: Float32Array[] | null = null
    const embedder = deps.embedder()
    if (embedder && chunks.length) {
      try {
        vecs = []
        for (let i = 0; i < chunks.length; i += 16)
          vecs.push(
            ...(await embedder.embed(
              chunks.slice(i, i + 16).map((c) => c.text),
              'passage'
            ))
          )
      } catch (error) {
        deps.log?.(error, { part: 'embed', path })
        vecs = null
      }
    }
    db.exec('begin')
    try {
      const id = insertFile({
        status: 'ok',
        title: parsed.title,
        pages: parsed.pages.length,
        empty: parsed.emptyPages
      })
      const insert = db.prepare(
        'insert into doc_chunks (file_id, page, label, text, vec) values (?, ?, ?, ?, ?)'
      )
      chunks.forEach((c, i) =>
        insert.run(id, c.page, c.label, c.text, vecs ? toBlob(vecs[i]) : null)
      )
      db.exec('commit')
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  }

  async function indexFolder(folder: string, full: boolean): Promise<void> {
    const files: string[] = []
    await walk(folder, files)
    const present = new Set(files.map(comparable))
    // Files that are gone, or now in a subfolder that's skipped, leave the index.
    for (const row of db.prepare('select id, path from doc_files where folder = ?').all(folder) as {
      id: number
      path: string
    }[])
      if (!present.has(comparable(row.path)) || full) removeFile(row.id)
    progress.set(folder, { done: 0, total: files.length })
    deps.onChange?.()
    for (const path of files) {
      try {
        await indexFile(folder, path)
      } catch (error) {
        deps.log?.(error, { part: 'index', path })
      }
      const p = progress.get(folder)!
      p.done++
      if (p.done % 25 === 0) deps.onChange?.()
    }
    progress.delete(folder)
    vectors = null
    deps.onChange?.()
  }

  function schedule(folder: string, full = false, delay = 0): Promise<void> {
    const current = running.get(folder)
    if (current) return current.then(() => schedule(folder, full, 0))
    const job = new Promise<void>((resolve) => setTimeout(resolve, delay))
      .then(() => indexFolder(folder, full))
      .catch((error) => deps.log?.(error, { part: 'index folder', folder }))
      .finally(() => running.delete(folder))
    running.set(folder, job)
    return job
  }

  function watchFolder(folder: string): void {
    if (watchers.has(folder)) return
    try {
      const watcher = watch(folder, { recursive: true }, () => {
        // Many changes at once (a copy, a sync) settle into one pass.
        clearTimeout(timers.get(folder))
        timers.set(
          folder,
          setTimeout(() => void schedule(folder), 2000)
        )
      })
      watcher.on('error', () => undefined)
      watchers.set(folder, watcher)
    } catch (error) {
      deps.log?.(error, { part: 'watch', folder })
    }
  }

  function unwatch(folder: string): void {
    watchers.get(folder)?.close()
    watchers.delete(folder)
    clearTimeout(timers.get(folder))
  }

  function allVectors(): Map<number, Float32Array> {
    if (vectors) return vectors
    vectors = new Map()
    for (const row of db.prepare('select id, vec from doc_chunks where vec is not null').all() as {
      id: number
      vec: Uint8Array
    }[])
      vectors.set(row.id, fromBlob(row.vec))
    return vectors
  }

  const index: DocIndex = {
    folders: settings,

    setFolder(path, next) {
      const allowed = deps.allowed().find((f) => comparable(f) === comparable(path))
      if (!allowed) throw new Error('That folder is not allowed.')
      const list = getMeta<DocFolder[]>(db, 'docFolders', []).filter(
        (f) => comparable(f.path) !== comparable(allowed)
      )
      const before = settings().find((f) => comparable(f.path) === comparable(allowed))
      // A document folder is read-only for agents unless the user says otherwise (7.8).
      const folder: DocFolder = {
        path: allowed,
        indexed: next.indexed ?? before?.indexed ?? false,
        readOnly: next.readOnly ?? before?.readOnly ?? true,
        localOnly: next.localOnly ?? before?.localOnly ?? false
      }
      setMeta(db, 'docFolders', [...list, folder])
      if (folder.indexed && !before?.indexed) {
        watchFolder(allowed)
        void schedule(allowed)
      }
      if (!folder.indexed && before?.indexed) {
        unwatch(allowed)
        for (const row of db.prepare('select id from doc_files where folder = ?').all(allowed) as {
          id: number
        }[])
          removeFile(row.id)
        vectors = null
      }
      deps.onChange?.()
      return settings()
    },

    status() {
      return settings().map((f) => {
        const counts = db
          .prepare(
            `select count(*) as files,
                    sum(case when status = 'ok' then 1 else 0 end) as ok,
                    sum(case when status != 'ok' then 1 else 0 end) as problems,
                    sum(empty_pages) as scanned
             from doc_files where folder = ?`
          )
          .get(f.path) as {
          files: number
          ok: number | null
          problems: number | null
          scanned: number | null
        }
        const passages = db
          .prepare(
            'select count(*) as n, sum(case when vec is null then 0 else 1 end) as v from doc_chunks c join doc_files f on f.id = c.file_id where f.folder = ?'
          )
          .get(f.path) as { n: number; v: number | null }
        const errors = (
          db
            .prepare(
              "select path, error from doc_files where folder = ? and status != 'ok' order by path limit 20"
            )
            .all(f.path) as { path: string; error: string }[]
        ).map((e) => ({ path: relative(f.path, e.path), error: e.error }))
        return {
          ...f,
          files: counts.files,
          ok: counts.ok ?? 0,
          problems: counts.problems ?? 0,
          scannedPages: counts.scanned ?? 0,
          passages: passages.n,
          withMeaning: passages.v ?? 0,
          progress: progress.get(f.path) ?? null,
          errors
        }
      })
    },

    async reindex(path, full = false) {
      const targets = settings().filter(
        (f) => f.indexed && (!path || comparable(f.path) === comparable(path))
      )
      await Promise.all(targets.map((f) => schedule(f.path, full)))
    },

    async search(query, options = {}) {
      const limit = Math.max(1, Math.min(20, options.limit ?? 8))
      const folders = settings()
        .filter((f) => f.indexed)
        .map((f) => f.path)
        .filter(
          (f) => !options.folders || options.folders.some((o) => comparable(o) === comparable(f))
        )
      if (!folders.length) return []
      const marks = folders.map(() => '?').join(', ')
      const ranks = new Map<number, number>()
      // Keyword search (bm25).
      const fts = ftsQuery(query)
      if (fts) {
        const rows = db
          .prepare(
            `select c.id from doc_chunks_fts
             join doc_chunks c on c.id = doc_chunks_fts.rowid
             join doc_files f on f.id = c.file_id
             where doc_chunks_fts match ? and f.folder in (${marks})
             order by bm25(doc_chunks_fts) limit 40`
          )
          .all(fts, ...folders) as { id: number }[]
        rows.forEach((r, i) => ranks.set(r.id, (ranks.get(r.id) ?? 0) + 1 / (60 + i)))
      }
      // Search by meaning, when the model is here.
      const embedder = deps.embedder()
      if (embedder) {
        try {
          const [q] = await embedder.embed([query], 'query')
          const inFolders = new Set(
            (
              db
                .prepare(
                  `select c.id from doc_chunks c join doc_files f on f.id = c.file_id where f.folder in (${marks}) and c.vec is not null`
                )
                .all(...folders) as { id: number }[]
            ).map((r) => r.id)
          )
          const scored: [number, number][] = []
          for (const [id, v] of allVectors()) if (inFolders.has(id)) scored.push([id, dot(q, v)])
          scored.sort((a, b) => b[1] - a[1])
          scored
            .slice(0, 40)
            .forEach(([id], i) => ranks.set(id, (ranks.get(id) ?? 0) + 1 / (60 + i)))
        } catch (error) {
          deps.log?.(error, { part: 'search by meaning' })
        }
      }
      const top = [...ranks.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
      return top.map(([id, score]) => {
        const row = db
          .prepare(
            'select c.page, c.label, c.text, f.path, f.folder from doc_chunks c join doc_files f on f.id = c.file_id where c.id = ?'
          )
          .get(id) as { page: number; label: string; text: string; path: string; folder: string }
        return {
          path: row.path,
          file: relative(row.folder, row.path).split(sep).join('/'),
          folder: row.folder,
          page: row.page,
          label: row.label,
          text: row.text,
          score
        }
      })
    },

    page(path, page) {
      const file = db.prepare('select id, pages from doc_files where path = ?').get(path) as
        { id: number; pages: number } | undefined
      if (!file) return null
      const rows = db
        .prepare('select label, text from doc_chunks where file_id = ? and page = ? order by id')
        .all(file.id, page) as { label: string; text: string }[]
      if (!rows.length) return null
      // Overlapping passages joined back, without the repeated part.
      let text = rows[0].text
      for (const r of rows.slice(1)) {
        const overlap = [...Array(Math.min(200, r.text.length)).keys()]
          .reverse()
          .find((n) => n > 20 && text.endsWith(r.text.slice(0, n)))
        text += overlap ? r.text.slice(overlap) : `\n${r.text}`
      }
      return { label: rows[0].label, text, pages: file.pages }
    },

    resolve(file) {
      const unify = (p: string): string => comparable(p.replace(/[\\/]+/g, '/').replace(/\/$/, ''))
      const wanted = unify(file.replace(/^\.\//, ''))
      for (const f of settings().filter((x) => x.indexed)) {
        const base = unify(f.path)
        const full = wanted.startsWith(`${base}/`) ? wanted : `${base}/${wanted}`
        const rows = db.prepare('select path from doc_files where folder = ?').all(f.path) as {
          path: string
        }[]
        const hit = rows.find((r) => unify(r.path) === full)
        if (hit) return { path: hit.path, localOnly: f.localOnly }
      }
      return null
    },

    start() {
      for (const f of settings().filter((f) => f.indexed)) {
        watchFolder(f.path)
        void schedule(f.path)
      }
    },

    close() {
      for (const folder of [...watchers.keys()]) unwatch(folder)
    }
  }
  return index
}
