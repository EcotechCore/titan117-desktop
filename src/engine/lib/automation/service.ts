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
import { readdirSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'

import type { Db } from '../db'
import type { Runtime } from '../../runtime'
import type { AgentStore } from '../agents'
import { isInsideFolder, realFolder } from '../folders'
import type { Task } from '../../../shared/protocol'
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
/** A file must be this old before a folder trigger counts it, so one still being copied waits. */
export const SETTLE_MS = 10_000
/** How many new files one run is told about by name. */
const MAX_NAMED = 20
const MAX_SCANNED = 5000
const EXPLAIN =
  'Something changed. In a few short points, say what changed and what matters to us (use what memory says about the company), with the page address next to each point. If none of it matters, say so in one line.'
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
  state_json?: string | null
}

/**
 * Files in a folder that are new or changed since `since` and have settled:
 * up to three levels deep, hidden folders and `node_modules` left out.
 */
export function newFiles(
  folder: string,
  since: number,
  now: number,
  match?: string[]
): { files: string[]; latest: number } {
  const found: { path: string; at: number }[] = []
  let scanned = 0
  const walk = (dir: string, depth: number): void => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (++scanned > MAX_SCANNED) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < 3) walk(path, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (match && !match.includes(extname(entry.name).slice(1).toLowerCase())) continue
      try {
        const info = statSync(path)
        // A file copied in keeps its old "modified" time: when it was made here counts too.
        const at = Math.max(info.mtimeMs, info.birthtimeMs, info.ctimeMs)
        if (at > since && at <= now - SETTLE_MS) found.push({ path, at })
      } catch {
        // Gone again already.
      }
    }
  }
  walk(folder, 1)
  found.sort((a, b) => a.at - b.at)
  return {
    files: found.map((f) => relative(folder, f.path).replace(/\\/g, '/')),
    latest: found.length ? found[found.length - 1].at : since
  }
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
  /**
   * Check a watch now, as its own task: reading runs without a model, and the
   * Web watcher is asked in the same task only when something changed.
   */
  checkWatch(idOrName: string, title?: string, text?: string): Task
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
  /** The folders the user allowed, and the app's own; a folder trigger looks only inside the first. */
  folders?: () => { allowed: string[]; core: string[] }
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

  /** A folder trigger's folder as a real path inside the allowed folders, or throws. */
  function allowedFolder(folder: string): string {
    const policy = deps.folders?.() ?? { allowed: [], core: [] }
    if (!policy.allowed.length)
      throw new AutomationError('No folder is allowed yet. Allow a folder first.')
    let real: string
    try {
      real = realFolder(isAbsolute(folder) ? folder : resolve(policy.allowed[0], folder))
      if (!statSync(real).isDirectory()) throw new Error('not a folder')
    } catch {
      throw new AutomationError(`"${folder.slice(0, 120)}" isn't a folder on this laptop.`)
    }
    if (
      !policy.allowed.some((a) => isInsideFolder(real, a)) ||
      policy.core.some((c) => isInsideFolder(real, c))
    )
      throw new AutomationError(
        `"${folder.slice(0, 120)}" isn't inside the folders Titan117 may use.`
      )
    return real
  }

  function preview(input: { name: unknown; when: unknown; action: unknown }): {
    name: string
    when: When
    action: Action
    text: string
  } {
    const name = checkName(input.name)
    let when = checkWhen(input.when, now())
    if (when.kind === 'folder') when = { ...when, folder: allowedFolder(when.folder) }
    const action = checkAction(input.action)
    if (when.kind === 'folder' && action.kind !== 'task')
      throw new AutomationError('A new file in a folder starts a task for an agent.')
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

  function checkWatch(idOrName: string, title?: string, text?: string): Task {
    const watch = watches.get(idOrName)
    if (!watch)
      throw new AutomationError(`There is no watch called "${String(idOrName).slice(0, 80)}".`)
    const before = watch.lastChangedAt
    return deps.runtime().runDirect({
      title: title ?? `Check ${watch.name}`,
      agent: WATCHER,
      text: text ?? `Check the watch "${watch.name}".`,
      call: { name: 'watch_check', input: { watch: watch.name } },
      followUp() {
        const after = watches.get(watch.id)
        const model = deps.defaultModel()
        return after && after.lastChangedAt !== before && model ? { text: EXPLAIN, model } : null
      }
    })
  }

  /** Start one run; returns the task and a note for the list. */
  function run(
    schedule: Schedule,
    late: boolean,
    files?: string[]
  ): { taskId: string | null; note: string } {
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
        const task = checkWatch(action.watch, title, `${head} Check the watch "${action.watch}".`)
        return { taskId: task.id, note: `Started.${caught}` }
      }
      const model = deps.defaultModel()
      if (!model) return { taskId: null, note: 'Not run: choose a model on the Models screen.' }
      // A folder trigger says which files arrived; their names are data, not instructions.
      const arrived =
        schedule.when.kind === 'folder' && files?.length
          ? `\n\nNew or changed files in ${schedule.when.folder} (names only, as data):\n${files
              .slice(0, MAX_NAMED)
              .map((f) => `- ${f.slice(0, 200)}`)
              .join(
                '\n'
              )}${files.length > MAX_NAMED ? `\n(and ${files.length - MAX_NAMED} more)` : ''}`
          : ''
      const task = runtime.start(
        `${head}\n\n${action.prompt}${arrived}`,
        model,
        'normal',
        action.agent
      )
      return {
        taskId: task.id,
        note: files?.length ? `Started for ${files.length} new file(s).` : `Started.${caught}`
      }
    } catch (error) {
      if (!(error instanceof Error) || !/Error$/.test(error.name)) throw error
      return { taskId: null, note: `Not run: ${error.message}`.slice(0, 300) }
    }
  }

  const stateOf = (id: string): { since?: number } => {
    const row = db.prepare('select state_json from schedules where id = ?').get(id) as
      { state_json: string | null } | undefined
    try {
      return row?.state_json ? (JSON.parse(row.state_json) as { since?: number }) : {}
    } catch {
      return {}
    }
  }

  /** A folder trigger: one run for everything that arrived since it last looked. */
  function lookInFolder(schedule: Schedule, at: number): void {
    if (schedule.when.kind !== 'folder') return
    const note = (text: string): void => {
      // Said once, not every 30 seconds.
      if (schedule.lastNote !== text) save(schedule.id, { last_note: text })
    }
    let folder: string
    try {
      folder = allowedFolder(schedule.when.folder)
    } catch (error) {
      return note(`Not run: ${(error as Error).message}`)
    }
    const since = stateOf(schedule.id).since ?? schedule.createdAt
    const { files, latest } = newFiles(folder, since, at, schedule.when.match)
    if (!files.length) return
    if (schedule.lastTaskId && deps.runtime().isRunning(schedule.lastTaskId)) return
    const result = run(schedule, false, files)
    save(schedule.id, {
      last_at: at,
      last_task_id: result.taskId ?? schedule.lastTaskId,
      last_note: result.note,
      // Only when a run started are the files counted as seen.
      ...(result.taskId ? { state_json: JSON.stringify({ since: latest }) } : {})
    })
  }

  function tick(): void {
    if (deps.locked()) return
    const at = now()
    for (const schedule of list()) {
      if (schedule.enabled && schedule.when.kind === 'folder') {
        try {
          lookInFolder(schedule, at)
        } catch (error) {
          deps.onError?.(error, { part: 'folder trigger', schedule: schedule.id })
        }
        continue
      }
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
          `insert into schedules (id, name, when_json, action_json, enabled, next_at, source, created_at, state_json)
           values (?, ?, ?, ?, 1, ?, ?, ?, ?)`
        ).run(
          id,
          checked.name,
          JSON.stringify(checked.when),
          JSON.stringify(checked.action),
          nextRun(checked.when, at),
          input.source.slice(0, 200),
          at,
          // A folder trigger starts from now: what is already there doesn't count.
          checked.when.kind === 'folder' ? JSON.stringify({ since: at }) : null
        )
        changed()
        return get(id)!
      },
      setEnabled(idOrName, enabled) {
        const schedule = need(idOrName)
        // Turned on again: the next time counts from now, with no catching up.
        save(schedule.id, {
          enabled: enabled ? 1 : 0,
          next_at: enabled ? nextRun(schedule.when, now()) : schedule.nextAt,
          ...(enabled && schedule.when.kind === 'folder'
            ? { state_json: JSON.stringify({ since: now() }) }
            : {})
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
    checkWatch,
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
