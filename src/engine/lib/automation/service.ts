/**
 * Automation (phase 13; decisions §61): the scheduler, and the stores for
 * web watches, recordings and saved site logins.
 *
 * The scheduler runs while the app is open: it looks every 30 seconds for
 * schedules that are due, and after the laptop slept or the app was closed
 * it catches up with ONE run per schedule, however many were missed (8.1).
 * A run is a task like any other, so approvals, budgets, the activity log
 * and notifications all apply. A run that reaches something only the user
 * may approve waits for them (decisions §29).
 */
import { randomUUID } from 'node:crypto'

import type { Db } from '../db'
import type { Runtime } from '../../runtime'
import type { AgentStore } from '../agents'
import {
  AutomationError,
  MAX_SCHEDULES,
  checkName,
  checkWhen,
  describeAction,
  describeWhen,
  nextRun,
  type Action,
  type Schedule,
  type When
} from './schedule'
import { createRecordingStore, type RecordingStore } from './recorder'
import { createWatchStore, type WatchStore } from './watch'

export const TICK_MS = 30_000
/** A run this late is called "caught up" in its note. */
const LATE_MS = 5 * 60_000
export const WATCHER = 'Web watcher'
export const RECORDER = 'Recorder'

export interface SiteLogin {
  username: string
  password: string
}

interface ScheduleRow {
  id: string
  name: string
  when_json: string
  action_json: string
  enabled: number
  next_at: number | null
  last_at: number | null
  last_task_id: string | null
  last_note: string | null
  source: string
  created_at: number
}

export interface AutomationService {
  schedules: {
    list(): Schedule[]
    get(idOrName: string): Schedule | null
    /** Check and save a new schedule; `when` and `action` come from a model or the window. */
    create(input: { name: unknown; when: unknown; action: unknown; source: string }): Schedule
    /** What a schedule would be, checked but not saved (the approval card shows it). */
    preview(input: { name: unknown; when: unknown; action: unknown }): {
      name: string
      when: When
      action: Action
      text: string
    }
    setEnabled(idOrName: string, enabled: boolean): Schedule
    remove(idOrName: string): void
    /** Run it now, whatever its time; its next time doesn't move. */
    runNow(idOrName: string): Schedule
  }
  watches: WatchStore
  recordings: RecordingStore
  /** Saved site logins from the OS keychain (8.5): held in memory only. */
  logins: {
    set(all: Record<string, SiteLogin>): void
    /** The login for a site: its own host, or a parent domain's. */
    get(site: string): SiteLogin | null
    sites(): string[]
  }
  /** Look for due schedules now. Resolves when their runs have been started. */
  tick(): void
  start(): void
  stop(): void
}

export function createAutomation(deps: {
  db: Db
  /** The app's data folder for recordings; null keeps them in memory (tests). */
  dataDir: string | null
  runtime: () => Runtime
  agents: AgentStore
  defaultModel(): string | null
  /** Why the app is locked, or null. Nothing runs while it is. */
  locked(): string | null
  onChange(): void
  onError?(error: unknown, context: Record<string, unknown>): void
  now?: () => number
}): AutomationService {
  const { db } = deps
  const now = deps.now ?? Date.now
  const changed = deps.onChange
  let timer: ReturnType<typeof setInterval> | null = null
  let logins: Record<string, SiteLogin> = {}

  const watches = createWatchStore({ db, onChange: changed, now })
  const recordings = createRecordingStore({
    dir: deps.dataDir ? `${deps.dataDir}/recordings` : null,
    onChange: changed
  })

  const toSchedule = (r: ScheduleRow): Schedule => ({
    id: r.id,
    name: r.name,
    when: JSON.parse(r.when_json) as When,
    action: JSON.parse(r.action_json) as Action,
    enabled: !!r.enabled,
    nextAt: r.next_at,
    lastAt: r.last_at,
    lastTaskId: r.last_task_id,
    lastNote: r.last_note,
    source: r.source,
    createdAt: r.created_at
  })

  function list(): Schedule[] {
    return (
      db.prepare('select * from schedules order by created_at').all() as unknown as ScheduleRow[]
    ).map(toSchedule)
  }

  function get(idOrName: string): Schedule | null {
    const key = String(idOrName ?? '').trim()
    const row = db
      .prepare('select * from schedules where id = ? or lower(name) = lower(?)')
      .get(key, key) as unknown as ScheduleRow | undefined
    return row ? toSchedule(row) : null
  }

  function need(idOrName: string): Schedule {
    const schedule = get(idOrName)
    if (!schedule)
      throw new AutomationError(`There is no schedule called "${String(idOrName).slice(0, 80)}".`)
    return schedule
  }

  function checkAction(input: unknown): Action {
    const a = (input ?? {}) as Record<string, unknown>
    if (a.kind === 'recording') {
      const recording = recordings.get(String(a.recording ?? ''))
      if (!recording)
        throw new AutomationError(
          `There is no recording called "${String(a.recording ?? '').slice(0, 80)}".`
        )
      const values: Record<string, string> = {}
      if (a.values && typeof a.values === 'object')
        for (const v of recording.variables) {
          const given = (a.values as Record<string, unknown>)[v.name]
          if (given !== undefined) values[v.name] = String(given).slice(0, 1000)
        }
      for (const v of recording.variables)
        if (!values[v.name] && !v.default)
          throw new AutomationError(`The recording needs a value for "${v.label}".`)
      return {
        kind: 'recording',
        recording: recording.name,
        ...(Object.keys(values).length ? { values } : {})
      }
    }
    if (a.kind === 'watch') {
      const watch = watches.get(String(a.watch ?? ''))
      if (!watch)
        throw new AutomationError(
          `There is no watch called "${String(a.watch ?? '').slice(0, 80)}".`
        )
      return { kind: 'watch', watch: watch.name }
    }
    if (a.kind === 'task') {
      const agent = deps.agents.get(String(a.agent ?? 'Titan') || 'Titan')
      if (!agent)
        throw new AutomationError(`There is no agent called "${String(a.agent).slice(0, 60)}".`)
      const prompt = String(a.prompt ?? '').trim()
      if (!prompt) throw new AutomationError('Say what the scheduled task should do.')
      if (prompt.length > 4000) throw new AutomationError('That is too long for a schedule.')
      return { kind: 'task', agent: agent.name, prompt }
    }
    throw new AutomationError('A schedule runs a "task", a "recording" or a "watch".')
  }

  function preview(input: { name: unknown; when: unknown; action: unknown }): {
    name: string
    when: When
    action: Action
    text: string
  } {
    const name = checkName(input.name)
    const when = checkWhen(input.when, now())
    const action = checkAction(input.action)
    return { name, when, action, text: `${describeWhen(when)}: ${describeAction(action)}` }
  }

  function save(id: string, patch: Partial<ScheduleRow>): void {
    const keys = Object.keys(patch) as (keyof ScheduleRow)[]
    if (!keys.length) return
    db.prepare(`update schedules set ${keys.map((k) => `${k} = ?`).join(', ')} where id = ?`).run(
      ...keys.map((k) => patch[k] as string | number | null),
      id
    )
    changed()
  }

  /** Start one run; returns the task and a note for the list. */
  function run(schedule: Schedule, late: boolean): { taskId: string | null; note: string } {
    const lock = deps.locked()
    if (lock) return { taskId: null, note: `Not run: ${lock}` }
    const runtime = deps.runtime()
    if (schedule.lastTaskId && runtime.isRunning(schedule.lastTaskId))
      return { taskId: schedule.lastTaskId, note: 'Skipped: the last run was still going.' }
    const title = `${schedule.name} (scheduled)`
    const head = `Scheduled run of "${schedule.name}" (${describeWhen(schedule.when)}).`
    const caught = late ? ' Caught up after the app was closed or asleep.' : ''
    const { action } = schedule
    try {
      if (action.kind === 'recording') {
        const task = runtime.runDirect({
          title,
          agent: RECORDER,
          text: `${head} Replay the recording "${action.recording}".`,
          call: {
            name: 'recording_run',
            input: { name: action.recording, ...(action.values ? { values: action.values } : {}) }
          },
          // The user agreed to this replay when they approved the schedule; final steps still ask.
          allow: ['recording_run']
        })
        return { taskId: task.id, note: `Started.${caught}` }
      }
      if (action.kind === 'watch') {
        // Reading runs without a model; the agent is asked only when something changed.
        const task = runtime.runDirect({
          title,
          agent: WATCHER,
          text: `${head} Check the watch "${action.watch}".`,
          call: { name: 'watch_check', input: { watch: action.watch } }
        })
        void runtime.settled(task.id).then(() => explain(task.id, action.watch))
        return { taskId: task.id, note: `Started.${caught}` }
      }
      const model = deps.defaultModel()
      if (!model) return { taskId: null, note: 'Not run: choose a model on the Models screen.' }
      const task = runtime.start(`${head}\n\n${action.prompt}`, model, 'normal', action.agent)
      return { taskId: task.id, note: `Started.${caught}` }
    } catch (error) {
      if (!(error instanceof Error) || !/Error$/.test(error.name)) throw error
      return { taskId: null, note: `Not run: ${error.message}`.slice(0, 300) }
    }
  }

  /** After a watch check found changes: the agent says what matters, in the same task. */
  function explain(taskId: string, watch: string): void {
    try {
      const lastChanged = watches.get(watch)?.lastChangedAt ?? 0
      const lastChecked = watches.get(watch)?.lastCheckedAt ?? -1
      const model = deps.defaultModel()
      if (lastChanged !== lastChecked || !model || deps.locked()) return
      deps
        .runtime()
        .send(
          taskId,
          'Something changed. In a few short points, say what changed and what matters to us (use what memory says about the company), with the page address next to each point. If none of it matters, say so in one line.',
          model
        )
    } catch (error) {
      deps.onError?.(error, { part: 'watch explain', taskId })
    }
  }

  function tick(): void {
    if (deps.locked()) return
    const at = now()
    for (const schedule of list()) {
      if (!schedule.enabled || schedule.nextAt === null || schedule.nextAt > at) continue
      try {
        const result = run(schedule, at - schedule.nextAt > LATE_MS)
        save(schedule.id, {
          last_at: at,
          last_task_id: result.taskId,
          last_note: result.note,
          // One run however many were missed: the next time counts from now.
          next_at: nextRun(schedule.when, at)
        })
      } catch (error) {
        deps.onError?.(error, { part: 'schedule', schedule: schedule.id })
        save(schedule.id, {
          last_at: at,
          last_note: 'Not run: something went wrong (saved to the local log).',
          next_at: nextRun(schedule.when, at)
        })
      }
    }
  }

  return {
    schedules: {
      list,
      get,
      preview,
      create(input) {
        const checked = preview(input)
        if (get(checked.name))
          throw new AutomationError(`There is already a schedule called "${checked.name}".`)
        if (list().length >= MAX_SCHEDULES)
          throw new AutomationError(`There are already ${MAX_SCHEDULES} schedules.`)
        const id = randomUUID()
        const at = now()
        db.prepare(
          `insert into schedules (id, name, when_json, action_json, enabled, next_at, source, created_at)
           values (?, ?, ?, ?, 1, ?, ?, ?)`
        ).run(
          id,
          checked.name,
          JSON.stringify(checked.when),
          JSON.stringify(checked.action),
          nextRun(checked.when, at),
          input.source.slice(0, 200),
          at
        )
        changed()
        return get(id)!
      },
      setEnabled(idOrName, enabled) {
        const schedule = need(idOrName)
        // Turned on again: the next time counts from now, with no catching up.
        save(schedule.id, {
          enabled: enabled ? 1 : 0,
          next_at: enabled ? nextRun(schedule.when, now()) : schedule.nextAt
        })
        return get(schedule.id)!
      },
      remove(idOrName) {
        const schedule = need(idOrName)
        db.prepare('delete from schedules where id = ?').run(schedule.id)
        changed()
      },
      runNow(idOrName) {
        const schedule = need(idOrName)
        const result = run(schedule, false)
        save(schedule.id, {
          last_at: now(),
          last_task_id: result.taskId,
          last_note: result.note
        })
        return get(schedule.id)!
      }
    },
    watches,
    recordings,
    logins: {
      set(all) {
        logins = { ...all }
      },
      get(site) {
        const host = String(site ?? '').toLowerCase()
        if (logins[host]) return logins[host]
        const parent = Object.keys(logins).find((h) => host.endsWith(`.${h}`))
        return parent ? logins[parent] : null
      },
      sites: () => Object.keys(logins).sort()
    },
    tick,
    start() {
      if (timer) return
      timer = setInterval(() => {
        try {
          tick()
        } catch (error) {
          deps.onError?.(error, { part: 'scheduler' })
        }
      }, TICK_MS)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}
