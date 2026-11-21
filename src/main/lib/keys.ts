/**
 * The user's own API keys (features 2.9, 11.5, 16.3): OpenRouter, Anthropic,
 * OpenAI and Google for models; Exa, Tavily and Brave for web search; Cloudflare for publishing apps. Kept on this laptop only, encrypted by the OS keychain
 * (Electron's safeStorage); never sent to our servers (decisions §32) or to
 * the window. The engine receives them to call each provider directly.
 *
 * A key is tried once against its provider before it's saved, so a typo is
 * caught at once rather than in the middle of a task.
 */
import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { KEY_PROVIDERS, type KeyProvider } from '../../shared/protocol'

export interface Keychain {
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

/** Each provider's own check, from its docs (external-services.md, 15 Nov 2026). */
async function tryKey(provider: KeyProvider, key: string, fetchFn: typeof fetch): Promise<boolean> {
  if (provider === 'anthropic') {
    try {
      // The official SDK: the Models API answers only for a valid key.
      await new Anthropic({ apiKey: key, fetch: fetchFn, maxRetries: 0 }).models.list({ limit: 1 })
      return true
    } catch (error) {
      if (
        error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError
      )
        return false
      throw error
    }
  }
  // Cloudflare (6.15): its own token check, which changes nothing.
  if (provider === 'cloudflare') {
    const res = await fetchFn('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${key}` }
    })
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { result?: { status?: string } }
      return body.result?.status === 'active'
    }
    if ([400, 401, 403].includes(res.status)) return false
    throw new Error(`Cloudflare answered ${res.status}.`)
  }
  // Search keys (decisions §44): one small search, the only check these providers offer.
  if (provider === 'brave') {
    const res = await fetchFn('https://api.search.brave.com/res/v1/web/search?q=titan117&count=1', {
      headers: { 'X-Subscription-Token': key, Accept: 'application/json' }
    })
    if (res.ok) return true
    if ([400, 401, 403, 422].includes(res.status)) return false
    throw new Error(`The provider answered ${res.status}.`)
  }
  if (provider === 'tavily' || provider === 'exa') {
    const res =
      provider === 'tavily'
        ? await fetchFn('https://api.tavily.com/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'titan117', max_results: 1, search_depth: 'basic' })
          })
        : await fetchFn('https://api.exa.ai/search', {
            method: 'POST',
            headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'titan117', numResults: 1 })
          })
    if (res.ok) return true
    if ([400, 401, 403].includes(res.status)) return false
    throw new Error(`The provider answered ${res.status}.`)
  }
  const url = {
    openrouter: 'https://openrouter.ai/api/v1/key',
    openai: 'https://api.openai.com/v1/models',
    google: 'https://generativelanguage.googleapis.com/v1beta/openai/models'
  }[provider]
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${key}` } })
  if (res.ok) return true
  if (res.status === 400 || res.status === 401 || res.status === 403) return false
  throw new Error(`The provider answered ${res.status}.`)
}

export type SaveResult = { ok: true } | { ok: false; problem: string }

export class Keys {
  private readonly dir: string
  private readonly fetchFn: typeof fetch

  constructor(
    dataDir: string,
    private readonly keychain: Keychain | null,
    fetchFn?: typeof fetch
  ) {
    this.dir = join(dataDir, 'keys')
    this.fetchFn = fetchFn ?? fetch
  }

  /** Which providers have a key. Never the keys. */
  saved(): Record<KeyProvider, boolean> {
    let files: string[] = []
    try {
      files = readdirSync(this.dir)
    } catch {
      // No keys yet.
    }
    return Object.fromEntries(KEY_PROVIDERS.map((p) => [p, files.includes(`${p}.bin`)])) as Record<
      KeyProvider,
      boolean
    >
  }

  /** The keys themselves, for the engine only. A key the keychain can't read is skipped. */
  all(): Partial<Record<KeyProvider, string>> {
    if (!this.keychain) return {}
    const out: Partial<Record<KeyProvider, string>> = {}
    for (const provider of KEY_PROVIDERS) {
      try {
        out[provider] = this.keychain.decrypt(readFileSync(join(this.dir, `${provider}.bin`)))
      } catch {
        // Not saved, or saved under another OS user.
      }
    }
    return out
  }

  async save(provider: unknown, key: unknown): Promise<SaveResult> {
    if (!KEY_PROVIDERS.includes(provider as KeyProvider))
      return { ok: false, problem: 'Unknown provider.' }
    const p = provider as KeyProvider
    const clean = typeof key === 'string' ? key.trim() : ''
    if (clean.length < 20 || clean.length > 400 || /\s/.test(clean))
      return { ok: false, problem: 'That doesn’t look like an API key.' }
    if (!this.keychain)
      return {
        ok: false,
        problem: 'This computer has no keychain Titan117 can use to keep keys safe.'
      }
    try {
      if (!(await tryKey(p, clean, this.fetchFn)))
        return {
          ok: false,
          problem: 'The provider didn’t accept this key. Check it and try again.'
        }
    } catch {
      return {
        ok: false,
        problem: 'Couldn’t reach the provider to check the key. Try again when online.'
      }
    }
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, `${p}.bin`), this.keychain.encrypt(clean))
    return { ok: true }
  }

  remove(provider: unknown): boolean {
    if (!KEY_PROVIDERS.includes(provider as KeyProvider)) return false
    rmSync(join(this.dir, `${provider as KeyProvider}.bin`), { force: true })
    return true
  }
}
