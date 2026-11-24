// The Agents screen (features 4.2-4.4, decisions §59): the team in groups, a
// form over each agent's file, clone and edit, and the file itself under
// Advanced. Built-in agents can only be cloned (their models are a setting).
import { useEffect, useMemo, useState } from 'react'

import {
  CLOUD_MODEL_PREFIX,
  LOCAL_MODEL_PREFIX,
  TOOL_GROUPS,
  type AgentDef,
  type CloudModel,
  type EngineState,
  type Skill,
  type ToolGroup
} from '../../shared/protocol'
import type { EngineClient } from './engine'
import { modelName } from './format'
import { Icon } from './ui'
import { byTeam } from './agents-lib'

type Draft = {
  name: string
  role: string
  team: string
  color: string
  model: string
  fastModel: string
  tools: ToolGroup[]
  memory: 'shared' | 'own'
  manager: boolean
  alwaysAsk: string
  skills: string[]
  instructions: string
}

const EMPTY: Draft = {
  name: '',
  role: '',
  team: '',
  color: '#2f6fed',
  model: '',
  fastModel: '',
  tools: ['files', 'memory'],
  memory: 'shared',
  manager: false,
  alwaysAsk: '',
  skills: [],
  instructions: ''
}

function draftOf(a: AgentDef): Draft {
  return {
    name: a.name,
    role: a.role,
    team: a.team,
    color: a.color,
    model: a.model ?? '',
    fastModel: a.fastModel ?? '',
    tools: a.tools,
    memory: a.memory,
    manager: a.manager,
    alwaysAsk: a.alwaysAsk.join(', '),
    skills: a.skills,
    instructions: a.instructions
  }
}

function bodyOf(d: Draft): Record<string, unknown> {
  return {
    ...d,
    model: d.model || null,
    fastModel: d.fastModel || null,
    alwaysAsk: d.alwaysAsk
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

/** Models to pick from: the ready local ones and OpenRouter's list. */
function ModelPicker({
  label,
  value,
  onChange,
  engine,
  cloud,
  empty
}: {
  label: string
  value: string
  onChange(next: string): void
  engine: EngineState
  cloud: CloudModel[]
  empty: string
}): React.JSX.Element {
  const ready = engine.localModels.filter((m) => m.state === 'ready')
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{empty}</option>
        {value && !cloud.some((m) => CLOUD_MODEL_PREFIX + m.id === value) && (
          <option value={value}>{modelName(value, engine)}</option>
        )}
        {ready.map((m) => (
          <option key={m.id} value={LOCAL_MODEL_PREFIX + m.id}>
            {m.name} · local
          </option>
        ))}
        {cloud.map((m) => (
          <option key={m.id} value={CLOUD_MODEL_PREFIX + m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function AgentsView({
  client,
  engine,
  cloud,
  changed,
  onStart,
  onAutomate,
  onProblem
}: {
  client: EngineClient | null
  engine: EngineState
  cloud: CloudModel[]
  changed: number
  onStart(agent: string): void
  /** Open Automations to give this agent a schedule or a trigger (4.1). */
  onAutomate(agent: string): void
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [triggers, setTriggers] = useState<
    { id: string; name: string; whenText: string; enabled: boolean; agent: string }[]
  >([])
  const [skills, setSkills] = useState<Skill[]>([])
  // null: the list; 'new': a new agent; otherwise the agent being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [cloneName, setCloneName] = useState('')
  const [file, setFile] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (!client) return
    client
      .get<{ agents: AgentDef[] }>('/v1/agents')
      .then((r) => setAgents(r.agents))
      .catch(onProblem)
    client
      .get<{ skills: Skill[] }>('/v1/skills')
      .then((r) => setSkills(r.skills))
      .catch(() => undefined)
    // What starts this agent by itself: its schedules and triggers (4.1).
    client
      .get<{
        schedules: {
          id: string
          name: string
          whenText: string
          enabled: boolean
          action: { kind: string; agent?: string }
        }[]
      }>('/v1/automations')
      .then((r) =>
        setTriggers(
          r.schedules
            .filter((s) => s.action.kind === 'task' && s.action.agent)
            .map((s) => ({
              id: s.id,
              name: s.name,
              whenText: s.whenText,
              enabled: s.enabled,
              agent: s.action.agent!
            }))
        )
      )
      .catch(() => undefined)
  }, [client, changed, onProblem])

  const current = useMemo(
    () => (editing && editing !== 'new' ? (agents.find((a) => a.id === editing) ?? null) : null),
    [agents, editing]
  )
  const teams = useMemo(() => [...new Set(agents.map((a) => a.team).filter(Boolean))], [agents])
  const locked = !!current?.builtIn

  function open(id: string | 'new'): void {
    const a = agents.find((x) => x.id === id)
    setDraft(a ? draftOf(a) : EMPTY)
    setEditing(id)
    setFile(null)
    setCloneName('')
    setSaved(null)
  }

  async function save(): Promise<void> {
    if (!client) return
    try {
      const body = bodyOf(draft)
      const r =
        editing === 'new'
          ? await client.send<{ agent: AgentDef }>('POST', '/v1/agents', body)
          : await client.send<{ agent: AgentDef }>('PUT', `/v1/agents/${editing}`, body)
      setEditing(r.agent.id)
      setDraft(draftOf(r.agent))
      setSaved(`Saved ${r.agent.name}.`)
    } catch (error) {
      onProblem(error)
    }
  }

  async function clone(): Promise<void> {
    if (!client || !current) return
    try {
      const r = await client.send<{ agent: AgentDef }>('POST', `/v1/agents/${current.id}/clone`, {
        name: cloneName
      })
      setEditing(r.agent.id)
      setDraft(draftOf(r.agent))
      setCloneName('')
      setSaved(`Made ${r.agent.name}, a copy of ${current.name}. Change it as you like.`)
    } catch (error) {
      onProblem(error)
    }
  }

  async function remove(): Promise<void> {
    if (!client || !current) return
    if (!window.confirm(`Remove ${current.name}? Its memories and skills stay.`)) return
    try {
      await client.send('DELETE', `/v1/agents/${current.id}`)
      setEditing(null)
    } catch (error) {
      onProblem(error)
    }
  }

  async function showFile(): Promise<void> {
    if (!client || !current) return
    try {
      setFile((await client.get<{ text: string }>(`/v1/agents/${current.id}/file`)).text)
    } catch (error) {
      onProblem(error)
    }
  }

  async function saveFile(): Promise<void> {
    if (!client || !current || file === null) return
    try {
      const r = await client.send<{ agent: AgentDef }>('PUT', `/v1/agents/${current.id}/file`, {
        text: file
      })
      setDraft(draftOf(r.agent))
      setSaved('Saved the file.')
    } catch (error) {
      onProblem(error)
    }
  }

  if (editing === null) {
    const titan = agents.find((a) => a.builtIn && a.name === 'Titan')
    return (
      <div className="list-view">
        <div className="view-head">
          <div>
            <h1 className="view-title">Agents</h1>
            <p className="muted">
              Each agent has a role, the tools it may use and its own memory. Every action still
              asks you as usual. Ask Titan for an agent you don&apos;t have, or make one here.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => open('new')}>
            <Icon name="plus" /> New agent
          </button>
        </div>
        {[['', titan ? [titan] : []] as [string, AgentDef[]], ...byTeam(agents)].map(
          ([team, list]) =>
            list.length > 0 && (
              <section key={team || 'titan'}>
                {team && <p className="label">{team}</p>}
                {list.map((a) => (
                  <div key={a.id} className="row">
                    <span className="agent-dot" style={{ background: a.color }} />
                    <div className="row-main">
                      <p className="row-title">
                        {a.name}
                        {a.builtIn && <span className="tag">Built in</span>}
                        {a.manager && <span className="tag">Hands out work</span>}
                      </p>
                      <p className="muted">{a.role}</p>
                    </div>
                    <button className="btn" onClick={() => onStart(a.name)}>
                      Start a task
                    </button>
                    <button className="btn" onClick={() => open(a.id)}>
                      {a.builtIn ? 'Open' : 'Edit'}
                    </button>
                  </div>
                ))}
              </section>
            )
        )}
      </div>
    )
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }))

  return (
    <div className="list-view agent-form">
      <button className="link" onClick={() => setEditing(null)}>
        ← All agents
      </button>
      <h1 className="view-title">
        {editing === 'new' ? 'New agent' : draft.name}
        {locked && <span className="tag">Built in</span>}
      </h1>
      {locked && (
        <div className="note">
          <span>
            {current?.name} is built in, so it can&apos;t change (its models can). Clone it to make
            your own version.
          </span>
          <input
            className="search"
            placeholder="Name for the copy"
            aria-label="Name for the copy"
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={!cloneName.trim()}
            onClick={() => void clone()}
          >
            Clone
          </button>
        </div>
      )}
      {saved && (
        <p className="note" role="status">
          {saved}
        </p>
      )}

      <div className="agent-grid">
        <label className="field">
          Name
          <input
            value={draft.name}
            disabled={editing !== 'new'}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Invoice clerk"
          />
        </label>
        <label className="field">
          Team
          <input
            value={draft.team}
            disabled={locked}
            list="agent-teams"
            onChange={(e) => set('team', e.target.value)}
            placeholder="Finance"
          />
          <datalist id="agent-teams">
            {teams.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="field wide">
          What it does
          <input
            value={draft.role}
            disabled={locked}
            onChange={(e) => set('role', e.target.value)}
            placeholder="Reads invoices and totals them."
          />
        </label>
        <ModelPicker
          label="Model"
          value={draft.model}
          onChange={(v) => set('model', v)}
          engine={engine}
          cloud={cloud}
          empty="The one chosen for the task"
        />
        <ModelPicker
          label="Fast model for the steps (optional)"
          value={draft.fastModel}
          onChange={(v) => set('fastModel', v)}
          engine={engine}
          cloud={cloud}
          empty="None: the main model does every step"
        />
        <label className="field">
          Colour
          <input
            type="color"
            value={draft.color}
            disabled={locked}
            onChange={(e) => set('color', e.target.value)}
          />
        </label>
        <label className="field">
          Memory
          <select
            value={draft.memory}
            disabled={locked}
            onChange={(e) => set('memory', e.target.value === 'own' ? 'own' : 'shared')}
          >
            <option value="shared">Shared memory and its own</option>
            <option value="own">Only its own memory</option>
          </select>
        </label>
      </div>

      <p className="label">Tools it may use</p>
      <div className="agent-tools">
        {TOOL_GROUPS.map((g) => (
          <label key={g.id} className="choice">
            <input
              type="checkbox"
              disabled={locked}
              checked={draft.tools.includes(g.id)}
              onChange={(e) =>
                set(
                  'tools',
                  e.target.checked ? [...draft.tools, g.id] : draft.tools.filter((t) => t !== g.id)
                )
              }
            />
            {g.label}
          </label>
        ))}
        <label className="choice">
          <input
            type="checkbox"
            disabled={locked}
            checked={draft.manager}
            onChange={(e) => set('manager', e.target.checked)}
          />
          Hands parts of a task to other agents
        </label>
      </div>

      <label className="field">
        Tools that always ask first (names, separated by commas)
        <input
          value={draft.alwaysAsk}
          disabled={locked}
          onChange={(e) => set('alwaysAsk', e.target.value)}
          placeholder="read_file, web_fetch"
        />
      </label>

      {skills.length > 0 && (
        <>
          <p className="label">Skills it reads first</p>
          <div className="agent-tools">
            {skills.map((s) => (
              <label key={s.name} className="choice" title={s.description}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={draft.skills.includes(s.name)}
                  onChange={(e) =>
                    set(
                      'skills',
                      e.target.checked
                        ? [...draft.skills, s.name]
                        : draft.skills.filter((n) => n !== s.name)
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
        </>
      )}

      <label className="field">
        Instructions
        <textarea
          rows={8}
          value={draft.instructions}
          disabled={locked}
          onChange={(e) => set('instructions', e.target.value)}
          placeholder="How it works: what to check, what to avoid, how to answer."
        />
      </label>

      <div className="code-actions">
        <button className="btn btn-primary" onClick={() => void save()}>
          {editing === 'new' ? 'Make the agent' : locked ? 'Save its models' : 'Save'}
        </button>
        {current && !locked && (
          <button className="btn" onClick={() => void remove()}>
            Remove
          </button>
        )}
        {current && (
          <button className="btn" onClick={() => onStart(current.name)}>
            Start a task
          </button>
        )}
      </div>

      {current && (
        <>
          <h2 className="section">Runs by itself</h2>
          {triggers.filter((t) => t.agent === current.name).length === 0 && (
            <p className="muted">
              Only when you start a task. A schedule or a trigger (a new file in a folder) can start{' '}
              {current.name} for you.
            </p>
          )}
          {triggers
            .filter((t) => t.agent === current.name)
            .map((t) => (
              <div key={t.id} className="row">
                <div className="row-main">
                  <p className="row-title">{t.name}</p>
                  <p className="muted">
                    {t.whenText}
                    {t.enabled ? '' : ' · paused'}
                  </p>
                </div>
              </div>
            ))}
          <div className="row-actions">
            <button className="btn" onClick={() => onAutomate(current.name)}>
              Add a schedule or a trigger
            </button>
          </div>
        </>
      )}

      {current && (
        <details className="advanced" onToggle={(e) => e.currentTarget.open && void showFile()}>
          <summary>Advanced: the agent&apos;s file</summary>
          <textarea
            className="edit mono"
            rows={16}
            value={file ?? ''}
            readOnly={locked}
            aria-label="The agent's file"
            onChange={(e) => setFile(e.target.value)}
          />
          {!locked && (
            <button className="btn" onClick={() => void saveFile()}>
              Save the file
            </button>
          )}
        </details>
      )}
    </div>
  )
}
