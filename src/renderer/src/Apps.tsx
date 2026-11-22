/**
 * The app builder (§6; phase 8, decisions §56; phase 9, decisions §57): make
 * a website or a mobile app from a template, ask Titan to build it (a plan
 * you approve, then code, checks, fixes and a new version), see it live on
 * this laptop (and a mobile app on your phone, with Expo Go), read its test
 * report with a screenshot per browser and size, and go back to any earlier
 * version.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { renderSVG } from 'uqr'

import { CLOUD_MODEL_PREFIX, type CloudModel, type EngineState } from '../../shared/protocol'
import {
  appBuildRequest,
  appCreateRequest,
  isLocalPreview,
  PREVIEW_SIZES,
  type PreviewSize,
  visualEditRequest,
  hostGuide,
  type GitHost,
  type PickedElement
} from './apps-lib'
import type { EngineClient } from './engine'
import { folderName } from './format'
import { Icon } from './ui'
import { OwnKeys } from './Keys'
import type { KeyProvider } from '../../shared/protocol'

interface AppInfo {
  folder: string
  name: string
  title: string
  kind: 'web' | 'mobile' | 'desktop'
  createdAt: number
  preview: string | null
  /** A mobile app open to phones on this Wi-Fi: the address Expo Go opens. */
  phone: string | null
  checking: string | null
  problem: string | null
  published: { host: 'cloudflare'; url: string; at: number } | null
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
  quick?: string | null
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

interface DeviceCheck {
  id: string
  label: string
  ok: boolean | null
  detail: string
  fix?: string
  built: boolean
}

/** The `exp://` address as a QR code for Expo Go; only this laptop's own address is drawn. */
function PhoneCode({ address }: { address: string }): React.JSX.Element | null {
  if (!/^exp:\/\/(10|172|192)\.[\d.]+:\d{2,5}$/.test(address)) return null
  return (
    <div
      className="app-qr"
      role="img"
      aria-label={`QR code for ${address}`}
      // uqr draws only squares from the address checked above.
      dangerouslySetInnerHTML={{ __html: renderSVG(address, { border: 2 }) }}
    />
  )
}

/** What this laptop can do for mobile and desktop apps (6.28). */
function ThisLaptop({ client }: { client: EngineClient }): React.JSX.Element {
  const [checks, setChecks] = useState<DeviceCheck[] | null>(null)
  const [busy, setBusy] = useState(false)
  function check(fresh: boolean): void {
    setBusy(true)
    client
      .get<{ checks: DeviceCheck[] }>(`/v1/apps/devices${fresh ? '?fresh=1' : ''}`)
      .then((r) => setChecks(r.checks))
      .catch(() => setChecks(null))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <h2 className="section">This laptop</h2>
      <p className="muted">
        What it can do for mobile and desktop apps. Titan117 only looks; it changes nothing.
      </p>
      {checks && (
        <ul className="app-checks app-devices">
          {checks.map((c) => (
            <li key={c.id}>
              <span className={c.ok ? 'app-good' : c.ok === false ? 'app-bad' : 'faint'}>
                {c.ok ? '✓' : c.ok === false ? '✗' : '?'}
              </span>{' '}
              <strong>{c.label}</strong>
              {!c.built && <span className="faint"> (coming in phase 9)</span>}{' '}
              <span className="faint">{c.detail}</span>
              {c.fix && <p className="app-fix">{c.fix}</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="code-actions">
        <button className="btn" disabled={busy} onClick={() => check(!!checks)}>
          {busy ? 'Checking…' : checks ? 'Check again' : 'Check this laptop'}
        </button>
      </div>
    </>
  )
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
        {shot.size.replace('phone-small', 'small phone').replace('-', ', ')}{' '}
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
  onProblem,
  onKeysChanged
}: {
  onKeysChanged(): void
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
  const [newTarget, setNewTarget] = useState<'web' | 'mobile' | 'desktop'>('web')
  const [busy, setBusy] = useState(false)
  // Visual edit (6.9): pick an element in the preview, then say what to change.
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PickedElement | null>(null)
  const [change, setChange] = useState('')
  const [privateRepo, setPrivateRepo] = useState(true)
  const [gitHost, setGitHost] = useState<GitHost>('cloudflare')
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
  const previewOrigin =
    app?.preview && isLocalPreview(app.preview) ? new URL(app.preview).origin : null

  /** Tell the preview's picker (dev only, in the app's own page) to turn on or off. */
  const tellPicker = useCallback(
    (on: boolean) => {
      if (previewOrigin)
        frame.current?.contentWindow?.postMessage({ type: 'titan117:pick', on }, previewOrigin)
    },
    [previewOrigin]
  )
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      // Only from the preview frame itself, at its own address.
      if (e.origin !== previewOrigin || e.source !== frame.current?.contentWindow) return
      const data = e.data as { type?: string; element?: PickedElement }
      if (data?.type !== 'titan117:picked' || !data.element) return
      const el = data.element
      const text = (v: unknown, max: number): string =>
        typeof v === 'string' ? v.slice(0, max) : ''
      setPicked({
        tag: text(el.tag, 20),
        text: text(el.text, 200),
        classes: text(el.classes, 300),
        path: text(el.path, 400),
        html: text(el.html, 600),
        page: text(el.page, 200) || '/'
      })
      setPicking(false)
      tellPicker(false)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [previewOrigin, tellPicker])

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
        Websites, web apps, mobile apps and desktop apps, built on this laptop. Titan plans each
        build for your OK, writes the code, tests it in local browsers at phone, tablet and desktop
        sizes, fixes what fails and saves a version you can go back to. Mobile apps also open on
        your own phone with Expo Go.
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
              <h2 className="section">A new app</h2>
              <div className="segmented" role="radiogroup" aria-label="What to build">
                {(
                  [
                    ['web', 'Website or web app'],
                    ['mobile', 'Mobile app (iPhone and Android)'],
                    ['desktop', 'Desktop app (Windows and Mac)']
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={newTarget === id}
                    className={newTarget === id ? 'seg on' : 'seg'}
                    onClick={() => setNewTarget(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
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
              {state && newTarget === 'web' && (
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
                {newTarget !== 'web'
                  ? 'One or two sentences about it (what the app is for)'
                  : 'One or two sentences about it (shown in search results)'}
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
                  placeholder={
                    newTarget === 'desktop'
                      ? 'A window to keep our customer list: add, search and edit customers.'
                      : newTarget === 'mobile'
                        ? 'A screen with our menu and prices, and a button to call us.'
                        : 'A home page with our opening hours, a menu with prices and a contact form.'
                  }
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
                        newKind,
                        newTarget
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
                  <Icon
                    name={
                      app.kind === 'mobile' ? 'phone' : app.kind === 'desktop' ? 'panel' : 'globe'
                    }
                  />
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
                {app.kind === 'mobile' && !app.phone && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Open ${app.title} to phones on this Wi-Fi? While it runs, devices on the same network can load the app from this laptop. Stop the preview to close it.`
                        )
                      )
                        act('/v1/apps/phone', { folder: app.folder })
                    }}
                  >
                    Open on your phone
                  </button>
                )}
                <button
                  className="btn"
                  disabled={!!app.checking}
                  onClick={() => act('/v1/apps/check', { folder: app.folder })}
                >
                  {app.checking ? 'Testing…' : 'Test it'}
                </button>
              </div>

              {app.phone && (
                <div className="apps-phone">
                  <PhoneCode address={app.phone} />
                  <div>
                    <p className="row-title">On your phone, with Expo Go</p>
                    <ol className="muted">
                      <li>Install Expo Go from the App Store or Google Play (free).</li>
                      <li>Connect the phone to the same Wi-Fi as this laptop.</li>
                      <li>
                        Android: open Expo Go and scan this code. iPhone: scan it with the Camera
                        app.
                      </li>
                    </ol>
                    <p className="faint mono">{app.phone}</p>
                    <p className="faint">
                      Open to this Wi-Fi until you press Stop the preview. If the phone can’t
                      connect, Windows may be blocking Node.js: allow it on private networks.
                    </p>
                  </div>
                </div>
              )}

              <label className="field">
                What should Titan build or change?
                <textarea
                  rows={3}
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  placeholder={
                    app.kind === 'desktop'
                      ? 'For example: add a search box above the list and a button to export it as CSV.'
                      : app.kind === 'mobile'
                        ? 'For example: add a second screen with our opening hours, and tabs to switch.'
                        : 'For example: add a gallery page with six photos and a link to it in the menu.'
                  }
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
                  <div className="code-actions">
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
                    {app.kind === 'web' && (
                      <button
                        className={picking ? 'btn btn-primary' : 'btn'}
                        aria-pressed={picking}
                        onClick={() => {
                          const next = !picking
                          setPicking(next)
                          if (next) setPicked(null)
                          tellPicker(next)
                        }}
                      >
                        {picking ? 'Click an element in the preview…' : 'Edit visually'}
                      </button>
                    )}
                  </div>
                  {picked && (
                    <div className="apps-picked">
                      <p className="row-title">
                        Selected: &lt;{picked.tag}&gt;
                        {picked.text ? ` “${picked.text.slice(0, 80)}”` : ''}
                      </p>
                      <p className="faint mono">{picked.path}</p>
                      <label className="field">
                        What should change?
                        <input
                          value={change}
                          onChange={(e) => setChange(e.target.value)}
                          placeholder="For example: make it bigger and use the second colour"
                        />
                      </label>
                      <div className="code-actions">
                        <button
                          className="btn btn-primary"
                          disabled={!change.trim()}
                          onClick={() => {
                            onStart(visualEditRequest(app.folder, picked, change))
                            setPicked(null)
                            setChange('')
                          }}
                        >
                          Change it
                        </button>
                        <button className="btn" onClick={() => setPicked(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="app-frame-wrap" ref={frameWrap}>
                    <iframe
                      key={app.preview}
                      ref={frame}
                      onLoad={() => picking && tellPicker(true)}
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
                    {app.phone
                      ? `Running at ${app.preview}, and open to phones on this Wi-Fi.`
                      : `Running on this laptop only, at ${app.preview}.`}{' '}
                    Changes show as soon as they’re saved.
                    {app.kind === 'mobile' &&
                      ' This is the app through react-native-web; on a phone it uses the real iPhone and Android controls.'}
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

              {app.kind === 'desktop' ? (
                <>
                  <h2 className="section">Installer</h2>
                  <p className="muted">
                    A desktop app is shared as a Windows installer (and later a Mac app), made on
                    this laptop with Tauri. That comes later in phase 9 and needs Rust and
                    Microsoft’s C++ build tools: see This laptop, below. For now, the preview shows
                    the app’s window contents as Tauri will.
                  </p>
                </>
              ) : app.kind === 'mobile' ? (
                <>
                  <h2 className="section">Publish</h2>
                  <p className="muted">
                    Mobile apps go to the App Store and Google Play from your own developer
                    accounts. That comes later in phase 9; for now, try it on your phone with Expo
                    Go.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="section">Publish</h2>
                  {app.published ? (
                    <p>
                      Live at{' '}
                      <a href={app.published.url} target="_blank" rel="noreferrer">
                        {app.published.url}
                      </a>{' '}
                      <span className="faint">
                        · published {new Date(app.published.at).toLocaleString()}
                      </span>
                    </p>
                  ) : (
                    <p className="muted">
                      Put the site on the internet, in your own Cloudflare account: you own it and
                      its address, and Cloudflare’s free plan is enough for most small sites. Only a
                      version that passes its checks is published.
                    </p>
                  )}
                  {app.problem && (
                    <p className="note note-error" role="alert">
                      {app.problem}
                    </p>
                  )}
                  <div className="code-actions">
                    <button
                      className="btn btn-primary"
                      disabled={busy || !!app.checking || !engine.ownKeys.cloudflare}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Publish ${app.title} to your Cloudflare account? Anyone with its address will be able to see it.`
                          )
                        )
                          act('/v1/apps/publish', { folder: app.folder })
                      }}
                    >
                      {app.checking === 'Publishing…' || app.checking?.includes('Cloudflare')
                        ? app.checking
                        : app.published
                          ? 'Publish again'
                          : 'Publish to Cloudflare'}
                    </button>
                    {!engine.ownKeys.cloudflare && (
                      <span className="faint">Add your Cloudflare token below first.</span>
                    )}
                  </div>
                  <OwnKeys
                    kind="hosting"
                    saved={engine.ownKeys as Record<KeyProvider, boolean>}
                    models={[]}
                    model={null}
                    onUse={() => undefined}
                    onChanged={onKeysChanged}
                  />
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

              {app.kind === 'web' && <h3 className="app-engine">Publish from GitHub</h3>}
              {app.kind !== 'web' ? null : app.github ? (
                (() => {
                  const guide = hostGuide(gitHost, {
                    owner: app.github.owner,
                    repo: app.github.repo,
                    name: app.name
                  })
                  return (
                    <div className="apps-guide">
                      <p className="muted">
                        Connect the repository to a host once, in the host’s own dashboard: after
                        that, each new version Titan pushes is published by the host itself.
                        Titan117 never needs that host’s password or token.
                      </p>
                      <div className="segmented" role="radiogroup" aria-label="Host">
                        {(['cloudflare', 'netlify', 'vercel'] as const).map((h) => (
                          <button
                            key={h}
                            role="radio"
                            aria-checked={gitHost === h}
                            className={gitHost === h ? 'seg on' : 'seg'}
                            onClick={() => setGitHost(h)}
                          >
                            {hostGuide(h, { owner: '', repo: '', name: '' }).name}
                          </button>
                        ))}
                      </div>
                      <ol>
                        {guide.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      <p className="faint">{guide.note}</p>
                      <a className="btn" href={guide.start} target="_blank" rel="noreferrer">
                        Open {guide.name}
                      </a>
                    </div>
                  )
                })()
              ) : (
                <p className="faint">
                  Save to GitHub first. Then Cloudflare, Netlify or Vercel can publish each new
                  version by itself, connected in their own dashboard.
                </p>
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
                stronger one fixes. Empty means the task’s own model. Our test of five sample sites
                (21 Nov 2026): Claude Haiku 5.5 and GLM 5.3 Flash built all five, for about 4 cents
                a site; Haiku was the fastest.
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
                  ['fixer', 'Fixer (after repeated failures)'],
                  ['quick', 'Quick edits (visual edits and small changes)']
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
          {client && <ThisLaptop client={client} />}
        </>
      )}
    </div>
  )
}
