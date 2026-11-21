/**
 * The code builder (5.7, §13; decisions §53, §54): pick a project in an
 * allowed folder, see its branch and what has changed, and give the coding
 * engine a job, to plan first or to build. The job runs as a task, where
 * every command, change, commit, push and pull request waits for your OK
 * with its diff shown.
 */
import { useCallback, useEffect, useState } from 'react'

import type { EngineState } from '../../shared/protocol'
import { codeRequest, diffCounts, reviewRequest } from './code-lib'
import { Diff } from './Diff'
import { ServersSection } from './Servers'
import { GitHubSection } from './GitHub'
import type { EngineClient } from './engine'
import { folderName } from './format'
import { Icon } from './ui'

interface GitState {
  root: string
  branch: string | null
  defaultBranch: string | null
  remote: { name: string; url: string; github: { owner: string; repo: string } | null } | null
  ahead: number
  behind: number
  changes: { path: string; status: string }[]
}

interface ToolsState {
  tools: {
    id: string
    name: string
    installed: boolean
    signedIn: boolean | null
    experimental: boolean
    enabled: boolean
    killed: boolean
    signIn: string
  }[]
  notOffered: { name: string; why: string }[]
}

interface CodeState {
  components: { id: string; name: string; version: string; ready: boolean; bytes: number }[]
  project: { git: GitState | null; diff: string; problem: string | null } | null
  coAuthor: boolean
}

const STATUS: Record<string, string> = {
  M: 'changed',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  '?': 'new'
}

function statusWord(code: string): string {
  const letter = code.trim()[0] ?? 'M'
  return STATUS[letter] ?? 'changed'
}

export function CodeView({
  client,
  engine,
  changed,
  onStart,
  onProblem
}: {
  client: EngineClient | null
  engine: EngineState
  changed: number
  onStart(text: string): void
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [chosen, setFolder] = useState<string>('')
  // The chosen project while it's still allowed; otherwise the first allowed folder.
  const folder = engine.folders.includes(chosen) ? chosen : (engine.folders[0] ?? '')
  const [state, setState] = useState<CodeState | null>(null)
  const [request, setRequest] = useState('')
  const [mode, setMode] = useState<'plan' | 'build'>('plan')
  const [showDiff, setShowDiff] = useState(false)
  const [editors, setEditors] = useState<{ id: string; name: string }[]>([])
  // The user's own coding tools (13.14): what's on this laptop, signed in and turned on.
  const [toolState, setToolState] = useState<ToolsState | null>(null)
  const tools = (toolState?.tools ?? []).filter(
    (t) => t.installed && t.signedIn !== false && t.enabled
  )
  const [engineId, setEngineId] = useState('titan117')
  useEffect(() => {
    let live = true
    client
      ?.get<ToolsState>('/v1/code/tools')
      .then((r) => live && setToolState(r))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client])

  function setToolOn(id: string, on: boolean): void {
    client
      ?.send<ToolsState>('PUT', '/v1/code', { tool: id, enabled: on })
      .then(setToolState)
      .catch(onProblem)
  }

  useEffect(() => {
    let live = true
    window.titan117.code
      .editors()
      .then((list) => live && setEditors(list))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const load = useCallback(() => {
    if (!client) return () => undefined
    let live = true
    const query = folder ? `?folder=${encodeURIComponent(folder)}` : ''
    client
      .get<CodeState>(`/v1/code${query}`)
      .then((r) => live && setState(r))
      .catch(onProblem)
    return () => {
      live = false
    }
  }, [client, folder, onProblem])

  useEffect(load, [load, changed])

  const git = state?.project?.git ?? null
  const missing = (state?.components ?? []).filter((c) => !c.ready)
  const counts = state?.project?.diff ? diffCounts(state.project.diff) : null

  return (
    <div className="list-view">
      <h1 className="view-title">Code</h1>
      <p className="muted">
        Give the coding engine a job in one of your projects. It plans or builds; every command,
        change, commit, push and pull request waits for your OK, with the change shown.
      </p>

      {engine.folders.length === 0 ? (
        <p className="empty">
          Allow a project folder first.{' '}
          <button className="link" onClick={() => void window.titan117.addFolder()}>
            Choose a folder
          </button>
        </p>
      ) : (
        <>
          <label className="field">
            Project
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              aria-label="Project folder"
            >
              {engine.folders.map((f) => (
                <option key={f} value={f}>
                  {folderName(f)} · {f}
                </option>
              ))}
            </select>
          </label>

          {state?.project?.problem && <p className="note">{state.project.problem}</p>}
          {git && (
            <div className="row row-tint code-repo">
              <span className="row-icon">
                <Icon name="code" />
              </span>
              <div className="row-main">
                <p className="row-title">
                  {git.branch ? `On ${git.branch}` : 'Not on a branch'}
                  {git.defaultBranch && git.branch !== git.defaultBranch
                    ? ` · main branch ${git.defaultBranch}`
                    : ''}
                  {git.ahead ? ` · ${git.ahead} to push` : ''}
                </p>
                <p className="muted">
                  {git.remote?.github
                    ? `GitHub: ${git.remote.github.owner}/${git.remote.github.repo}`
                    : git.remote
                      ? `Remote: ${git.remote.url}`
                      : 'No remote'}
                  {' · '}
                  {git.changes.length
                    ? `${git.changes.length} changed file${git.changes.length === 1 ? '' : 's'}`
                    : 'nothing changed since the last commit'}
                  {counts && (
                    <>
                      {' · '}
                      <span className="diff-add-n">+{counts.added}</span>{' '}
                      <span className="diff-del-n">−{counts.removed}</span>
                    </>
                  )}
                </p>
              </div>
              {git.changes.length > 0 && (
                <button className="btn" onClick={() => setShowDiff((v) => !v)}>
                  {showDiff ? 'Hide changes' : 'Show changes'}
                </button>
              )}
            </div>
          )}
          {folder && (
            <div className="code-open">
              {editors.map((e) => (
                <button
                  key={e.id}
                  className="btn"
                  onClick={() => void window.titan117.code.open(folder, e.id).catch(onProblem)}
                >
                  Open in {e.name}
                </button>
              ))}
              <button
                className="btn"
                onClick={() => void window.titan117.code.open(folder, 'folder').catch(onProblem)}
              >
                Show the folder
              </button>
              {git &&
                (git.changes.length > 0 || (git.branch && git.branch !== git.defaultBranch)) && (
                  <button
                    className="btn"
                    onClick={() =>
                      onStart(
                        reviewRequest(git.root, git.changes.length > 0 ? 'changes' : 'branch')
                      )
                    }
                  >
                    {git.changes.length > 0 ? 'Review the changes' : 'Review the branch'}
                  </button>
                )}
            </div>
          )}
          {git && showDiff && (
            <>
              <ul className="code-files">
                {git.changes.map((c) => (
                  <li key={c.path}>
                    <span className="faint">{statusWord(c.status)}</span> {c.path}
                  </li>
                ))}
              </ul>
              {state?.project?.diff ? (
                <Diff text={state.project.diff} />
              ) : (
                <p className="faint">
                  New files only: their content shows once they’re added to git.
                </p>
              )}
            </>
          )}

          <label className="field">
            {tools.length > 0 && (
              <select
                value={engineId}
                onChange={(e) => setEngineId(e.target.value)}
                aria-label="Which coding engine"
              >
                <option value="titan117">Titan117’s coding engine</option>
                {tools.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (your own plan)
                  </option>
                ))}
              </select>
            )}
            The job
            <textarea
              rows={5}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="For example: the cart total ignores quantities; fix it and add a test."
            />
          </label>
          <div className="code-actions">
            <div className="segmented" role="radiogroup" aria-label="Mode">
              <button
                role="radio"
                aria-checked={mode === 'plan'}
                className={mode === 'plan' ? 'seg on' : 'seg'}
                onClick={() => setMode('plan')}
              >
                Plan first
              </button>
              <button
                role="radio"
                aria-checked={mode === 'build'}
                className={mode === 'build' ? 'seg on' : 'seg'}
                onClick={() => setMode('build')}
              >
                Build
              </button>
            </div>
            <button
              className="btn btn-primary"
              disabled={!folder || !request.trim()}
              onClick={() => {
                onStart(
                  codeRequest(
                    git?.root ?? folder,
                    request,
                    mode,
                    tools.find((t) => t.id === engineId) ?? null
                  )
                )
                setRequest('')
              }}
            >
              {mode === 'plan' ? 'Plan it' : 'Start'}
            </button>
          </div>
          {state && (
            <label className="choice muted">
              <input
                type="checkbox"
                checked={state.coAuthor}
                onChange={(e) => {
                  const on = e.target.checked
                  client
                    ?.send<{ coAuthor: boolean }>('PUT', '/v1/code', { coAuthor: on })
                    .then((r) => setState((s) => (s ? { ...s, coAuthor: r.coAuthor } : s)))
                    .catch(onProblem)
                }}
              />{' '}
              Add “Co-authored-by: Titan117” to commits Titan makes, so the AI’s part shows in the
              history
            </label>
          )}
          {missing.length > 0 && (
            <p className="faint">
              The first job downloads the coding engine (
              {missing.map((c) => `${c.name} ${c.version}`).join(', ')}, about{' '}
              {Math.round(missing.reduce((n, c) => n + c.bytes, 0) / 1e6)} MB) once; after that it
              works offline with local models.
            </p>
          )}

          {toolState && (
            <>
              <h2 className="section">Your own coding tools</h2>
              <p className="muted">
                A coding tool you already use can do the job instead, on your own plan: Titan117
                starts the tool’s own program, and you sign in to it yourself in the tool’s own way.
                Its changes still wait for your OK here.
              </p>
              {toolState.tools.map((t) => (
                <div key={t.id} className="row">
                  <div className="row-main">
                    <p className="row-title">
                      {t.name}
                      {t.experimental && <span className="tag">experimental</span>}
                    </p>
                    <p className="muted">
                      {t.killed
                        ? 'Switched off by Titan117 for now: its maker’s terms changed or are being checked. Titan117’s own engine does the job instead.'
                        : !t.installed
                          ? 'Not installed on this laptop.'
                          : t.signedIn === false
                            ? `Installed, not signed in. In a terminal: ${t.signIn}`
                            : t.signedIn === null
                              ? 'Installed. Its sign-in is checked when a job starts.'
                              : 'Installed and signed in.'}
                      {t.experimental &&
                        ' Its maker’s terms don’t yet say whether another app may run it, so it asks once before each job and works in its own restricted mode.'}
                    </p>
                  </div>
                  {t.experimental && (
                    <label className="choice">
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={(e) => setToolOn(t.id, e.target.checked)}
                      />{' '}
                      On
                    </label>
                  )}
                </div>
              ))}
              {toolState.notOffered.map((n) => (
                <p key={n.name} className="faint">
                  Not offered: {n.name}. {n.why}
                </p>
              ))}
            </>
          )}
          <GitHubSection onProblem={onProblem} />
          <ServersSection client={client} onProblem={onProblem} />
        </>
      )}
    </div>
  )
}
