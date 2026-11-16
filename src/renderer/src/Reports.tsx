/**
 * Error reports (features 19.2-19.8, decisions §22, §45): the report is shown
 * in full before anything leaves the laptop; the user adds a note and sends
 * it, or doesn't. Always ask, send automatically or never, changeable here.
 */
import { useEffect, useState } from 'react'

import type { QueuedReport, ReportMode } from '../../shared/protocol'
import type { EngineClient } from './engine'
import { Icon } from './ui'

const MODES: { id: ReportMode; label: string }[] = [
  { id: 'ask', label: 'Always ask' },
  { id: 'auto', label: 'Send automatically' },
  { id: 'never', label: 'Never ask' }
]

export function ReportDialog({
  client,
  errorRef,
  feature,
  onClose,
  onProblem
}: {
  client: EngineClient
  /** A caught error's id (or its first 8 characters); none for "Report a problem". */
  errorRef?: string
  feature?: string
  onClose(): void
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<QueuedReport | null>(null)
  const [note, setNote] = useState('')
  const [result, setResult] = useState<QueuedReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<ReportMode>('ask')
  const [mine, setMine] = useState<QueuedReport[]>([])

  useEffect(() => {
    let live = true
    client
      .send<{ report: QueuedReport }>('POST', '/v1/reports', { errorRef, feature })
      .then((r) => live && setDraft(r.report))
      .catch(onProblem)
    client
      .get<{ mode: ReportMode; reports: QueuedReport[] }>('/v1/reports')
      .then((r) => {
        if (!live) return
        setMode(r.mode)
        setMine(r.reports)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, errorRef, feature, onProblem])

  async function send(): Promise<void> {
    if (!draft) return
    setBusy(true)
    try {
      const { report } = await client.send<{ report: QueuedReport }>(
        'POST',
        `/v1/reports/${draft.id}/send`,
        { note }
      )
      setResult(report)
    } catch (error) {
      onProblem(error)
    } finally {
      setBusy(false)
    }
  }

  function cancel(): void {
    if (draft && !result)
      void client.send('DELETE', `/v1/reports/${draft.id}`).catch(() => undefined)
    onClose()
  }

  async function chooseMode(next: ReportMode): Promise<void> {
    try {
      await client.send('PUT', '/v1/reports', { mode: next })
      setMode(next)
    } catch (error) {
      onProblem(error)
    }
  }

  const r = draft?.report
  return (
    <div
      className="modal-back"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && cancel()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <header className="modal-head">
          <h2 id="report-title">{errorRef ? 'Something went wrong' : 'Report a problem'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={cancel}>
            <Icon name="x" />
          </button>
        </header>

        {result ? (
          <div className="modal-body">
            {result.status === 'sent' ? (
              <p>
                Thank you. Your report&apos;s reference is{' '}
                <strong className="mono">{result.ref}</strong>. Quote it if you write to support;
                the app tells you when a release fixes it.
              </p>
            ) : (
              <p>
                {result.problem ?? 'Your report is waiting to be sent.'} Nothing else is needed from
                you.
              </p>
            )}
            <div className="row-actions">
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <p className="muted">
              This is everything the report holds. Nothing leaves this laptop until you press Send.
              It never includes your files, prompts, memory, keys or passwords.
            </p>
            <label className="field">
              What happened? (optional)
              <textarea
                rows={3}
                value={note}
                maxLength={4000}
                placeholder="What you were doing, and what you expected"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {!r ? (
              <p className="empty">Putting the report together…</p>
            ) : (
              <dl className="report">
                <dt>App</dt>
                <dd className="mono">Titan117 {r.appVersion}</dd>
                <dt>System</dt>
                <dd className="mono">{r.os}</dd>
                <dt>Where</dt>
                <dd>{r.feature}</dd>
                {r.message && (
                  <>
                    <dt>Error</dt>
                    <dd>{r.message}</dd>
                  </>
                )}
                {r.stack && (
                  <>
                    <dt>Stack trace</dt>
                    <dd>
                      <pre>{r.stack}</pre>
                    </dd>
                  </>
                )}
                <dt>Last log lines ({r.logLines.length})</dt>
                <dd>
                  <pre>{r.logLines.join('\n') || '(none)'}</pre>
                </dd>
              </dl>
            )}
            <div className="row-actions">
              <button
                className="btn btn-primary"
                disabled={!draft || busy}
                onClick={() => void send()}
              >
                {busy ? 'Sending…' : 'Send report'}
              </button>
              <button className="btn" onClick={cancel}>
                Don&apos;t send
              </button>
            </div>
            <div className="report-mode" role="radiogroup" aria-label="When something goes wrong">
              <span className="muted">When something goes wrong:</span>
              {MODES.map((m) => (
                <label key={m.id}>
                  <input
                    type="radio"
                    name="report-mode"
                    checked={mode === m.id}
                    onChange={() => void chooseMode(m.id)}
                  />{' '}
                  {m.label}
                </label>
              ))}
            </div>
            {mine.length > 0 && (
              <details className="report-history">
                <summary>Your reports ({mine.length})</summary>
                <ul>
                  {mine.map((q) => (
                    <li key={q.id}>
                      <span className="mono">{q.ref ?? 'waiting'}</span> · {q.report.feature}
                      {q.fixedIn && <span className="pill"> Fixed in {q.fixedIn}</span>}
                      {q.status === 'queued' && q.problem && (
                        <span className="muted"> · {q.problem}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
