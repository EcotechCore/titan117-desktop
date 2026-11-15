/**
 * The engine's own network access: OpenRouter (models), Hugging Face (model
 * downloads) and our credits proxy, whose exact origin the shell configures
 * (decisions §39). Anything else is refused. Tools get no network yet; the per-task network policy
 * (security.md A3) arrives with the browser and search tools.
 */
const ALLOWED_HOSTS = new Set([
  'openrouter.ai',
  'huggingface.co',
  // The user's own API keys (features 2.9, 11.5), straight to each provider.
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  // Search with the user's own key (feature 16.3, decisions §44).
  'api.search.brave.com',
  'api.tavily.com',
  'api.exa.ai'
])

export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

export type Fetch = typeof fetch

export function engineFetch(base: Fetch = fetch, extraOrigins: () => string[] = () => []): Fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (extraOrigins().includes(url.origin)) return base(input, init)
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname))
      throw new NetworkError(`The engine may not reach ${url.hostname}.`)
    return base(input, init)
  }
}
