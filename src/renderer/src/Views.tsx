// The list views: approvals waiting for you, and models (design.md §6, Lists).
import { useState } from 'react'

import { OwnKeys } from './Keys'

import {
  CLOUD_MODEL_PREFIX,
  LOCAL_MODEL_PREFIX,
  type Approval,
  type ApprovalAnswer,
  type CloudModel,
  type EngineState,
  type OwnKeyModel,
  type Task
} from '../../shared/protocol'
import { bytes } from './format'
import { Icon } from './ui'

export function ApprovalsView({
  approvals,
  tasks,
  onAnswer,
  onOpen
}: {
  approvals: Approval[]
  tasks: Task[]
  onAnswer(id: string, answer: ApprovalAnswer): void
  onOpen(taskId: string): void
}): React.JSX.Element {
  return (
    <div className="list-view">
      <h1 className="view-title">Approvals</h1>
      <p className="muted">
        Titan asks before it changes anything. Nothing here runs until you say so.
      </p>
      {approvals.length === 0 && <p className="empty">Nothing is waiting for you.</p>}
      {approvals.map((approval) => (
        <div key={approval.id} className="row row-tint">
          <span className="row-icon">
            <Icon name="shield" />
          </span>
          <div className="row-main">
            <p className="row-title">{approval.summary}</p>
            <p className="muted">
              {tasks.find((t) => t.id === approval.taskId)?.title ?? 'Task'} ·{' '}
              <button className="link" onClick={() => onOpen(approval.taskId)}>
                Open the task
              </button>
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => onAnswer(approval.id, 'approve')}>
            Approve
          </button>
          <button className="btn" onClick={() => onAnswer(approval.id, 'deny')}>
            Deny
          </button>
        </div>
      ))}
    </div>
  )
}

export function ModelsView({
  engine,
  cloud,
  own,
  model,
  onUse,
  onDownload,
  onCancel,
  onRemove,
  onKeysChanged
}: {
  engine: EngineState
  cloud: CloudModel[]
  own: OwnKeyModel[]
  onKeysChanged(): void
  model: string | null
  onUse(model: string): void
  onDownload(id: string): void
  onCancel(id: string): void
  onRemove(id: string): void
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const { hardware } = engine
  const found = cloud
    .filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 40)

  return (
    <div className="list-view">
      <h1 className="view-title">Models</h1>

      <h2 className="section">On this laptop</h2>
      <p className="muted">
        Free, private, and they work with no internet once downloaded. This laptop:{' '}
        {bytes(hardware.ramBytes)} memory
        {engine.localProblem
          ? ''
          : engine.localChecking
            ? ', checking the graphics card…'
            : hardware.gpu
              ? `, ${hardware.gpu} with ${bytes(hardware.vramBytes)}`
              : ', no graphics card found'}
        .
      </p>
      {engine.localProblem && (
        <p className="note note-error" role="alert">
          {engine.localProblem}
        </p>
      )}
      {engine.localModels.map((m) => {
        const id = LOCAL_MODEL_PREFIX + m.id
        return (
          <div key={m.id} className="row">
            <span className="row-icon">
              <Icon name="chip" />
            </span>
            <div className="row-main">
              <p className="row-title">
                {m.name}
                <span className={`tag tag-${m.fit.replace(/ /g, '-')}`}>{m.fit}</span>
                {model === id && <span className="tag">In use</span>}
              </p>
              <p className="muted">
                {m.note} {bytes(m.sizeBytes)} · {m.licence}
              </p>
              {m.state === 'downloading' && (
                <p className="download">
                  <progress value={m.downloadedBytes} max={m.sizeBytes} />
                  <span className="mono">
                    {bytes(m.downloadedBytes)} of {bytes(m.sizeBytes)}
                  </span>
                </p>
              )}
            </div>
            {m.state === 'not downloaded' && (
              <button
                className="btn btn-primary"
                disabled={m.fit === 'too big' || !!engine.localProblem}
                onClick={() => onDownload(m.id)}
              >
                Download
              </button>
            )}
            {m.state === 'downloading' && (
              <button className="btn" onClick={() => onCancel(m.id)}>
                Cancel
              </button>
            )}
            {m.state === 'ready' && (
              <>
                {model !== id && (
                  <button className="btn btn-primary" onClick={() => onUse(id)}>
                    Use
                  </button>
                )}
                <button className="btn" onClick={() => onRemove(m.id)}>
                  Remove
                </button>
              </>
            )}
          </div>
        )
      })}

      <h2 className="section">Cloud, through OpenRouter</h2>
      {engine.cloudVia === 'own' ? (
        <p className="muted">
          Cloud models use your own OpenRouter key, billed by OpenRouter, not in credits.
        </p>
      ) : engine.cloudVia === 'credits' ? (
        <p className="muted">
          Cloud models use your credits: OpenRouter&apos;s price plus 25%, one credit per cent. The
          cost of each step is shown before you send, at OpenRouter&apos;s own prices.
        </p>
      ) : engine.cloudVia === 'dev' ? (
        <p className="muted">
          A development key from the local <span className="mono">.env</span> is in use (running
          from source). Prices are OpenRouter&apos;s own, per million tokens.
        </p>
      ) : (
        <p className="muted">Sign in to use cloud models with your credits.</p>
      )}
      <input
        className="search"
        type="search"
        placeholder="Search cloud models"
        aria-label="Search cloud models"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {cloud.length === 0 && (
        <p className="empty">The model list could not be loaded. Check the internet connection.</p>
      )}
      {found.map((m) => {
        const id = CLOUD_MODEL_PREFIX + m.id
        return (
          <div key={m.id} className="row">
            <div className="row-main">
              <p className="row-title">
                {m.name}
                {model === id && <span className="tag">In use</span>}
              </p>
              <p className="muted mono">
                {m.id} · ${m.inputPerMillion.toFixed(2)} in · ${m.outputPerMillion.toFixed(2)} out
              </p>
            </div>
            {model !== id && (
              <button className="btn" disabled={!engine.cloudKey} onClick={() => onUse(id)}>
                Use
              </button>
            )}
          </div>
        )
      })}

      <OwnKeys
        saved={engine.ownKeys}
        models={own}
        model={model}
        onUse={onUse}
        onChanged={onKeysChanged}
      />
    </div>
  )
}
