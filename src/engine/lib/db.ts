/**
 * The local data store (feature 1.7): one SQLite file in the app's data
 * folder, through Node's built-in driver, so there is no native module to
 * rebuild for Electron. Secrets never go in here (guardrails §8).
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type Db = DatabaseSync

const MIGRATIONS: string[] = [
  `
  create table meta (key text primary key, value text not null);

  create table tasks (
    id text primary key,
    title text not null,
    agent text not null,
    model text not null,
    status text not null,
    note text,
    steps integer not null default 0,
    cost_usd real not null default 0,
    created_at integer not null,
    updated_at integer not null
  );

  create table messages (
    id text primary key,
    task_id text not null references tasks(id) on delete cascade,
    seq integer not null,
    message text not null,
    created_at integer not null
  );
  create index messages_task on messages(task_id, seq);

  create table approvals (
    id text primary key,
    task_id text not null references tasks(id) on delete cascade,
    call_id text not null,
    tool text not null,
    risk text not null,
    summary text not null,
    input text not null,
    status text not null,
    can_always integer not null,
    answered_by text,
    created_at integer not null,
    answered_at integer
  );
  create index approvals_status on approvals(status);

  -- The activity timeline (feature 1.8): append-only.
  create table activity (
    id text primary key,
    task_id text not null,
    at integer not null,
    kind text not null,
    agent text not null,
    model text,
    tool text,
    summary text not null,
    cost_usd real not null default 0,
    approved_by text
  );
  create index activity_task on activity(task_id, at);

  -- Tools the user chose to always allow inside one task.
  create table task_allows (
    task_id text not null references tasks(id) on delete cascade,
    tool text not null,
    primary key (task_id, tool)
  );

  -- Caught errors, redacted, kept for an error report (feature 19.1).
  create table errors (
    id text primary key,
    at integer not null,
    source text not null,
    message text not null,
    stack text,
    context text
  );
  `
]

export function openDb(dataDir: string | ':memory:'): Db {
  let db: Db
  if (dataDir === ':memory:') {
    db = new DatabaseSync(':memory:')
  } else {
    mkdirSync(dataDir, { recursive: true })
    db = new DatabaseSync(join(dataDir, 'titan117.db'))
    db.exec('pragma journal_mode = wal')
  }
  db.exec('pragma foreign_keys = on')
  migrate(db)
  return db
}

function migrate(db: Db): void {
  const current = (db.prepare('pragma user_version').get() as { user_version: number }).user_version
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('begin')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`pragma user_version = ${v + 1}`)
      db.exec('commit')
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  }
}

export function getMeta<T>(db: Db, key: string, fallback: T): T {
  const row = db.prepare('select value from meta where key = ?').get(key) as
    { value: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setMeta(db: Db, key: string, value: unknown): void {
  db.prepare(
    'insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value'
  ).run(key, JSON.stringify(value))
}
