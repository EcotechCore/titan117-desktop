// Your own servers over SSH (3.15; decisions §55): Titan may run commands
// only on servers added here, with your own SSH keys; each command follows
// the same approvals as on the laptop.
import { useEffect, useState } from 'react'

import type { EngineClient } from './engine'

interface Server {
  name: string
  target: string
  port?: number
}

export function ServersSection({
  client,
  onProblem
}: {
  client: EngineClient | null
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [servers, setServers] = useState<Server[]>([])
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [port, setPort] = useState('')

  useEffect(() => {
    let live = true
    client
      ?.get<{ servers: Server[] }>('/v1/code/servers')
      .then((r) => live && setServers(r.servers))
      .catch(onProblem)
    return () => {
      live = false
    }
  }, [client, onProblem])

  async function add(): Promise<void> {
    try {
      const r = await client!.send<{ servers: Server[] }>('POST', '/v1/code/servers', {
        name,
        target,
        ...(port ? { port: Number(port) } : {})
      })
      setServers(r.servers)
      setName('')
      setTarget('')
      setPort('')
    } catch (error) {
      onProblem(error)
    }
  }

  async function remove(server: string): Promise<void> {
    try {
      const r = await client!.send<{ servers: Server[] }>(
        'DELETE',
        `/v1/code/servers?name=${encodeURIComponent(server)}`
      )
      setServers(r.servers)
    } catch (error) {
      onProblem(error)
    }
  }

  return (
    <>
      <h2 className="section">Your servers</h2>
      <p className="muted">
        Titan can run commands on a server of yours over SSH, with your own SSH keys, only on the
        servers listed here. Each command asks first, as on this laptop. Connect to a new server
        once yourself in a terminal, so its host key is known.
      </p>
      {servers.map((s) => (
        <div key={s.name} className="row">
          <div className="row-main">
            <p className="row-title">{s.name}</p>
            <p className="muted">
              {s.target}
              {s.port ? `, port ${s.port}` : ''}
            </p>
          </div>
          <button className="btn" onClick={() => void remove(s.name)}>
            Remove
          </button>
        </div>
      ))}
      <div className="add-row">
        <input
          className="search"
          placeholder="Name (e.g. web server)"
          aria-label="Server name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="search"
          placeholder="user@host or an SSH config name"
          aria-label="Server address"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <input
          className="search short"
          placeholder="Port"
          aria-label="Port"
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
        />
        <button
          className="btn"
          disabled={!name.trim() || !target.trim()}
          onClick={() => void add()}
        >
          Add
        </button>
      </div>
    </>
  )
}
