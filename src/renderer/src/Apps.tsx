/**
 * The app builder for the web (§6, phase 8; decisions §56): make a web app
 * from the template, ask Titan to build it (a plan you approve, then code,
 * checks, fixes and a new version), see it live on this laptop at phone,
 * tablet and desktop sizes, read its test report with a screenshot per
 * browser and size, and go back to any earlier version.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { CLOUD_MODEL_PREFIX, type CloudModel, type EngineState } from '../../shared/protocol'
import {
  appBuildRequest,
  appCreateRequest,
  isLocalPreview,
  PREVIEW_SIZES,
  type PreviewSize
} from './apps-lib'
import type { EngineClient } from './engine'
import { folderName } from './format'
import { Icon } from './ui'

interface AppInfo {
  folder: string
  name: string
  title: string
  kind: 'web'
  createdAt: number
  preview: string | null
  checking: string | null
  github: { owner: string; repo: string; url: string; sync: boolean; error: string | null } | null
}

type GitHubSave =
  | { status: 'saved'; repo: { owner: string; repo: string; url: string }; created: boolean }
  | { status: 'make-it'; url: string; name: string }
  | { status: 'stopped' }

interface Models {
  planner: string | null
  coder: string | null
  fixer: string | null
}

interface Brand {
  primary: string
  accent: string
  font: 'system' | 'serif' | 'rounded' | 'mono'
  tone: string
  logo: string
}

const FONT_NAMES: Record<Brand['font'], string> = {
  system: 'Clean (the system font)',
  serif: 'Classic (serif)',
  rounded: 'Friendly (rounded)',
  mono: 'Technical (monospace)'
}

interface AppsState {
  apps: AppInfo[]
  models: Models
  brand: Brand
  starters: { id: string; label: string; description: string }[]
  components: {
    node: { version: string; ready: boolean; bytes: number }
    browsers: { firefox: boolean; webkit: boolean }
  }
}

interface CheckResult {
  name: string
  ran: boolean
  ok: boolean
  output: string
  ms: number
}

interface Shot {
  engine: string
  size: string
  screenshot: string | null
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
  overflow: boolean
}

interface Report {
  id: string
  at: number
  passed: boolean
  checks: CheckResult[]
  browsers: {
    engines: { engine: string; ran: boolean; note?: string }[]
    shots: Shot[]
    seo: { ok: boolean; check: string; detail: string }[]
  } | null
  summary: string
}

interface Version {
  sha: string
  subject: string
  at: number
}

const ENGINE_NAME: Record<string, string> = {
  chromium: 'Chromium (Edge or Chrome)',
  firefox: 'Firefox',
  webkit: 'WebKit (like Safari)'
}

function Screenshot({
  client,
  folder,
  report,
  shot
}: {
  client: EngineClient
  folder: string
  report: string
  shot: Shot
}): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!shot.screenshot) return
    let live = true
    const q = new URLSearchParams({ folder, report, file: shot.screenshot })
    client
      .get<{ png: string }>(`/v1/apps/screenshot?${q}`)
      .then((r) => live && setSrc(`data:image/png;base64,${r.png}`))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, folder, report, shot.screenshot])
  const problems =
    shot.pageErrors.length +
    shot.consoleErrors.length +
    shot.failedRequests.length +
    (shot.overflow ? 1 : 0)
  return (
    <figure className="app-shot">
      {src ? (
        <img src={src} alt={`${shot.engine}, ${shot.size}`} />
      ) : (
        <div className="app-shot-empty" />
      )}
      <figcaption>
        {shot.size.replace('-', ', ')}{' '}
        {problems ? (
          <span className="app-bad">
            {problems} problem{problems === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="app-good">fine</span>
        )}
      </figcaption>
    </figure>
  )
}

export function AppsView({
  client,
  engine,
  cloud,
  changed,
  onStart,
  onProblem
}: {
  client: EngineClient | null
  engine: EngineState
  cloud: CloudModel[]
  changed: number
  onStart(text: string): void
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [state, setState] = useState<AppsState | null>(null)
  const [chosen, setChosen] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [request, setRequest] = useState('')
  const [size, setSize] = useState<PreviewSize>('desktop')
  const [creating, setCreating] = useState(false)
  const [newFolder, setNewFolder] = useState('')
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newRequest, setNewRequest] = useState('')
  const [newKind, setNewKind] = useState('blank')
  const [busy, setBusy] = useState(false)
  const [privateRepo, setPrivateRepo] = useState(true)
  // What went wrong with the last click, shown here (the chat's error line isn't on this screen).
  const [problem, setProblem] = useState<string | null>(null)
  const [githubProblem, setGitHubProblem] = useState<string | null>(null)
  const fail = (error: unknown): void =>
    setProblem(error instanceof Error ? error.message : 'Something went wrong.')
  const [makeIt, setMakeIt] = useState<{ folder: string; url: string; name: string } | null>(null)
  // The preview is shown at the real screen width, scaled down to fit the window.
  const frameWrap = useRef<HTMLDivElement | null>(null)
  const [room, setRoom] = useState(800)
  useEffect(() => {
    const wrap = frameWrap.current
    if (!wrap) return
    const observer = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width))
    observer.observe(wrap)
    return () => observer.disconnect()
  })

  const load = useCallback(() => {
    if (!client) return () => undefined
    let live = true
    client
      .get<AppsState>('/v1/apps')
      .then((r) => live && setState(r))
      .catch(onProblem)
    return () => {
      live = false
    }
  }, [client, onProblem])
  useEffect(load, [load, changed])

  const apps = state?.apps ?? []
  const app = apps.find((a) => a.folder === chosen) ?? apps[0] ?? null

  useEffect(() => {
    if (!client || !app) return
    let live = true
    const q = `?folder=${encodeURIComponent(app.folder)}`
    client
      .get<{ report: Report | null }>(`/v1/apps/report${q}`)
      .then((r) => live && setReport(r.report))
      .catch(() => undefined)
    client
      .get<{ versions: Version[] }>(`/v1/apps/versions${q}`)
      .then((r) => live && setVersions(r.versions))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, app?.folder, changed]) // eslint-disable-line react-hooks/exhaustive-deps

  function act(path: string, body: Record<string, unknown>): void {
    if (!client) return
    setBusy(true)
    setProblem(null)
    client
      .send('POST', path, body)
      .then(load)
      .catch(fail)
      .finally(() => setBusy(false))
  }

  /** Save to the user's own GitHub (6.18), or stop pushing new versions. */
  function github(folder: string, action: 'save' | 'stop'): void {
    if (!client) return
    setBusy(true)
    setGitHubProblem(null)
    setMakeIt(null)
    client
      .send<GitHubSave>('POST', '/v1/apps/github', { folder, action, private: privateRepo })
      .then((r) => {
        if (r.status === 'make-it') setMakeIt({ folder, url: r.url, name: r.name })
        load()
      })
      .catch((error: unknown) =>
        setGitHubProblem(error instanceof Error ? error.message : 'Something went wrong.')
      )
      .finally(() => setBusy(false))
  }

  function setBrand(change: Partial<Brand>): void {
    if (!client || !state) return
    client
      .send<AppsState>('PUT', '/v1/apps/brand', { ...state.brand, ...change })
      .then(setState)
      .catch(fail)
  }

  function setRole(role: keyof Models, value: string): void {
    if (!client || !state) return
    const next = { ...state.models, [role]: value || null }
    client.send<AppsState>('PUT', '/v1/apps', next).then(setState).catch(onProblem)
  }

  const missing: string[] = []
  if (state && !state.components.node.ready)
    missing.push(
      `Node.js ${state.components.node.version} (about ${Math.round(state.components.node.bytes / 1e6)} MB)`
    )
  if (state && !(state.components.browsers.firefox && state.components.browsers.webkit))
    missing.push('Firefox and WebKit for testing (about 250 MB)')

  const previewSize = PREVIEW_SIZES.find((s) => s.id === size) ?? PREVIEW_SIZES[2]
  const shotsByEngine = new Map<string, Shot[]>()
  for (const shot of report?.browsers?.shots ?? [])
    shotsByEngine.set(shot.engine, [...(shotsByEngine.get(shot.engine) ?? []), shot])

  return (
    <div className="list-view apps-view">
      <h1 className="view-title">Apps</h1>
      <p className="muted">
        Websites and web apps, built on this laptop. Titan plans each build for your OK, writes the
        code, tests it in three browsers at phone, tablet and desktop sizes, fixes what fails and
        saves a version you can go back to.
      </p>

      {engine.folders.length === 0 ? (
        <p className="empty">
          Allow a folder to keep your apps in first.{' '}
          <button className="link" onClick={() => void window.titan117.addFolder()}>
            Choose a folder
          </button>
        </p>
      ) : (
        <>
          <div className="code-actions">
            {apps.length > 0 && (
              <label className="field apps-pick">
                App
                <select
                  value={app?.folder ?? ''}
                  onChange={(e) => setChosen(e.target.value)}
                  aria-label="App"
                >
                  {apps.map((a) => (
                    <option key={a.folder} value={a.folder}>
                      {a.title} · {a.folder}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="btn" onClick={() => setCreating((v) => !v)}>
              <Icon name="plus" /> New app
            </button>
          </div>

          {(creating || apps.length === 0) && (
            <div className="apps-new">
              <h2 className="section">A new web app</h2>
              <label className="field">
                Folder to keep it in
                <select
                  value={newFolder || engine.folders[0]}
                  onChange={(e) => setNewFolder(e.target.value)}
                  aria-label="Folder for the new app"
                >
                  {engine.folders.map((f) => (
                    <option key={f} value={f}>
                      {folderName(f)} · {f}
                    </option>
                  ))}
                </select>
              </label>
              {state && (
                <label className="field">
                  Kind of site
                  <select
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value)}
                    aria-label="Kind of site"
                  >
                    {state.starters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}: {s.description}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                Name
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="For example: Cluj Bakery"
                />
              </label>
              <label className="field">
                One or two sentences about it (shown in search results)
                <input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Fresh bread every morning in Cluj, baked with local flour."
                />
              </label>
              <label className="field">
                What should Titan build first? (optional)
                <textarea
                  rows={3}
                  value={newRequest}
                  onChange={(e) => setNewRequest(e.target.value)}
                  placeholder="A home page with our opening hours, a menu with prices and a contact form."
                />
              </label>
              <div className="code-actions">
                <button
                  className="btn btn-primary"
                  disabled={!newName.trim() || !newDescription.trim()}
                  onClick={() => {
                    onStart(
                      appCreateRequest(
                        newFolder || engine.folders[0],
                        newName,
                        newDescription,
                        newRequest,
                        newKind
                      )
                    )
                    setCreating(false)
                    setNewName('')
                    setNewDescription('')
                    setNewRequest('')
                  }}
                >
                  Make it
                </button>
              </div>
            </div>
          )}

          {problem && (
            <p className="note note-error" role="alert">
              {problem}
            </p>
          )}
          {app && (
            <>
              <div className="row row-tint">
                <span className="row-icon">
                  <Icon name="globe" />
                </span>
                <div className="row-main">
                  <p className="row-title">{app.title}</p>
                  <p className="muted">
                    {app.folder}
                    {versions.length
                      ? ` · ${versions.length} version${versions.length === 1 ? '' : 's'}`
                      : ''}
                    {app.checking ? ` · Testing: ${app.checking}` : ''}
                  </p>
                </div>
                {app.preview ? (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => act('/v1/apps/preview', { folder: app.folder, action: 'stop' })}
                  >
                    Stop the preview
                  </button>
                ) : (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => act('/v1/apps/preview', { folder: app.folder, action: 'start' })}
                  >
                    {busy ? 'Starting…' : 'Preview'}
                  </button>
                )}
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    if (!client) return
                    client
                      .get<{ name: string; base64: string }>(
                        `/v1/apps/zip?folder=${encodeURIComponent(app.folder)}`
                      )
                      .then((f) => window.titan117.artifacts.save(f.name, f.base64))
                      .catch(fail)
                  }}
                >
                  Download ZIP
                </button>
                <button
                  className="btn"
                  disabled={!!app.checking}
                  onClick={() => act('/v1/apps/check', { folder: app.folder })}
                >
                  {app.checking ? 'Testing…' : 'Test it'}
                </button>
              </div>

              <label className="field">
                What should Titan build or change?
                <textarea
                  rows={3}
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  placeholder="For example: add a gallery page with six photos and a link to it in the menu."
                />
              </label>
              <div className="code-actions">
                <button
                  className="btn btn-primary"
                  disabled={!request.trim()}
                  onClick={() => {
                    onStart(appBuildRequest(app.folder, request))
                    setRequest('')
                  }}
                >
                  Build it
                </button>
              </div>

              {app.preview && isLocalPreview(app.preview) && (
                <>
                  <h2 className="section">Preview</h2>
                  <div className="segmented" role="radiogroup" aria-label="Screen size">
                    {PREVIEW_SIZES.map((s) => (
                      <button
                        key={s.id}
                        role="radio"
                        aria-checked={size === s.id}
                        className={size === s.id ? 'seg on' : 'seg'}
                        onClick={() => setSize(s.id)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="app-frame-wrap" ref={frameWrap}>
                    <iframe
                      key={app.preview}
                      className="app-frame"
                      title={`Preview of ${app.title}`}
                      src={app.preview}
                      sandbox="allow-scripts allow-forms allow-same-origin"
                      style={{
                        width: previewSize.width,
                        height: Math.min(previewSize.height, 1100),
                        zoom: Math.min(1, room / previewSize.width)
                      }}
                    />
                  </div>
                  <p className="faint">
                    Running on this laptop only, at {app.preview}. Changes show as soon as they’re
                    saved.
                  </p>
                </>
              )}

              <h2 className="section">Test report</h2>
              {!report ? (
                <p className="faint">
                  Not tested yet. Press Test it, or ask Titan to build something.
                </p>
              ) : (
                <>
                  <p className={report.passed ? 'app-good' : 'app-bad'}>
                    {report.passed ? 'All checks passed' : 'Some checks failed'} ·{' '}
                    {new Date(report.at).toLocaleString()}
                  </p>
                  <ul className="app-checks">
                    {report.checks
                      .filter((c) => c.ran || c.name !== 'install')
                      .map((c) => (
                        <li key={c.name}>
                          <span className={c.ok ? 'app-good' : 'app-bad'}>{c.ok ? '✓' : '✗'}</span>{' '}
                          {c.name === 'install'
                            ? 'Packages'
                            : c.name[0].toUpperCase() + c.name.slice(1)}
                          {!c.ran && <span className="faint"> (none)</span>}
                        </li>
                      ))}
                    {report.browsers?.seo.map((f) => (
                      <li key={f.check}>
                        <span className={f.ok ? 'app-good' : 'app-bad'}>{f.ok ? '✓' : '✗'}</span>{' '}
                        {f.check} <span className="faint">{f.detail}</span>
                      </li>
                    ))}
                  </ul>
                  {!report.passed && <pre className="app-summary">{report.summary}</pre>}
                  {client &&
                    report.browsers?.engines.map((e) => (
                      <div key={e.engine}>
                        <h3 className="app-engine">{ENGINE_NAME[e.engine] ?? e.engine}</h3>
                        {e.ran ? (
                          <div className="app-shots">
                            {(shotsByEngine.get(e.engine) ?? []).map((s) => (
                              <Screenshot
                                key={s.size}
                                client={client}
                                folder={app.folder}
                                report={report.id}
                                shot={s}
                              />
                            ))}
                          </div>
                        ) : (
                          <p className="faint">Not tested: {e.note}</p>
                        )}
                      </div>
                    ))}
                </>
              )}

              <h2 className="section">GitHub</h2>
              {app.github ? (
                <div className="row">
                  <div className="row-main">
                    <p className="row-title">
                      Saved to{' '}
                      <a href={app.github.url} target="_blank" rel="noreferrer">
                        {app.github.owner}/{app.github.repo}
                      </a>
                    </p>
                    <p className="muted">
                      {app.github.sync
                        ? 'Each new version is pushed there, as you.'
                        : 'New versions aren’t pushed there any more.'}
                    </p>
                    {app.github.error && (
                      <p className="note">The last push didn’t work: {app.github.error}</p>
                    )}
                  </div>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => github(app.folder, 'save')}
                  >
                    {app.github.sync ? 'Push now' : 'Push and keep it up to date'}
                  </button>
                  {app.github.sync && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => github(app.folder, 'stop')}
                    >
                      Stop pushing
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <p className="muted">
                    Keep the code in your own GitHub account, with every version: no lock-in. After
                    this, each new version is pushed there too. Needs Sign in with GitHub (Code
                    screen).
                  </p>
                  <div className="code-actions">
                    <label className="choice">
                      <input
                        type="checkbox"
                        checked={privateRepo}
                        onChange={(e) => setPrivateRepo(e.target.checked)}
                      />{' '}
                      Private repository
                    </label>
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => github(app.folder, 'save')}
                    >
                      Save to GitHub
                    </button>
                  </div>
                  {githubProblem && (
                    <p className="note note-error" role="alert">
                      {githubProblem}
                    </p>
                  )}
                  {makeIt?.folder === app.folder && (
                    <p className="note">
                      Titan117 may not make repositories in your account yet. Make an empty one
                      named <span className="mono">{makeIt.name}</span> on{' '}
                      <a href={makeIt.url} target="_blank" rel="noreferrer">
                        GitHub’s page
                      </a>{' '}
                      (filled in for you; add nothing to it), then press Save to GitHub again.
                    </p>
                  )}
                </>
              )}

              <h2 className="section">Versions</h2>
              {versions.map((v, i) => (
                <div key={v.sha} className="row">
                  <div className="row-main">
                    <p className="row-title">{v.subject}</p>
                    <p className="muted">
                      {new Date(v.at).toLocaleString()} · {v.sha}
                      {i === 0 ? ' · current' : ''}
                    </p>
                  </div>
                  {i > 0 && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Put every file of ${app.title} back as it was in “${v.subject}”? It’s saved as a new version, so you can undo it.`
                          )
                        )
                          act('/v1/apps/restore', { folder: app.folder, version: v.sha })
                      }}
                    >
                      Go back to this
                    </button>
                  )}
                </div>
              ))}
            </>
          )}

          {state && (
            <>
              <h2 className="section">Your brand</h2>
              <p className="muted">
                Used for every new app: its colours, font, logo and tone of voice. Existing apps
                keep theirs; ask Titan to apply a change to one.
              </p>
              <div className="apps-brand">
                <label className="field">
                  Main colour
                  <input
                    type="color"
                    value={state.brand.primary}
                    onChange={(e) => setBrand({ primary: e.target.value })}
                  />
                </label>
                <label className="field">
                  Second colour
                  <input
                    type="color"
                    value={state.brand.accent}
                    onChange={(e) => setBrand({ accent: e.target.value })}
                  />
                </label>
                <label className="field">
                  Font
                  <select
                    value={state.brand.font}
                    onChange={(e) => setBrand({ font: e.target.value as Brand['font'] })}
                  >
                    {(Object.keys(FONT_NAMES) as Brand['font'][]).map((f) => (
                      <option key={f} value={f}>
                        {FONT_NAMES[f]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                Tone of voice
                <input
                  defaultValue={state.brand.tone}
                  placeholder="For example: warm and plain, no jargon"
                  onBlur={(e) => {
                    if (e.target.value !== state.brand.tone) setBrand({ tone: e.target.value })
                  }}
                />
              </label>
              <label className="field">
                Logo (a PNG, SVG, JPEG or WebP file in one of your allowed folders)
                <input
                  defaultValue={state.brand.logo}
                  placeholder="For example: C:\\Users\\you\\Documents\\logo.png"
                  onBlur={(e) => {
                    if (e.target.value !== state.brand.logo) setBrand({ logo: e.target.value })
                  }}
                />
              </label>

              <h2 className="section">Models for builds</h2>
              <p className="muted">
                A strong model plans, a cheaper one writes the code, and after repeated failures a
                stronger one fixes. Empty means the task’s own model.
              </p>
              <datalist id="app-models">
                {cloud.map((m) => (
                  <option key={m.id} value={CLOUD_MODEL_PREFIX + m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
              {(
                [
                  ['planner', 'Planner'],
                  ['coder', 'Coder'],
                  ['fixer', 'Fixer (after repeated failures)']
                ] as const
              ).map(([role, label]) => (
                <label key={role} className="field">
                  {label}
                  <input
                    list="app-models"
                    defaultValue={state.models[role] ?? ''}
                    placeholder="The task’s own model"
                    onBlur={(e) => {
                      if (e.target.value !== (state.models[role] ?? ''))
                        setRole(role, e.target.value)
                    }}
                  />
                </label>
              ))}
            </>
          )}

          {missing.length > 0 && (
            <p className="faint">
              The first build or test downloads {missing.join(' and ')} once, from their makers’ own
              sites; after that, building and testing work offline with local models.
            </p>
          )}
        </>
      )}
    </div>
  )
}
