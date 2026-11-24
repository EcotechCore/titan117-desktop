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
  `,
  // Phase 3: Titan and memory.
  `
  -- What "always" means on an approval card, when it isn't "always in this task".
  alter table approvals add column always_label text;

  -- Sites a task may reach (security.md A3).
  create table task_sites (
    task_id text not null references tasks(id) on delete cascade,
    host text not null,
    primary key (task_id, host)
  );

  -- Shell commands the user always allows in one folder (feature 3.8).
  create table shell_allows (
    folder text not null,
    command text not null,
    created_at integer not null,
    primary key (folder, command)
  );

  -- Memory the user can see, edit and delete (features 3.2-3.4).
  -- scope: 'shared' (every agent) or 'agent:<name>' (that agent only).
  create table memories (
    id text primary key,
    scope text not null,
    kind text not null,
    text text not null,
    source text not null,
    task_id text,
    created_at integer not null,
    updated_at integer not null
  );
  create index memories_scope on memories(scope);
  create virtual table memories_fts using fts5(text, content='memories', content_rowid='rowid');
  create trigger memories_ai after insert on memories begin
    insert into memories_fts(rowid, text) values (new.rowid, new.text);
  end;
  create trigger memories_ad after delete on memories begin
    insert into memories_fts(memories_fts, rowid, text) values ('delete', old.rowid, old.text);
  end;
  create trigger memories_au after update on memories begin
    insert into memories_fts(memories_fts, rowid, text) values ('delete', old.rowid, old.text);
    insert into memories_fts(rowid, text) values (new.rowid, new.text);
  end;

  -- How past tasks were solved (feature 3.13). Local only.
  create table task_records (
    id text primary key,
    task_id text not null unique,
    agent text not null,
    goal text not null,
    outcome text not null,
    steps text not null,
    failed text not null,
    worked text not null,
    places text not null,
    created_at integer not null
  );
  create virtual table task_records_fts using fts5(
    goal, steps, failed, worked, places, content='task_records', content_rowid='rowid'
  );
  create trigger task_records_ai after insert on task_records begin
    insert into task_records_fts(rowid, goal, steps, failed, worked, places)
      values (new.rowid, new.goal, new.steps, new.failed, new.worked, new.places);
  end;
  create trigger task_records_ad after delete on task_records begin
    insert into task_records_fts(task_records_fts, rowid, goal, steps, failed, worked, places)
      values ('delete', old.rowid, old.goal, old.steps, old.failed, old.worked, old.places);
  end;

  -- MCP connectors the user added (feature 3.6). Their secrets are in the keychain.
  create table connectors (
    id text primary key,
    name text not null,
    kind text not null,
    command text,
    args text not null default '[]',
    url text,
    enabled integer not null default 1,
    created_at integer not null
  );
  `,
  // Phase 4: artifacts (§17, decisions §44). Every change is a version.
  `
  -- Deep research (feature 16.8) is a mode a task runs in.
  alter table tasks add column mode text not null default 'normal';

  create table artifacts (
    id text primary key,
    task_id text references tasks(id) on delete set null,
    kind text not null,
    title text not null,
    version integer not null,
    -- The share link's public id and address (feature 17.13), when shared.
    share_id text,
    share_url text,
    created_at integer not null,
    updated_at integer not null
  );
  create index artifacts_task on artifacts(task_id);
  create index artifacts_updated on artifacts(updated_at);

  create table artifact_versions (
    artifact_id text not null references artifacts(id) on delete cascade,
    version integer not null,
    content text not null,
    author text not null,
    note text not null,
    created_at integer not null,
    primary key (artifact_id, version)
  );
  `,
  // Phase 5: error reports the user chose to send, and the offline queue (19.8, decisions §45).
  `
  create table report_queue (
    id text primary key,
    -- draft: built and shown, not yet sent; queued: waiting to go; sent: has a reference.
    status text not null,
    report text not null,
    ref text,
    fixed_in text,
    problem text,
    created_at integer not null,
    sent_at integer
  );
  create index report_queue_status on report_queue(status, created_at);
  `,
  // Phase 6: the folder agent's index (features 7.1-7.5, decisions §51).
  `
  create table doc_files (
    id integer primary key,
    folder text not null,
    path text not null unique,
    size integer not null,
    mtime integer not null,
    indexed_at integer not null,
    title text not null default '',
    pages integer not null default 0,
    empty_pages integer not null default 0,
    -- ok, error (couldn't be read) or skipped (too large)
    status text not null,
    error text
  );
  create index doc_files_folder on doc_files(folder);

  -- Passages, each within one page, so a citation knows its page.
  create table doc_chunks (
    id integer primary key,
    file_id integer not null references doc_files(id) on delete cascade,
    page integer not null,
    label text not null,
    text text not null,
    -- The passage's embedding (float32), once the model is on the laptop.
    vec blob
  );
  create index doc_chunks_file on doc_chunks(file_id, page);
  create virtual table doc_chunks_fts using fts5(text, content='doc_chunks', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2');
  create trigger doc_chunks_ai after insert on doc_chunks begin
    insert into doc_chunks_fts(rowid, text) values (new.id, new.text);
  end;
  create trigger doc_chunks_ad after delete on doc_chunks begin
    insert into doc_chunks_fts(doc_chunks_fts, rowid, text) values ('delete', old.id, old.text);
  end;
  `,
  // Phase 6, OCR (7.3): files read before OCR that had scanned pages are read again.
  `
  update doc_files set mtime = -1 where empty_pages > 0;
  `,
  // Phase 11: parts of a task handed to other agents (4.6), and the messages between them (4.7).
  `
  alter table tasks add column parent_id text references tasks(id) on delete cascade;
  create index tasks_parent on tasks(parent_id);
  create table agent_messages (
    id text primary key,
    root_task_id text not null references tasks(id) on delete cascade,
    task_id text not null references tasks(id) on delete cascade,
    from_agent text not null,
    to_agent text not null,
    kind text not null,
    text text not null,
    at integer not null
  );
  create index agent_messages_root on agent_messages(root_task_id, at);
  `,
  // Phase 13: schedules (8.1, 8.10) and web watches (5.5); decisions §61. Local only.
  `
  create table schedules (
    id text primary key,
    name text not null,
    -- JSON: when it runs and what it runs (lib/automation/schedule.ts).
    when_json text not null,
    action_json text not null,
    enabled integer not null default 1,
    next_at integer,
    last_at integer,
    last_task_id text,
    last_note text,
    source text not null,
    created_at integer not null
  );
  create index schedules_next on schedules(enabled, next_at);

  create table watches (
    id text primary key,
    name text not null unique,
    urls text not null,
    about text not null default '',
    source text not null,
    created_at integer not null,
    last_checked_at integer,
    last_changed_at integer
  );
  -- Each watched page's text as last read, to compare with the next time.
  create table watch_pages (
    watch_id text not null references watches(id) on delete cascade,
    url text not null,
    text text not null,
    hash text not null,
    checked_at integer not null,
    primary key (watch_id, url)
  );
  create table watch_changes (
    id text primary key,
    watch_id text not null references watches(id) on delete cascade,
    url text not null,
    at integer not null,
    added text not null,
    removed text not null
  );
  create index watch_changes_watch on watch_changes(watch_id, at);
  `,
  // Phase 13, triggers (4.1): what a folder trigger has already seen; watches read in the browser.
  `
  alter table schedules add column state_json text;
  alter table watches add column via text not null default 'reader';
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
