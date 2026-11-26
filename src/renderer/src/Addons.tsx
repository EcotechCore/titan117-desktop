// Add-ons (phase 16, decisions §66): what is installed, from GitHub or made by
// Titan, with versions, rollback and safe mode; and installing from a GitHub
// address after the card with what it may do, its licence and its checks.
import { useCallback, useEffect, useState } from 'react'

import type { EngineClient } from './engine'
import { Icon } from './ui'

interface AddonVersion {
  id: string
  version: string
  commit: string | null
  installedAt: number
}

interface Addon {
  name: string
  type: string
  title: string
  description: string
  repo: string | null
  by: string
  versions: AddonVersion[]
  current: string
  enabled: boolean
  offReason: string | null
  takenDown?: boolean
  publishedAs?: string
}

interface SafeMode {
  on: boolean
  reason: string | null
  lastChanged: string | null
}

interface Inspection {
  key: string
  repo: string
  commit: string
  manifest: {
    type: string
    title: string
    version: string
    description: string
    app: { dir: string } | null
  }
  permissions: string[]
  checks: {
    licence: {
      id: string | null
      verdict: 'ok' | 'copyleft' | 'unknown' | 'restricted'
      note: string
    }
    dependencies: {
      checked: number
      unpinned: string[]
      vulnerable: { name: string; version: string; ids: string[] }[]
      error: string | null
    }
    secrets: { file: string; line: number; rule: string }[]
    installScripts: string[]
    files: number
    bytes: number
  }
  takenDown: boolean | null
  verified: boolean
  update: {
    name: string
    fromVersion: string
    fromCommit: string
    total: number | null
    commits: { sha: string; message: string }[]
  } | null
}

interface SidebarBuilds {
  id: string
  title: string
  build: string
  builds: { build: string; at: number; current: boolean }[]
}

const TYPE_LABEL: Record<string, string> = {
  agent: 'Agent',
  skill: 'Skill',
  tool: 'Tool',
  'app-template': 'App template',
  'sidebar-app': 'Sidebar app',
  'mcp-server': 'MCP server',
  workflow: 'Workflow'
}

/** The banner on every screen while add-ons are off (decisions §66.8). */
export function SafeModeBanner({
  client,
  changed,
  onOpen
}: {
  client: EngineClient | null
  changed: number
  onOpen(): void
}): React.JSX.Element | null {
  const [safe, setSafe] = useState<SafeMode | null>(null)
  useEffect(() => {
    client
      ?.get<{ safeMode: SafeMode }>('/v1/addons')
      .then((r) => setSafe(r.safeMode))
      .catch(() => setSafe(null))
  }, [client, changed])
  if (!safe?.on) return null
  return (
    <div className="note note-error safe-mode" role="alert">
      <span>
        <strong>Safe mode: add-ons are off.</strong> {safe.reason}
        {safe.lastChanged ? ` The last one that changed is “${safe.lastChanged}”.` : ''}
      </span>
      <button className="btn btn-primary" onClick={onOpen}>
        Open Add-ons
      </button>
    </div>
  )
}

export function AddonsView({
  client,
  changed,
  onProblem
}: {
  client: EngineClient | null
  changed: number
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [items, setItems] = useState<Addon[]>([])
  const [sidebarApps, setSidebarApps] = useState<SidebarBuilds[]>([])
  const [safe, setSafe] = useState<SafeMode | null>(null)
  const [address, setAddress] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Refusals (no titan.json, taken down, a folder that isn't empty) show here, next to the card.
  const [problem, setProblem] = useState<string | null>(null)
  const show = (error: unknown): void =>
    setProblem(error instanceof Error ? error.message : 'Something went wrong.')

  const load = useCallback(() => {
    client
      ?.get<{ addons: Addon[]; safeMode: SafeMode; sidebarApps?: SidebarBuilds[] }>('/v1/addons')
      .then((r) => {
        setItems(r.addons)
        setSidebarApps(r.sidebarApps ?? [])
        setSafe(r.safeMode)
      })
      .catch(onProblem)
  }, [client, onProblem])
  useEffect(load, [load, changed])

  async function inspect(what = address): Promise<void> {
    if (!client) return
    setBusy(true)
    setNote(null)
    setProblem(null)
    setInspection(null)
    try {
      const r = await client.send<{ inspection: Inspection }>('POST', '/v1/addons', {
        action: 'inspect',
        address: what
      })
      setInspection(r.inspection)
    } catch (error) {
      show(error)
    } finally {
      setBusy(false)
    }
  }

  async function install(): Promise<void> {
    if (!client || !inspection) return
    setBusy(true)
    try {
      const r = await client.send<{ installed: { addon: Addon; copiedTo: string | null } }>(
        'POST',
        '/v1/addons',
        { action: 'install', key: inspection.key, folder: folder.trim() || null }
      )
      setNote(
        `Installed ${r.installed.addon.title}.` +
          (r.installed.copiedTo ? ` Its files are in ${r.installed.copiedTo}.` : '')
      )
      setInspection(null)
      setAddress('')
      setFolder('')
      load()
    } catch (error) {
      show(error)
    } finally {
      setBusy(false)
    }
  }

  const act = (
    path: string,
    body: unknown,
    method: 'POST' | 'DELETE' = 'POST',
    done?: string
  ): void => {
    setProblem(null)
    client
      ?.send(method, path, body)
      .then(() => {
        if (done) setNote(done)
        load()
      })
      .catch(show)
  }

  const c = inspection?.checks
  const blocked = !!inspection && inspection.takenDown === true

  return (
    <div className="list-view">
      <h1 className="view-title">Add-ons</h1>
      <p className="muted">
        Agents, skills, tools and app templates from GitHub, and tools Titan made for you. Each one
        is pinned to a version you can roll back. Tools run in a sandbox with no files and only the
        sites they name; the app itself can&apos;t be changed by any of them.
      </p>

      {safe?.on && (
        <div className="note note-error" role="alert">
          <p>
            <strong>Safe mode: add-ons are off.</strong> {safe.reason}
          </p>
          <div className="approval-actions">
            {safe.lastChanged && items.some((a) => a.name === safe.lastChanged) && (
              <>
                <button
                  className="btn"
                  onClick={() => act(`/v1/addons/${safe.lastChanged}`, { action: 'rollback' })}
                >
                  Roll back “{safe.lastChanged}”
                </button>
                <button
                  className="btn"
                  onClick={() => act(`/v1/addons/${safe.lastChanged}`, undefined, 'DELETE')}
                >
                  Remove “{safe.lastChanged}”
                </button>
              </>
            )}
            <button
              className="btn btn-primary"
              onClick={() => {
                act('/v1/addons', { action: 'leave-safe-mode' })
                setNote('Add-ons come back on when you restart Titan117.')
              }}
            >
              Start normally
            </button>
          </div>
        </div>
      )}

      <div className="row row-stack form">
        <label>
          Install from GitHub or GitLab
          <input
            className="mono"
            placeholder="owner/repo, owner/repo@commit, https://github.com/owner/repo or gitlab.com/group/project"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && address.trim()) void inspect()
            }}
          />
        </label>
        <div className="approval-actions">
          <button
            className="btn btn-primary"
            disabled={!address.trim() || busy}
            onClick={() => void inspect()}
          >
            {busy && !inspection ? 'Checking…' : 'Check it'}
          </button>
          <span className="muted">Nothing is installed until you approve the card.</span>
        </div>
      </div>

      {note && <p className="note">{note}</p>}
      {problem && (
        <p className="note note-error" role="alert">
          {problem}
        </p>
      )}

      {inspection && c && (
        <div className="row row-stack addon-card" role="region" aria-label="Before installing">
          <p className="row-title">
            {inspection.manifest.title} {inspection.manifest.version}
            <span className="tag">
              {TYPE_LABEL[inspection.manifest.type] ?? inspection.manifest.type}
            </span>
            {inspection.verified && <span className="tag tag-ready">Verified</span>}
          </p>
          <p className="muted mono">
            github.com/{inspection.repo} @ {inspection.commit.slice(0, 12)}
          </p>
          <p>{inspection.manifest.description}</p>
          {inspection.update && (
            <div className="note">
              <p>
                <strong>
                  Update from {inspection.update.fromVersion} (
                  {inspection.update.fromCommit.slice(0, 12)}) to {inspection.manifest.version}.
                </strong>{' '}
                {inspection.update.total === null
                  ? 'GitHub couldn’t list the commits in between.'
                  : `${inspection.update.total} commit${inspection.update.total === 1 ? '' : 's'} since:`}
              </p>
              {inspection.update.commits.length > 0 && (
                <ul className="tool-list">
                  {inspection.update.commits.slice(-10).map((c) => (
                    <li key={c.sha}>
                      <span className="mono">{c.sha}</span> {c.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <h3 className="addon-h">What it may do</h3>
          <ul className="tool-list">
            {inspection.permissions.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <h3 className="addon-h">Checks</h3>
          <ul className="tool-list">
            <li className={c.licence.verdict === 'ok' ? '' : 'warn'}>Licence: {c.licence.note}</li>
            <li className={c.dependencies.vulnerable.length || c.dependencies.error ? 'warn' : ''}>
              {c.dependencies.error
                ? `Dependency scan couldn’t run: ${c.dependencies.error}`
                : c.dependencies.checked === 0
                  ? 'No pinned npm dependencies.'
                  : c.dependencies.vulnerable.length
                    ? `${c.dependencies.vulnerable.length} of ${c.dependencies.checked} dependencies have known vulnerabilities: ${c.dependencies.vulnerable
                        .slice(0, 6)
                        .map((v) => `${v.name} ${v.version} (${v.ids.slice(0, 2).join(', ')})`)
                        .join('; ')}`
                    : `${c.dependencies.checked} dependencies checked against OSV: no known vulnerabilities.`}
            </li>
            {c.dependencies.unpinned.length > 0 && (
              <li>
                {c.dependencies.unpinned.length} dependencies have no exact version and weren’t
                checked.
              </li>
            )}
            <li className={c.secrets.length ? 'warn' : ''}>
              {c.secrets.length
                ? `Keys found in its files: ${c.secrets
                    .slice(0, 5)
                    .map((s) => `${s.rule} in ${s.file}:${s.line}`)
                    .join('; ')}`
                : 'No keys found in its files.'}
            </li>
            {c.installScripts.length > 0 && (
              <li className="warn">
                Install scripts (never run here): {c.installScripts.join('; ')}
              </li>
            )}
            <li>
              {c.files} files, {Math.round(c.bytes / 1024)} KB
            </li>
            {inspection.takenDown === null && (
              <li className="warn">
                Titan117’s takedown list couldn’t be checked (offline or signed out).
              </li>
            )}
            {inspection.takenDown && (
              <li className="warn">Titan117 took this add-on down after a report.</li>
            )}
          </ul>
          {inspection.manifest.app && (
            <label>
              New folder for its files (inside your allowed folders)
              <input
                className="mono"
                placeholder="C:\Users\you\Documents\my-crm"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              />
            </label>
          )}
          <p className="muted">
            Want Titan to read the code first? Ask it: “Look at {inspection.repo} and tell me what
            it does.”
          </p>
          <div className="approval-actions">
            <button
              className="btn btn-primary"
              disabled={busy || blocked || (!!inspection.manifest.app && !folder.trim())}
              onClick={() => void install()}
            >
              {inspection.update ? 'Update' : 'Install'}
            </button>
            <button className="btn" onClick={() => setInspection(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && <p className="empty">No add-ons yet.</p>}
      {items.map((a) => {
        const at = a.versions.findIndex((v) => v.id === a.current)
        const current = a.versions[at]
        return (
          <div key={a.name} className="row row-stack">
            <div className="row-line">
              <span className="row-icon">
                <Icon name="box" />
              </span>
              <div className="row-main">
                <p className="row-title">
                  {a.title}
                  <span className="tag">{TYPE_LABEL[a.type] ?? a.type}</span>
                  <span className={`tag ${a.enabled && !safe?.on ? 'tag-ready' : 'tag-off'}`}>
                    {safe?.on ? 'Off (safe mode)' : a.enabled ? 'On' : 'Off'}
                  </span>
                </p>
                <p className="muted mono">
                  {a.repo ? `github.com/${a.repo}` : 'Made by Titan'} · version{' '}
                  {current?.version ?? '?'} [{a.current}] · {at + 1} of {a.versions.length}
                </p>
                <p className="muted">{a.description}</p>
                {a.publishedAs && (
                  <p className="muted">
                    Published at{' '}
                    <a
                      href={`https://github.com/${a.publishedAs}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      github.com/{a.publishedAs}
                    </a>
                    . Add the topic titan117-addon there for the marketplace to list it.
                  </p>
                )}
                {a.repo && !a.repo.startsWith('gitlab.com/') && (
                  <p className="muted">
                    <a href={`https://github.com/${a.repo}/fork`} target="_blank" rel="noreferrer">
                      Suggest a change to its author
                    </a>{' '}
                    (GitHub’s own fork page; Titan can then make the change and open a pull
                    request).
                  </p>
                )}
                {a.offReason && <p className="note note-error">{a.offReason}</p>}
              </div>
              {a.repo && !a.takenDown && (
                <button className="btn" disabled={busy} onClick={() => void inspect(a.repo!)}>
                  Check for update
                </button>
              )}
              {a.repo && !a.takenDown && (
                <select
                  className="btn"
                  aria-label={`Rate ${a.title}`}
                  defaultValue=""
                  onChange={(e) => {
                    const stars = Number(e.target.value)
                    if (stars)
                      act(
                        `/v1/addons/${a.name}`,
                        { action: 'rate', stars },
                        'POST',
                        `Thanks: ${stars} stars for ${a.title}.`
                      )
                  }}
                >
                  <option value="">Rate</option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {'★'.repeat(n)}
                    </option>
                  ))}
                </select>
              )}
              {at > 0 && !a.takenDown && (
                <button
                  className="btn"
                  onClick={() => act(`/v1/addons/${a.name}`, { action: 'rollback' })}
                >
                  Roll back
                </button>
              )}
              <button
                className="btn"
                disabled={!!a.takenDown}
                onClick={() =>
                  act(`/v1/addons/${a.name}`, { action: a.enabled ? 'disable' : 'enable' })
                }
              >
                {a.enabled ? 'Turn off' : 'Turn on'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (window.confirm(`Remove ${a.title} and all its versions?`))
                    act(`/v1/addons/${a.name}`, undefined, 'DELETE')
                }}
              >
                Remove
              </button>
            </div>
          </div>
        )
      })}

      {sidebarApps.length > 0 && (
        <>
          <h2 className="addon-h">Sidebar apps</h2>
          <p className="muted">
            Apps Titan built for the sidebar. Each update is checked and kept; go back to the build
            before if one breaks.
          </p>
          {sidebarApps.map((app) => {
            const at = app.builds.findIndex((b) => b.current)
            return (
              <div key={app.id} className="row row-stack">
                <div className="row-line">
                  <span className="row-icon">
                    <Icon name="app" />
                  </span>
                  <div className="row-main">
                    <p className="row-title">
                      {app.title}
                      <span className="tag">Sidebar app</span>
                      {safe?.on && <span className="tag tag-off">Off (safe mode)</span>}
                    </p>
                    <p className="muted mono">
                      build {app.build} · {app.builds.length} kept
                    </p>
                  </div>
                  {at >= 0 && at < app.builds.length - 1 && (
                    <button
                      className="btn"
                      onClick={() =>
                        act(
                          `/v1/addons/${app.id}`,
                          { action: 'rollback-build' },
                          'POST',
                          `${app.title} is back at build ${app.builds[at + 1].build}.`
                        )
                      }
                    >
                      Roll back
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
