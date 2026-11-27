// Layout v2 (decisions §67): the short sidebar, the Customize and Settings
// screens that gather what used to be sidebar rows, and Ctrl K search.
// Every screen the old sidebar reached is reachable from here.
import { useEffect, useMemo, useRef, useState } from 'react'

import type { AgentDef, Approval, EngineState, Task } from '../../shared/protocol'
import type { AccountView } from '../../preload/index.d'
import { AccountBox } from './Account'
import { folderName } from './format'
import { age, groupTasks } from './layout-lib'
import type { SidebarAppInfo } from './SidebarApp'
import type { View } from './state'
import { Icon } from './ui'

type IconName = Parameters<typeof Icon>[0]['name']

/** The screens Customize gathers, in the order the owner listed them. */
const CUSTOMIZE: { view: View; title: string; icon: IconName; line: string }[] = [
  {
    view: { kind: 'memory' },
    title: 'Memory',
    icon: 'brain',
    line: 'What agents remember, skills and past tasks'
  },
  {
    view: { kind: 'connectors' },
    title: 'Connectors',
    icon: 'plug',
    line: 'Mail, calendars and the services you connect'
  },
  {
    view: { kind: 'addons' },
    title: 'Add-ons',
    icon: 'box',
    line: 'Agents, skills, tools and apps from the marketplace'
  },
  {
    view: { kind: 'models' },
    title: 'Models',
    icon: 'chip',
    line: 'Local and cloud models, and the default'
  },
  { view: { kind: 'keys' }, title: 'Keys', icon: 'shield', line: 'Your own API keys' },
  {
    view: { kind: 'search' },
    title: 'Web search',
    icon: 'globe',
    line: 'How agents search the web'
  },
  {
    view: { kind: 'remote' },
    title: 'Remote control',
    icon: 'send',
    line: 'Your phone and chat channels, off by default'
  },
  {
    view: { kind: 'team' },
    title: 'Team',
    icon: 'users',
    line: 'Agents and apps shared with your team'
  },
  { view: { kind: 'setup' }, title: 'Setup', icon: 'check', line: 'The checklist and health' },
  {
    view: { kind: 'compare' },
    title: 'Compare',
    icon: 'chart',
    line: 'The same task on several models'
  }
]

/** Screens that have no row of their own in the sidebar. */
const MORE: { view: View; title: string; icon: IconName; line: string }[] = [
  {
    view: { kind: 'approvals' },
    title: 'Approvals',
    icon: 'shield',
    line: 'Everything waiting for your OK'
  },
  { view: { kind: 'code' }, title: 'Code', icon: 'code', line: 'The code builder' },
  {
    view: { kind: 'documents' },
    title: 'Documents',
    icon: 'folder',
    line: 'Document folders and search'
  },
  { view: { kind: 'artifacts' }, title: 'Artifacts', icon: 'file', line: 'Everything agents made' },
  {
    view: { kind: 'marketing' },
    title: 'Marketing',
    icon: 'tag',
    line: 'Brand kit, calendar and videos'
  }
]

const CUSTOMIZE_KINDS = new Set<string>(CUSTOMIZE.map((c) => c.view.kind).concat('customize'))

export function Sidebar({
  view,
  tasks,
  approvals,
  engine,
  apps,
  onView,
  onNew,
  onAutomations
}: {
  view: View
  tasks: Task[]
  approvals: Approval[]
  engine: EngineState
  apps: SidebarAppInfo[]
  onView(view: View): void
  onNew(): void
  onAutomations(): void
}): React.JSX.Element {
  const taskId = view.kind === 'task' ? view.id : null
  const { folders, loose } = groupTasks(tasks, engine.folders)
  const needs = new Set(approvals.map((a) => a.taskId))
  // Ages tick over once a minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const row = (on: boolean): string => (on ? 'nav on' : 'nav')
  const taskRow = (t: Task, nested: boolean): React.JSX.Element => (
    <button
      key={t.id}
      className={`${row(taskId === t.id)}${nested ? ' nav-task' : ''}`}
      onClick={() => onView({ kind: 'task', id: t.id })}
      title={t.title}
    >
      <span className="nav-text">
        {t.title}
        {t.syncedFrom && <span className="muted"> · from {t.syncedFrom}</span>}
      </span>
      {needs.has(t.id) || t.status === 'waiting' ? (
        <span className="dot dot-needs" aria-label="Needs you" />
      ) : t.status === 'running' ? (
        <span className="dot dot-running" aria-label="Working" />
      ) : t.status === 'error' ? (
        <span className="dot dot-error" aria-label="Error" />
      ) : (
        <span className="age">{age(t.updatedAt, now)}</span>
      )}
    </button>
  )

  return (
    <nav className="side" aria-label="Main">
      <button className="new-task" onClick={onNew}>
        <Icon name="plus" /> New task <kbd>Ctrl N</kbd>
      </button>

      <div className="side-nav">
        <button className={row(view.kind === 'automations')} onClick={onAutomations}>
          <Icon name="calendar" /> <span className="nav-text">Automations</span>
        </button>
        <button className={row(view.kind === 'apps')} onClick={() => onView({ kind: 'apps' })}>
          <Icon name="app" /> <span className="nav-text">Apps</span>
        </button>
        {apps.map((a) => (
          <button
            key={a.id}
            className={`${row(view.kind === 'sidebar-app' && view.id === a.id)} nav-task`}
            onClick={() => onView({ kind: 'sidebar-app', id: a.id })}
          >
            <span className="nav-text">{a.title}</span>
            {a.error && <span className="dot dot-error" aria-label="reported an error" />}
          </button>
        ))}
        <button className={row(view.kind === 'agents')} onClick={() => onView({ kind: 'agents' })}>
          <Icon name="users" /> <span className="nav-text">Agents</span>
        </button>
        <button
          className={row(CUSTOMIZE_KINDS.has(view.kind))}
          onClick={() => onView({ kind: 'customize' })}
        >
          <Icon name="list" /> <span className="nav-text">Customize</span>
          <span className="age">memory, keys…</span>
        </button>
      </div>

      <div className="side-scroll">
        <p className="label">
          Folders
          <button
            className="icon-btn label-btn"
            aria-label="Allow a folder"
            title="Allow a folder"
            onClick={() => void window.titan117.addFolder()}
          >
            <Icon name="plus" />
          </button>
        </p>
        {folders.length === 0 && <p className="hint">None yet. Titan can&apos;t see any files.</p>}
        {folders.map(({ folder, tasks: inside }) => (
          <div key={folder} className="folder-group">
            <div className="folder" title={folder}>
              <Icon name="folder" />
              <span className="nav-text">{folderName(folder)}</span>
              <button
                className="icon-btn folder-x"
                aria-label={`Stop allowing ${folder}`}
                title="Stop allowing this folder"
                onClick={() => void window.titan117.removeFolder(folder)}
              >
                <Icon name="x" />
              </button>
            </div>
            {inside.map((t) => taskRow(t, true))}
          </div>
        ))}

        <p className="label">
          Tasks
          <button
            className="icon-btn label-btn"
            aria-label="New task"
            title="New task"
            onClick={onNew}
          >
            <Icon name="plus" />
          </button>
        </p>
        {tasks.length === 0 && <p className="hint">No tasks yet.</p>}
        {loose.map((t) => taskRow(t, false))}
      </div>

      <div className="side-foot">
        <button
          className={row(view.kind === 'settings')}
          onClick={() => onView({ kind: 'settings' })}
        >
          <Icon name="chip" /> <span className="nav-text">Settings</span>
          <span className={engine ? 'dot dot-done' : 'dot dot-error'} aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}

/** A grid of screens, each a card with one line (Customize). */
function Cards({
  items,
  onView
}: {
  items: { view: View; title: string; icon: IconName; line: string }[]
  onView(view: View): void
}): React.JSX.Element {
  return (
    <div className="cards">
      {items.map((c) => (
        <button key={c.title} className="card" onClick={() => onView(c.view)}>
          <span className="row-icon">
            <Icon name={c.icon} />
          </span>
          <span className="card-main">
            <span className="card-title">{c.title}</span>
            <span className="muted">{c.line}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function CustomizeView({
  onView,
  onReport
}: {
  onView(view: View): void
  onReport(): void
}): React.JSX.Element {
  return (
    <div className="list-view">
      <h1 className="view-title">Customize</h1>
      <p className="muted">How Titan117 works on this laptop.</p>
      <Cards items={CUSTOMIZE} onView={onView} />
      <h2 className="section">More screens</h2>
      <Cards items={MORE} onView={onView} />
      <button className="nav report-row" onClick={onReport}>
        <Icon name="flag" /> Report a problem
      </button>
    </div>
  )
}

export function SettingsView({
  account,
  engine,
  status,
  onView,
  onReport
}: {
  account: AccountView | null
  engine: EngineState
  status: 'connecting' | 'ready' | 'lost'
  onView(view: View): void
  onReport(): void
}): React.JSX.Element {
  return (
    <div className="list-view">
      <h1 className="view-title">Settings</h1>
      <div className="row">
        <span className="row-icon">
          <Icon name="users" />
        </span>
        <div className="row-main">
          <p className="row-title">Account</p>
          {account && (account.signedIn || account.enforced) ? (
            <AccountBox view={account} />
          ) : (
            <p className="muted">Not signed in. Everything on this laptop still works.</p>
          )}
        </div>
        {account && !account.signedIn && (
          <button
            className="btn"
            disabled={!account.configured}
            onClick={() => void window.titan117.account.signIn().catch(() => undefined)}
          >
            Sign in
          </button>
        )}
      </div>
      <div className="row">
        <span className="row-icon">
          <Icon name="chip" />
        </span>
        <div className="row-main">
          <p className="row-title">
            <span className={status === 'ready' ? 'dot dot-done' : 'dot dot-error'} />
            {status === 'ready' ? 'Engine running' : 'Engine restarting'}
          </p>
          <p className="muted mono">Titan117 v{engine.appVersion}</p>
        </div>
        <button className="btn" onClick={() => onView({ kind: 'setup' })}>
          Setup and health
        </button>
      </div>
      <h2 className="section">Customize</h2>
      <Cards items={CUSTOMIZE} onView={onView} />
      <button className="nav report-row" onClick={onReport}>
        <Icon name="flag" /> Report a problem
      </button>
    </div>
  )
}

interface Hit {
  key: string
  title: string
  hint: string
  icon: IconName
  go(): void
}

/** Ctrl K: tasks, screens, agents and folders, by name. Only what's on this laptop. */
export function Palette({
  tasks,
  agents,
  folders,
  onView,
  onAgent,
  onClose
}: {
  tasks: Task[]
  agents: AgentDef[]
  folders: string[]
  onView(view: View): void
  onAgent(name: string): void
  onClose(): void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const everything = useMemo<Hit[]>(() => {
    const screens: Hit[] = [
      ...[
        { view: { kind: 'automations' } as View, title: 'Automations', icon: 'calendar' as const },
        { view: { kind: 'apps' } as View, title: 'Apps', icon: 'app' as const },
        { view: { kind: 'agents' } as View, title: 'Agents', icon: 'users' as const },
        { view: { kind: 'customize' } as View, title: 'Customize', icon: 'list' as const },
        { view: { kind: 'settings' } as View, title: 'Settings', icon: 'chip' as const }
      ],
      ...CUSTOMIZE,
      ...MORE
    ].map((s) => ({
      key: `view:${s.title}`,
      title: s.title,
      hint: 'Screen',
      icon: s.icon,
      go: () => onView(s.view)
    }))
    return [
      ...tasks
        .filter((t) => !t.parentId)
        .map<Hit>((t) => ({
          key: `task:${t.id}`,
          title: t.title,
          hint: `Task · ${t.agent}`,
          icon: 'tasks',
          go: () => onView({ kind: 'task', id: t.id })
        })),
      ...screens,
      ...agents.map<Hit>((a) => ({
        key: `agent:${a.id}`,
        title: a.name,
        hint: 'Agent · new task',
        icon: 'users',
        go: () => onAgent(a.name)
      })),
      ...folders.map<Hit>((f) => ({
        key: `folder:${f}`,
        title: folderName(f),
        hint: 'Folder · show in Explorer',
        icon: 'folder',
        go: () => void window.titan117.files.reveal(f).catch(() => undefined)
      }))
    ]
  }, [tasks, agents, folders, onView, onAgent])

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = everything
    .filter((h) => words.every((w) => `${h.title} ${h.hint}`.toLowerCase().includes(w)))
    .slice(0, 12)
  const at = Math.min(index, Math.max(0, hits.length - 1))

  function choose(hit: Hit | undefined): void {
    if (!hit) return
    onClose()
    hit.go()
  }

  return (
    <div className="palette-back" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Search everything"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          className="palette-input"
          placeholder="Search tasks, screens, agents and folders"
          aria-label="Search everything"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex(Math.min(at + 1, hits.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex(Math.max(at - 1, 0))
            } else if (e.key === 'Enter') choose(hits[at])
          }}
        />
        <div className="palette-list" role="listbox">
          {hits.length === 0 && <p className="hint">Nothing matches.</p>}
          {hits.map((h, i) => (
            <button
              key={h.key}
              role="option"
              aria-selected={i === at}
              className={i === at ? 'palette-hit on' : 'palette-hit'}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(h)}
            >
              <Icon name={h.icon} />
              <span className="nav-text">{h.title}</span>
              <span className="faint">{h.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
