/**
 * Your own API keys (features 2.9, 11.5), in the Models view. A key is typed
 * here once, checked with its provider and kept by the shell in the OS
 * keychain; it never comes back to this page. Calls with it go straight to
 * the provider and are billed there, not in credits.
 */
import { useState } from 'react'

import type { KeyProvider, OwnKeyModel } from '../../shared/protocol'

const PROVIDERS: {
  id: KeyProvider
  name: string
  where: string
  note: string
  kind?: 'search'
}[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    where: 'openrouter.ai/keys',
    note: 'Cloud models from the list above use this key instead of your credits.'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    where: 'console.anthropic.com',
    note: 'Claude, straight from Anthropic.'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    where: 'platform.openai.com/api-keys',
    note: 'GPT models, straight from OpenAI.'
  },
  {
    id: 'google',
    name: 'Google',
    where: 'aistudio.google.com',
    note: 'Gemini. In the EU, UK and Switzerland Google requires billing turned on for the key’s project.'
  },
  {
    id: 'exa',
    name: 'Exa',
    where: 'dashboard.exa.ai',
    note: 'Search made for AI, with the most relevant passages of each page.',
    kind: 'search'
  },
  {
    id: 'tavily',
    name: 'Tavily',
    where: 'app.tavily.com',
    note: 'Search made for AI agents; a free monthly allowance.',
    kind: 'search'
  },
  {
    id: 'brave',
    name: 'Brave Search',
    where: 'api-dashboard.search.brave.com',
    note: 'An independent web index. Its results are never cached, as Brave’s terms ask.',
    kind: 'search'
  }
]

export function OwnKeys({
  saved,
  models,
  model,
  onUse,
  onChanged,
  kind = 'models'
}: {
  /** Model keys (the Models view) or search keys (Web search). */
  kind?: 'models' | 'search'
  saved: Record<KeyProvider, boolean>
  models: OwnKeyModel[]
  model: string | null
  onUse(model: string): void
  onChanged(): void
}): React.JSX.Element {
  const [editing, setEditing] = useState<KeyProvider | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  /** Opens (or closes) one provider's form, always empty. */
  function open(provider: KeyProvider | null): void {
    setEditing(provider)
    setValue('')
    setProblem(null)
  }

  async function save(provider: KeyProvider): Promise<void> {
    setBusy(true)
    setProblem(null)
    const result = await window.titan117.keys.save(provider, value)
    setBusy(false)
    if (result.ok) {
      open(null)
      onChanged()
    } else setProblem(result.problem)
  }

  async function remove(provider: KeyProvider, name: string): Promise<void> {
    if (!window.confirm(`Remove your ${name} key from this computer?`)) return
    await window.titan117.keys.remove(provider)
    onChanged()
  }

  return (
    <>
      <h2 className="section">
        {kind === 'search' ? 'Your own search keys' : 'Your own API keys'}
      </h2>
      <p className="muted">
        Optional. Calls with your own key go straight to the provider and are billed by them, not in
        credits. Keys stay on this computer, in its keychain, and are never sent to Titan117.
      </p>
      {PROVIDERS.filter((p) => (p.kind ?? 'models') === kind).map((p) => (
        <div key={p.id} className="row key-row">
          <div className="row-main">
            <p className="row-title">
              {p.name}
              {saved[p.id] && <span className="tag">Key saved</span>}
            </p>
            <p className="muted">{p.note}</p>
            {editing === p.id && (
              <form
                className="key-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void save(p.id)
                }}
              >
                <input
                  className="search"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={`Paste your ${p.name} API key (from ${p.where})`}
                  aria-label={`${p.name} API key`}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus
                />
                <button className="btn btn-primary" disabled={busy || !value.trim()}>
                  {busy ? 'Checking…' : 'Save'}
                </button>
                <button type="button" className="btn" onClick={() => open(null)}>
                  Cancel
                </button>
                {problem && (
                  <p className="key-problem" role="alert">
                    {problem}
                  </p>
                )}
              </form>
            )}
          </div>
          {editing !== p.id &&
            (saved[p.id] ? (
              <>
                <button className="btn" onClick={() => open(p.id)}>
                  Replace
                </button>
                <button className="btn" onClick={() => void remove(p.id, p.name)}>
                  Remove
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => open(p.id)}>
                Add key
              </button>
            ))}
        </div>
      ))}

      {models.length > 0 && (
        <>
          <h2 className="section">Models with your keys</h2>
          {models.slice(0, 60).map((m) => (
            <div key={m.id} className="row">
              <div className="row-main">
                <p className="row-title">
                  {m.name}
                  {model === m.id && <span className="tag">In use</span>}
                </p>
                <p className="muted mono">
                  {m.id} · billed to your {PROVIDERS.find((p) => p.id === m.provider)?.name} key
                </p>
              </div>
              {model !== m.id && (
                <button className="btn" onClick={() => onUse(m.id)}>
                  Use
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </>
  )
}
