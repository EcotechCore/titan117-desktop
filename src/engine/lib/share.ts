/**
 * Share links (feature 17.13, decisions §44): only when the user presses
 * Share. The window hands over the artifact's self-contained snapshot; this
 * checks it carries no key or token (guardrails §7, §8), then uploads it to
 * our web app with the device token. Unsharing deletes it there at once.
 */
import { knownSecrets, looksSecret } from '../redact'
import type { Fetch } from './net'

export const MAX_SHARE_BYTES = 5 * 1024 * 1024

export class ShareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareError'
  }
}

export interface ShareComment {
  id: string
  name: string
  text: string
  fromOwner: boolean
  at: number
  hidden: boolean
}

export interface ShareService {
  share(input: { title: string; kind: string; html: string }): Promise<{ id: string; url: string }>
  unshare(id: string): Promise<void>
  /** Comments on a shared page (17.14): list, reply, hide or show. */
  comments(
    id: string,
    op:
      | { op: 'list' }
      | { op: 'reply'; text: string }
      | { op: 'hide'; commentId: string; hidden: boolean }
  ): Promise<ShareComment[]>
}

function explain(status: number): string {
  if (status === 401) return 'Sign in to Titan117 to share.'
  if (status === 402) return 'Sharing needs an active plan.'
  if (status === 413) return 'This artifact is too large to share (5 MB at most).'
  if (status === 429)
    return 'You have shared the most allowed for now (30 a day, 100 in all). Unshare some first.'
  return `Sharing didn't work (${status}). Try again.`
}

export function createShareService(deps: {
  fetch: Fetch
  /** The device token and our web app's API address, or null when signed out. */
  account(): { token: string; apiBase: string } | null
}): ShareService {
  function account(): { token: string; apiBase: string } {
    const value = deps.account()
    if (!value) throw new ShareError('Sign in to Titan117 to share.')
    return value
  }

  return {
    async share({ title, kind, html }) {
      if (Buffer.byteLength(html) > MAX_SHARE_BYTES)
        throw new ShareError('This artifact is too large to share (5 MB at most).')
      // A shared page never carries a key or token (guardrails §7).
      if (looksSecret(html) || knownSecrets().some((s) => html.includes(s)))
        throw new ShareError(
          'This artifact contains something that looks like a key or token, so it was not shared. Remove it and try again.'
        )
      const { token, apiBase } = account()
      let response: Response
      try {
        response = await deps.fetch(`${apiBase}/shares`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, kind, html })
        })
      } catch {
        throw new ShareError(
          'No internet connection: sharing needs it. Try again when you are online.'
        )
      }
      if (!response.ok) throw new ShareError(explain(response.status))
      const body = (await response.json()) as { id?: string; url?: string }
      if (!body.id || !body.url) throw new ShareError("Sharing didn't work. Try again.")
      return { id: body.id, url: body.url }
    },

    async comments(id, op) {
      const { token, apiBase } = account()
      const call = async (body: unknown): Promise<Response> => {
        let response: Response
        try {
          response = await deps.fetch(
            `${apiBase}/shares/${encodeURIComponent(id)}/comments/owner`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            }
          )
        } catch {
          throw new ShareError('No internet connection: comments need it.')
        }
        if (!response.ok) throw new ShareError(explain(response.status))
        return response
      }
      if (op.op !== 'list') await call(op)
      const body = (await (await call({ op: 'list' })).json()) as { comments?: ShareComment[] }
      return body.comments ?? []
    },

    async unshare(id) {
      const { token, apiBase } = account()
      const response = await deps.fetch(`${apiBase}/shares/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      // Already gone there is the same as unshared.
      if (!response.ok && response.status !== 404) throw new ShareError(explain(response.status))
    }
  }
}
