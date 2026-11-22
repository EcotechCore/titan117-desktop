// Compare models side by side (feature 2.8, decisions §59.8): one prompt on
// up to four models, no tools, each answer with its time and cost. The
// estimated cost shows before anything is sent; nothing is kept.
import { useEffect, useState } from 'react'

import {
  CLOUD_MODEL_PREFIX,
  LOCAL_MODEL_PREFIX,
  type CloudModel,
  type EngineState,
  type Estimate
} from '../../shared/protocol'
import type { EngineClient } from './engine'
import { modelName, usd } from './format'
import { Icon } from './ui'

interface Result {
  model: string
  text: string
  ms: number
  costUsd: number
  via: string | null
  error: string | null
}

export function CompareView({
  client,
  engine,
  cloud,
  model,
  onProblem
}: {
  client: EngineClient | null
  engine: EngineState
  cloud: CloudModel[]
  model: string | null
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [models, setModels] = useState<string[]>(() => [model ?? '', ''])
  const [estimates, setEstimates] = useState<Record<string, Estimate | null>>({})
  const [results, setResults] = useState<Result[] | null>(null)
  const [running, setRunning] = useState(false)
  const ready = engine.localModels.filter((m) => m.state === 'ready')
  const chosen = models.filter(Boolean)

  // The cost shows first (2.5).
  useEffect(() => {
    if (!client) return
    const timer = setTimeout(() => {
      for (const m of chosen)
        client
          .send<Estimate>('POST', '/v1/estimate', { model: m, text: prompt })
          .then((e) => setEstimates((all) => ({ ...all, [m]: e })))
          .catch(() => setEstimates((all) => ({ ...all, [m]: null })))
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, prompt, chosen.join('|')])

  async function run(): Promise<void> {
    if (!client) return
    setRunning(true)
    setResults(null)
    try {
      const r = await client.send<{ results: Result[] }>('POST', '/v1/compare', {
        prompt,
        models: [...new Set(chosen)]
      })
      setResults(r.results)
    } catch (error) {
      onProblem(error)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="list-view">
      <h1 className="view-title">Compare models</h1>
      <p className="muted">
        The same prompt on up to four models, side by side, without tools. Nothing is kept. Cloud
        models get the prompt; local ones run on this laptop for free.
      </p>
      <label className="field">
        Prompt
        <textarea
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Write a two-line reply to a customer asking for a discount."
        />
      </label>
      <div className="compare-models">
        {models.map((m, i) => (
          <label key={i} className="field">
            Model {i + 1}
            <select
              value={m}
              onChange={(e) => setModels(models.map((x, j) => (j === i ? e.target.value : x)))}
            >
              <option value="">Choose a model</option>
              {m && !cloud.some((c) => CLOUD_MODEL_PREFIX + c.id === m) && (
                <option value={m}>{modelName(m, engine)}</option>
              )}
              {ready.map((r) => (
                <option key={r.id} value={LOCAL_MODEL_PREFIX + r.id}>
                  {r.name} · local
                </option>
              ))}
              {cloud.map((c) => (
                <option key={c.id} value={CLOUD_MODEL_PREFIX + c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="cost mono">{m && estimates[m] ? estimates[m]!.label : ''}</span>
          </label>
        ))}
      </div>
      <div className="code-actions">
        {models.length < 4 && (
          <button className="btn" onClick={() => setModels([...models, ''])}>
            <Icon name="plus" /> Another model
          </button>
        )}
        <button
          className="btn btn-primary"
          disabled={running || !prompt.trim() || new Set(chosen).size < 2}
          onClick={() => void run()}
        >
          {running ? 'Asking…' : 'Compare'}
        </button>
      </div>
      {results && (
        <div
          className="compare-grid"
          style={{ gridTemplateColumns: `repeat(${results.length}, 1fr)` }}
        >
          {results.map((r) => (
            <section key={r.model} className="compare-cell">
              <p className="row-title">{modelName(r.model, engine)}</p>
              <p className="muted mono">
                {(r.ms / 1000).toFixed(1)} s · {r.costUsd > 0 ? usd(r.costUsd) : 'free'}
                {r.via ? ` · ${r.via}` : ''}
              </p>
              {r.error ? (
                <p className="note note-error">{r.error}</p>
              ) : (
                <div className="compare-text">{r.text}</div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
