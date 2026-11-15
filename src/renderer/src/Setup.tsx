/**
 * Setup (features 1.4, 1.12, 1.13, 1.20, 1.21): the first-launch wizard, and
 * the Setup page with this laptop's hardware, what's ready and missing for
 * what the user wants to do, a health check, and what takes disk space.
 */
import { useEffect, useState } from 'react'

import type { SetupCheck, SetupInterest, SetupState } from '../../shared/protocol'
import type { EngineClient } from './engine'
import { Eyes } from './ui'

const GB = 1024 ** 3
function size(bytes: number | null): string {
  if (bytes === null) return 'unknown'
  return bytes >= GB
    ? `${(bytes / GB).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

const INTERESTS: { id: SetupInterest; label: string; note: string }[] = [
  { id: 'everyday', label: 'Everyday tasks', note: 'Files, emails, small jobs on this laptop' },
  { id: 'documents', label: 'My documents', note: 'Questions about contracts, invoices, reports' },
  { id: 'research', label: 'Research the web', note: 'Reports with sources, competitors, rules' },
  { id: 'apps', label: 'Build apps and sites', note: 'Web, mobile and desktop apps' },
  { id: 'marketing', label: 'Marketing', note: 'Posts, newsletters, campaigns' }
]

const ORDER: Record<SetupCheck['status'], number> = {
  problem: 0,
  missing: 1,
  suggested: 2,
  ready: 3
}
const LABEL: Record<SetupCheck['status'], string> = {
  problem: 'Needs fixing',
  missing: 'Missing',
  suggested: 'Suggested',
  ready: 'Ready'
}

export type FixHandler = (fix: NonNullable<SetupCheck['fix']>) => void

function Hardware({ state }: { state: SetupState }): React.JSX.Element {
  const h = state.hardware
  return (
    <dl className="facts hw">
      <dt>System</dt>
      <dd>{h.os}</dd>
      <dt>Processor</dt>
      <dd>
        {h.cpu} · {h.cores} cores
      </dd>
      <dt>Memory</dt>
      <dd>{size(h.ramBytes)}</dd>
      <dt>Graphics</dt>
      <dd>
        {h.gpu ? `${h.gpu}${h.vramBytes ? ` · ${size(h.vramBytes)}` : ''}` : 'Not used for models'}
      </dd>
      <dt>Disk</dt>
      <dd>
        {h.diskFreeBytes === null
          ? 'unknown'
          : `${size(h.diskFreeBytes)} free of ${size(h.diskTotalBytes)}`}
      </dd>
    </dl>
  )
}

function Checks({ checks, onFix }: { checks: SetupCheck[]; onFix: FixHandler }): React.JSX.Element {
  const sorted = [...checks].sort((a, b) => ORDER[a.status] - ORDER[b.status])
  return (
    <>
      {sorted.map((c) => (
        <div key={c.id} className={c.status === 'problem' ? 'row row-tint' : 'row'}>
          <span className={`check check-${c.status}`} aria-label={LABEL[c.status]} />
          <div className="row-main">
            <p className="row-title">
              {c.title}
              <span className="tag">{c.area}</span>
            </p>
            {c.detail && <p className="muted">{c.detail}</p>}
          </div>
          {c.fix && (
            <button
              className={c.status === 'ready' ? 'btn' : 'btn btn-primary'}
              onClick={() => onFix(c.fix!)}
            >
              {c.fix.label}
            </button>
          )}
        </div>
      ))}
    </>
  )
}

export function SetupView({
  client,
  changed,
  onFix,
  onProblem
}: {
  client: EngineClient | null
  changed: number
  onFix: FixHandler
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [state, setState] = useState<SetupState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    client
      ?.get<SetupState>('/v1/setup')
      .then((s) => live && setState(s))
      .catch(onProblem)
    return () => {
      live = false
    }
  }, [client, changed, onProblem])

  async function health(): Promise<void> {
    setBusy(true)
    try {
      setState(await client!.send<SetupState>('POST', '/v1/setup/health'))
    } catch (error) {
      onProblem(error)
    } finally {
      setBusy(false)
    }
  }

  async function toggle(id: SetupInterest): Promise<void> {
    if (!state) return
    const interests = state.interests.includes(id)
      ? state.interests.filter((i) => i !== id)
      : [...state.interests, id]
    try {
      setState(await client!.send<SetupState>('PUT', '/v1/setup', { interests }))
    } catch (error) {
      onProblem(error)
    }
  }

  if (!state) return <div className="list-view" />
  const open = state.checks.filter((c) => c.status !== 'ready').length

  return (
    <div className="list-view">
      <h1 className="view-title">Setup</h1>
      <p className="muted">
        What’s ready on this laptop, what’s missing for what you want to do, and what to fix.{' '}
        {open ? `${open} thing${open === 1 ? '' : 's'} to look at.` : 'Everything is ready.'}
      </p>
      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void health()}>
          {busy ? 'Checking…' : 'Run a health check'}
        </button>
        {state.checkedAt && (
          <span className="muted">
            Last checked {new Date(state.checkedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <h2 className="section">Checklist</h2>
      <Checks checks={state.checks} onFix={onFix} />

      <h2 className="section">What you use Titan117 for</h2>
      <div className="interests">
        {INTERESTS.map((i) => (
          <label key={i.id} className={state.interests.includes(i.id) ? 'interest on' : 'interest'}>
            <input
              type="checkbox"
              checked={state.interests.includes(i.id)}
              onChange={() => void toggle(i.id)}
            />
            <span>
              <strong>{i.label}</strong>
              <span className="muted"> · {i.note}</span>
            </span>
          </label>
        ))}
      </div>

      <h2 className="section">This laptop</h2>
      <Hardware state={state} />

      {state.components.length > 0 && (
        <>
          <h2 className="section">Disk space used by Titan117</h2>
          {state.components.map((c) => (
            <div key={c.id} className="row">
              <div className="row-main">
                <p className="row-title">{c.name}</p>
              </div>
              <span className="mono">{size(c.bytes)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/** First launch (1.12): sign in, this laptop, what you want to do. Skippable at every step. */
export function SetupWizard({
  client,
  signedIn,
  onFix,
  onDone,
  onProblem
}: {
  client: EngineClient
  signedIn: boolean
  onFix: FixHandler
  onDone(): void
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<SetupState | null>(null)
  const [interests, setInterests] = useState<SetupInterest[]>([])

  useEffect(() => {
    client.get<SetupState>('/v1/setup').then(setState).catch(onProblem)
  }, [client, onProblem])

  async function finish(): Promise<void> {
    try {
      await client.send('PUT', '/v1/setup', { interests, done: true })
      onDone()
    } catch (error) {
      onProblem(error)
    }
  }

  const local = state?.checks.find((c) => c.id === 'local')
  return (
    <div className="modal-back">
      <div className="modal wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
        <div className="modal-body">
          <Eyes state="working" size="large" />
          {step === 0 && (
            <>
              <h2 id="wizard-title">Welcome to Titan117</h2>
              <p className="muted">
                Your AI team works on this laptop. Three short steps: your account, what this laptop
                can do, and what you want to do first. You can skip any of them.
              </p>
              {signedIn ? (
                <p>You’re signed in.</p>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => onFix({ kind: 'account', label: 'Sign in' })}
                >
                  Sign in in your browser
                </button>
              )}
            </>
          )}
          {step === 1 && state && (
            <>
              <h2 id="wizard-title">This laptop</h2>
              <Hardware state={state} />
              {local && (
                <p className={local.status === 'ready' ? '' : 'muted'}>
                  {local.detail || local.title}
                </p>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <h2 id="wizard-title">What do you want to do first?</h2>
              <p className="muted">
                Titan117 prepares only what these need. You can change this in Setup.
              </p>
              <div className="interests">
                {INTERESTS.map((i) => (
                  <label
                    key={i.id}
                    className={interests.includes(i.id) ? 'interest on' : 'interest'}
                  >
                    <input
                      type="checkbox"
                      checked={interests.includes(i.id)}
                      onChange={() =>
                        setInterests((list) =>
                          list.includes(i.id) ? list.filter((x) => x !== i.id) : [...list, i.id]
                        )
                      }
                    />
                    <span>
                      <strong>{i.label}</strong>
                      <span className="muted"> · {i.note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="row-actions wizard-actions">
            <button className="btn" onClick={() => void finish()}>
              Skip setup
            </button>
            <span className="muted">Step {step + 1} of 3</span>
            {step < 2 ? (
              <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
                Next
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void finish()}>
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
