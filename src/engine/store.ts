/**
 * Tasks, messages, approvals and the activity timeline in the local
 * database. Everything stored is redacted first (guardrails §8). Changes are
 * announced on the event bus, which the local API streams to the window.
 */
import { randomUUID } from 'node:crypto'

import type {
  Activity,
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
  createTask(input: { title: string; agent: string; model: string }): Task
  getTask(id: string): Task | null
  listTasks(): Task[]
  updateTask(
    id: string,
    patch: Partial<Pick<Task, 'status' | 'note' | 'model' | 'steps' | 'costUsd'>>
  ): Task
  addMessage(taskId: string, message: ChatMessage): StoredMessage
  listMessages(taskId: string): StoredMessage[]
  createApproval(input: {
    taskId: string
    callId: string
    tool: string
    risk: Risk
    summary: string
    input: Record<string, unknown>
    canAlways: boolean
  }): Approval
  answerApproval(id: string, status: ApprovalStatus, by: string): Approval
  getApproval(id: string): Approval | null
  listApprovals(filter: { taskId?: string; status?: ApprovalStatus }): Approval[]
  allowAlways(taskId: string, tool: string): void
  isAlwaysAllowed(taskId: string, tool: string): boolean
  log(entry: Omit<Activity, 'id' | 'at'>): Activity
  listActivity(taskId: string): Activity[]
  /** After a restart: nothing is running any more (checkpoints come in phase 5). */
  closeInterrupted(): void
}

export function createStore(db: Db, emit: Emit): Store {
  const store: Store = {
    createTask({ title, agent, model }) {
      const now = Date.now()
      const id = randomUUID()
      db.prepare(
        `insert into tasks (id, title, agent, model, status, created_at, updated_at)
         values (?, ?, ?, ?, 'running', ?, ?)`
      ).run(id, redact(title).slice(0, 120), agent, model, now, now)
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

    updateTask(id, patch) {
      const current = store.getTask(id)
      if (!current) throw new Error('No such task.')
      const next = { ...current, ...patch }
      db.prepare(
        `update tasks set status = ?, note = ?, model = ?, steps = ?, cost_usd = ?, updated_at = ?
         where id = ?`
      ).run(
        next.status,
        next.note ? redact(next.note) : null,
        next.model,
        next.steps,
        next.costUsd,
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

    createApproval(input) {
      const id = randomUUID()
      db.prepare(
        `insert into approvals
           (id, task_id, call_id, tool, risk, summary, input, status, can_always, created_at)
         values (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(
        id,
        input.taskId,
        input.callId,
        input.tool,
        input.risk,
        redact(input.summary),
        JSON.stringify(redactDeep(input.input)),
        input.canAlways ? 1 : 0,
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
      db.prepare(
        `update approvals set status = 'expired', answered_at = ? where status = 'pending'`
      ).run(Date.now())
      db.prepare(
        `update tasks set status = 'stopped', note = 'The app closed while this task was running.'
         where status in ('running', 'waiting')`
      ).run()
    }
  }
  return store
}
