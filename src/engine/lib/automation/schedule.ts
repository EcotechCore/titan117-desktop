/**
 * Schedules (features 8.1, 8.10; decisions §61): when something runs, and
 * what. Times are the laptop's own local time. A schedule runs while the app
 * is open and catches up once on the next launch; it never runs on a server.
 *
 * Pure: no clock of its own, no storage. The scheduler (scheduler.ts) keeps
 * them and starts the runs.
 */

export class AutomationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationError'
  }
}

/** When a schedule runs. Days are 0 (Sunday) to 6 (Saturday). */
export type When =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: string; days?: number[] }
  | { kind: 'monthly'; day: number; time: string }
  | { kind: 'once'; at: number }

/** What a schedule runs. */
export type Action =
  /** A task for an agent, with the usual approvals. */
  | { kind: 'task'; agent: string; prompt: string }
  /** A recording replayed without AI (8.2). */
  | { kind: 'recording'; recording: string; values?: Record<string, string> }
  /** A web watch checked, then the agent says what matters (5.5). */
  | { kind: 'watch'; watch: string }

export interface Schedule {
  id: string
  name: string
  when: When
  action: Action
  enabled: boolean
  /** The next run, or null when it has none left (a one-off that ran). */
  nextAt: number | null
  lastAt: number | null
  /** The last run's task, to open from the list. */
  lastTaskId: string | null
  /** How the last run ended, in a few words. */
  lastNote: string | null
  /** Who made it: "you", or an agent in a task. */
  source: string
  createdAt: number
}

export const MIN_INTERVAL_MINUTES = 15
export const MAX_SCHEDULES = 100
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ,.'()&/+:_-]{0,79}$/u
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function clock(time: string): { h: number; m: number } {
  const match = TIME.exec(time)!
  return { h: Number(match[1]), m: Number(match[2]) }
}

function pad(time: string): string {
  const { h, m } = clock(time)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Check a "when" from a model or the window; returns it cleaned or throws. */
export function checkWhen(input: unknown, now: number): When {
  const w = (input ?? {}) as Record<string, unknown>
  switch (w.kind) {
    case 'interval': {
      const minutes = Math.round(Number(w.minutes))
      if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES || minutes > 60 * 24 * 30)
        throw new AutomationError(
          `"Every N minutes" needs at least ${MIN_INTERVAL_MINUTES} minutes (and at most 30 days).`
        )
      return { kind: 'interval', minutes }
    }
    case 'daily': {
      if (typeof w.time !== 'string' || !TIME.test(w.time))
        throw new AutomationError('Give the time as HH:MM, like 08:00.')
      const days = Array.isArray(w.days)
        ? [...new Set(w.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : []
      if (Array.isArray(w.days) && w.days.length && !days.length)
        throw new AutomationError('Days are numbers from 0 (Sunday) to 6 (Saturday).')
      return {
        kind: 'daily',
        time: pad(w.time),
        ...(days.length && days.length < 7 ? { days: days.sort() } : {})
      }
    }
    case 'monthly': {
      const day = Math.round(Number(w.day))
      if (!Number.isFinite(day) || day < 1 || day > 31)
        throw new AutomationError('The day of the month is 1 to 31.')
      if (typeof w.time !== 'string' || !TIME.test(w.time))
        throw new AutomationError('Give the time as HH:MM, like 08:00.')
      return { kind: 'monthly', day, time: pad(w.time) }
    }
    case 'once': {
      const at = typeof w.at === 'number' ? w.at : Date.parse(String(w.at ?? ''))
      if (!Number.isFinite(at)) throw new AutomationError('Give the date and time of the one run.')
      if (at < now - 60_000) throw new AutomationError('That time has already passed.')
      return { kind: 'once', at }
    }
    default:
      throw new AutomationError('A schedule is "interval", "daily", "monthly" or "once".')
  }
}

export function checkName(input: unknown): string {
  const name = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!NAME.test(name))
    throw new AutomationError('Give it a short name (letters, numbers and spaces, up to 80).')
  return name
}

/**
 * The first run strictly after `after`, in local time; null for a one-off
 * that is over. A month without the day (the 31st) runs on its last day.
 */
export function nextRun(when: When, after: number): number | null {
  switch (when.kind) {
    case 'interval':
      return after + when.minutes * 60_000
    case 'once':
      return when.at > after ? when.at : null
    case 'daily': {
      const { h, m } = clock(when.time)
      const from = new Date(after)
      for (let add = 0; add <= 7; add++) {
        const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add, h, m, 0, 0)
        if (day.getTime() <= after) continue
        if (when.days && !when.days.includes(day.getDay())) continue
        return day.getTime()
      }
      return null
    }
    case 'monthly': {
      const { h, m } = clock(when.time)
      const from = new Date(after)
      for (let add = 0; add <= 12; add++) {
        const year = from.getFullYear()
        const month = from.getMonth() + add
        const last = new Date(year, month + 1, 0).getDate()
        const run = new Date(year, month, Math.min(when.day, last), h, m, 0, 0)
        if (run.getTime() > after) return run.getTime()
      }
      return null
    }
  }
}

/** "Every weekday at 08:00", for the list and the approval card. */
export function describeWhen(when: When): string {
  switch (when.kind) {
    case 'interval':
      return when.minutes % 1440 === 0
        ? `Every ${when.minutes / 1440 === 1 ? 'day' : `${when.minutes / 1440} days`}`
        : when.minutes % 60 === 0
          ? `Every ${when.minutes / 60 === 1 ? 'hour' : `${when.minutes / 60} hours`}`
          : `Every ${when.minutes} minutes`
    case 'once':
      return `Once, on ${new Date(when.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
    case 'monthly':
      return `On day ${when.day} of every month at ${when.time}`
    case 'daily': {
      const days = when.days
      if (!days) return `Every day at ${when.time}`
      if (days.join() === '1,2,3,4,5') return `Every weekday at ${when.time}`
      if (days.join() === '0,6') return `Every weekend day at ${when.time}`
      return `Every ${days.map((d) => DAY_NAMES[d]).join(', ')} at ${when.time}`
    }
  }
}

export function describeAction(action: Action): string {
  if (action.kind === 'task') return `${action.agent}: ${action.prompt.slice(0, 160)}`
  if (action.kind === 'recording') return `Replay the recording "${action.recording}"`
  return `Check the watch "${action.watch}"`
}
