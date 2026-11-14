// Logs and stored rows never hold keys or tokens (guardrails §8).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { openDb } from '../src/engine/lib/db'
import { createLogger } from '../src/engine/lib/log'
import { redact, redactDeep, registerSecret, REDACTED } from '../src/engine/redact'
import { createStore } from '../src/engine/store'
import { FAKE_KEY, tempFolder } from './helpers'

// Shapes of keys, put together here so no scanner mistakes them for real ones.
const SECRETS = [
  FAKE_KEY,
  ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-'),
  ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-'),
  ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_'),
  ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_'),
  'AIza' + 'SyA-abcdefghijklmnopqrstuvwxyz012345',
  ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghijklmnop'].join('.')
]

describe('redaction', () => {
  it.each(SECRETS)('scrubs %s', (secret) => {
    const out = redact(`calling with ${secret} now`)
    expect(out).not.toContain(secret)
    expect(out).toContain(REDACTED)
  })

  it('scrubs labelled values and exact registered secrets', () => {
    expect(redact('Authorization: Bearer abc123def456')).not.toContain('abc123def456')
    expect(redact('{"password": "hunter2-hunter2"}')).not.toContain('hunter2')
    registerSecret('plain-looking-install-value')
    expect(redact('it is plain-looking-install-value.')).not.toContain('plain-looking')
  })

  it('leaves ordinary text alone', () => {
    const text = 'Read invoices/2026-03.pdf and summed 14 rows.'
    expect(redact(text)).toBe(text)
  })

  it('reaches inside objects', () => {
    const out = JSON.stringify(redactDeep({ a: [{ b: `x ${FAKE_KEY}` }] }))
    expect(out).not.toContain(FAKE_KEY)
  })
})

describe('error capture (feature 19.1)', () => {
  it('writes a redacted line to the local log and keeps the error', () => {
    const dir = tempFolder()
    const db = openDb(dir)
    const log = createLogger(db, dir)
    const error = new Error(`request failed with key ${FAKE_KEY}`)
    const id = log.capture('test', error, { header: `Bearer ${FAKE_KEY}` })

    const file = readFileSync(join(dir, 'logs', 'engine.log'), 'utf8')
    expect(file).toContain('request failed')
    expect(file).not.toContain(FAKE_KEY)

    const row = db.prepare('select * from errors where id = ?').get(id) as Record<string, string>
    expect(row.source).toBe('test')
    expect(JSON.stringify(row)).not.toContain(FAKE_KEY)
    db.close()
  })

  it('never stores a key in a task, a message, an approval or the timeline', () => {
    const db = openDb(':memory:')
    const store = createStore(db, () => undefined)
    const task = store.createTask({ title: `use ${FAKE_KEY}`, agent: 'Titan', model: 'm' })
    store.addMessage(task.id, { role: 'user', text: `my key is ${FAKE_KEY}` })
    store.createApproval({
      taskId: task.id,
      callId: 'c',
      tool: 'write_file',
      risk: 'write',
      summary: `write ${FAKE_KEY}`,
      input: { content: FAKE_KEY },
      canAlways: true
    })
    store.log({
      taskId: task.id,
      kind: 'tool',
      agent: 'Titan',
      model: null,
      tool: 't',
      summary: `did ${FAKE_KEY}`,
      costUsd: 0,
      approvedBy: null
    })
    for (const table of ['tasks', 'messages', 'approvals', 'activity'])
      expect(JSON.stringify(db.prepare(`select * from ${table}`).all())).not.toContain(FAKE_KEY)
    db.close()
  })
})
