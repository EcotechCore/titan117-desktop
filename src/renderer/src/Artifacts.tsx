/**
 * Artifacts (§17, decisions §44): the panel beside the chat and the gallery.
 * An artifact is shown in a frame from `titan117://sandbox`, which has no
 * network and no access to this page. Every edit is a version; downloads are
 * converted on this laptop; Share uploads a snapshot only when asked.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Artifact, ArtifactDetail, ArtifactVersion } from '../../shared/protocol'
import {
  base64,
  DOWNLOADS,
  KIND_LABEL,
  lineDiff,
  renderPage,
  TEMPLATES,
  when
} from './artifact-lib'
import type { EngineClient } from './engine'
import { Icon } from './ui'

type Mode = 'view' | 'edit' | 'versions' | 'share'

export function ArtifactPanel({
  client,
  id,
  changed,
  full,
  onFull,
  onClose,
  onProblem
}: {
  client: EngineClient
  id: string
  /** Bumped when artifacts change. */
  changed: number
  full: boolean
  onFull(): void
  onClose(): void
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null)
  const [shown, setShown] = useState<ArtifactVersion | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('view')
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState(false)
  const [pageSize, setPageSize] = useState<'A4' | 'Letter'>('A4')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [busy, setBusy] = useState<string | null>(null)
  const [compare, setCompare] = useState<ArtifactVersion | null>(null)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const next = await client.get<ArtifactDetail>(`/v1/artifacts/${id}`)
      setDetail(next)
      setShown(next.current)
    } catch (error) {
      onProblem(error)
    }
  }, [client, id, onProblem])

  // The panel is keyed by the artifact's id, so a new artifact starts fresh.
  useEffect(() => {
    let live = true
    client
      .get<ArtifactDetail>(`/v1/artifacts/${id}`)
      .then((next) => {
        if (!live) return
        setDetail(next)
        setShown(next.current)
      })
      .catch(onProblem)
    return () => {
      live = false
    }
  }, [client, id, changed, onProblem])

  // Draw the shown version into the sandbox.
  useEffect(() => {
    if (!detail || !shown) return
    let live = true
    void renderPage(detail.artifact, shown.content, { theme, pageSize })
      .then((html) => window.titan117.artifacts.stage(html))
      .then((url) => live && setFrame(url))
      .catch(onProblem)
    return () => {
      live = false
    }
  }, [detail, shown, theme, pageSize, onProblem])

  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  if (!detail || !shown)
    return (
      <aside className="artifact" aria-label="Artifact">
        <p className="empty">Opening…</p>
      </aside>
    )

  const { artifact } = detail
  const old = shown.version !== artifact.version

  async function download(format: string): Promise<void> {
    if (!detail || !shown) return
    setMenu(false)
    setBusy('Preparing the file…')
    try {
      const name = (ext: string): string =>
        `${artifact.title.replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'Artifact'}${old ? ` v${shown.version}` : ''}.${ext}`
      if (format === 'pdf' || format === 'png') {
        const html = await renderPage(artifact, shown.content, { theme, pageSize })
        if (format === 'pdf') await window.titan117.artifacts.pdf(html, name('pdf'), pageSize)
        else await window.titan117.artifacts.png(html, name('png'))
      } else if (format === 'svg') {
        const html = await renderPage(artifact, shown.content, { theme })
        const svg = /<svg[\s\S]*<\/svg>/.exec(html)?.[0]
        if (!svg) throw new Error('There is no drawing to save.')
        await window.titan117.artifacts.save(name('svg'), base64(svg))
      } else if (format === 'html') {
        const html = await renderPage(artifact, shown.content, { theme, pageSize })
        await window.titan117.artifacts.save(name('html'), base64(html))
      } else {
        const file = await client.get<{ name: string; base64: string }>(
          `/v1/artifacts/${artifact.id}/export?format=${format}&v=${shown.version}`
        )
        await window.titan117.artifacts.save(old ? name(format) : file.name, file.base64)
      }
    } catch (error) {
      onProblem(error)
    } finally {
      setBusy(null)
    }
  }

  async function saveEdit(): Promise<void> {
    try {
      await client.send('PUT', `/v1/artifacts/${artifact.id}`, { content: draft })
      setMode('view')
      await load()
    } catch (error) {
      onProblem(error)
    }
  }

  async function restore(version: number): Promise<void> {
    try {
      await client.send('POST', `/v1/artifacts/${artifact.id}/restore`, { version })
      setMode('view')
      setCompare(null)
      await load()
    } catch (error) {
      onProblem(error)
    }
  }

  async function showVersion(version: number): Promise<void> {
    try {
      const { version: v } = await client.get<{ version: ArtifactVersion }>(
        `/v1/artifacts/${artifact.id}/version?v=${version}`
      )
      setShown(v)
      setCompare(null)
    } catch (error) {
      onProblem(error)
    }
  }

  async function compareWith(version: number): Promise<void> {
    try {
      const { version: v } = await client.get<{ version: ArtifactVersion }>(
        `/v1/artifacts/${artifact.id}/version?v=${version}`
      )
      setCompare(v)
    } catch (error) {
      onProblem(error)
    }
  }

  async function share(): Promise<void> {
    setBusy('Sharing…')
    try {
      // Shared pages are light, whatever the panel shows.
      const html = await renderPage(artifact, detail!.current.content, { pageSize })
      await client.send('POST', `/v1/artifacts/${artifact.id}/share`, { html })
      await load()
    } catch (error) {
      onProblem(error)
    } finally {
      setBusy(null)
    }
  }

  async function unshare(): Promise<void> {
    setBusy('Unsharing…')
    try {
      await client.send('DELETE', `/v1/artifacts/${artifact.id}/share`)
      await load()
    } catch (error) {
      onProblem(error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside className={full ? 'artifact artifact-full' : 'artifact'} aria-label="Artifact">
      <header className="art-head">
        <div className="art-title">
          <span className="art-kind">{KIND_LABEL[artifact.kind]}</span>
          <h2 title={artifact.title}>{artifact.title}</h2>
          <span className="art-version mono">
            v{shown.version}
            {old && ` of ${artifact.version}`}
          </span>
        </div>
        <div className="art-tools">
          <button
            className={mode === 'edit' ? 'btn on' : 'btn'}
            onClick={() => {
              setDraft(detail.current.content)
              setMode(mode === 'edit' ? 'view' : 'edit')
            }}
          >
            Edit
          </button>
          <button
            className={mode === 'versions' ? 'btn on' : 'btn'}
            onClick={() => setMode(mode === 'versions' ? 'view' : 'versions')}
          >
            Versions
          </button>
          <div className="menu-wrap" ref={menuRef}>
            <button className="btn" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <Icon name="down" /> Download
            </button>
            {menu && (
              <div className="menu" role="menu">
                {DOWNLOADS[artifact.kind].map((d) => (
                  <button key={d.format} role="menuitem" onClick={() => void download(d.format)}>
                    {d.label}
                  </button>
                ))}
                <button
                  role="menuitem"
                  onClick={() => {
                    void navigator.clipboard.writeText(shown.content)
                    setMenu(false)
                  }}
                >
                  Copy to clipboard
                </button>
                <div className="menu-opts">
                  <label>
                    Page
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(e.target.value as 'A4' | 'Letter')}
                    >
                      <option>A4</option>
                      <option>Letter</option>
                    </select>
                  </label>
                  <label>
                    Look
                    <select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                </div>
              </div>
            )}
          </div>
          <button
            className={artifact.shareUrl ? 'btn on' : 'btn btn-primary'}
            onClick={() => setMode(mode === 'share' ? 'view' : 'share')}
          >
            {artifact.shareUrl ? 'Shared' : 'Share'}
          </button>
          <button
            className="icon-btn"
            aria-label={full ? 'Smaller' : 'Full screen'}
            onClick={onFull}
          >
            <Icon name="panel" />
          </button>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </header>

      {busy && <p className="note">{busy}</p>}

      {mode === 'share' && (
        <div className="art-share">
          {artifact.shareUrl ? (
            <>
              <p>
                Anyone with this link can view the version you shared. Unshare to delete it from our
                servers.
              </p>
              <div className="share-link">
                <input
                  readOnly
                  value={artifact.shareUrl}
                  aria-label="Share link"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  className="btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(artifact.shareUrl!)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="row-actions">
                <button className="btn" onClick={() => void share()}>
                  Share the latest version
                </button>
                <button className="btn" onClick={() => void unshare()}>
                  Unshare
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Sharing puts a copy of this {KIND_LABEL[artifact.kind].toLowerCase()} on
                Titan117&apos;s servers behind a private link. Anyone with the link can view it, and
                report it if it breaks our rules. Nothing else leaves this laptop; unshare any time.
              </p>
              <div className="row-actions">
                <button className="btn btn-primary" onClick={() => void share()}>
                  Make a link
                </button>
                <button className="btn" onClick={() => setMode('view')}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'versions' && (
        <div className="art-versions">
          <ol>
            {detail.versions.map((v) => (
              <li key={v.version} className={v.version === shown.version ? 'on' : ''}>
                <button className="ver" onClick={() => void showVersion(v.version)}>
                  <span className="mono">v{v.version}</span> {v.note}
                  <span className="muted">
                    {' '}
                    · {v.author} · {when(v.createdAt)}
                  </span>
                </button>
                {v.version !== artifact.version && (
                  <span className="ver-actions">
                    <button className="link" onClick={() => void compareWith(v.version)}>
                      Compare
                    </button>
                    <button className="link" onClick={() => void restore(v.version)}>
                      Restore
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {compare ? (
        <Compare before={compare} after={detail.current} onClose={() => setCompare(null)} />
      ) : mode === 'edit' ? (
        <div className="art-edit">
          <p className="muted">
            {artifact.kind === 'spreadsheet' || artifact.kind === 'chart'
              ? 'The data, as JSON.'
              : artifact.kind === 'diagram'
                ? 'The diagram, in Mermaid.'
                : artifact.kind === 'page'
                  ? 'The page, in HTML.'
                  : 'The text, in Markdown.'}{' '}
            Saving makes a new version; Titan sees your edit.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck
            aria-label="Artifact content"
          />
          <div className="row-actions">
            <button
              className="btn btn-primary"
              onClick={() => void saveEdit()}
              disabled={draft === detail.current.content}
            >
              Save as v{artifact.version + 1}
            </button>
            <button className="btn" onClick={() => setMode('view')}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        frame && (
          <iframe
            key={frame}
            className="art-frame"
            title={artifact.title}
            src={frame}
            sandbox="allow-scripts allow-popups"
          />
        )
      )}
    </aside>
  )
}

function Compare({
  before,
  after,
  onClose
}: {
  before: ArtifactVersion
  after: ArtifactVersion
  onClose(): void
}): React.JSX.Element {
  const lines = useMemo(() => lineDiff(before.content, after.content), [before, after])
  return (
    <div className="art-compare">
      <div className="row-actions">
        <span className="muted">
          v{before.version} → v{after.version}
        </span>
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </div>
      <pre className="diff">
        {lines.map((l, i) => (
          <div key={i} className={`diff-${l.kind}`}>
            {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  )
}

export function ArtifactsView({
  client,
  changed,
  onOpen,
  onProblem
}: {
  client: EngineClient | null
  changed: number
  onOpen(id: string): void
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [list, setList] = useState<Artifact[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!client) return
    const timer = setTimeout(() => {
      client
        .get<{ artifacts: Artifact[] }>(
          `/v1/artifacts${query ? `?q=${encodeURIComponent(query)}` : ''}`
        )
        .then((r) => setList(r.artifacts))
        .catch(onProblem)
    }, 150)
    return () => clearTimeout(timer)
  }, [client, query, changed, onProblem])

  async function fromTemplate(t: (typeof TEMPLATES)[number]): Promise<void> {
    try {
      const { artifact } = await client!.send<{ artifact: Artifact }>('POST', '/v1/artifacts', t)
      onOpen(artifact.id)
    } catch (error) {
      onProblem(error)
    }
  }

  async function remove(a: Artifact): Promise<void> {
    if (
      !window.confirm(
        `Delete "${a.title}" and all its versions?${a.shareUrl ? ' Its share link stops working.' : ''}`
      )
    )
      return
    try {
      await client!.send('DELETE', `/v1/artifacts/${a.id}`)
    } catch (error) {
      onProblem(error)
    }
  }

  return (
    <div className="list-view">
      <h1 className="view-title">Artifacts</h1>
      <p className="muted">
        Reports, offers, tables, charts, diagrams and slides your agents made. They stay on this
        laptop until you share one.
      </p>
      <input
        className="search"
        placeholder="Find by title"
        aria-label="Find artifacts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {list.length === 0 && (
        <p className="empty">{query ? 'Nothing with that title.' : 'No artifacts yet.'}</p>
      )}
      {list.map((a) => (
        <div key={a.id} className="row">
          <span className="row-icon">
            <Icon name="file" />
          </span>
          <button className="row-main left" onClick={() => onOpen(a.id)}>
            <span className="row-title">
              {a.title}
              {a.shareUrl && <span className="pill">Shared</span>}
            </span>
            <span className="muted">
              {KIND_LABEL[a.kind]} · v{a.version} · {when(a.updatedAt)}
            </span>
          </button>
          <button
            className="icon-btn"
            aria-label={`Delete ${a.title}`}
            onClick={() => void remove(a)}
          >
            <Icon name="x" />
          </button>
        </div>
      ))}
      <p className="section">Start from a template</p>
      <div className="prompts">
        {TEMPLATES.map((t) => (
          <button key={t.title} className="prompt" onClick={() => void fromTemplate(t)}>
            <strong>{t.title}</strong>
            <span className="muted"> · {KIND_LABEL[t.kind]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
