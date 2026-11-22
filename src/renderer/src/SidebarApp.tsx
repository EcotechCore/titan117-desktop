// A sidebar app (6.2; decisions §58): its checked build in a frame
// sandboxed without same-origin (no cookies, storage or access to this
// window) and with no network (its content security policy). Its `titan`
// SDK talks only through this bridge: each message is checked to come from
// this app's own frame, and the engine decides what the app may reach.
import { useEffect, useRef, useState } from 'react'

import type { EngineClient } from './engine'
import { Icon } from './ui'

export interface SidebarAppInfo {
  id: string
  folder: string
  title: string
  icon: string
  collections: string[]
  build: string
  grants: { reads: string[]; writes: string[]; ai?: boolean }
  ai?: { day: string; calls: number; usd: number }
  addedAt: number
  updatedAt: number
  error: { message: string; at: number } | null
}

/** What a sidebar app may ask through the bridge; the engine checks the rest. */
const METHODS = new Set([
  'db.collections',
  'db.list',
  'db.count',
  'db.get',
  'db.insert',
  'db.update',
  'db.remove',
  'auth.user',
  'agent.ask',
  'ai.ask',
  'app.error'
])

export function SidebarAppView({
  client,
  app,
  onAsk,
  onFix,
  onProblem
}: {
  client: EngineClient
  app: SidebarAppInfo
  /** The app's `titan.agent.ask`: a new request in the composer, which the user sends. */
  onAsk: (request: string) => void
  /** "Fix with Titan" (6.14): a task that changes the app and updates the sidebar. */
  onFix: (request: string) => void
  onProblem: (error: unknown) => void
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const target = frame.current?.contentWindow
      // Only this app's own frame; a sandboxed frame's origin is "null".
      if (!target || event.source !== target || event.origin !== 'null') return
      const m = event.data as { titan117?: string; id?: number; method?: string; args?: unknown }
      if (!m || m.titan117 !== 'call' || typeof m.id !== 'number' || typeof m.method !== 'string')
        return
      const reply = (ok: boolean, value: unknown): void =>
        target.postMessage(
          ok
            ? { titan117: 'reply', id: m.id, ok: true, value }
            : { titan117: 'reply', id: m.id, ok: false, error: String(value) },
          '*'
        )
      if (!METHODS.has(m.method)) return reply(false, 'Titan117 doesn’t know that call.')
      if (m.method === 'agent.ask') {
        const request = (m.args as { request?: unknown } | undefined)?.request
        if (typeof request !== 'string' || !request.trim())
          return reply(false, 'Ask for something.')
        onAsk(
          `${request.trim().slice(0, 4000)}\n\n(Asked from the ${app.title} app in the sidebar.)`
        )
        return reply(true, { opened: true })
      }
      client
        .send<{ value?: unknown; error?: string }>('POST', '/v1/sidebar/call', {
          app: app.id,
          method: m.method,
          args: m.args ?? {}
        })
        .then((r) => (r.error !== undefined ? reply(false, r.error) : reply(true, r.value ?? null)))
        .catch((error) => reply(false, error instanceof Error ? error.message : String(error)))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [client, app.id, app.title, onAsk])

  async function update(): Promise<void> {
    setBusy(true)
    try {
      await client.send('POST', '/v1/sidebar/update', { folder: app.folder })
    } catch (error) {
      onProblem(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sidebar-app" aria-label={app.title}>
      <header className="sidebar-app-bar">
        <h1>
          <Icon name={app.icon} /> {app.title}
        </h1>
        <span className="muted">
          On this laptop · version {app.build.slice(0, 7)}
          {app.grants.reads.length ? ` · reads ${app.grants.reads.join(', ')}` : ''}
          {app.grants.ai && app.ai?.day === new Date().toISOString().slice(0, 10)
            ? ` · AI today: ${app.ai.calls} question${app.ai.calls === 1 ? '' : 's'}, ${app.ai.usd > 0 && app.ai.usd < 0.01 ? 'under $0.01' : `$${app.ai.usd.toFixed(2)}`}`
            : ''}
        </span>
        <span className="grow" />
        <button
          className="btn"
          disabled={busy}
          onClick={() => onAsk(`Change the sidebar app "${app.title}" (${app.folder}): `)}
        >
          Change with Titan
        </button>
        <button className="btn" disabled={busy} onClick={() => void update()}>
          {busy ? 'Updating…' : 'Update'}
        </button>
      </header>
      {app.error && (
        <div className="sidebar-app-error" role="alert">
          <span>
            <strong>The app reported an error:</strong> {app.error.message.slice(0, 300)}
          </span>
          <button
            className="btn btn-primary"
            onClick={() =>
              onFix(
                `The sidebar app "${app.title}" in ${app.folder} reported this error. Find the cause and fix it with app_build, so the sidebar gets a working version:\n\n${app.error?.message ?? ''}`
              )
            }
          >
            Fix with Titan
          </button>
        </div>
      )}
      <iframe
        key={app.id + app.build}
        ref={frame}
        className="sidebar-app-frame"
        title={app.title}
        src={`titan117://${app.id}.apps/`}
        sandbox="allow-scripts allow-forms allow-modals"
        referrerPolicy="no-referrer"
      />
    </section>
  )
}

interface Review {
  id: string
  title: string
  reads: { ref: string; app: string | null }[]
  writes: { ref: string; app: string | null }[]
  manifest: { reads: string[]; writes: string[]; collections: string[]; ai: boolean }
  added: boolean
}

const refName = (r: { ref: string; app: string | null }): string => {
  const [id, collection] = r.ref.split('/')
  return `${r.app ?? `${id} (not in the sidebar yet)`}: ${collection === '*' ? 'all its data' : collection}`
}

/**
 * On the Apps screen, for a web app (6.2): add it to the sidebar after
 * reading exactly what it may reach, update it, or take it out.
 */
export function SidebarControls({
  client,
  folder,
  added,
  working,
  onChanged,
  onProblem
}: {
  client: EngineClient
  folder: string
  added: SidebarAppInfo | null
  working: boolean
  onChanged: () => void
  onProblem: (error: unknown) => void
}): React.JSX.Element {
  const [review, setReview] = useState<Review | null>(null)
  const [removing, setRemoving] = useState(false)
  const [deleteData, setDeleteData] = useState(false)

  const look = (): void => {
    client
      .get<{ review: Review }>(`/v1/sidebar/review?folder=${encodeURIComponent(folder)}`)
      .then((r) => setReview(r.review))
      .catch(onProblem)
  }
  const send = (path: string, body: Record<string, unknown>): void => {
    client
      .send('POST', path, body)
      .then(() => {
        setReview(null)
        setRemoving(false)
        onChanged()
      })
      .catch(onProblem)
  }

  return (
    <div className="sidebar-review">
      <p className="row-title">
        <Icon name={added?.icon ?? 'app'} /> In the Titan117 sidebar
      </p>
      {added ? (
        <p className="muted">
          In the sidebar as “{added.title}”, version {added.build.slice(0, 7)}. Its data stays on
          this laptop; Titan can read it to answer your questions.
        </p>
      ) : (
        <p className="muted">
          Internal tools (a CRM, stock, invoices) can live in the sidebar: sandboxed, with no
          network, their data on this laptop in one shared place Titan can read.
        </p>
      )}
      {review && (
        <>
          <p>
            {review.added ? 'Update' : 'Add'} “{review.title}”: Titan117 saves a version, runs its
            checks and shows the build in the sidebar. It keeps its own data
            {review.manifest.collections.length
              ? ` (${review.manifest.collections.join(', ')})`
              : ''}
            .
          </p>
          {review.reads.length + review.writes.length > 0 ? (
            <>
              <p>It also asks to reach other apps’ data:</p>
              <ul>
                {review.reads.map((r) => (
                  <li key={`r${r.ref}`}>Read {refName(r)}</li>
                ))}
                {review.writes.map((w) => (
                  <li key={`w${w.ref}`}>Change {refName(w)}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">It doesn’t ask for any other app’s data.</p>
          )}
          {review.manifest.ai && (
            <p>
              It also asks to send questions to your default AI model (
              <strong>costs credits</strong>, at most 100 a day; what it sends leaves this laptop if
              the model is in the cloud).
            </p>
          )}
          <div className="code-actions">
            <button
              className="btn btn-primary"
              disabled={working}
              onClick={() =>
                send('/v1/sidebar/add', {
                  folder,
                  grants: {
                    reads: review.manifest.reads,
                    writes: review.manifest.writes,
                    ai: review.manifest.ai
                  }
                })
              }
            >
              {review.added ? 'Update it' : 'Add to the sidebar'}
            </button>
            <button className="btn" onClick={() => setReview(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {removing && added && (
        <>
          <label className="choice">
            <input
              type="checkbox"
              checked={deleteData}
              onChange={(e) => setDeleteData(e.target.checked)}
            />{' '}
            Also delete its data on this laptop (can’t be undone)
          </label>
          <div className="code-actions">
            <button
              className="btn btn-primary"
              onClick={() => send('/v1/sidebar/remove', { app: added.id, deleteData })}
            >
              Take it out of the sidebar
            </button>
            <button className="btn" onClick={() => setRemoving(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {!review && !removing && (
        <div className="code-actions">
          {added ? (
            <>
              <button
                className="btn"
                disabled={working}
                onClick={() => send('/v1/sidebar/update', { folder })}
              >
                Update in the sidebar
              </button>
              <button className="btn" disabled={working} onClick={look}>
                Review what it reaches
              </button>
              <button className="btn" disabled={working} onClick={() => setRemoving(true)}>
                Take out
              </button>
            </>
          ) : (
            <button className="btn" disabled={working} onClick={look}>
              Add to the sidebar…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
