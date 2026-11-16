/**
 * Error capture (feature 19.1): every engine, agent and tool error is caught,
 * redacted, written to a local log and kept in the `errors` table for an
 * error report (sent only in phase 5, and only after the user has read it).
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { Db } from './db'
import { redact, redactDeep } from '../redact'

const MAX_LOG_BYTES = 2 * 1024 * 1024

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void
  /** Catch an error: log it and keep it. Returns its reference id. */
  capture(source: string, error: unknown, context?: Record<string, unknown>): string
  /** Called after each caught error (error reports, 19.2). */
  onCapture(listener: (id: string, source: string) => void): void
}

export function createLogger(db: Db, dataDir: string | null): Logger {
  let file: string | null = null
  if (dataDir) {
    const dir = join(dataDir, 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'engine.log')
  }

  function write(level: string, message: string, context?: Record<string, unknown>): void {
    if (!file) return
    const line = redact(
      JSON.stringify({ at: new Date().toISOString(), level, message, ...(context ?? {}) })
    )
    try {
      // One older file is kept, so the log never grows without limit.
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_LOG_BYTES)
        renameSync(file, `${file}.1`)
      appendFileSync(file, `${line}\n`)
    } catch {
      // Logging must never take the engine down.
    }
  }

  const listeners: ((id: string, source: string) => void)[] = []

  return {
    onCapture(listener) {
      listeners.push(listener)
    },
    info(message, context) {
      write('info', message, context)
    },
    capture(source, error, context) {
      const id = randomUUID()
      const err = error instanceof Error ? error : new Error(String(error))
      const message = redact(err.message)
      const stack = err.stack ? redact(err.stack) : null
      const safeContext = context ? redactDeep(context) : null
      try {
        db.prepare(
          'insert into errors (id, at, source, message, stack, context) values (?, ?, ?, ?, ?, ?)'
        ).run(
          id,
          Date.now(),
          source,
          message,
          stack,
          safeContext ? JSON.stringify(safeContext) : null
        )
      } catch {
        // The database may be the thing that failed; the log line still goes out.
      }
      write('error', message, { id, source, stack, ...(safeContext ?? {}) })
      for (const listener of listeners) {
        try {
          listener(id, source)
        } catch {
          // A listener failing must not hide the error it was told about.
        }
      }
      return id
    }
  }
}
