/**
 * Tasks, messages, approvals and the activity timeline in the local
 * database. Everything stored is redacted first (guardrails §8). Changes are
 * announced on the event bus, which the local API streams to the window.
 */
import { randomUUID } from 'node:crypto'

import type {
  Activity,
  AgentMessage,
  ActivityKind,
  Approval,
  ApprovalStatus,
  ChatMessage,
  EngineEvent,
  Risk,
  StoredMessage,
  Task,
  TaskStatus
} from '../shared/protocol'
import type { Db } from './lib/db'
import { redact, redactDeep } from './redact'

export type Emit = (event: EngineEvent) => void

type Row = Record<string, unknown>

function toTask(r: Row): Task {
  return {
    id: r.id as string,
    title: r.title as string,
    agent: r.agent as string,
    model: r.model as string,
    status: r.status as TaskStatus,
    note: (r.note as string | null) ?? null,
    steps: r.steps as number,
    costUsd: r.cost_usd as number,
    mode: r.mode === 'research' ? 'research' : 'normal',
    parentId: (r.parent_id as string | null) ?? null,
    syncedFrom: (r.synced_from as string | null) ?? null,
    folder: (r.folder as string | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number
  }
}

function toApproval(r: Row): Approval {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    callId: r.call_id as string,
    tool: r.tool as string,
    risk: r.risk as Risk,
    summary: r.summary as string,
    input: JSON.parse(r.input as string) as Record<string, unknown>,
    status: r.status as ApprovalStatus,
    canAlways: r.can_always === 1,
    alwaysLabel: (r.always_label as string | null) ?? null,
    answeredBy: (r.answered_by as string | null) ?? null,
    createdAt: r.created_at as number,
    answeredAt: (r.answered_at as number | null) ?? null
  }
}

function toActivity(r: Row): Activity {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    at: r.at as number,
    kind: r.kind as ActivityKind,
    agent: r.agent as string,
    model: (r.model as string | null) ?? null,
    tool: (r.tool as string | null) ?? null,
    summary: r.summary as string,
    costUsd: r.cost_usd as number,
    approvedBy: (r.approved_by as string | null) ?? null
  }
}

export interface Store {
  createTask(input: {
    title: string
    agent: string
    model: string
    mode?: Task['mode']
    parentId?: string | null
  }): Task
  getTask(id: string): Task | null
  listTasks(): Task[]
  /** The parts of a task handed to other agents (4.6). */
  listParts(taskId: string): Task[]
  /** The message bus between agents (4.7). */
  addAgentMessage(input: Omit<AgentMessage, 'id' | 'at'>): AgentMessage
  listAgentMessages(rootTaskId: string): AgentMessage[]
  updateTask(
    id: string,
    patch: Partial<Pick<Task, 'status' | 'note' | 'model' | 'steps' | 'costUsd' | 'folder'>>
  ): Task
  addMessage(taskId: string, message: ChatMessage): StoredMessage
  listMessages(taskId: string): StoredMessage[]
  /**
   * Conversations for sync (decisions §65.3): finished top-level tasks changed
   * after `since`, oldest first, each with its messages.
   */
  syncedTasksSince(since: number, limit?: number): SyncedTask[]
  /** A conversation from another laptop: kept when it's newer and this laptop isn't running it. */
  importSyncedTask(record: SyncedTask, from: string): boolean
  createApproval(input: {
    taskId: string
    callId: string
    tool: string
    risk: Risk
    summary: string
    input: Record<string, unknown>
    canAlways: boolean
    alwaysLabel?: string | null
  }): Approval
  answerApproval(id: string, status: ApprovalStatus, by: string): Approval
  getApproval(id: string): Approval | null
  listApprovals(filter: { taskId?: string; status?: ApprovalStatus }): Approval[]
  allowAlways(taskId: string, tool: string): void
  isAlwaysAllowed(taskId: string, tool: string): boolean
  /** Sites a task may reach (security.md A3). */
  sites: {
    has(taskId: string, host: string): boolean
    add(taskId: string, host: string): void
    list(taskId: string): string[]
  }
  /** Shell commands always allowed in a folder (feature 3.8). */
  hasStanding(folder: string, command: string): boolean
  addStanding(folder: string, command: string): void
  log(entry: Omit<Activity, 'id' | 'at'>): Activity
  listActivity(taskId: string): Activity[]
  /** After a restart: nothing is running any more (checkpoints come in phase 5). */
  /** Tasks left running when the app stopped: marked stopped; their ids are returned (1.6). */
  closeInterrupted(): string[]
}

/** One conversation as it travels between the user's laptops (decisions §65.3). */
export interface SyncedTask {
  id: string
  title: string
  agent: string
  model: string
  status: TaskStatus
  note: string | null
  steps: number
  costUsd: number
  mode: 'normal' | 'research'
  createdAt: number
  updatedAt: number
  messages: { createdAt: number; message: ChatMessage }[]
}

const SYNC_ID = /^[A-Za-z0-9_-]{1,80}$/
const FINISHED: TaskStatus[] = ['done', 'stopped', 'error']

export const INTERRUPTED_NOTE = 'The app closed while this task was running.'

export function createStore(db: Db, emit: Emit): Store {
  const store: Store = {
    createTask({ title, agent, model, mode, parentId }) {
      const now = Date.now()
      const id = randomUUID()
      db.prepare(
        `insert into tasks (id, title, agent, model, status, mode, parent_id, created_at, updated_at)
         values (?, ?, ?, ?, 'running', ?, ?, ?, ?)`
      ).run(
        id,
        redact(title).slice(0, 120),
        agent,
        model,
        mode ?? 'normal',
        parentId ?? null,
        now,
        now
      )
      const task = store.getTask(id)!
      emit({ type: 'task', task })
      return task
    },

    getTask(id) {
      const row = db.prepare('select * from tasks where id = ?').get(id) as Row | undefined
      return row ? toTask(row) : null
    },

    listTasks() {
      return (
        db.prepare('select * from tasks order by updated_at desc limit 200').all() as Row[]
      ).map(toTask)
    },

    listParts(taskId) {
      return (
        db
          .prepare('select * from tasks where parent_id = ? order by created_at')
          .all(taskId) as Row[]
      ).map(toTask)
    },

    addAgentMessage(input) {
      const message: AgentMessage = {
        ...input,
        id: randomUUID(),
        text: redact(input.text).slice(0, 20_000),
        at: Date.now()
      }
      db.prepare(
        `insert into agent_messages (id, root_task_id, task_id, from_agent, to_agent, kind, text, at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        message.id,
        message.rootTaskId,
        message.taskId,
        message.from,
        message.to,
        message.kind,
        message.text,
        message.at
      )
      return message
    },

    listAgentMessages(rootTaskId) {
      return (
        db
          .prepare('select * from agent_messages where root_task_id = ? order by at, rowid')
          .all(rootTaskId) as Row[]
      ).map((r) => ({
        id: r.id as string,
        rootTaskId: r.root_task_id as string,
        taskId: r.task_id as string,
        from: r.from_agent as string,
        to: r.to_agent as string,
        kind: r.kind === 'answer' ? 'answer' : 'brief',
        text: r.text as string,
        at: r.at as number
      }))
    },

    updateTask(id, patch) {
      const current = store.getTask(id)
      if (!current) throw new Error('No such task.')
      const next = { ...current, ...patch }
      db.prepare(
        `update tasks set status = ?, note = ?, model = ?, steps = ?, cost_usd = ?, folder = ?, updated_at = ?
         where id = ?`
      ).run(
        next.status,
        next.note ? redact(next.note) : null,
        next.model,
        next.steps,
        next.costUsd,
        next.folder ?? null,
        Date.now(),
        id
      )
      const task = store.getTask(id)!
      emit({ type: 'task', task })
      return task
    },

    addMessage(taskId, message) {
      const id = randomUUID()
      const now = Date.now()
      const { seq } = db
        .prepare('select coalesce(max(seq), 0) + 1 as seq from messages where task_id = ?')
        .get(taskId) as { seq: number }
      const safe = redactDeep(message)
      db.prepare(
        'insert into messages (id, task_id, seq, message, created_at) values (?, ?, ?, ?, ?)'
      ).run(id, taskId, seq, JSON.stringify(safe), now)
      const stored: StoredMessage = { id, taskId, seq, createdAt: now, message: safe }
      emit({ type: 'message', message: stored })
      return stored
    },

    listMessages(taskId) {
      return (
        db.prepare('select * from messages where task_id = ? order by seq').all(taskId) as Row[]
      ).map((r) => ({
        id: r.id as string,
        taskId: r.task_id as string,
        seq: r.seq as number,
        createdAt: r.created_at as number,
        message: JSON.parse(r.message as string) as ChatMessage
      }))
    },

    syncedTasksSince(since, limit = 20) {
      const rows = db
        .prepare(
          `select * from tasks where parent_id is null and status in ('done', 'stopped', 'error')
           and updated_at > ? order by updated_at limit ?`
        )
        .all(since, Math.min(200, Math.max(1, limit))) as Row[]
      return rows.map((r) => {
        const t = toTask(r)
        return {
          id: t.id,
          title: t.title,
          agent: t.agent,
          model: t.model,
          status: t.status,
          note: t.note,
          steps: t.steps,
          costUsd: t.costUsd,
          mode: t.mode,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          messages: store
            .listMessages(t.id)
            .map((m) => ({ createdAt: m.createdAt, message: m.message }))
        }
      })
    },

    importSyncedTask(record, from) {
      if (
        !record ||
        typeof record.id !== 'string' ||
        !SYNC_ID.test(record.id) ||
        !FINISHED.includes(record.status) ||
        typeof record.title !== 'string' ||
        !Number.isFinite(record.updatedAt) ||
        !Number.isFinite(record.createdAt) ||
        !Array.isArray(record.messages)
      )
        return false
      const local = store.getTask(record.id)
      // A conversation running here is never replaced; an older copy never wins.
      if (local && (!FINISHED.includes(local.status) || local.updatedAt >= record.updatedAt))
        return false
      if (local?.parentId) return false
      const messages = record.messages.filter(
        (m) =>
          m &&
          typeof m.message === 'object' &&
          m.message !== null &&
          typeof m.message.role === 'string'
      )
      db.exec('begin')
      try {
        db.prepare(
          `insert into tasks (id, title, agent, model, status, note, steps, cost_usd, mode, created_at, updated_at, synced_from)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (id) do update set title = excluded.title, agent = excluded.agent, model = excluded.model,
             status = excluded.status, note = excluded.note, steps = excluded.steps, cost_usd = excluded.cost_usd,
             mode = excluded.mode, updated_at = excluded.updated_at, synced_from = excluded.synced_from`
        ).run(
          record.id,
          redact(record.title.slice(0, 500)),
          String(record.agent ?? '').slice(0, 80),
          String(record.model ?? '').slice(0, 200),
          record.status,
          record.note ? redact(String(record.note).slice(0, 2000)) : null,
          Number(record.steps) || 0,
          Number(record.costUsd) || 0,
          record.mode === 'research' ? 'research' : 'normal',
          record.createdAt,
          record.updatedAt,
          from.slice(0, 60)
        )
        db.prepare('delete from messages where task_id = ?').run(record.id)
        const insert = db.prepare(
          'insert into messages (id, task_id, seq, message, created_at) values (?, ?, ?, ?, ?)'
        )
        messages.forEach((m, i) =>
          insert.run(
            randomUUID(),
            record.id,
            i + 1,
            JSON.stringify(redactDeep(m.message)),
            Number.isFinite(m.createdAt) ? m.createdAt : record.updatedAt
          )
        )
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
      emit({ type: 'task', task: store.getTask(record.id)! })
      return true
    },

    createApproval(input) {
      const id = randomUUID()
      db.prepare(
        `insert into approvals
           (id, task_id, call_id, tool, risk, summary, input, status, can_always, always_label, created_at)
         values (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      ).run(
        id,
        input.taskId,
        input.callId,
        input.tool,
        input.risk,
        redact(input.summary),
        JSON.stringify(redactDeep(input.input)),
        input.canAlways ? 1 : 0,
        input.alwaysLabel ?? null,
        Date.now()
      )
      const approval = store.getApproval(id)!
      emit({ type: 'approval', approval })
      return approval
    },

    answerApproval(id, status, by) {
      db.prepare(
        `update approvals set status = ?, answered_by = ?, answered_at = ?
         where id = ? and status = 'pending'`
      ).run(status, by, Date.now(), id)
      const approval = store.getApproval(id)
      if (!approval) throw new Error('No such approval.')
      emit({ type: 'approval', approval })
      return approval
    },

    getApproval(id) {
      const row = db.prepare('select * from approvals where id = ?').get(id) as Row | undefined
      return row ? toApproval(row) : null
    },

    listApprovals({ taskId, status }) {
      const where: string[] = []
      const args: string[] = []
      if (taskId) {
        where.push('task_id = ?')
        args.push(taskId)
      }
      if (status) {
        where.push('status = ?')
        args.push(status)
      }
      const sql = `select * from approvals ${where.length ? `where ${where.join(' and ')}` : ''} order by created_at`
      return (db.prepare(sql).all(...args) as Row[]).map(toApproval)
    },

    allowAlways(taskId, tool) {
      db.prepare('insert or ignore into task_allows (task_id, tool) values (?, ?)').run(
        taskId,
        tool
      )
    },

    isAlwaysAllowed(taskId, tool) {
      return !!db
        .prepare('select 1 from task_allows where task_id = ? and tool = ?')
        .get(taskId, tool)
    },

    sites: {
      has: (taskId, host) =>
        !!db.prepare('select 1 from task_sites where task_id = ? and host = ?').get(taskId, host),
      add(taskId, host) {
        db.prepare('insert or ignore into task_sites (task_id, host) values (?, ?)').run(
          taskId,
          host
        )
      },
      list: (taskId) =>
        (
          db.prepare('select host from task_sites where task_id = ? order by host').all(taskId) as {
            host: string
          }[]
        ).map((r) => r.host)
    },

    hasStanding(folder, command) {
      return !!db
        .prepare('select 1 from shell_allows where folder = ? and command = ?')
        .get(folder, command)
    },

    addStanding(folder, command) {
      db.prepare(
        'insert or ignore into shell_allows (folder, command, created_at) values (?, ?, ?)'
      ).run(folder, command, Date.now())
    },

    log(entry) {
      const id = randomUUID()
      const at = Date.now()
      const summary = redact(entry.summary).slice(0, 500)
      db.prepare(
        `insert into activity
           (id, task_id, at, kind, agent, model, tool, summary, cost_usd, approved_by)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        entry.taskId,
        at,
        entry.kind,
        entry.agent,
        entry.model,
        entry.tool,
        summary,
        entry.costUsd,
        entry.approvedBy
      )
      const activity: Activity = { ...entry, id, at, summary }
      emit({ type: 'activity', activity })
      return activity
    },

    listActivity(taskId) {
      return (
        db
          .prepare('select * from activity where task_id = ? order by at, rowid')
          .all(taskId) as Row[]
      ).map(toActivity)
    },

    closeInterrupted() {
      const ids = (
        db.prepare(`select id from tasks where status in ('running', 'waiting')`).all() as {
          id: string
        }[]
      ).map((r) => r.id)
      db.prepare(
        `update approvals set status = 'expired', answered_at = ? where status = 'pending'`
      ).run(Date.now())
      db.prepare(
        `update tasks set status = 'stopped', note = ? where status in ('running', 'waiting')`
      ).run(INTERRUPTED_NOTE)
      return ids
    }
  }
  return store
}
