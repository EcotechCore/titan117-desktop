/**
 * The engine's own network access. In phase 1 the engine talks to two hosts
 * only: OpenRouter (models) and Hugging Face (model downloads). Anything else
 * is refused. Tools get no network yet; the per-task network policy
 * (security.md A3) arrives with the browser and search tools.
 */
const ALLOWED_HOSTS = new Set(['openrouter.ai', 'huggingface.co'])

export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

export type Fetch = typeof fetch

export function engineFetch(base: Fetch = fetch): Fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname))
      throw new NetworkError(`The engine may not reach ${url.hostname}.`)
    return base(input, init)
  }
}
