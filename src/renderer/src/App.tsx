// The window (layout v2, decisions §67): a toolbar, a short sidebar, the chat
// as a white sheet, and the right panel as its own sheet that opens like a
// drawer. Everything it shows comes from the engine's local API.
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
import { folderName, modelName } from './format'
import { Eyes, Icon, type EyesState } from './ui'
import { LeaseWarning, LockScreen } from './Account'
import { useAccount } from './useAccount'
import { ApprovalsView, ModelsView } from './Views'
import { MemoryView } from './Memory'
import { ConnectorsView } from './Connectors'
import { AddonsView, SafeModeBanner } from './Addons'
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
import { CompareView } from './Compare'
import { AutomationsView } from './Automations'
import { MarketingView } from './Marketing'
import { RemoteView } from './Remote'
import { TeamView } from './Team'
import type { TeamsView } from '../../preload/index.d'
import { MediaModelsView } from './Media'
import type { KeyProvider, ReportMode } from '../../shared/protocol'
import { OwnKeys } from './Keys'
import { folderOf } from './layout-lib'
import { RightPanel } from './RightPanel'
import { CustomizeView, Palette, SettingsView, Sidebar } from './Shell'
import type { View } from './state'

/** Titan's own colour: its dot and eyes stay tomato whatever the accent (decisions §67). */
const TITAN_COLOR = '#ff6347'

/** What the toolbar's breadcrumb says when no task is open. */
const VIEW_TITLE: Partial<Record<View['kind'], string>> = {
  start: 'New task',
  approvals: 'Approvals',
  models: 'Customize / Models',
  memory: 'Customize / Memory',
  connectors: 'Customize / Connectors',
  addons: 'Customize / Add-ons',
  artifacts: 'Artifacts',
  search: 'Customize / Web search',
  setup: 'Customize / Setup',
  documents: 'Documents',
  code: 'Code',
  apps: 'Apps',
  agents: 'Agents',
  compare: 'Customize / Compare',
  automations: 'Automations',
  remote: 'Customize / Remote control',
  marketing: 'Marketing',
  'sidebar-app': 'Apps',
  customize: 'Customize',
  settings: 'Settings',
  keys: 'Customize / Keys'
}

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
  // Ctrl K search, and the message box's + menu.
  const [palette, setPalette] = useState(false)
  const [plus, setPlus] = useState(false)
  // Sidebar apps (6.2): read again whenever the engine says they changed.
  const [sidebarApps, setSidebarApps] = useState<SidebarAppInfo[]>([])
  const sidebarChanged = state.changed.sidebar ?? 0
  // The team (4.2): agents in the sidebar under their teams; the one a new task goes to.
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [agentName, setAgentName] = useState('Titan')
  /** The agent whose page sent the user to Automations (a schedule or trigger for it, 4.1). */
  const [automateAgent, setAutomateAgent] = useState<string | null>(null)
  const [teamBrand, setTeamBrand] = useState<TeamsView['brand']>(null)
  useEffect(() => {
    window.titan117.teams.onChange((v) => setTeamBrand(v.brand))
    void window.titan117.teams
      .status()
      .then((v) => setTeamBrand(v.brand))
      .catch(() => undefined)
  }, [])
  const agentsChanged = state.changed.agents ?? 0
  useEffect(() => {
    if (!api) return
    api
      .get<{ agents: AgentDef[] }>('/v1/agents')
      .then((r) => setAgents(r.agents))
      .catch(() => undefined)
  }, [api, agentsChanged])
  const draftAgent = agents.find((a) => a.name === agentName) ?? null
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
    // A notification was clicked: its task, or the Marketing screen for a post that is due (15.4).
    window.titan117.onOpenTask((id) =>
      dispatch({
        type: 'view',
        view: id === 'view:marketing' ? { kind: 'marketing' } : { kind: 'task', id }
      })
    )
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
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (mod && key === 'n') {
        event.preventDefault()
        dispatch({ type: 'view', view: { kind: 'start' } })
        input.current?.focus()
      } else if (mod && key === 'k') {
        event.preventDefault()
        setPalette((open) => !open)
      } else if (mod && key === 'b') {
        event.preventDefault()
        dispatch({ type: 'toggleSidebar' })
      } else if (mod && key === '.') {
        event.preventDefault()
        dispatch({ type: 'toggleDetails' })
      } else if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault()
        dispatch({ type: 'back' })
      } else if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault()
        dispatch({ type: 'forward' })
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
  async function startNew(message: string, agent?: string): Promise<void> {
    const api = client.current
    if (!api) return
    if (!model) return dispatch({ type: 'view', view: { kind: 'models' } })
    try {
      const { task: created } = await api.send<{ task: Task }>('POST', '/v1/tasks', {
        text: message,
        model,
        ...(agent ? { agent } : {})
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
  const colorOf = (name: string): string =>
    agents.find((a) => a.name === name)?.color ?? (name === 'Titan' ? TITAN_COLOR : '#80868b')
  const openFolder = task ? folderOf(task, engine.folders) : null
  // The right panel is there for an open task or artifact; the toolbar's toggle opens and closes it.
  const hasRight = !!(detail || (state.artifact && api))
  const rightOpen = hasRight && state.showDetails
  const full = rightOpen && state.rightTab === 'artifact' && !!state.artifact && state.artifactFull
  const shellClass = [
    'shell',
    state.showSidebar ? '' : 'no-side',
    rightOpen ? '' : 'no-right',
    full ? 'right-full' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const openTask = (id: string): void => dispatch({ type: 'view', view: { kind: 'task', id } })
  const startWith = (name: string): void => {
    setAgentName(name)
    dispatch({ type: 'view', view: { kind: 'start' } })
    setTimeout(() => input.current?.focus(), 0)
  }

  return (
    <div className="win">
      <header className="toolbar">
        <div className="toolbar-left">
          <span className="brand" title={`Titan117 · ${titan === 'idle' ? 'idle' : titan}`}>
            <Eyes state={titan} />
          </span>
          {teamBrand && (
            // An agency's brand (white-label, decisions §68.7): its name, with ours beside it.
            <span className="team-brand" title={`${teamBrand.name} · with Titan117`}>
              <span className="team-brand-dot" style={{ background: teamBrand.accent }} />
              {teamBrand.name}
            </span>
          )}
          <button
            className="bar-btn"
            aria-label={
              state.showSidebar ? 'Hide the sidebar (Ctrl B)' : 'Show the sidebar (Ctrl B)'
            }
            title="Sidebar (Ctrl B)"
            aria-pressed={state.showSidebar}
            onClick={() => dispatch({ type: 'toggleSidebar' })}
          >
            <Icon name="sidebar" />
          </button>
          <button
            className="bar-btn"
            aria-label="Back"
            title="Back (Alt ←)"
            disabled={state.back.length === 0}
            onClick={() => dispatch({ type: 'back' })}
          >
            <Icon name="back" />
          </button>
          <button
            className="bar-btn"
            aria-label="Forward"
            title="Forward (Alt →)"
            disabled={state.forward.length === 0}
            onClick={() => dispatch({ type: 'forward' })}
          >
            <Icon name="forward" />
          </button>
          <button
            className="bar-btn"
            aria-label="Search everything (Ctrl K)"
            title="Search everything (Ctrl K)"
            onClick={() => setPalette(true)}
          >
            <Icon name="search" />
          </button>
        </div>
        <div className="crumb">
          {task ? (
            <>
              {openFolder && <span className="crumb-folder">{folderName(openFolder)} / </span>}
              <b>{task.title}</b>
            </>
          ) : (
            <b>{VIEW_TITLE[view.kind] ?? ''}</b>
          )}
        </div>
        <div className="toolbar-right">
          {update !== null && (
            <button
              className="pill-accent"
              title={`Titan117 ${update} is ready`}
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
              Restart to update →
            </button>
          )}
          <button
            className={view.kind === 'approvals' ? 'bar-btn on' : 'bar-btn'}
            aria-label={`Approvals, ${waiting} waiting`}
            title="Approvals"
            onClick={() => dispatch({ type: 'view', view: { kind: 'approvals' } })}
          >
            <Icon name="shield" />
          </button>
          {waiting > 0 && <span className="count">{waiting}</span>}
          <button
            className="bar-btn"
            aria-label="What the task made (Ctrl .)"
            title="What the task made (Ctrl .)"
            aria-pressed={rightOpen}
            disabled={!hasRight}
            onClick={() => dispatch({ type: 'toggleDetails' })}
          >
            <Icon name="panel" />
          </button>
        </div>
      </header>

      <div className={shellClass}>
        <Sidebar
          view={view}
          tasks={state.tasks}
          approvals={state.approvals}
          engine={engine}
          apps={sidebarApps}
          onView={(next) => dispatch({ type: 'view', view: next })}
          onNew={() => {
            dispatch({ type: 'view', view: { kind: 'start' } })
            setTimeout(() => input.current?.focus(), 0)
          }}
          onAutomations={() => {
            setAutomateAgent(null)
            dispatch({ type: 'view', view: { kind: 'automations' } })
          }}
        />

        <main className="work">
          {account && <LeaseWarning view={account} />}
          {view.kind !== 'addons' && (
            <SafeModeBanner
              client={api}
              changed={state.changed.addons ?? 0}
              onOpen={() => dispatch({ type: 'view', view: { kind: 'addons' } })}
            />
          )}
          {!engine.online && (
            <div className="note offline-bar" role="status">
              <strong>Offline.</strong> Local models, your files and tools keep working. Cloud
              models, web search and sharing wait for the internet; error reports wait and go by
              themselves.
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
          <div
            className={
              view.kind === 'start' || view.kind === 'task'
                ? 'work-scroll work-chat'
                : 'work-scroll'
            }
          >
            {view.kind === 'approvals' && (
              <ApprovalsView
                approvals={state.approvals}
                tasks={state.tasks}
                onAnswer={answer}
                onOpen={openTask}
              />
            )}
            {view.kind === 'customize' && (
              <CustomizeView
                onView={(next) => dispatch({ type: 'view', view: next })}
                onReport={() =>
                  dispatch({ type: 'report', report: { feature: 'report a problem' } })
                }
              />
            )}
            {view.kind === 'settings' && (
              <SettingsView
                account={account}
                engine={engine}
                status={state.status}
                onView={(next) => dispatch({ type: 'view', view: next })}
                onReport={() =>
                  dispatch({ type: 'report', report: { feature: 'report a problem' } })
                }
              />
            )}
            {view.kind === 'keys' && (
              <div className="list-view">
                <h1 className="view-title">Keys</h1>
                <p className="muted">
                  Your own API keys, kept in this laptop&apos;s keychain. Calls with them are billed
                  to you by the provider, not through credits.
                </p>
                <OwnKeys
                  saved={engine.ownKeys as Record<KeyProvider, boolean>}
                  models={state.own}
                  model={model}
                  onUse={chooseModel}
                  onChanged={() => void reloadModels().catch(fail)}
                />
                <OwnKeys
                  kind="search"
                  saved={engine.ownKeys as Record<KeyProvider, boolean>}
                  models={[]}
                  model={null}
                  onUse={() => undefined}
                  onChanged={() => void reloadModels().catch(fail)}
                />
              </div>
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
              <ConnectorsView
                client={api}
                changed={state.changed.connectors ?? 0}
                onProblem={fail}
              />
            )}
            {view.kind === 'addons' && (
              <AddonsView client={api} changed={state.changed.addons ?? 0} onProblem={fail} />
            )}
            {view.kind === 'agents' && (
              <AgentsView
                client={api}
                engine={engine}
                cloud={state.cloud}
                changed={agentsChanged + (state.changed.skills ?? 0)}
                onStart={startWith}
                onAutomate={(name) => {
                  setAutomateAgent(name)
                  dispatch({ type: 'view', view: { kind: 'automations' } })
                }}
                onProblem={fail}
              />
            )}
            {view.kind === 'marketing' && (
              <MarketingView
                client={api}
                changed={state.changed.marketing ?? 0}
                onProblem={fail}
                onAsk={(agent, words) => void startNew(words, agent)}
                savedKeys={(engine?.ownKeys ?? {}) as Record<KeyProvider, boolean>}
                onKeysChanged={() => void reloadModels().catch(fail)}
              />
            )}
            {view.kind === 'team' && (
              <TeamView
                agents={agents}
                apps={sidebarApps}
                folders={engine?.folders ?? []}
                onProblem={fail}
              />
            )}
            {view.kind === 'remote' && (
              <RemoteView folders={engine?.folders ?? []} onProblem={fail} />
            )}
            {view.kind === 'automations' && (
              <AutomationsView
                key={automateAgent ?? 'all'}
                client={api}
                agent={automateAgent}
                changed={state.changed.automations ?? 0}
                onProblem={fail}
                onOpenTask={openTask}
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
                onCancel={(id) =>
                  client.current?.send('POST', `/v1/models/${id}/cancel`).catch(fail)
                }
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
                agentColor={colorOf(detail.task.agent)}
                onAnswer={answer}
                onReadAloud={readAloud}
                onOpenFile={(path) => dispatch({ type: 'tab', tab: `file:${path}` })}
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
                  placeholder={
                    task
                      ? `Reply to ${task.agent}`
                      : `Ask ${agentName} anything. It reads only the folders you allow.`
                  }
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
                  <div className="menu-wrap">
                    <button
                      className="chip chip-icon"
                      aria-label="Add files or switch on deep research"
                      title="Add files"
                      aria-expanded={plus}
                      onClick={() => setPlus(!plus)}
                    >
                      <Icon name="plus" />
                    </button>
                    {plus && (
                      <div className="menu menu-up" role="menu">
                        <button
                          role="menuitem"
                          onClick={() => {
                            setPlus(false)
                            void window.titan117.addFolder()
                          }}
                        >
                          <Icon name="folder" /> Allow a folder…
                        </button>
                        {!task && (
                          <button
                            role="menuitemcheckbox"
                            aria-checked={research}
                            title="Many searches, reading and cross-checking, then a report with sources"
                            onClick={() => {
                              setPlus(false)
                              setResearch(!research)
                            }}
                          >
                            <Icon name="globe" /> Deep research {research ? '· on' : ''}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {!task && (
                    <label className="chip">
                      <span className="agent-dot" style={{ background: colorOf(agentName) }} />
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
                  {task && (
                    <span className="chip chip-static">
                      <span className="agent-dot" style={{ background: colorOf(task.agent) }} />
                      {task.agent}
                    </span>
                  )}
                  <label className="chip">
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
                  {research && !task && (
                    <button
                      className="chip chip-on"
                      aria-pressed
                      title="Deep research is on for the next task. Click to switch it off."
                      onClick={() => setResearch(false)}
                    >
                      <Icon name="globe" /> Deep research
                    </button>
                  )}
                  <span className="spacer" />
                  <span className="cost mono">{model && estimate ? estimate.label : ''}</span>
                  <span
                    className="chip chip-static chip-ask"
                    title="Agents ask before they change files, run commands, send or pay. “Always in this task” on a card lets one kind of step through for that task."
                  >
                    <Icon name="lock" /> <span className="chip-words">Asks before changes</span>
                  </span>
                  {voice === 'off' && (
                    <button
                      className="chip chip-icon"
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
                      title="Stop"
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
                      title="Send (Enter)"
                      disabled={!canSend}
                      onClick={() => void send()}
                    >
                      <Icon name="up" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {hasRight ? (
          <RightPanel
            client={api}
            engine={engine}
            cloud={state.cloud}
            detail={detail}
            parts={parts}
            artifactId={state.artifact}
            artifactsChanged={state.changed.artifacts ?? 0}
            tab={state.rightTab}
            artifactPanel={
              state.artifact && api ? (
                <ArtifactPanel
                  key={state.artifact}
                  client={api}
                  id={state.artifact}
                  changed={state.changed.artifacts ?? 0}
                  full={state.artifactFull}
                  onFull={() => dispatch({ type: 'artifactFull' })}
                  onClose={() => dispatch({ type: 'artifact', id: null })}
                  onProblem={fail}
                  onAsk={(words) => {
                    if (!model) return dispatch({ type: 'view', view: { kind: 'models' } })
                    client.current
                      ?.send<{ task: Task }>('POST', '/v1/tasks', { text: words, model })
                      .then(({ task: created }) => {
                        dispatch({
                          type: 'detail',
                          detail: { task: created, messages: [], approvals: [], activity: [] }
                        })
                        openTask(created.id)
                      })
                      .catch(fail)
                  }}
                />
              ) : null
            }
            onTab={(tab) => dispatch({ type: 'tab', tab })}
            onArtifact={(id) => dispatch({ type: 'artifact', id })}
            onClose={() => dispatch({ type: 'toggleDetails' })}
            onOpenTask={openTask}
            onReport={(errorRef) => dispatch({ type: 'report', report: { errorRef } })}
          />
        ) : (
          <section className="right" aria-hidden="true" />
        )}
      </div>

      {palette && (
        <Palette
          tasks={state.tasks}
          agents={agents}
          folders={engine.folders}
          onView={(next) => dispatch({ type: 'view', view: next })}
          onAgent={startWith}
          onClose={() => setPalette(false)}
        />
      )}

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
    </div>
  )
}

export default App
