/**
 * Error reports (features 19.1-19.11; decisions §22, §45). Opt-in and shown
 * in full before anything leaves the laptop:
 *
 *   draft   builds the report from a caught error (or none, for "Report a
 *           problem"): versions, OS, the feature, the error and stack, the
 *           last lines of the local log, all redacted, home folder as "~"
 *   send    the report the user read, exactly, plus their note; it waits in
 *           the queue while offline or signed out and goes when it can
 *
 * Never file contents, prompts, memory, keys or tokens: none of those are in
 * the local log, which redacts keys and tokens as it writes.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { join } from 'node:path'

import { redact } from '../redact'
import type { Db } from './db'
import { getMeta, setMeta } from './db'
import type { Fetch } from './net'

import type { CaughtError, ErrorReport, QueuedReport, ReportMode } from '../../shared/protocol'

export type { CaughtError, ErrorReport, QueuedReport, ReportMode }

export class ReportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportError'
  }
}

const LOG_LINES = 40
/** Automatic reports at most this often (one a minute), so a loop of errors isn't a flood. */
const AUTO_GAP_MS = 60_000
const RETRY_MS = 10 * 60_000

/** The user's home folder as "~", so their name and folders don't travel with a path. */
export function tidyPaths(text: string, home = homedir()): string {
  if (!home) return text
  const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')])
  let out = text
  for (const v of variants) if (v.length > 2) out = out.split(v).join('~')
  return out
}

function clean(text: string, max: number): string {
  return tidyPaths(redact(text)).slice(0, max)
}

interface Row {
  id: string
  status: QueuedReport['status']
  report: string
  ref: string | null
  fixed_in: string | null
  problem: string | null
  created_at: number
  sent_at: number | null
}

function toQueued(r: Row): QueuedReport {
  return {
    id: r.id,
    status: r.status,
    report: JSON.parse(r.report) as ErrorReport,
    ref: r.ref,
    fixedIn: r.fixed_in,
    problem: r.problem,
    createdAt: r.created_at,
    sentAt: r.sent_at
  }
}

export interface ReportService {
  mode(): ReportMode
  setMode(mode: unknown): ReportMode
  /** Recently caught errors, newest first, for "Something went wrong". */
  recentErrors(limit?: number): CaughtError[]
  /** A report to read before sending. `errorRef` is a caught error's id or its first 8 characters. */
  draft(input: { errorRef?: string; feature?: string }): QueuedReport
  /** Send the draft the user read, with their note. Queued if it can't go now. */
  send(id: string, note: string): Promise<QueuedReport>
  discard(id: string): void
  list(): QueuedReport[]
  /** Try the queue again (back online, signed in). */
  flush(): Promise<void>
  /** Ask which sent reports a release has fixed (19.5). */
  checkFixed(): Promise<void>
  /** A caught error, for "send automatically". */
  onCaptured(errorId: string): void
  close(): void
}

export function createReportService(deps: {
  db: Db
  appVersion: string
  dataDir: string | null
  fetch: Fetch
  /** The device token and our web app's API address, or null when signed out. */
  account(): { token: string; apiBase: string } | null
  onChange?: () => void
  now?: () => number
  platform?: string
}): ReportService {
  const { db } = deps
  const now = deps.now ?? Date.now
  let lastAuto = 0
  let flushing: Promise<void> | null = null

  function row(id: string): QueuedReport {
    const found = db.prepare('select * from report_queue where id = ?').get(id) as Row | undefined
    if (!found) throw new ReportError('There is no such report.')
    return toQueued(found)
  }

  function logTail(): string[] {
    if (!deps.dataDir) return []
    const file = join(deps.dataDir, 'logs', 'engine.log')
    if (!existsSync(file)) return []
    try {
      const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
      return lines.slice(-LOG_LINES).map((l) => clean(l, 1000))
    } catch {
      return []
    }
  }

  function findError(errorRef: string): { source: string; message: string; stack: string } | null {
    if (!/^[0-9a-f-]{8,36}$/i.test(errorRef)) return null
    return ((db
      .prepare(
        'select source, message, stack from errors where id = ? or id like ? order by at desc limit 1'
      )
      .get(errorRef, `${errorRef}%`) as
      { source: string; message: string; stack: string | null } | undefined) ?? null) as {
      source: string
      message: string
      stack: string
    } | null
  }

  async function deliver(item: QueuedReport): Promise<void> {
    const account = deps.account()
    if (!account) {
      setProblem(item.id, 'Waiting: sign in to Titan117 to send it.')
      return
    }
    let response: Response
    try {
      response = await deps.fetch(`${account.apiBase}/error-reports`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(item.report)
      })
    } catch {
      setProblem(item.id, 'Waiting: no connection. It goes when you are back online.')
      return
    }
    if (response.status === 429) {
      setProblem(item.id, 'Waiting: today’s reports are used up. It goes tomorrow.')
      return
    }
    if (!response.ok) {
      setProblem(item.id, `Waiting: the server answered ${response.status}.`)
      return
    }
    const { ref } = (await response.json()) as { ref?: string }
    db.prepare(
      "update report_queue set status = 'sent', ref = ?, sent_at = ?, problem = null where id = ?"
    ).run(typeof ref === 'string' ? ref.slice(0, 20) : null, now(), item.id)
    deps.onChange?.()
  }

  function setProblem(id: string, problem: string): void {
    db.prepare('update report_queue set problem = ? where id = ?').run(problem, id)
    deps.onChange?.()
  }

  const timer = setInterval(() => void service.flush(), RETRY_MS)
  timer.unref?.()

  const service: ReportService = {
    mode: () => getMeta<ReportMode>(db, 'reportMode', 'ask'),

    setMode(mode) {
      if (mode !== 'ask' && mode !== 'auto' && mode !== 'never')
        throw new ReportError('Choose ask, auto or never.')
      setMeta(db, 'reportMode', mode)
      return mode
    },

    recentErrors(limit = 20) {
      return (
        db
          .prepare('select id, at, source, message from errors order by at desc limit ?')
          .all(Math.max(1, Math.min(100, limit))) as unknown as CaughtError[]
      ).map((e) => ({ ...e, message: clean(e.message, 300) }))
    },

    draft({ errorRef, feature }) {
      const error = errorRef ? findError(errorRef) : null
      if (errorRef && !error) throw new ReportError('That error is no longer in the local log.')
      const report: ErrorReport = {
        id: randomUUID(),
        appVersion: deps.appVersion,
        os: `${deps.platform ?? process.platform} ${release()}`,
        feature: clean(error?.source ?? feature ?? 'report a problem', 60),
        message: clean(error?.message ?? '', 2000),
        stack: clean(error?.stack ?? '', 8000),
        logLines: logTail(),
        note: ''
      }
      db.prepare(
        "insert into report_queue (id, status, report, created_at) values (?, 'draft', ?, ?)"
      ).run(report.id, JSON.stringify(report), now())
      // Old drafts the user walked away from don't pile up.
      db.prepare("delete from report_queue where status = 'draft' and created_at < ?").run(
        now() - 24 * 60 * 60_000
      )
      return row(report.id)
    },

    async send(id, note) {
      const item = row(id)
      if (item.status === 'sent') return item
      // Exactly what the user read, with their note (redacted too).
      const report: ErrorReport = { ...item.report, note: clean(String(note ?? ''), 4000) }
      db.prepare(
        "update report_queue set status = 'queued', report = ?, problem = null where id = ?"
      ).run(JSON.stringify(report), id)
      await deliver(row(id))
      return row(id)
    },

    discard(id) {
      db.prepare("delete from report_queue where id = ? and status != 'sent'").run(id)
      deps.onChange?.()
    },

    list() {
      return (
        db
          .prepare(
            "select * from report_queue where status != 'draft' order by created_at desc limit 100"
          )
          .all() as unknown as Row[]
      ).map(toQueued)
    },

    async flush() {
      if (flushing) return flushing
      flushing = (async () => {
        const queued = (
          db
            .prepare("select * from report_queue where status = 'queued' order by created_at")
            .all() as unknown as Row[]
        ).map(toQueued)
        for (const item of queued) await deliver(item)
      })().finally(() => {
        flushing = null
      })
      return flushing
    },

    async checkFixed() {
      const account = deps.account()
      const refs = (
        db
          .prepare(
            "select ref from report_queue where status = 'sent' and ref is not null and fixed_in is null"
          )
          .all() as { ref: string }[]
      ).map((r) => r.ref)
      if (!account || !refs.length) return
      try {
        const response = await deps.fetch(`${account.apiBase}/error-reports/fixed`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refs })
        })
        if (!response.ok) return
        const { fixed } = (await response.json()) as { fixed?: { ref: string; fixedIn: string }[] }
        for (const f of fixed ?? [])
          db.prepare('update report_queue set fixed_in = ? where ref = ?').run(
            String(f.fixedIn).slice(0, 20),
            f.ref
          )
        if (fixed?.length) deps.onChange?.()
      } catch {
        // Offline: asked again next time.
      }
    },

    onCaptured(errorId) {
      if (service.mode() !== 'auto' || now() - lastAuto < AUTO_GAP_MS) return
      lastAuto = now()
      try {
        const draft = service.draft({ errorRef: errorId })
        void service.send(draft.id, '').catch(() => undefined)
      } catch {
        // A report about a report failing would loop; it stays in the local log.
      }
    },

    close() {
      clearInterval(timer)
    }
  }
  return service
}
