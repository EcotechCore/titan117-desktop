// Automations (phase 13; decisions §61): what runs by itself. Schedules in
// plain words (8.10), web watches (5.5), recordings that replay without AI
// (5.6, 8.2-8.5) and the saved logins they use. Everything here is on this
// laptop; a schedule runs while Titan117 is open and catches up afterwards.
import { useCallback, useEffect, useState } from 'react'

import type { EngineClient } from './engine'
import { Icon } from './ui'

interface ScheduleRow {
  id: string
  name: string
  enabled: boolean
  nextAt: number | null
  lastAt: number | null
  lastTaskId: string | null
  lastNote: string | null
  whenText: string
  actionText: string
  source: string
}

interface WatchRow {
  id: string
  name: string
  urls: string[]
  about: string
  lastCheckedAt: number | null
  lastChangedAt: number | null
  changes: { url: string; at: number; added: string[]; removed: string[] }[]
}

interface RecordingRow {
  name: string
  title: string
  url: string
  variables: { name: string; label: string; default: string }[]
  steps: unknown[]
  stepsText: string[]
  missingLogins: string[]
  updatedAt: number
}

interface Listing {
  schedules: ScheduleRow[]
  watches: WatchRow[]
  recordings: RecordingRow[]
  session: { url: string; startedAt: number; events: number } | null
  agents: string[]
  /** The folders the user allowed (a folder trigger looks inside one). */
  folders: string[]
}

/** Ready-made schedules (8.10): one click, then yours to pause, change or remove. */
const EXAMPLES: {
  id: string
  name: string
  what: string
  /** What the user fills in first, if anything. */
  ask?: { label: string; placeholder: string }
  when: Record<string, unknown>
  whenText: string
  agent: string
  prompt(value: string): string
}[] = [
  {
    id: 'briefing',
    name: 'Morning briefing',
    what: 'What needs you today: approvals waiting, what changed in your folders since yesterday, and what your web watches saw.',
    when: { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] },
    whenText: 'Every weekday at 08:00',
    agent: 'Titan',
    prompt: () =>
      'Give me a short morning briefing, most important first: (1) what my web watches saw since yesterday (watch_list, then the latest changes of each); (2) files added or changed in my folders since yesterday, by folder; (3) how yesterday’s scheduled runs went (schedule_list). Keep it under 15 lines and say plainly when there is nothing new.'
  },
  {
    id: 'seo',
    name: 'Weekly SEO re-audit',
    what: 'The SEO agent audits your site again and says what was fixed and what is new.',
    ask: { label: 'Your site', placeholder: 'https://your-site.com' },
    when: { kind: 'daily', time: '09:00', days: [1] },
    whenText: 'Every Monday at 09:00',
    agent: 'SEO agent',
    prompt: (site) =>
      `Audit ${site} with site_audit and tell me, in a few points, what was fixed since the last audit, what is new, and the three things most worth fixing now.`
  },
  {
    id: 'backup',
    name: 'Weekly backup',
    what: 'A dated ZIP copy of one folder, kept in a "backups" folder beside it. It asks before it writes.',
    ask: { label: 'Folder to back up', placeholder: 'Documents' },
    when: { kind: 'daily', time: '17:00', days: [5] },
    whenText: 'Every Friday at 17:00',
    agent: 'Titan',
    prompt: (folder) =>
      `Make a backup of the folder "${folder}": a ZIP file named after the folder and today's date, saved in a "backups" folder inside the allowed folders (make it if it's missing, and never put the backup inside the folder being backed up). Then say where the file is and how big it is. If older backups of this folder exist, list them and ask before removing any.`
  }
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function time(at: number | null): string {
  return at
    ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'never'
}

export function AutomationsView({
  client,
  changed,
  onProblem,
  onOpenTask,
  onAskTitan,
  agent
}: {
  client: EngineClient | null
  changed: number
  onProblem(error: unknown): void
  onOpenTask(id: string): void
  /** Start a task for Titan with these words (a schedule in plain words, 8.10). */
  onAskTitan(text: string): void
  /** Opened from an agent's page: the form starts with that agent (a trigger, 4.1). */
  agent?: string | null
}): React.JSX.Element {
  const [data, setData] = useState<Listing | null>(null)
  const [words, setWords] = useState('')

  const load = useCallback(() => {
    client?.get<Listing>('/v1/automations').then(setData).catch(onProblem)
  }, [client, onProblem])

  useEffect(load, [load, changed])
  // While a recording is going, the count of steps seen keeps up.
  const recording = !!data?.session
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [recording, load])

  const post = useCallback(
    async <T extends object = Listing>(action: string, body: unknown): Promise<T | null> => {
      try {
        const result = await client!.send<T & Listing>('POST', `/v1/automations/${action}`, body)
        setData(result)
        return result
      } catch (error) {
        onProblem(error)
        return null
      }
    },
    [client, onProblem]
  )

  if (!data) return <div className="list-view" />

  return (
    <div className="list-view">
      <h1 className="view-title">Automations</h1>
      <p className="muted">
        What runs by itself: schedules, pages watched for changes, and browser steps you recorded.
        Everything runs on this laptop while Titan117 is open, and catches up once after the laptop
        was off. Anything that sends, pays or publishes still waits for you.
      </p>

      <h2 className="section">Say it in plain words</h2>
      <div className="add-row">
        <input
          className="search"
          aria-label="A schedule in plain words"
          placeholder="Every weekday at 8, brief me on what changed in …"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && words.trim()) {
              onAskTitan(words.trim())
              setWords('')
            }
          }}
        />
        <button
          className="btn btn-primary"
          disabled={!words.trim()}
          onClick={() => {
            onAskTitan(words.trim())
            setWords('')
          }}
        >
          Make it with Titan
        </button>
      </div>
      <p className="muted">
        Titan turns the sentence into a schedule and shows it to you before it is saved.
      </p>

      <Schedules data={data} post={post} onOpenTask={onOpenTask} agent={agent ?? null} />
      <Watches data={data} post={post} onOpenTask={onOpenTask} />
      <Recordings data={data} post={post} onOpenTask={onOpenTask} />
      <Logins onProblem={onProblem} changed={changed} />
    </div>
  )
}

type Post = <T extends object = Listing>(action: string, body: unknown) => Promise<T | null>

function Schedules({
  data,
  post,
  onOpenTask,
  agent: preset
}: {
  data: Listing
  post: Post
  onOpenTask(id: string): void
  agent: string | null
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [what, setWhat] = useState<'task' | 'recording' | 'watch'>('task')
  const [agent, setAgent] = useState(preset ?? 'Titan')
  const [folder, setFolder] = useState('')
  const [match, setMatch] = useState('')
  const [asked, setAsked] = useState<Record<string, string>>({})
  const [prompt, setPrompt] = useState('')
  const [target, setTarget] = useState('')
  const [every, setEvery] = useState<'day' | 'weekday' | 'week' | 'month' | 'hours' | 'folder'>(
    'weekday'
  )
  const [at, setAt] = useState('08:00')
  const [day, setDay] = useState(1)
  const [hours, setHours] = useState(2)

  const when =
    every === 'folder'
      ? { kind: 'folder', folder: folder || data.folders[0] || '', match }
      : every === 'hours'
        ? { kind: 'interval', minutes: Math.max(1, hours) * 60 }
        : every === 'month'
          ? { kind: 'monthly', day, time: at }
          : {
              kind: 'daily',
              time: at,
              ...(every === 'weekday'
                ? { days: [1, 2, 3, 4, 5] }
                : every === 'week'
                  ? { days: [day] }
                  : {})
            }
  const action =
    what === 'task'
      ? { kind: 'task', agent, prompt }
      : what === 'recording'
        ? { kind: 'recording', recording: target }
        : { kind: 'watch', watch: target }
  const options =
    what === 'recording' ? data.recordings.map((r) => r.name) : data.watches.map((w) => w.name)
  const ready =
    name.trim() &&
    (what === 'task' ? prompt.trim() : target) &&
    (every !== 'folder' || (what === 'task' && data.folders.length > 0))
  const taken = new Set(data.schedules.map((s) => s.name.toLowerCase()))

  return (
    <>
      <h2 className="section">Schedules</h2>
      {data.schedules.length === 0 && <p className="empty">Nothing is scheduled yet.</p>}
      {data.schedules.map((s) => (
        <div key={s.id} className="row">
          <span className="row-icon">
            <Icon name="calendar" />
          </span>
          <div className="row-main">
            <p className={s.enabled ? 'row-title' : 'row-title faint'}>{s.name}</p>
            <p className="muted">
              {s.whenText} · {s.actionText}
            </p>
            <p className="muted">
              {s.enabled ? (
                <>
                  Next: <span className="mono">{time(s.nextAt)}</span>
                </>
              ) : (
                'Paused'
              )}
              {s.lastAt && (
                <>
                  {' '}
                  · Last: <span className="mono">{time(s.lastAt)}</span> {s.lastNote}{' '}
                  {s.lastTaskId && (
                    <button className="link" onClick={() => onOpenTask(s.lastTaskId!)}>
                      Open the run
                    </button>
                  )}
                </>
              )}
            </p>
          </div>
          <button className="btn" onClick={() => void post('schedule-run', { id: s.id })}>
            Run now
          </button>
          <button
            className="btn"
            onClick={() => void post('schedule-set', { id: s.id, enabled: !s.enabled })}
          >
            {s.enabled ? 'Pause' : 'Resume'}
          </button>
          <button className="btn" onClick={() => void post('schedule-remove', { id: s.id })}>
            Remove
          </button>
        </div>
      ))}
      <details className="fold">
        <summary>Ready-made schedules</summary>
        {EXAMPLES.filter((e) => !taken.has(e.name.toLowerCase())).map((e) => (
          <div key={e.id} className="row">
            <div className="row-main">
              <p className="row-title">{e.name}</p>
              <p className="muted">
                {e.whenText} · {e.agent}. {e.what}
              </p>
            </div>
            {e.ask && (
              <input
                className="search"
                aria-label={e.ask.label}
                placeholder={e.ask.placeholder}
                value={asked[e.id] ?? ''}
                onChange={(ev) => setAsked({ ...asked, [e.id]: ev.target.value })}
              />
            )}
            <button
              className="btn"
              disabled={!!e.ask && !(asked[e.id] ?? '').trim()}
              onClick={() =>
                void post('schedule', {
                  name: e.name,
                  when: e.when,
                  action: {
                    kind: 'task',
                    agent: e.agent,
                    prompt: e.prompt((asked[e.id] ?? '').trim())
                  }
                })
              }
            >
              Add
            </button>
          </div>
        ))}
        {EXAMPLES.every((e) => taken.has(e.name.toLowerCase())) && (
          <p className="muted">You have added them all.</p>
        )}
      </details>
      <details className="fold" open={!!preset}>
        <summary>Add a schedule or a trigger yourself</summary>
        <div className="add-row">
          <input
            className="search"
            placeholder="Name (e.g. Morning briefing)"
            aria-label="Schedule name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            aria-label="What runs"
            value={what}
            onChange={(e) => {
              setWhat(e.target.value as typeof what)
              setTarget('')
            }}
          >
            <option value="task">A task for an agent</option>
            <option value="recording">A recording</option>
            <option value="watch">A web watch</option>
          </select>
          {what === 'task' ? (
            <select aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
              {data.agents.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          ) : (
            <select
              aria-label="Which one"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          )}
        </div>
        {what === 'task' && (
          <label className="field">
            What should it do each time?
            <textarea
              rows={3}
              placeholder="Summarise yesterday's new files in the Invoices folder and list anything unpaid."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
        )}
        <div className="add-row">
          <select
            aria-label="How often"
            value={every}
            onChange={(e) => setEvery(e.target.value as typeof every)}
          >
            <option value="weekday">Every weekday</option>
            <option value="day">Every day</option>
            <option value="week">Every week</option>
            <option value="month">Every month</option>
            <option value="hours">Every few hours</option>
            <option value="folder">When a new file arrives in a folder</option>
          </select>
          {every === 'folder' && (
            <>
              <select
                aria-label="Folder"
                value={folder || data.folders[0] || ''}
                onChange={(e) => setFolder(e.target.value)}
              >
                {data.folders.length === 0 && <option value="">Allow a folder first</option>}
                {data.folders.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <input
                className="search short"
                aria-label="File kinds"
                placeholder="pdf, xlsx"
                value={match}
                onChange={(e) => setMatch(e.target.value)}
              />
            </>
          )}
          {every === 'week' && (
            <select
              aria-label="Day of the week"
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {every === 'month' && (
            <input
              className="search short"
              type="number"
              min={1}
              max={31}
              aria-label="Day of the month"
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
            />
          )}
          {every === 'folder' ? null : every === 'hours' ? (
            <input
              className="search short"
              type="number"
              min={1}
              max={720}
              aria-label="Hours between runs"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          ) : (
            <input
              className="search short"
              type="time"
              aria-label="Time"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          )}
          <button
            className="btn btn-primary"
            disabled={!ready}
            onClick={() =>
              void post('schedule', { name, when, action }).then((ok) => {
                if (!ok) return
                setName('')
                setPrompt('')
                setTarget('')
              })
            }
          >
            Add
          </button>
        </div>
      </details>
    </>
  )
}

function Watches({
  data,
  post,
  onOpenTask
}: {
  data: Listing
  post: Post
  onOpenTask(id: string): void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [urls, setUrls] = useState('')
  const [about, setAbout] = useState('')
  const [browser, setBrowser] = useState(false)
  return (
    <>
      <h2 className="section">Web watches</h2>
      <p className="muted">
        Pages Titan117 reads again to see what changed: an official page listing new laws, a price
        list, a competitor’s news. It reads politely and only what a site allows automated readers
        to read. To check one regularly, add a schedule for it.
      </p>
      {data.watches.map((w) => (
        <div key={w.id} className="row row-stack">
          <div className="row-line">
            <span className="row-icon">
              <Icon name="globe" />
            </span>
            <div className="row-main">
              <p className="row-title">{w.name}</p>
              <p className="muted">{w.urls.join(' · ')}</p>
              <p className="muted">
                {w.about && <>Cares about: {w.about} · </>}
                Checked: <span className="mono">{time(w.lastCheckedAt)}</span> · Last change:{' '}
                <span className="mono">{time(w.lastChangedAt)}</span>
              </p>
            </div>
            <button
              className="btn"
              onClick={() =>
                void post<{ task?: { id: string } }>('watch-check', { id: w.id }).then(
                  (r) => r?.task && onOpenTask(r.task.id)
                )
              }
            >
              Check now
            </button>
            <button className="btn" onClick={() => void post('watch-remove', { id: w.id })}>
              Remove
            </button>
          </div>
          {w.changes.length > 0 && (
            <details className="fold">
              <summary>Latest changes</summary>
              {w.changes.map((c, i) => (
                <div key={i} className="change">
                  <p className="muted">
                    <span className="mono">{time(c.at)}</span> · {c.url}
                  </p>
                  {c.added.slice(0, 12).map((l, j) => (
                    <p key={`a${j}`} className="diff-add">
                      + {l}
                    </p>
                  ))}
                  {c.removed.slice(0, 12).map((l, j) => (
                    <p key={`r${j}`} className="diff-del">
                      − {l}
                    </p>
                  ))}
                </div>
              ))}
            </details>
          )}
        </div>
      ))}
      <details className="fold">
        <summary>Add a web watch</summary>
        <div className="add-row">
          <input
            className="search"
            placeholder="Name (e.g. Environmental law)"
            aria-label="Watch name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="search"
            placeholder="What matters to you in these pages (optional)"
            aria-label="What matters to you"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
          />
        </div>
        <label className="field">
          Pages or RSS feeds to watch, one address per line (up to 10). A site’s feed of what is new
          works best.
          <textarea
            rows={3}
            placeholder="https://example.gov/new-acts"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
          />
        </label>
        <label className="row choice">
          <input type="checkbox" checked={browser} onChange={(e) => setBrowser(e.target.checked)} />
          <span className="row-main">
            <span className="row-title">Read these pages in the browser</span>
            <span className="muted">
              For a site that turns automated readers away. Titan117 opens the page as you would, in
              its browser window; a CAPTCHA is yours to answer.
            </span>
          </span>
        </label>
        <div className="row-actions">
          <button
            className="btn btn-primary"
            disabled={!name.trim() || !urls.trim()}
            onClick={() =>
              void post('watch', {
                name,
                about,
                browser,
                urls: urls
                  .split(/\s+/)
                  .map((u) => u.trim())
                  .filter(Boolean)
              }).then((ok) => {
                if (!ok) return
                setName('')
                setUrls('')
                setAbout('')
                setBrowser(false)
              })
            }
          >
            Add
          </button>
        </div>
      </details>
    </>
  )
}

function Recordings({
  data,
  post,
  onOpenTask
}: {
  data: Listing
  post: Post
  onOpenTask(id: string): void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ name: string; text: string } | null>(null)
  const [values, setValues] = useState<Record<string, Record<string, string>>>({})

  async function start(): Promise<void> {
    setBusy(true)
    await post('record-start', { url })
    setBusy(false)
  }

  async function stop(discard: boolean): Promise<void> {
    setBusy(true)
    const ok = await post('record-stop', discard ? { discard: true } : { name, title })
    setBusy(false)
    if (ok) {
      setName('')
      setTitle('')
      setUrl('')
    }
  }

  return (
    <>
      <h2 className="section">Recordings</h2>
      <p className="muted">
        Do something once in the browser and Titan117 can do it again, without AI: the same clicks
        and typing, on the sites you’re signed into. A password is never recorded; it comes from
        Saved logins below. Buttons that send, pay or publish wait for your OK every time.
      </p>
      {data.session ? (
        <div className="row row-tint row-stack">
          <p className="row-title">
            Recording… {data.session.events} action{data.session.events === 1 ? '' : 's'} seen
          </p>
          <p className="muted">
            Do your steps in the browser window that opened ({data.session.url}), then come back
            here. Stop before a final button if you only want it prepared.
          </p>
          <div className="add-row">
            <input
              className="search"
              placeholder="Name: small letters and dashes (monthly-report)"
              aria-label="Recording name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            />
            <input
              className="search"
              placeholder="What it does (optional)"
              aria-label="What it does"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={busy || !name}
              onClick={() => void stop(false)}
            >
              Stop and save
            </button>
            <button className="btn" disabled={busy} onClick={() => void stop(true)}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <div className="add-row">
          <input
            className="search"
            placeholder="Where it starts, e.g. https://portal.example.com"
            aria-label="Where the recording starts"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !url.trim()}
            onClick={() => void start()}
          >
            Record new
          </button>
        </div>
      )}
      {data.recordings.map((r) => (
        <div key={r.name} className="row row-stack">
          <div className="row-line">
            <span className="row-icon">
              <Icon name="play" />
            </span>
            <div className="row-main">
              <p className="row-title">{r.title}</p>
              <p className="muted">
                <span className="mono">{r.name}</span> · {r.steps.length} steps · starts at {r.url}
              </p>
              {r.missingLogins.length > 0 && (
                <p className="warn">
                  Needs a saved login for {r.missingLogins.join(', ')} (add it below).
                </p>
              )}
            </div>
            <button
              className="btn btn-primary"
              onClick={() =>
                void post<{ task?: { id: string } }>('recording-run', {
                  name: r.name,
                  values: values[r.name] ?? {}
                }).then((res) => res?.task && onOpenTask(res.task.id))
              }
            >
              Run
            </button>
            <button
              className="btn"
              onClick={() =>
                setEditing(
                  editing?.name === r.name
                    ? null
                    : {
                        name: r.name,
                        text: JSON.stringify(
                          {
                            name: r.name,
                            title: r.title,
                            url: r.url,
                            variables: r.variables,
                            steps: r.steps
                          },
                          null,
                          2
                        )
                      }
                )
              }
            >
              {editing?.name === r.name ? 'Close' : 'Edit'}
            </button>
            <button className="btn" onClick={() => void post('recording-remove', { name: r.name })}>
              Remove
            </button>
          </div>
          {r.variables.length > 0 && (
            <div className="add-row">
              {r.variables.map((v) => (
                <input
                  key={v.name}
                  className="search"
                  aria-label={v.label}
                  placeholder={`${v.label}${v.default ? ` (${v.default})` : ''}`}
                  value={values[r.name]?.[v.name] ?? ''}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [r.name]: { ...(values[r.name] ?? {}), [v.name]: e.target.value }
                    })
                  }
                />
              ))}
            </div>
          )}
          <details className="fold">
            <summary>Steps</summary>
            <ol className="rec-steps">
              {r.stepsText.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </details>
          {editing?.name === r.name && (
            <>
              <label className="field">
                Steps and variables. A value that changes each run is a variable: write{' '}
                {'{{month}}'} in a step and list it under {'"variables"'}. A step{' '}
                {'{"action": "pause", "note": "Enter the code from your phone"}'} hands over to you.
                <textarea
                  className="mono"
                  rows={14}
                  spellCheck={false}
                  value={editing.text}
                  onChange={(e) => setEditing({ name: r.name, text: e.target.value })}
                />
              </label>
              <div className="row-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    let parsed: unknown
                    try {
                      parsed = JSON.parse(editing.text)
                    } catch {
                      parsed = null
                    }
                    void post('recording-save', {
                      recording: { ...(parsed as object), name: r.name }
                    }).then((ok) => ok && setEditing(null))
                  }}
                >
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </>
  )
}

function Logins({
  onProblem,
  changed
}: {
  onProblem(error: unknown): void
  changed: number
}): React.JSX.Element {
  const [saved, setSaved] = useState<{ site: string; username: string }[]>([])
  const [site, setSite] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(() => {
    window.titan117.logins.saved().then(setSaved).catch(onProblem)
  }, [onProblem])
  useEffect(load, [load, changed])

  async function add(): Promise<void> {
    const result = await window.titan117.logins.save(site, username, password)
    if (!result.ok) return setProblem(result.problem)
    setProblem(null)
    setSite('')
    setUsername('')
    setPassword('')
    load()
  }

  return (
    <>
      <h2 className="section">Saved logins</h2>
      <p className="muted">
        For recordings that sign in. Kept in this computer’s keychain, never in a recording, never
        shown to an AI model and never sent to us. A login is filled in only on its own site.
      </p>
      {saved.map((l) => (
        <div key={l.site} className="row">
          <span className="row-icon">
            <Icon name="shield" />
          </span>
          <div className="row-main">
            <p className="row-title">{l.site}</p>
            <p className="muted">{l.username}</p>
          </div>
          <button
            className="btn"
            onClick={() => void window.titan117.logins.remove(l.site).then(load).catch(onProblem)}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="add-row">
        <input
          className="search"
          placeholder="Site (portal.example.com)"
          aria-label="Site"
          value={site}
          onChange={(e) => setSite(e.target.value)}
        />
        <input
          className="search"
          placeholder="User name or email"
          aria-label="User name"
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="search"
          type="password"
          placeholder="Password"
          aria-label="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          className="btn"
          disabled={!site.trim() || !username.trim() || !password}
          onClick={() => void add().catch(onProblem)}
        >
          Save
        </button>
      </div>
      {problem && <p className="warn">{problem}</p>}
    </>
  )
}
