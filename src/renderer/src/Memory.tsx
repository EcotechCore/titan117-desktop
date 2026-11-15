// Memory you can see, edit and delete (features 3.2-3.5, 3.13): what Titan
// remembers, the skills it saved, and how past tasks went. All on this laptop.
import { useCallback, useEffect, useState } from 'react'

import type { Memory, MemoryKind, Skill, TaskRecord } from '../../shared/protocol'
import type { EngineClient } from './engine'
import { Icon } from './ui'

type Tab = 'memory' | 'skills' | 'records'

const KINDS: { kind: MemoryKind; label: string }[] = [
  { kind: 'profile', label: 'Company' },
  { kind: 'preference', label: 'Preference' },
  { kind: 'fact', label: 'Fact' },
  { kind: 'note', label: 'Note' }
]

function scopeLabel(scope: string): string {
  return scope === 'shared' ? 'All agents' : `Only ${scope.replace(/^agent:/, '')}`
}

function day(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function MemoryView({
  client,
  changed,
  onProblem
}: {
  client: EngineClient | null
  /** Bumped when the engine says memory, skills or records changed. */
  changed: Record<string, number>
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('memory')
  return (
    <div className="list-view">
      <h1 className="view-title">Memory</h1>
      <p className="muted">
        What Titan remembers, the skills it saved and how past tasks went. It all stays on this
        laptop; change or delete anything.
      </p>
      <div className="segmented" role="tablist" aria-label="Memory">
        {(
          [
            ['memory', 'Remembered'],
            ['skills', 'Skills'],
            ['records', 'Past tasks']
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'seg on' : 'seg'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'memory' && (
        <Memories client={client} changed={changed.memory ?? 0} onProblem={onProblem} />
      )}
      {tab === 'skills' && (
        <Skills client={client} changed={changed.skills ?? 0} onProblem={onProblem} />
      )}
      {tab === 'records' && (
        <Records client={client} changed={changed.records ?? 0} onProblem={onProblem} />
      )}
    </div>
  )
}

function Memories({
  client,
  changed,
  onProblem
}: {
  client: EngineClient | null
  changed: number
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [items, setItems] = useState<Memory[]>([])
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<MemoryKind>('fact')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const load = useCallback(() => {
    client
      ?.get<{ memories: Memory[] }>(
        `/v1/memory${query.trim() ? `?q=${encodeURIComponent(query)}` : ''}`
      )
      .then((r) => setItems(r.memories))
      .catch(onProblem)
  }, [client, query, onProblem])
  useEffect(load, [load, changed])

  async function add(): Promise<void> {
    if (!client || !text.trim()) return
    try {
      await client.send('POST', '/v1/memory', { text, kind, scope: 'shared' })
      setText('')
      load()
    } catch (error) {
      onProblem(error)
    }
  }

  return (
    <>
      <div className="add-row">
        <input
          className="search"
          placeholder="Tell Titan something to remember"
          aria-label="Something to remember"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <select
          value={kind}
          aria-label="Kind"
          onChange={(e) => setKind(e.target.value as MemoryKind)}
        >
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={!text.trim()} onClick={() => void add()}>
          Remember
        </button>
      </div>
      <input
        className="search"
        type="search"
        placeholder="Search memory"
        aria-label="Search memory"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {items.length === 0 && (
        <p className="empty">
          {query
            ? 'Nothing matches.'
            : 'Nothing yet. Titan saves what you tell it about you and your company.'}
        </p>
      )}
      {items.map((m) => (
        <div key={m.id} className="row">
          <span className="row-icon">
            <Icon name="brain" />
          </span>
          <div className="row-main">
            {editing?.id === m.id ? (
              <textarea
                className="edit"
                aria-label="Edit memory"
                value={editing.text}
                onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
              />
            ) : (
              <p className="row-title">{m.text}</p>
            )}
            <p className="muted">
              {KINDS.find((k) => k.kind === m.kind)?.label} · {scopeLabel(m.scope)} · from{' '}
              {m.source} · {day(m.updatedAt)}
            </p>
          </div>
          {editing?.id === m.id ? (
            <>
              <button
                className="btn btn-primary"
                onClick={() =>
                  client
                    ?.send('PUT', `/v1/memory/${m.id}`, { text: editing.text })
                    .then(() => {
                      setEditing(null)
                      load()
                    })
                    .catch(onProblem)
                }
              >
                Save
              </button>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setEditing({ id: m.id, text: m.text })}>
                Edit
              </button>
              <button
                className="btn"
                onClick={() =>
                  client?.send('DELETE', `/v1/memory/${m.id}`).then(load).catch(onProblem)
                }
              >
                Forget
              </button>
            </>
          )}
        </div>
      ))}
    </>
  )
}

function Skills({
  client,
  changed,
  onProblem
}: {
  client: EngineClient | null
  changed: number
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [items, setItems] = useState<Skill[]>([])
  const [open, setOpen] = useState<{ name: string; body: string } | null>(null)

  const load = useCallback(() => {
    client
      ?.get<{ skills: Skill[] }>('/v1/skills')
      .then((r) => setItems(r.skills))
      .catch(onProblem)
  }, [client, onProblem])
  useEffect(load, [load, changed])

  return (
    <>
      {items.length === 0 && (
        <p className="empty">
          No skills yet. After a task you are likely to repeat, Titan offers to save how it did it.
        </p>
      )}
      {items.map((s) => (
        <div key={s.name} className="row row-stack">
          <div className="row-line">
            <span className="row-icon">
              <Icon name="file" />
            </span>
            <div className="row-main">
              <p className="row-title">
                {s.description} <span className="tag mono">{s.name}.md</span>
              </p>
              <p className="muted">
                Written by {s.source} · {day(s.updatedAt)}
              </p>
            </div>
            <button
              className="btn"
              onClick={() => setOpen(open?.name === s.name ? null : { name: s.name, body: s.body })}
            >
              {open?.name === s.name ? 'Close' : 'Read and edit'}
            </button>
            <button
              className="btn"
              onClick={() =>
                client
                  ?.send('DELETE', `/v1/skills/${encodeURIComponent(s.name)}`)
                  .then(load)
                  .catch(onProblem)
              }
            >
              Delete
            </button>
          </div>
          {open?.name === s.name && (
            <div className="skill-edit">
              <textarea
                className="edit mono"
                rows={12}
                aria-label={`Steps of ${s.name}`}
                value={open.body}
                onChange={(e) => setOpen({ name: s.name, body: e.target.value })}
              />
              <button
                className="btn btn-primary"
                onClick={() =>
                  client
                    ?.send('PUT', `/v1/skills/${encodeURIComponent(s.name)}`, {
                      description: s.description,
                      body: open.body
                    })
                    .then(() => {
                      setOpen(null)
                      load()
                    })
                    .catch(onProblem)
                }
              >
                Save
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

function Records({
  client,
  changed,
  onProblem
}: {
  client: EngineClient | null
  changed: number
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [items, setItems] = useState<TaskRecord[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(() => {
    client
      ?.get<{ records: TaskRecord[] }>(
        `/v1/records${query.trim() ? `?q=${encodeURIComponent(query)}` : ''}`
      )
      .then((r) => setItems(r.records))
      .catch(onProblem)
  }, [client, query, onProblem])
  useEffect(load, [load, changed])

  return (
    <>
      <p className="muted">
        A short record of each finished task that used tools. Titan reads similar ones before new
        work, to reuse what worked.
      </p>
      <input
        className="search"
        type="search"
        placeholder="Search past tasks"
        aria-label="Search past tasks"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {items.length === 0 && (
        <p className="empty">{query ? 'Nothing matches.' : 'No records yet.'}</p>
      )}
      {items.map((r) => (
        <div key={r.id} className="row row-stack">
          <div className="row-line">
            <span className="row-icon">
              <Icon name="tasks" />
            </span>
            <div className="row-main">
              <p className="row-title">{r.goal}</p>
              <p className="muted">
                {r.agent} · {r.outcome} · {day(r.createdAt)}
              </p>
            </div>
            <button className="btn" onClick={() => setOpen(open === r.id ? null : r.id)}>
              {open === r.id ? 'Close' : 'Details'}
            </button>
            <button
              className="btn"
              onClick={() =>
                client?.send('DELETE', `/v1/records/${r.id}`).then(load).catch(onProblem)
              }
            >
              Delete
            </button>
          </div>
          {open === r.id && (
            <dl className="record">
              {r.steps && (
                <>
                  <dt>Steps</dt>
                  <dd>{r.steps}</dd>
                </>
              )}
              {r.failed && (
                <>
                  <dt>What failed</dt>
                  <dd>{r.failed}</dd>
                </>
              )}
              {r.worked && (
                <>
                  <dt>Result</dt>
                  <dd>{r.worked}</dd>
                </>
              )}
              {r.places && (
                <>
                  <dt>Files and sites</dt>
                  <dd className="mono">{r.places}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      ))}
    </>
  )
}
