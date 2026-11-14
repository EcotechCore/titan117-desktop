// The window (design.md 0.2): title bar, sidebar, workspace and task details.
// Everything it shows comes from the engine's local API.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import type {
  ApprovalAnswer,
  CloudModel,
  EngineState,
  Estimate,
  LocalModel,
  Task,
  TaskDetail
} from '../../shared/protocol'
import { connect, type EngineClient } from './engine'
import { initialState, reducer } from './state'
import { TaskView } from './TaskView'
import { clock, folderName, modelName, usd } from './format'
import { Eyes, Icon, type EyesState } from './ui'
import { ApprovalsView, ModelsView } from './Views'

const PROMPTS = [
  'List what is in my folder and tell me what it is for.',
  'Read the newest text file in my folder and summarise it.',
  'Write a file called notes.txt with three ideas for this week.',
  'What can you do on this laptop today?'
]

function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  const client = useRef<EngineClient | null>(null)
  const [text, setText] = useState('')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [attempt, setAttempt] = useState(0)
  const input = useRef<HTMLTextAreaElement>(null)

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
        dispatch({ type: 'loaded', engine: await api.get<EngineState>('/v1/state') })
        void api
          .get<{ cloud: CloudModel[] }>('/v1/models')
          .then((m) => dispatch({ type: 'cloud', models: m.cloud }))
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
  }, [])

  // Open a task: load its messages, approvals and activity once.
  useEffect(() => {
    if (!taskId || state.status !== 'ready') return
    client.current
      ?.get<TaskDetail>(`/v1/tasks/${taskId}`)
      .then((d) => dispatch({ type: 'detail', detail: d }))
      .catch(fail)
  }, [taskId, state.status, fail])

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
          model
        })
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

  const waiting = state.approvals.length
  const working = state.tasks.some((t) => t.status === 'running')
  const titan: EyesState = waiting ? 'needs-you' : working ? 'working' : 'idle'
  const ready: LocalModel[] = engine.localModels.filter((m) => m.state === 'ready')
  const canSend = !!text.trim() && !busy

  return (
    <div className={state.showDetails && detail ? 'win' : 'win no-details'}>
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
          className={view.kind === 'models' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'models' } })}
        >
          <Icon name="chip" /> Models
        </button>

        <p className="label">Agents</p>
        <button
          className={view.kind === 'start' ? 'nav on' : 'nav'}
          onClick={() => dispatch({ type: 'view', view: { kind: 'start' } })}
        >
          <Eyes state={titan} /> Titan
          {titan === 'needs-you' && <span className="pill">Needs you</span>}
          {titan === 'working' && <span className="shimmer">Working</span>}
        </button>

        <p className="label">Tasks</p>
        <div className="scroll">
          {state.tasks.length === 0 && <p className="hint">No tasks yet.</p>}
          {state.tasks.map((t) => (
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

        <p className="foot mono">
          <span className={state.status === 'ready' ? 'dot dot-done' : 'dot dot-error'} />
          {state.status === 'ready' ? 'Engine running' : 'Engine restarting'} · v{engine.appVersion}
        </p>
      </nav>

      <main className="work">
        <div className="work-scroll">
          {view.kind === 'approvals' && (
            <ApprovalsView
              approvals={state.approvals}
              tasks={state.tasks}
              onAnswer={answer}
              onOpen={(id) => dispatch({ type: 'view', view: { kind: 'task', id } })}
            />
          )}
          {view.kind === 'models' && (
            <ModelsView
              engine={engine}
              cloud={state.cloud}
              model={model}
              onUse={chooseModel}
              onDownload={(id) =>
                client.current?.send('POST', `/v1/models/${id}/download`).catch(fail)
              }
              onCancel={(id) => client.current?.send('POST', `/v1/models/${id}/cancel`).catch(fail)}
              onRemove={(id) => client.current?.send('DELETE', `/v1/models/${id}`).catch(fail)}
            />
          )}
          {view.kind === 'start' && (
            <div className="start">
              <Eyes state="working" size="large" />
              <h1>What should Titan do?</h1>
              <p className="muted">
                Titan works on this laptop. It reads only the folders you allow, and asks before it
                changes anything.
              </p>
              <div className="prompts">
                {PROMPTS.map((prompt) => (
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
            />
          )}
        </div>

        {(view.kind === 'start' || view.kind === 'task') && (
          <div className="composer">
            {state.problem && (
              <p className="note note-error" role="alert">
                {state.problem}
              </p>
            )}
            <div className="box">
              <textarea
                ref={input}
                rows={2}
                placeholder={task ? 'Reply to Titan' : 'Describe a task'}
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
                <span className="cost mono">{model && estimate ? estimate.label : ''}</span>
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

      {state.showDetails && detail && (
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
