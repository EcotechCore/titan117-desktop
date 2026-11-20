/**
 * Memory you can see, edit and delete (features 3.2-3.4). Facts,
 * preferences and the company profile, kept in the local database only.
 *
 * Scopes: `shared` is read by every agent; `agent:<name>` only by that agent,
 * so the QA agent can't read the finance agent's notes. Every memory says
 * who wrote it (you, or an agent and the task it came from), and the user can
 * change or delete any of them.
 */
import { randomUUID } from 'node:crypto'

import type { Memory, MemoryKind } from '../shared/protocol'
import type { Db } from './lib/db'
import { redact } from './redact'

export const MEMORY_KINDS: MemoryKind[] = ['fact', 'preference', 'profile', 'note']
const MAX_TEXT = 2000

type Row = Record<string, unknown>

function toMemory(r: Row): Memory {
  return {
    id: r.id as string,
    scope: r.scope as string,
    kind: r.kind as MemoryKind,
    text: r.text as string,
    source: r.source as string,
    taskId: (r.task_id as string | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number
  }
}

export function agentScope(agent: string): string {
  return `agent:${agent}`
}

/** Project memory (13.8): conventions and decisions for one repository, keyed by its real folder. */
export function projectScope(root: string): string {
  return `project:${root}`
}

/** The scopes an agent may read: shared memory and its own. */
export function visibleScopes(agent: string): string[] {
  return ['shared', agentScope(agent)]
}

function checkScope(scope: unknown): string {
  if (scope === 'shared') return scope
  if (typeof scope === 'string' && /^agent:[A-Za-z0-9 _-]{1,40}$/.test(scope)) return scope
  if (typeof scope === 'string' && /^project:[^\n\r\0]{1,500}$/.test(scope)) return scope
  throw new MemoryError('A memory is shared, belongs to one agent, or belongs to one project.')
}

function checkText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim())
    throw new MemoryError('Write something to remember.')
  // Keys and tokens never go into memory (guardrails §8).
  return redact(text.trim()).slice(0, MAX_TEXT)
}

function checkKind(kind: unknown): MemoryKind {
  if (!MEMORY_KINDS.includes(kind as MemoryKind))
    throw new MemoryError(`A memory is one of: ${MEMORY_KINDS.join(', ')}.`)
  return kind as MemoryKind
}

export class MemoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryError'
  }
}

/** Words for a full-text search, quoted so the user's text can't be read as search syntax. */
export function ftsQuery(text: string): string | null {
  const terms = (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 12)
  return terms.length ? terms.map((t) => `"${t}"`).join(' OR ') : null
}

export interface MemoryStore {
  list(filter?: { scopes?: string[]; query?: string; limit?: number }): Memory[]
  get(id: string): Memory | null
  add(input: {
    scope: string
    kind: string
    text: string
    source: string
    taskId?: string | null
  }): Memory
  update(id: string, patch: { text?: string; kind?: string; scope?: string }): Memory
  remove(id: string): void
  /** What an agent sees at the start of a task: its profile and preferences, then what matches. */
  forPrompt(agent: string, about: string): Memory[]
}

export function createMemoryStore(db: Db, onChange: () => void = () => undefined): MemoryStore {
  const store: MemoryStore = {
    list({ scopes, query, limit = 200 } = {}) {
      const where: string[] = []
      const args: (string | number)[] = []
      if (scopes) {
        where.push(`m.scope in (${scopes.map(() => '?').join(', ')})`)
        args.push(...scopes)
      }
      const match = query ? ftsQuery(query) : null
      if (query && !match) return []
      const sql = match
        ? `select m.* from memories_fts f join memories m on m.rowid = f.rowid
           where memories_fts match ? ${where.length ? `and ${where.join(' and ')}` : ''}
           order by rank limit ?`
        : `select m.* from memories m ${where.length ? `where ${where.join(' and ')}` : ''}
           order by m.updated_at desc limit ?`
      const rows = db.prepare(sql).all(...(match ? [match] : []), ...args, limit) as Row[]
      return rows.map(toMemory)
    },

    get(id) {
      const row = db.prepare('select * from memories where id = ?').get(id) as Row | undefined
      return row ? toMemory(row) : null
    },

    add(input) {
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        `insert into memories (id, scope, kind, text, source, task_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        checkScope(input.scope),
        checkKind(input.kind),
        checkText(input.text),
        input.source.slice(0, 200),
        input.taskId ?? null,
        now,
        now
      )
      onChange()
      return store.get(id)!
    },

    update(id, patch) {
      const current = store.get(id)
      if (!current) throw new MemoryError('No such memory.')
      db.prepare(
        'update memories set text = ?, kind = ?, scope = ?, updated_at = ? where id = ?'
      ).run(
        patch.text === undefined ? current.text : checkText(patch.text),
        patch.kind === undefined ? current.kind : checkKind(patch.kind),
        patch.scope === undefined ? current.scope : checkScope(patch.scope),
        Date.now(),
        id
      )
      onChange()
      return store.get(id)!
    },

    remove(id) {
      db.prepare('delete from memories where id = ?').run(id)
      onChange()
    },

    forPrompt(agent, about) {
      const scopes = visibleScopes(agent)
      const standing = (
        db
          .prepare(
            `select * from memories where scope in (?, ?) and kind in ('profile', 'preference')
             order by updated_at desc limit 25`
          )
          .all(...scopes) as Row[]
      ).map(toMemory)
      const seen = new Set(standing.map((m) => m.id))
      const related = store.list({ scopes, query: about, limit: 15 }).filter((m) => !seen.has(m.id))
      return [...standing, ...related]
    }
  }
  return store
}

/** What a tool may do with memory, for one agent and task. */
export interface MemoryAccess {
  search(query: string, limit?: number): Memory[]
  save(input: { text: string; kind: string; shared: boolean }): Memory
  /** A convention or decision for one repository (13.8); every agent working on it sees it. */
  saveForProject(input: { text: string; kind: string; folder: string }): Promise<Memory>
  forget(id: string): Memory
}

export function createMemoryAccess(deps: {
  store: MemoryStore
  agent: string
  taskId: string
  taskTitle: () => string
  mode: 'read' | 'write'
  /** The project's real root folder, checked against the allowed folders. */
  projectRoot?(folder: string): Promise<string>
}): MemoryAccess {
  const { store, agent } = deps
  const scopes = visibleScopes(agent)
  const writable = (): void => {
    if (deps.mode !== 'write') throw new MemoryError('This tool may read memory, not change it.')
  }
  return {
    search(query, limit = 20) {
      return query.trim() ? store.list({ scopes, query, limit }) : store.list({ scopes, limit })
    },
    save({ text, kind, shared }) {
      writable()
      return store.add({
        scope: shared ? 'shared' : agentScope(agent),
        kind,
        text,
        source: `${agent}, in the task "${deps.taskTitle().slice(0, 80)}"`,
        taskId: deps.taskId
      })
    },
    async saveForProject({ text, kind, folder }) {
      writable()
      if (!deps.projectRoot) throw new MemoryError('Project memory isn’t available here.')
      const root = await deps.projectRoot(folder)
      return store.add({
        scope: projectScope(root),
        kind,
        text,
        source: `${agent}, in the task "${deps.taskTitle().slice(0, 80)}"`,
        taskId: deps.taskId
      })
    },
    forget(id) {
      writable()
      const memory = store.get(id)
      // Another agent's memories don't exist, as far as this agent can tell.
      if (!memory || !(scopes.includes(memory.scope) || memory.scope.startsWith('project:')))
        throw new MemoryError('No such memory.')
      store.remove(id)
      return memory
    }
  }
}
