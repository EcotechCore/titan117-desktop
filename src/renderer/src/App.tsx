// The window (design.md 0.2): title bar, sidebar, workspace and task details.
// Everything it shows comes from the engine's local API.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import type {
  AgentDef,
  ApprovalAnswer,
  CloudModel,
  EngineState,
  Estimate,
  LocalModel,
  OwnKeyModel,
  Task,
  TaskDetail
} from '../../shared/protocol'
import { connect, type EngineClient } from './engine'
import { initialState, reducer } from './state'
import { TaskView } from './TaskView'
import { clock, folderName, modelName, usd } from './format'
import { Eyes, Icon, type EyesState } from './ui'
import { AccountBox, LeaseWarning, LockScreen } from './Account'
import { useAccount } from './useAccount'
import { ApprovalsView, ModelsView } from './Views'
import { MemoryView } from './Memory'
import { ConnectorsView } from './Connectors'
import { play, record, stopPlaying, type Recording } from './voice'
import { ReadAloudBar, type Reading } from './ReadAloudBar'
import { VoiceBar } from './VoiceBar'
import { ArtifactPanel, ArtifactsView } from './Artifacts'
import { SearchView } from './Search'
import { ReportDialog } from './Reports'
import { SetupView, SetupWizard, type FixHandler } from './Setup'
import { DocumentsView } from './Documents'
import { CodeView } from './Code'
import { AppsView } from './Apps'
import { SidebarAppView, type SidebarAppInfo } from './SidebarApp'
import { AgentsView } from './Agents'
import { byTeam } from './agents-lib'
import { CompareView } from './Compare'
import { AutomationsView } from './Automations'
import { MediaModelsView } from './Media'
import type { ReportMode } from '../../shared/protocol'

const PROMPTS = [
  'Find every invoice in my folder and total them in a CSV.',
  'Read https://titan117.com and tell me what it offers.',
  'Research the rules for e-invoicing in Romania and make a report with sources.',
  'Rename the photos in my folder by the date they were taken.',
  'Remember that our company is called … and what we sell.'
]

function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  const client = useRef<EngineClient | null>(null)
  // The same client, as state, for the views that load their own lists.
  const [api, setApi] = useState<EngineClient | null>(null)
  const [text, setText] = useState('')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [attempt, setAttempt] = useState(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const account = useAccount()
  const recording = useRef<Recording | null>(null)
  const [voice, setVoice] = useState<'off' | 'recording' | 'transcribing'>('off')
  // Deep research (16.8): the next new task runs as research.
  const [research, setResearch] = useState(false)
  // Error reports (19.7): "never" means no card after an error; Report a problem still works.
  const [reportMode, setReportMode] = useState<ReportMode>('ask')
  // The first-launch wizard (1.12), until it's finished or skipped.
  const [wizard, setWizard] = useState(false)
  // A downloaded update waiting for a restart (1.10).
  const [update, setUpdate] = useState<string | null>(null)
  // Sidebar apps (6.2): read again whenever the engine says they changed.
  const [sidebarApps, setSidebarApps] = useState<SidebarAppInfo[]>([])
  const sidebarChanged = state.changed.sidebar ?? 0
  // The team (4.2): agents in the sidebar under their teams; the one a new task goes to.
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [agentName, setAgentName] = useState('Titan')
  /** The agent whose page sent the user to Automations (a schedule or trigger for it, 4.1). */
  const [automateAgent, setAutomateAgent] = useState<string | null>(null)
  const agentsChanged = state.changed.agents ?? 0
  useEffect(() => {
    if (!api) return
    api
      .get<{ agents: AgentDef[] }>('/v1/agents')
      .then((r) => setAgents(r.agents))
      .catch(() => undefined)
  }, [api, agentsChanged])
  const draftAgent = agents.find((a) => a.name === agentName) ?? null
  // Teams fold up in the sidebar, so the task list keeps its room; remembered on this laptop.
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('titan117.foldedTeams') ?? '[]')
      return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const toggleTeam = (team: string): void =>
    setFolded((now) => {
      const next = now.includes(team) ? now.filter((x) => x !== team) : [...now, team]
      try {
        localStorage.setItem('titan117.foldedTeams', JSON.stringify(next))
      } catch {
        // Not kept; it still folds for now.
      }
      return next
    })
  useEffect(() => {
    if (!api) return
    api
      .get<{ apps: SidebarAppInfo[] }>('/v1/sidebar')
      .then((r) => setSidebarApps(r.apps))
      .catch(() => undefined)
  }, [api, sidebarChanged])

  const { engine, view, model } = state
  const taskId = view.kind === 'task' ? view.id : null
  const detail: TaskDetail | null = taskId ? (state.details[taskId] ?? null) : null
  const task: Task | null = detail?.task ?? null
  const busy = task?.status === 'running' || task?.status === 'waiting'

  const fail = useCallback((error: unknown) => {
    dispatch({
      type: 'problem',
      message: error instanceof Error ? error.message : 'Something went wrong.'
    })
  }, [])

  // Connect, load the state, then follow events. Reconnects if the engine restarts.
  useEffect(() => {
    const abort = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      try {
        const api = await connect()
        client.current = api
        setApi(api)
        dispatch({ type: 'loaded', engine: await api.get<EngineState>('/v1/state') })
        void api
          .get<{ mode: ReportMode }>('/v1/reports')
          .then((r) => setReportMode(r.mode))
          .catch(() => undefined)
        void api
          .get<{ done: boolean }>('/v1/setup')
          .then((s) => setWizard(!s.done))
          .catch(() => undefined)
        void api
          .get<{ cloud: CloudModel[]; own: OwnKeyModel[] }>('/v1/models')
          .then((m) => dispatch({ type: 'cloud', models: m.cloud, own: m.own }))
          .catch(() => undefined)
        await api.events((event) => dispatch({ type: 'event', event }), abort.signal)
      } catch {
        if (abort.signal.aborted) return
        dispatch({ type: 'lost' })
        retry = setTimeout(() => setAttempt((n) => n + 1), 1500)
      }
    })()
    return () => {
      abort.abort()
      clearTimeout(retry)
    }
  }, [attempt])

  useEffect(() => {
    window.titan117.onEngineRestart(() => setAttempt((n) => n + 1))
    window.titan117.onOpenTask((id) => dispatch({ type: 'view', view: { kind: 'task', id } }))
    const onUpdate = (s: { state: string; version?: string }): void =>
      setUpdate(s.state === 'ready' ? (s.version ?? '') : null)
    window.titan117.updates.onChange(onUpdate)
    void window.titan117.updates
      .state()
      .then(onUpdate)
      .catch(() => undefined)
  }, [])

  // Open a task: load its messages, approvals and activity once.
  useEffect(() => {
    if (!taskId || state.status !== 'ready') return
    client.current
      ?.get<TaskDetail>(`/v1/tasks/${taskId}`)
      .then((d) => dispatch({ type: 'detail', detail: d }))
      .catch(fail)
  }, [taskId, state.status, fail])

  // Parts handed to other agents (4.6) come and go as task events; the team talk (4.7)
  // is read again whenever one of them, or the task itself, changes state.
  const parts = taskId ? state.tasks.filter((t) => t.parentId === taskId) : []
  const partsKey = parts.map((p) => `${p.id}:${p.status}`).join('|')
  const openStatus = taskId ? state.tasks.find((t) => t.id === taskId)?.status : undefined
  useEffect(() => {
    if (!taskId || state.status !== 'ready' || (!partsKey && openStatus === 'running')) return
    const timer = setTimeout(() => {
      client.current
        ?.get<TaskDetail>(`/v1/tasks/${taskId}`)
        .then((d) => dispatch({ type: 'detail', detail: d }))
        .catch(() => undefined)
    }, 300)
    return () => clearTimeout(timer)
  }, [taskId, partsKey, openStatus, state.status])

  // Cost shown before a task runs (feature 2.5).
  useEffect(() => {
    if (!model || state.status !== 'ready') return
    const timer = setTimeout(() => {
      client.current
        ?.send<Estimate>('POST', '/v1/estimate', { model, text, taskId })
        .then(setEstimate)
        .catch(() => setEstimate(null))
    }, 300)
    return () => clearTimeout(timer)
  }, [model, text, taskId, state.status])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        dispatch({ type: 'view', view: { kind: 'start' } })
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const chooseModel = useCallback(
    (next: string) => {
      dispatch({ type: 'model', model: next })
      client.current?.send('PUT', '/v1/settings', { defaultModel: next }).catch(fail)
    },
    [fail]
  )

  async function send(message = text): Promise<void> {
    const api = client.current
    if (!api || !message.trim() || busy) return
    if (!model) return dispatch({ type: 'view', view: { kind: 'models' } })
    try {
      if (task) {
        await api.send('POST', `/v1/tasks/${task.id}/messages`, { text: message, model })
      } else {
        const { task: created } = await api.send<{ task: Task }>('POST', '/v1/tasks', {
          text: message,
          model,
          mode: research || /^research\b/i.test(message) ? 'research' : 'normal',
          agent: agentName
        })
        setResearch(false)
        dispatch({
          type: 'detail',
          detail: { task: created, messages: [], approvals: [], activity: [] }
        })
        dispatch({ type: 'view', view: { kind: 'task', id: created.id } })
      }
      setText('')
    } catch (error) {
      fail(error)
    }
  }

  /** A new task from another screen (the code builder), whatever task is open. */
  async function startNew(message: string): Promise<void> {
    const api = client.current
    if (!api) return
    if (!model) return dispatch({ type: 'view', view: { kind: 'models' } })
    try {
      const { task: created } = await api.send<{ task: Task }>('POST', '/v1/tasks', {
        text: message,
        model
      })
      dispatch({
        type: 'detail',
        detail: { task: created, messages: [], approvals: [], activity: [] }
      })
      dispatch({ type: 'view', view: { kind: 'task', id: created.id } })
    } catch (error) {
      fail(error)
    }
  }

  /** A checklist item's fix button (1.17, 1.20). */
  const fix: FixHandler = useCallback((f) => {
    if (f.kind === 'view' && f.target) dispatch({ type: 'view', view: { kind: f.target } as never })
    else if (f.kind === 'folder') void window.titan117.addFolder()
    else if (f.kind === 'account') void window.titan117.account.signIn().catch(() => undefined)
    else if (f.kind === 'link' && f.target) window.open(f.target)
    else if (f.kind === 'report')
      dispatch({ type: 'report', report: { feature: 'report a problem' } })
  }, [])

  /** After a key is saved or removed: what cloud calls can reach has changed. */
  const reloadModels = useCallback(async () => {
    const api = client.current
    if (!api) return
    dispatch({ type: 'loaded', engine: await api.get<EngineState>('/v1/state') })
    const m = await api.get<{ cloud: CloudModel[]; own: OwnKeyModel[] }>('/v1/models')
    dispatch({ type: 'cloud', models: m.cloud, own: m.own })
  }, [])

  /** Voice input: press to record; Done turns it into text on this laptop, Cancel drops it. */
  async function startVoice(): Promise<void> {
    if (voice !== 'off') return
    try {
      recording.current = await record()
      setVoice('recording')
    } catch {
      fail(new Error('The microphone could not be used. Check that Titan117 may use it.'))
    }
  }

  const finishVoice = useCallback(async () => {
    const current = recording.current
    if (!current) return
    setVoice('transcribing')
    try {
      const pcm16 = await current.stop()
      const { text: heard } = await client.current!.send<{ text: string }>(
        'POST',
        '/v1/speech/transcribe',
        { pcm16 }
      )
      if (heard) setText((existing) => (existing ? `${existing} ${heard}` : heard))
      else fail(new Error('No speech was heard. Try again a little closer to the microphone.'))
    } catch (error) {
      fail(error)
    } finally {
      recording.current = null
      setVoice('off')
      input.current?.focus()
    }
  }, [fail])

  const cancelVoice = useCallback(() => {
    recording.current?.cancel()
    recording.current = null
    setVoice('off')
    input.current?.focus()
  }, [])

  const micLevel = useCallback(() => recording.current?.level() ?? 0, [])

  // Read aloud (3.14), with pause, resume, speed and stop in a bar while it plays.
  const [reading, setReading] = useState<Reading | null>(null)
  const readingId = useRef(0)
  function stopReading(): void {
    readingId.current++
    stopPlaying()
    setReading(null)
  }
  function readAloud(spoken: string): void {
    const id = ++readingId.current
    stopPlaying()
    setReading({ state: 'preparing' })
    client.current
      ?.send<{ wav: string }>('POST', '/v1/speech/speak', { text: spoken })
      .then((r) => {
        // Stopped, or another reply asked for, while the voice was being made.
        if (id !== readingId.current) return
        const audio = play(r.wav, () => {
          if (id === readingId.current) setReading(null)
        })
        setReading({ state: 'playing', audio })
      })
      .catch((error) => {
        if (id === readingId.current) setReading(null)
        fail(error)
      })
  }

  const answer = useCallback(
    (id: string, reply: ApprovalAnswer) => {
      client.current?.send('POST', `/v1/approvals/${id}`, { answer: reply }).catch(fail)
    },
    [fail]
  )

  if (!engine) {
    return (
      <main className="boot">
        <Eyes state="working" size="large" />
        <p>{state.status === 'lost' ? 'Starting the engine again…' : 'Starting the engine…'}</p>
      </main>
    )
  }

  // Locked (decisions §17): the lock screen replaces the workspace; no agent runs.
  if (account?.locked) return <LockScreen view={account} />

  const waiting = state.approvals.length
  const working = state.tasks.some((t) => t.status === 'running')
  const titan: EyesState = waiting ? 'needs-you' : working ? 'working' : 'idle'
  const ready: LocalModel[] = engine.localModels.filter((m) => m.state === 'ready')
  const canSend = !!text.trim() && !busy

  return (
    <div
      className={
        state.artifact && api
          ? state.artifactFull
            ? 'win artifact-full-win'
            : 'win with-artifact'
          : state.showDetails && detail
            ? 'win'
            : 'win no-details'
      }
    >
      <header className="bar">
        <div className="brand">
          <Eyes state="idle" />
          <span className="wordmark">TITAN117</span>
        </div>
        <span className="bar-title">{task ? task.title : ''}</span>
        <div className="bar-right">
          <button
            className="bar-btn"
            aria-label={`Approvals, ${waiting} waiting`}
            onClick={() => dispatch({ type: 'view', view: { kind: 'approvals' } })}
          >
            <Icon name="shield" />
            {waiting > 0 && <span className="badge">{waiting}</span>}
          </button>
          <button
            className="bar-btn"
            aria-label="Task details"
            aria-pressed={state.showDetails}
            onClick={() => dispatch({ type: 'toggleDetails' })}
          >
            <Icon name="panel" />
          </button>
        </div>
      </header>

      <nav className="side" aria-label="Main">
        <button
          className="btn btn-primary new-task"
          onClick={() => {
            dispatch({ type: 'view', view: { kind: 'start' } })
            input.current?.focus()
          }}
        >
          <Icon name="plus" /> New task <kbd>Ctrl N</kbd>
        </button>

        <button
          className={view.kind === 'approvals' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'approvals' } })}
        >
          <Icon name="shield" /> Approvals {waiting > 0 && <span className="count">{waiting}</span>}
        </button>
        <button
          className={view.kind === 'memory' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'memory' } })}
        >
          <Icon name="brain" /> Memory
        </button>
        <button
          className={view.kind === 'connectors' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'connectors' } })}
        >
          <Icon name="plug" /> Connectors
        </button>
        <button
          className={view.kind === 'code' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'code' } })}
        >
          <Icon name="code" /> Code
        </button>
        <button
          className={view.kind === 'apps' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'apps' } })}
        >
          <Icon name="globe" /> Apps
        </button>
        <button
          className={view.kind === 'documents' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'documents' } })}
        >
          <Icon name="folder" /> Documents
        </button>
        <button
          className={view.kind === 'artifacts' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'artifacts' } })}
        >
          <Icon name="file" /> Artifacts
        </button>
        <button
          className={view.kind === 'search' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'search' } })}
        >
          <Icon name="globe" /> Web search
        </button>
        <button
          className={view.kind === 'models' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'models' } })}
        >
          <Icon name="chip" /> Models
        </button>
        <button
          className={view.kind === 'automations' ? 'nav on' : 'nav'}
          onClick={() => {
            setAutomateAgent(null)
            dispatch({ type: 'view', view: { kind: 'automations' } })
          }}
        >
          <Icon name="calendar" /> Automations
        </button>
        <button
          className={view.kind === 'compare' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'compare' } })}
        >
          <Icon name="chart" /> Compare models
        </button>
        <button
          className={view.kind === 'setup' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'setup' } })}
        >
          <Icon name="check" /> Setup
        </button>

        <p className="label">
          Agents
          <button
            className={view.kind === 'agents' ? 'label-btn on' : 'label-btn'}
            onClick={() => dispatch({ type: 'view', view: { kind: 'agents' } })}
          >
            <Icon name="users" /> Manage
          </button>
        </p>
        <button
          className={view.kind === 'start' && agentName === 'Titan' ? 'nav on' : 'nav'}
          onClick={() => {
            setAgentName('Titan')
            dispatch({ type: 'view', view: { kind: 'start' } })
          }}
        >
          <Eyes state={titan} /> Titan
          {titan === 'needs-you' && <span className="pill">Needs you</span>}
          {titan === 'working' && <span className="shimmer">Working</span>}
        </button>
        {byTeam(agents).map(([team, list]) => (
          <div key={team} className="team">
            {(() => {
              const isFolded = folded.includes(team)
              const names = new Set(list.map((a) => a.name))
              const teamTasks = state.tasks.filter((t) => names.has(t.agent))
              const teamNeeds = state.approvals.some((ap) =>
                teamTasks.some((t) => t.id === ap.taskId)
              )
              const teamBusy = teamTasks.some((t) => t.status === 'running')
              return (
                <button
                  className={isFolded ? 'team-label folded' : 'team-label'}
                  aria-expanded={!isFolded}
                  onClick={() => toggleTeam(team)}
                >
                  <Icon name="chevron" />
                  <span className="nav-text">{team}</span>
                  {isFolded && teamNeeds && <span className="pill">Needs you</span>}
                  {isFolded && !teamNeeds && teamBusy && <span className="shimmer">Working</span>}
                  {isFolded && !teamNeeds && !teamBusy && (
                    <span className="team-count">{list.length}</span>
                  )}
                </button>
              )
            })()}
            {!folded.includes(team) &&
              list.map((a) => {
                const mine = state.tasks.filter((t) => t.agent === a.name)
                const needs = state.approvals.some((ap) => mine.some((t) => t.id === ap.taskId))
                const busyNow = mine.some((t) => t.status === 'running')
                return (
                  <button
                    key={a.id}
                    className={view.kind === 'start' && agentName === a.name ? 'nav on' : 'nav'}
                    onClick={() => {
                      setAgentName(a.name)
                      dispatch({ type: 'view', view: { kind: 'start' } })
                      setTimeout(() => input.current?.focus(), 0)
                    }}
                  >
                    <span className="agent-dot" style={{ background: a.color }} />
                    <span className="nav-text">{a.name}</span>
                    {needs && <span className="pill">Needs you</span>}
                    {!needs && busyNow && <span className="shimmer">Working</span>}
                  </button>
                )
              })}
          </div>
        ))}

        {sidebarApps.length > 0 && <p className="label">Your apps</p>}
        {sidebarApps.map((a) => (
          <button
            key={a.id}
            className={view.kind === 'sidebar-app' && view.id === a.id ? 'nav on' : 'nav'}
            onClick={() => dispatch({ type: 'view', view: { kind: 'sidebar-app', id: a.id } })}
          >
            <Icon name={a.icon} />
            <span className="nav-text">{a.title}</span>
            {a.error && <span className="dot dot-error" aria-label="reported an error" />}
          </button>
        ))}

        <p className="label">Tasks</p>
        <div className="scroll">
          {state.tasks.length === 0 && <p className="hint">No tasks yet.</p>}
          {state.tasks
            .filter((t) => !t.parentId)
            .map((t) => (
              <button
                key={t.id}
                className={taskId === t.id ? 'nav on' : 'nav'}
                onClick={() => dispatch({ type: 'view', view: { kind: 'task', id: t.id } })}
              >
                <span className={`dot dot-${t.status}`} aria-label={t.status} />
                <span className="nav-text">{t.title}</span>
              </button>
            ))}
        </div>

        <p className="label">Folders Titan may use</p>
        {engine.folders.length === 0 && (
          <p className="hint">None yet. Titan can&apos;t see any files.</p>
        )}
        {engine.folders.map((folder) => (
          <div key={folder} className="folder" title={folder}>
            <Icon name="folder" />
            <span className="nav-text">{folderName(folder)}</span>
            <button
              className="icon-btn"
              aria-label={`Stop allowing ${folder}`}
              onClick={() => void window.titan117.removeFolder(folder)}
            >
              <Icon name="x" />
            </button>
          </div>
        ))}
        <button className="btn add-folder" onClick={() => void window.titan117.addFolder()}>
          <Icon name="plus" /> Allow a folder
        </button>

        <button
          className="nav"
          onClick={() => dispatch({ type: 'report', report: { feature: 'report a problem' } })}
        >
          <Icon name="flag" /> Report a problem
        </button>
        <p className="foot mono">
          <span className={state.status === 'ready' ? 'dot dot-done' : 'dot dot-error'} />
          {state.status === 'ready' ? 'Engine running' : 'Engine restarting'} · v{engine.appVersion}
        </p>
        {account && <AccountBox view={account} />}
      </nav>

      <main className="work">
        {account && <LeaseWarning view={account} />}
        {update !== null && (
          <div className="note offline-switch" role="status">
            <span>Titan117 {update} is ready.</span>
            <button
              className="btn btn-primary"
              onClick={() => {
                const running = state.tasks.some(
                  (t) => t.status === 'running' || t.status === 'waiting'
                )
                if (
                  running &&
                  !window.confirm(
                    'A task is still working. Restart now? It carries on after the update.'
                  )
                )
                  return
                void window.titan117.updates.install()
              }}
            >
              Restart to update
            </button>
          </div>
        )}
        {!engine.online && (
          <div className="note offline-bar" role="status">
            <strong>Offline.</strong> Local models, your files and tools keep working. Cloud models,
            web search and sharing wait for the internet; error reports wait and go by themselves.
          </div>
        )}
        {state.lastError && reportMode === 'ask' && (
          <div className="note note-error error-card" role="alert">
            <span>
              Something went wrong ({state.lastError.source}). It was saved to the local log. Send
              us a report? You&apos;ll see all of it first.
            </span>
            <button
              className="btn"
              onClick={() =>
                dispatch({ type: 'report', report: { errorRef: state.lastError!.errorId } })
              }
            >
              Review the report
            </button>
            <button
              className="icon-btn"
              aria-label="Dismiss"
              onClick={() => dispatch({ type: 'dismissError' })}
            >
              <Icon name="x" />
            </button>
          </div>
        )}
        <div className="work-scroll">
          {view.kind === 'approvals' && (
            <ApprovalsView
              approvals={state.approvals}
              tasks={state.tasks}
              onAnswer={answer}
              onOpen={(id) => dispatch({ type: 'view', view: { kind: 'task', id } })}
            />
          )}
          {view.kind === 'memory' && (
            <MemoryView client={api} changed={state.changed} onProblem={fail} />
          )}
          {view.kind === 'artifacts' && (
            <ArtifactsView
              client={api}
              changed={state.changed.artifacts ?? 0}
              onOpen={(id) => dispatch({ type: 'artifact', id })}
              onProblem={fail}
            />
          )}
          {view.kind === 'code' && (
            <CodeView
              client={api}
              engine={engine}
              changed={
                state.tasks.filter((t) => t.status === 'running').length * 1000 +
                state.approvals.length
              }
              onStart={(message) => void startNew(message)}
              onProblem={fail}
            />
          )}
          {view.kind === 'sidebar-app' &&
            (() => {
              const shown = sidebarApps.find((a) => a.id === view.id)
              return shown && api ? (
                <SidebarAppView
                  client={api}
                  app={shown}
                  onAsk={(request) => {
                    setText(request)
                    dispatch({ type: 'view', view: { kind: 'start' } })
                    setTimeout(() => input.current?.focus(), 0)
                  }}
                  onFix={(request) => void startNew(request)}
                  onProblem={fail}
                />
              ) : (
                <p className="hint">This app isn&apos;t in the sidebar any more.</p>
              )
            })()}
          {view.kind === 'apps' && (
            <AppsView
              client={api}
              engine={engine}
              cloud={state.cloud}
              onKeysChanged={() => void reloadModels().catch(fail)}
              changed={
                (state.changed.apps ?? 0) +
                state.tasks.filter((t) => t.status === 'running').length * 1000 +
                state.approvals.length
              }
              onStart={(message) => void startNew(message)}
              onProblem={fail}
            />
          )}
          {view.kind === 'documents' && (
            <DocumentsView
              client={api}
              engine={engine}
              changed={state.changed.documents ?? 0}
              onProblem={fail}
            />
          )}
          {view.kind === 'setup' && (
            <SetupView
              client={api}
              changed={(state.changed.connectors ?? 0) + (state.changed.reports ?? 0)}
              onFix={fix}
              onProblem={fail}
            />
          )}
          {view.kind === 'search' && (
            <SearchView
              client={api}
              engine={engine}
              onKeysChanged={() => void reloadModels().catch(fail)}
              onProblem={fail}
            />
          )}
          {view.kind === 'connectors' && (
            <ConnectorsView client={api} changed={state.changed.connectors ?? 0} onProblem={fail} />
          )}
          {view.kind === 'agents' && (
            <AgentsView
              client={api}
              engine={engine}
              cloud={state.cloud}
              changed={agentsChanged + (state.changed.skills ?? 0)}
              onStart={(name) => {
                setAgentName(name)
                dispatch({ type: 'view', view: { kind: 'start' } })
                setTimeout(() => input.current?.focus(), 0)
              }}
              onAutomate={(name) => {
                setAutomateAgent(name)
                dispatch({ type: 'view', view: { kind: 'automations' } })
              }}
              onProblem={fail}
            />
          )}
          {view.kind === 'automations' && (
            <AutomationsView
              key={automateAgent ?? 'all'}
              client={api}
              agent={automateAgent}
              changed={state.changed.automations ?? 0}
              onProblem={fail}
              onOpenTask={(id) => dispatch({ type: 'view', view: { kind: 'task', id } })}
              onAskTitan={(words) =>
                void startNew(
                  `${words}

(Make this a schedule with schedule_create; add a web watch or use a recording if it needs one.)`
                )
              }
            />
          )}
          {view.kind === 'compare' && (
            <CompareView
              client={api}
              engine={engine}
              cloud={state.cloud}
              model={model}
              onProblem={fail}
            />
          )}
          {view.kind === 'models' && (
            <ModelsView
              engine={engine}
              cloud={state.cloud}
              own={state.own}
              onKeysChanged={() => void reloadModels().catch(fail)}
              model={model}
              onUse={chooseModel}
              onDownload={(id) =>
                client.current?.send('POST', `/v1/models/${id}/download`).catch(fail)
              }
              onCancel={(id) => client.current?.send('POST', `/v1/models/${id}/cancel`).catch(fail)}
              onRemove={(id) => client.current?.send('DELETE', `/v1/models/${id}`).catch(fail)}
            />
          )}
          {view.kind === 'models' && <MediaModelsView client={api} onProblem={fail} />}
          {view.kind === 'start' && (
            <div className="start">
              <Eyes state="working" size="large" />
              <h1>What should {agentName} do?</h1>
              <p className="muted">
                {draftAgent && agentName !== 'Titan'
                  ? `${draftAgent.role} It asks before it changes anything.`
                  : 'Titan works on this laptop with files, the shell, the browser and your connectors. It reads only the folders you allow, and asks before it changes anything.'}
              </p>
              <div className="prompts">
                {(agentName === 'Titan' ? PROMPTS : []).map((prompt) => (
                  <button key={prompt} className="prompt" onClick={() => void send(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
          {view.kind === 'task' && detail && (
            <TaskView
              detail={detail}
              streaming={state.streaming[detail.task.id] ?? ''}
              engine={engine}
              onAnswer={answer}
              onReadAloud={readAloud}
              client={api}
            />
          )}
        </div>

        {(view.kind === 'start' || view.kind === 'task') && (
          <div className="composer">
            {reading && (
              <ReadAloudBar
                reading={reading}
                onPause={() => {
                  if (reading.state === 'preparing') return
                  reading.audio.pause()
                  setReading({ state: 'paused', audio: reading.audio })
                }}
                onResume={() => {
                  if (reading.state === 'preparing') return
                  void reading.audio.play()
                  setReading({ state: 'playing', audio: reading.audio })
                }}
                onStop={stopReading}
              />
            )}
            {task?.status === 'stopped' &&
              !task.note?.startsWith('No internet') &&
              task.note !== 'You stopped this task.' && (
                <div className="note offline-switch">
                  <span>{task.note ?? 'This task stopped.'}</span>
                  <button
                    className="btn btn-primary"
                    onClick={() =>
                      client.current?.send('POST', `/v1/tasks/${task.id}/resume`).catch(fail)
                    }
                  >
                    Resume
                  </button>
                </div>
              )}
            {task?.status === 'stopped' &&
              (task.note?.startsWith('No internet') ||
                task.note?.startsWith(
                  'This task read files from a folder kept for local models'
                )) && (
                <div className="note offline-switch">
                  <span>{task.note}</span>
                  {ready[0] ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        const local = `local:${ready[0].id}`
                        chooseModel(local)
                        client.current
                          ?.send('POST', `/v1/tasks/${task.id}/messages`, {
                            text: 'Continue with the local model.',
                            model: local
                          })
                          .catch(fail)
                      }}
                    >
                      Continue with {ready[0].name} (local)
                    </button>
                  ) : (
                    <span className="muted">
                      Download a local model in Models to keep working offline.
                    </span>
                  )}
                </div>
              )}
            {state.problem && (
              <p className="note note-error" role="alert">
                {state.problem}
              </p>
            )}
            <div className="box">
              {voice !== 'off' && (
                <VoiceBar
                  state={voice}
                  level={micLevel}
                  onDone={() => void finishVoice()}
                  onCancel={cancelVoice}
                />
              )}
              <textarea
                style={voice !== 'off' ? { display: 'none' } : undefined}
                ref={input}
                rows={2}
                placeholder={task ? `Reply to ${task.agent}` : `Describe a task for ${agentName}`}
                aria-label="Message"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <div className="box-row">
                <label className="chip">
                  <Icon name="chip" />
                  <span className="sr">Model</span>
                  <select
                    value={model ?? ''}
                    onChange={(e) =>
                      e.target.value === 'more'
                        ? dispatch({ type: 'view', view: { kind: 'models' } })
                        : chooseModel(e.target.value)
                    }
                  >
                    {!model && <option value="">Choose a model</option>}
                    {model && !ready.some((m) => `local:${m.id}` === model) && (
                      <option value={model}>{modelName(model, engine)}</option>
                    )}
                    {ready.map((m) => (
                      <option key={m.id} value={`local:${m.id}`}>
                        {m.name} · local
                      </option>
                    ))}
                    <option value="more">More models…</option>
                  </select>
                </label>
                {!task && (
                  <label className="chip">
                    <span
                      className="agent-dot"
                      style={{ background: draftAgent?.color ?? '#ff6347' }}
                    />
                    <span className="sr">Agent</span>
                    <select value={agentName} onChange={(e) => setAgentName(e.target.value)}>
                      {(agents.length ? agents : [{ name: 'Titan', id: 'titan' }]).map((a) => (
                        <option key={a.id} value={a.name}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!task && (
                  <button
                    className={research ? 'chip chip-on' : 'chip'}
                    aria-pressed={research}
                    title="Many searches, reading and cross-checking, then a report with sources"
                    onClick={() => setResearch(!research)}
                  >
                    <Icon name="globe" /> Deep research
                  </button>
                )}
                <span className="cost mono">{model && estimate ? estimate.label : ''}</span>
                {voice === 'off' && (
                  <button
                    className="voice"
                    aria-label="Speak instead of typing"
                    title="Speak instead of typing"
                    onClick={() => void startVoice()}
                  >
                    <Icon name="mic" />
                  </button>
                )}
                {busy ? (
                  <button
                    className="send"
                    aria-label="Stop"
                    onClick={() =>
                      client.current?.send('POST', `/v1/tasks/${task!.id}/cancel`).catch(fail)
                    }
                  >
                    <Icon name="stop" />
                  </button>
                ) : (
                  <button
                    className="send"
                    aria-label="Send"
                    disabled={!canSend}
                    onClick={() => void send()}
                  >
                    <Icon name="send" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {wizard && api && (
        <SetupWizard
          client={api}
          signedIn={!!account?.signedIn}
          onFix={fix}
          onDone={() => setWizard(false)}
          onProblem={fail}
        />
      )}

      {state.report && api && (
        <ReportDialog
          client={api}
          errorRef={state.report.errorRef}
          feature={state.report.feature}
          onClose={() => {
            dispatch({ type: 'report', report: null })
            void api
              .get<{ mode: ReportMode }>('/v1/reports')
              .then((r) => setReportMode(r.mode))
              .catch(() => undefined)
          }}
          onProblem={fail}
        />
      )}

      {state.artifact && api && (
        <ArtifactPanel
          key={state.artifact}
          client={api}
          id={state.artifact}
          changed={state.changed.artifacts ?? 0}
          full={state.artifactFull}
          onFull={() => dispatch({ type: 'artifactFull' })}
          onClose={() => dispatch({ type: 'artifact', id: null })}
          onProblem={fail}
          onAsk={(text) => {
            if (!model) return dispatch({ type: 'view', view: { kind: 'models' } })
            client.current
              ?.send<{ task: Task }>('POST', '/v1/tasks', { text, model })
              .then(({ task: created }) => {
                dispatch({
                  type: 'detail',
                  detail: { task: created, messages: [], approvals: [], activity: [] }
                })
                dispatch({ type: 'view', view: { kind: 'task', id: created.id } })
              })
              .catch(fail)
          }}
        />
      )}

      {!state.artifact && state.showDetails && detail && (
        <aside className="details" aria-label="Task details">
          <span className={`status status-${detail.task.status}`}>
            {
              {
                running: 'Running',
                waiting: 'Needs you',
                done: 'Done',
                stopped: 'Stopped',
                error: 'Error'
              }[detail.task.status]
            }
          </span>
          <dl className="facts">
            <dt>Agent</dt>
            <dd>{detail.task.agent}</dd>
            <dt>Model</dt>
            <dd>{modelName(detail.task.model, engine)}</dd>
            <dt>Steps</dt>
            <dd className="mono">{detail.task.steps}</dd>
            <dt>Cost</dt>
            <dd className="mono">{usd(detail.task.costUsd)}</dd>
          </dl>
          {detail.task.status === 'error' && /ref ([0-9a-f]{8})/.exec(detail.task.note ?? '') && (
            <button
              className="btn"
              onClick={() =>
                dispatch({
                  type: 'report',
                  report: { errorRef: /ref ([0-9a-f]{8})/.exec(detail.task.note ?? '')![1] }
                })
              }
            >
              Send a report about this
            </button>
          )}
          {parts.length > 0 && (
            <>
              <p className="label">Parts handed out</p>
              <ul className="parts">
                {parts.map((p) => (
                  <li key={p.id}>
                    <button
                      className="link"
                      onClick={() => dispatch({ type: 'view', view: { kind: 'task', id: p.id } })}
                    >
                      <span className={`dot dot-${p.status}`} aria-label={p.status} /> {p.agent}
                    </button>
                    <span className="mono muted"> {usd(p.costUsd)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {detail.task.parentId && (
            <button
              className="link"
              onClick={() =>
                dispatch({ type: 'view', view: { kind: 'task', id: detail.task.parentId! } })
              }
            >
              ← The task this is a part of
            </button>
          )}
          {(detail.talk?.length ?? 0) > 0 && (
            <>
              <p className="label">Team talk</p>
              <ol className="talk">
                {detail.talk!.map((m) => (
                  <li key={m.id} className={`talk-${m.kind}`}>
                    <span className="talk-who">
                      {m.from} → {m.to}
                    </span>
                    <span className="talk-text">{m.text}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="label">Activity</p>
          <ol className="log">
            {detail.activity.map((a) => (
              <li key={a.id} className={`log-${a.kind}`}>
                <span className="log-time">{clock(a.at)}</span>
                <span>
                  {a.summary}
                  {a.costUsd > 0 && ` · ${usd(a.costUsd)}`}
                  {a.approvedBy && ` · approved by ${a.approvedBy}`}
                </span>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  )
}

export default App
