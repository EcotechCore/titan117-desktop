/**
 * Web search settings (§16, decisions §44): where searches come from, the
 * language and country they're made in, the sites Titan should stick to or
 * avoid, and the user's own search keys.
 */
import { useEffect, useState } from 'react'

import type { EngineState, KeyProvider, SearchSettings, SearchSource } from '../../shared/protocol'
import type { EngineClient } from './engine'
import { OwnKeys } from './Keys'

const SOURCES: { id: SearchSource; label: string; note: string }[] = [
  {
    id: 'auto',
    label: 'Automatic',
    note: 'Your own search key if you added one, otherwise credits.'
  },
  {
    id: 'credits',
    label: 'Credits',
    note: 'OpenRouter’s web search (Exa) through your Titan117 credits: about 1 credit a search.'
  },
  { id: 'exa', label: 'Your Exa key', note: 'Billed to your Exa account.' },
  { id: 'tavily', label: 'Your Tavily key', note: 'Billed to your Tavily account.' },
  { id: 'brave', label: 'Your Brave key', note: 'Billed to your Brave account.' }
]

function lines(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function SearchView({
  client,
  engine,
  onKeysChanged,
  onProblem
}: {
  client: EngineClient | null
  engine: EngineState
  onKeysChanged(): void
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [settings, setSettings] = useState<SearchSettings | null>(null)
  const [only, setOnly] = useState('')
  const [blocked, setBlocked] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    client
      ?.get<{ settings: SearchSettings }>('/v1/search')
      .then(({ settings }) => {
        setSettings(settings)
        setOnly((settings.sites.Titan?.only ?? []).join('\n'))
        setBlocked((settings.sites.Titan?.blocked ?? []).join('\n'))
      })
      .catch(onProblem)
  }, [client, onProblem])

  if (!settings) return <div className="list-view" />

  async function save(next: SearchSettings): Promise<void> {
    try {
      const { settings: stored } = await client!.send<{ settings: SearchSettings }>(
        'PUT',
        '/v1/search',
        next
      )
      setSettings(stored)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (error) {
      onProblem(error)
    }
  }

  const withSites = (): SearchSettings => ({
    ...settings,
    sites: { ...settings.sites, Titan: { only: lines(only), blocked: lines(blocked) } }
  })

  return (
    <div className="list-view">
      <h1 className="view-title">Web search</h1>
      <p className="muted">
        Agents search the web when a task needs it, read the pages they find, and show the address
        of every fact. Searches are never made from your private files or memory.
      </p>

      <h2 className="section">Where searches come from</h2>
      {SOURCES.map((s) => (
        <label key={s.id} className="row choice">
          <input
            type="radio"
            name="source"
            checked={settings.source === s.id}
            onChange={() => void save({ ...withSites(), source: s.id })}
          />
          <span className="row-main">
            <span className="row-title">{s.label}</span>
            <span className="muted">{s.note}</span>
          </span>
        </label>
      ))}
      <p className="muted">
        You can also ask Titan to search in the browser, as you would; it stops at any CAPTCHA and
        hands over to you.
      </p>

      <h2 className="section">Language and country</h2>
      <div className="row">
        <label className="field">
          Country
          <input
            className="search short"
            maxLength={2}
            placeholder="RO"
            value={settings.country}
            onChange={(e) => setSettings({ ...settings, country: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="field">
          Language
          <input
            className="search short"
            maxLength={2}
            placeholder="ro"
            value={settings.language}
            onChange={(e) => setSettings({ ...settings, language: e.target.value.toLowerCase() })}
          />
        </label>
        <span className="muted">Two letters each, e.g. RO and ro. Empty for none.</span>
      </div>

      <h2 className="section">Titan’s sites</h2>
      <div className="sites">
        <label className="field">
          Only these sites (empty: any)
          <textarea
            rows={4}
            placeholder={'legislatie.just.ro\nanaf.ro'}
            value={only}
            onChange={(e) => setOnly(e.target.value)}
          />
        </label>
        <label className="field">
          Never these sites
          <textarea
            rows={4}
            placeholder="example.com"
            value={blocked}
            onChange={(e) => setBlocked(e.target.value)}
          />
        </label>
      </div>
      <div className="row-actions">
        <button className="btn btn-primary" onClick={() => void save(withSites())}>
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>

      <OwnKeys
        kind="search"
        saved={engine.ownKeys as Record<KeyProvider, boolean>}
        models={[]}
        model={null}
        onUse={() => undefined}
        onChanged={onKeysChanged}
      />
    </div>
  )
}
