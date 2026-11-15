/**
 * How past tasks were solved (feature 3.13, decisions §34.1). When a task
 * that used tools ends, a short record is kept on the laptop: the goal, the
 * steps, what failed, what worked, and the files and sites involved. Agents
 * search them before similar work; the user can browse, search and delete
 * them. Never sent anywhere (decisions §32).
 */
import { randomUUID } from 'node:crypto'

import type { TaskRecord } from '../shared/protocol'
import type { Db } from './lib/db'
import { ftsQuery } from './memory'
import { redact } from './redact'
import type { Store } from './store'

type Row = Record<string, unknown>

function toRecord(r: Row): TaskRecord {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    agent: r.agent as string,
    goal: r.goal as string,
    outcome: r.outcome as string,
    steps: r.steps as string,
    failed: r.failed as string,
    worked: r.worked as string,
    places: r.places as string,
    createdAt: r.created_at as number
  }
}

export interface RecordStore {
  /** Write (or rewrite) the record of a task that just ended. Null when it used no tools. */
  capture(taskId: string): TaskRecord | null
  list(filter?: { query?: string; limit?: number; agent?: string }): TaskRecord[]
  remove(id: string): void
}

const clip = (text: string, n: number): string =>
  text.length > n ? `${text.slice(0, n - 1)}…` : text

export function createRecordStore(deps: {
  db: Db
  store: Store
  sites: (taskId: string) => string[]
  onChange?: () => void
}): RecordStore {
  const { db, store } = deps

  const records: RecordStore = {
    capture(taskId) {
      const task = store.getTask(taskId)
      if (!task) return null
      const activity = store.listActivity(taskId)
      const tools = activity.filter((a) => a.kind === 'tool')
      if (tools.length === 0) {
        db.prepare('delete from task_records where task_id = ?').run(taskId)
        return null
      }
      const messages = store.listMessages(taskId).map((m) => m.message)
      const goal = messages.find((m) => m.role === 'user')
      const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.text.trim())
      const failed = activity.filter(
        (a) => a.kind === 'refused' || a.kind === 'error' || a.kind === 'budget'
      )

      const places = new Set<string>()
      for (const m of messages)
        if (m.role === 'assistant')
          for (const call of m.toolCalls ?? []) {
            const where = call.input.path ?? call.input.folder ?? call.input.url ?? call.input.to
            if (typeof where === 'string') places.add(where)
          }
      for (const site of deps.sites(taskId)) places.add(site)

      const record = {
        goal: clip(goal && goal.role === 'user' ? goal.text : task.title, 400),
        outcome:
          task.status === 'done'
            ? 'finished'
            : task.status === 'error'
              ? `failed: ${task.note ?? ''}`
              : `stopped: ${task.note ?? ''}`,
        steps: tools
          .slice(0, 25)
          .map((a) => `- ${clip(a.summary, 160)}`)
          .join('\n'),
        failed: failed
          .slice(0, 10)
          .map((a) => `- ${clip(a.summary, 160)}`)
          .join('\n'),
        worked: clip(last && last.role === 'assistant' ? last.text : '', 700),
        places: clip([...places].slice(0, 20).join('\n'), 1500)
      }
      db.prepare('delete from task_records where task_id = ?').run(taskId)
      const id = randomUUID()
      db.prepare(
        `insert into task_records
           (id, task_id, agent, goal, outcome, steps, failed, worked, places, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        taskId,
        task.agent,
        redact(record.goal),
        redact(record.outcome),
        redact(record.steps),
        redact(record.failed),
        redact(record.worked),
        redact(record.places),
        Date.now()
      )
      deps.onChange?.()
      return toRecord(db.prepare('select * from task_records where id = ?').get(id) as Row)
    },

    list({ query, limit = 100, agent } = {}) {
      const match = query ? ftsQuery(query) : null
      if (query && !match) return []
      const rows = match
        ? (db
            .prepare(
              `select r.* from task_records_fts f join task_records r on r.rowid = f.rowid
               where task_records_fts match ? ${agent ? 'and r.agent = ?' : ''} order by rank limit ?`
            )
            .all(match, ...(agent ? [agent] : []), limit) as Row[])
        : (db
            .prepare(
              `select * from task_records ${agent ? 'where agent = ?' : ''} order by created_at desc limit ?`
            )
            .all(...(agent ? [agent] : []), limit) as Row[])
      return rows.map(toRecord)
    },

    remove(id) {
      db.prepare('delete from task_records where id = ?').run(id)
      deps.onChange?.()
    }
  }
  return records
}

/** What a tool may do with past-task records: search them. */
export interface RecordAccess {
  search(query: string, limit?: number): TaskRecord[]
}

export function formatRecord(r: TaskRecord): string {
  return [
    `Goal: ${r.goal}`,
    `Outcome: ${r.outcome}`,
    r.steps ? `Steps:\n${r.steps}` : '',
    r.failed ? `What failed:\n${r.failed}` : '',
    r.worked ? `Result: ${r.worked}` : '',
    r.places ? `Files and sites:\n${r.places}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}
