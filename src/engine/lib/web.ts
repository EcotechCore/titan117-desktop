/**
 * The network policy per task (security.md A3, guardrails §5). Every request
 * a tool makes (a page it opens, a browser's requests, a connector) passes
 * through here:
 *
 *   - the task has a site list: the sites the user's message names, the
 *     tools' own hosts, and sites the user allowed;
 *   - a new site is added quietly while the task has read nothing private;
 *     once it has, a new site waits for the user's OK;
 *   - a request carrying a passage of something private (in its address,
 *     form fields or upload) is blocked, whatever site it goes to.
 */
import type { TaskPrivacy } from '../privacy'
import { PermissionError } from './folders'

export type Ask = (input: {
  summary: string
  /** What the approval is for, shown in the activity log. */
  tool: string
}) => Promise<'once' | 'always' | 'deny'>

export interface TaskNet {
  /**
   * Check one request. `navigate` is a page the task opens itself (asks for a
   * new site when the task is private); `resource` is what a page loads on
   * its own (images, scripts), allowed unless it carries private content.
   */
  check(url: string, body: string | null, kind: 'navigate' | 'resource'): Promise<void>
  /** Fetch through the policy, following at most 5 redirects, each checked. */
  fetch(url: string, init?: RequestInit): Promise<Response>
  sites(): string[]
}

export interface SiteStore {
  has(taskId: string, host: string): boolean
  add(taskId: string, host: string): void
  list(taskId: string): string[]
}

/** Hosts in a message the user wrote: the sites the task is about. */
export function hostsIn(text: string): string[] {
  const out = new Set<string>()
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    try {
      out.add(new URL(match[0]).hostname.toLowerCase())
    } catch {
      // Not an address after all.
    }
  }
  for (const match of text.matchAll(
    /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|dev|ai|app|co|eu|ro|uk|de|fr|gov|edu|info|biz))\b/gi
  ))
    out.add(match[1].toLowerCase())
  return [...out]
}

export function createTaskNet(deps: {
  taskId: string
  privacy: TaskPrivacy
  sites: SiteStore
  ask: Ask
  /** Ports on 127.0.0.1 that belong to the engine itself: never reachable by a tool. */
  enginePorts: () => number[]
  log(summary: string): void
  fetch?: typeof fetch
}): TaskNet {
  const { taskId, privacy, sites } = deps
  const base = deps.fetch ?? fetch

  function parse(url: string): URL {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new PermissionError('That is not a web address.')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      throw new PermissionError(`Only web addresses (http and https) can be opened.`)
    if (parsed.username || parsed.password)
      throw new PermissionError('Addresses with a login in them are not opened.')
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
    if (local && deps.enginePorts().includes(port))
      throw new PermissionError("Titan117's own engine can't be reached from a tool.")
    return parsed
  }

  const policy: TaskNet = {
    async check(url, body, kind) {
      const parsed = parse(url)
      const leak = privacy.leak(url) ?? (body ? privacy.leak(body) : null)
      if (leak) {
        deps.log(
          `Blocked a request to ${parsed.hostname}: it carried private content from ${leak.source}`
        )
        throw new PermissionError(
          `Blocked: this request to ${parsed.hostname} carried private content (from ${leak.source}). Nothing was sent.`
        )
      }
      const host = parsed.hostname.toLowerCase()
      if (kind === 'resource' || sites.has(taskId, host)) return
      if (!privacy.isPrivate) {
        sites.add(taskId, host)
        deps.log(`Added ${host} to this task's sites`)
        return
      }
      const answer = await deps.ask({
        tool: 'open_site',
        summary: `Open ${host}? This task has read ${privacy.sources.join(', ')}.`
      })
      if (answer === 'deny') throw new PermissionError(`You didn't allow ${host}.`)
      sites.add(taskId, host)
    },

    async fetch(url, init = {}) {
      let current = url
      for (let hop = 0; hop <= 5; hop++) {
        const body = typeof init.body === 'string' ? init.body : null
        if (init.body && typeof init.body !== 'string')
          throw new PermissionError('Only text bodies can be sent.')
        await policy.check(current, body, 'navigate')
        const response = await base(current, { ...init, redirect: 'manual' })
        const location = response.headers.get('location')
        if (response.status >= 300 && response.status < 400 && location) {
          current = new URL(location, current).toString()
          init = { ...init, method: 'GET', body: undefined }
          continue
        }
        return response
      }
      throw new Error('Too many redirects.')
    },

    sites: () => sites.list(taskId)
  }
  return policy
}
