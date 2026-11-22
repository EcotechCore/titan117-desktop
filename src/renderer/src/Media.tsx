// Images and video (feature 2.7, decisions §59.10): which OpenRouter models
// agents use for them. Empty means the app picks a common one.
import { useEffect, useState } from 'react'

import type { EngineClient } from './engine'

interface MediaState {
  image: string | null
  video: string | null
  images: { id: string; name: string }[]
  videos: { id: string; name: string }[]
}

export function MediaModelsView({
  client,
  onProblem
}: {
  client: EngineClient | null
  onProblem(error: unknown): void
}): React.JSX.Element | null {
  const [state, setState] = useState<MediaState | null>(null)

  useEffect(() => {
    if (!client) return
    client
      .get<MediaState>('/v1/media')
      .then(setState)
      .catch(() => setState(null))
  }, [client])

  if (!state) return null

  function choose(kind: 'image' | 'video', value: string): void {
    if (!client || !state) return
    const next = { image: state.image, video: state.video, [kind]: value || null }
    client.send<MediaState>('PUT', '/v1/media', next).then(setState).catch(onProblem)
  }

  return (
    <div className="list-view">
      <h2 className="view-title">Images and video</h2>
      <p className="muted">
        When an agent makes an image or a video clip, it uses these OpenRouter models, paid with
        your credits or your own OpenRouter key. Each one asks you first; a video asks every time.
      </p>
      <div className="compare-models">
        {(['image', 'video'] as const).map((kind) => (
          <label key={kind} className="field">
            {kind === 'image' ? 'Images' : 'Video'}
            <select value={state[kind] ?? ''} onChange={(e) => choose(kind, e.target.value)}>
              <option value="">A common one, chosen for you</option>
              {(kind === 'image' ? state.images : state.videos).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}
