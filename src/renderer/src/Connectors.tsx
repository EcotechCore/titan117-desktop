// Connectors (feature 3.6, decisions §28): the user's own services through
// MCP, signed in as the user. Secrets go to the keychain through the shell;
// the page never reads them back.
import { useCallback, useEffect, useState } from 'react'

import type { Connector } from '../../shared/protocol'
import type { EngineClient } from './engine'
import { Icon } from './ui'

const RISK_LABEL = { read: 'runs at once', write: 'asks first', external: 'always asks' }

/** `KEY=value` lines → an object. Blank lines and lines without "=" are skipped. */
function parseSecrets(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at <= 0) continue
    const name = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && value) out[name] = value
  }
  return out
}

export function ConnectorsView({
  client,
  changed,
  onProblem
}: {
  client: EngineClient | null
  changed: number
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [items, setItems] = useState<Connector[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    name: '',
    kind: 'stdio' as 'stdio' | 'http',
    command: '',
    args: '',
    url: '',
    secrets: ''
  })

  const load = useCallback(() => {
    client
      ?.get<{ connectors: Connector[] }>('/v1/connectors')
      .then((r) => setItems(r.connectors))
      .catch(onProblem)
  }, [client, onProblem])
  useEffect(load, [load, changed])

  async function add(): Promise<void> {
    if (!client) return
    try {
      const { connector } = await client.send<{ connector: Connector }>('POST', '/v1/connectors', {
        name: form.name,
        kind: form.kind,
        command: form.command,
        args: form.args
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
        url: form.url
      })
      const secrets = parseSecrets(form.secrets)
      if (Object.keys(secrets).length) {
        const saved = await window.titan117.connectors.setSecrets(connector.id, secrets)
        if (!saved.ok) onProblem(new Error(saved.problem))
      }
      setForm({ name: '', kind: 'stdio', command: '', args: '', url: '', secrets: '' })
      setAdding(false)
      load()
    } catch (error) {
      onProblem(error)
    }
  }

  return (
    <div className="list-view">
      <h1 className="view-title">Connectors</h1>
      <p className="muted">
        Connect your own services (mail, calendar, CRM, GitHub, Notion…) through their MCP server,
        signed in as you. Tokens stay in this laptop&apos;s keychain. Reading runs at once; sending,
        posting and deleting always ask.
      </p>
      {items.length === 0 && !adding && <p className="empty">No connectors yet.</p>}
      {items.map((c) => (
        <div key={c.id} className="row row-stack">
          <div className="row-line">
            <span className="row-icon">
              <Icon name="plug" />
            </span>
            <div className="row-main">
              <p className="row-title">
                {c.name}
                <span className={`tag tag-${c.status}`}>
                  {
                    { off: 'Off', connecting: 'Connecting', ready: 'Connected', error: 'Error' }[
                      c.status
                    ]
                  }
                </span>
              </p>
              <p className="muted mono">
                {c.kind === 'stdio' ? [c.command, ...c.args].join(' ') : c.url}
                {c.secretNames.length > 0 && ` · keychain: ${c.secretNames.join(', ')}`}
              </p>
              {c.error && <p className="note note-error">{c.error}</p>}
            </div>
            <button
              className="btn"
              onClick={() =>
                client
                  ?.send('POST', `/v1/connectors/${c.id}/enable`, { enabled: !c.enabled })
                  .then(load)
                  .catch(onProblem)
              }
            >
              {c.enabled ? 'Turn off' : 'Turn on'}
            </button>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await client?.send('DELETE', `/v1/connectors/${c.id}`)
                  await window.titan117.connectors.removeSecrets(c.id)
                  load()
                } catch (error) {
                  onProblem(error)
                }
              }}
            >
              Remove
            </button>
          </div>
          {c.tools.length > 0 && (
            <ul className="tool-list">
              {c.tools.map((t) => (
                <li key={t.name}>
                  <span className="mono">{t.name}</span>{' '}
                  <span className={`tag tag-risk-${t.risk}`}>{RISK_LABEL[t.risk]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {adding ? (
        <div className="row row-stack form">
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <div className="segmented" role="radiogroup" aria-label="Kind">
            <button
              className={form.kind === 'stdio' ? 'seg on' : 'seg'}
              aria-pressed={form.kind === 'stdio'}
              onClick={() => setForm({ ...form, kind: 'stdio' })}
            >
              A program on this laptop
            </button>
            <button
              className={form.kind === 'http' ? 'seg on' : 'seg'}
              aria-pressed={form.kind === 'http'}
              onClick={() => setForm({ ...form, kind: 'http' })}
            >
              An address
            </button>
          </div>
          {form.kind === 'stdio' ? (
            <>
              <label>
                Program
                <input
                  className="mono"
                  placeholder="npx"
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                />
              </label>
              <label>
                Arguments, one per line
                <textarea
                  className="mono"
                  rows={3}
                  placeholder={'-y\n@modelcontextprotocol/server-github'}
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                />
              </label>
            </>
          ) : (
            <label>
              Address
              <input
                className="mono"
                placeholder="https://mcp.example.com/mcp"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </label>
          )}
          <label>
            Secrets, one <span className="mono">NAME=value</span> per line (kept in the keychain
            {form.kind === 'http' ? '; TOKEN is sent as the bearer token' : ''})
            <textarea
              className="mono"
              rows={2}
              placeholder={form.kind === 'http' ? 'TOKEN=…' : 'GITHUB_PERSONAL_ACCESS_TOKEN=…'}
              value={form.secrets}
              onChange={(e) => setForm({ ...form, secrets: e.target.value })}
            />
          </label>
          <div className="approval-actions">
            <button
              className="btn btn-primary"
              disabled={
                !form.name.trim() ||
                (form.kind === 'stdio' ? !form.command.trim() : !form.url.trim())
              }
              onClick={() => void add()}
            >
              Connect
            </button>
            <button className="btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add a connector
        </button>
      )}
    </div>
  )
}
