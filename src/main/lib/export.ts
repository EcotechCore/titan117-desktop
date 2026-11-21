/**
 * Showing and printing artifacts (features 17.1, 17.8, 17.18; decisions §44).
 *
 * The window shows an artifact in an iframe from `titan117://sandbox/<id>`,
 * served here with a content policy that has no network and runs it in an
 * opaque origin: it can't reach the engine, the app's page, files or the
 * internet. PDF and PNG are printed by a hidden window in a separate,
 * in-memory session whose every request outside our sandbox is cancelled.
 */
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

export const SANDBOX_HOST = 'sandbox'

/** The sandbox's content policy, sent as a header (17.18). */
export const SANDBOX_CSP = [
  'sandbox allow-scripts allow-popups',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const MAX_STAGED = 30
const MAX_BYTES = 8 * 1024 * 1024

/** Pages the window asked to show, by a random id; the oldest go first. */
export class Staged {
  private readonly pages = new Map<string, string>()

  put(html: unknown): string {
    if (typeof html !== 'string' || !html || html.length > MAX_BYTES) throw new Error('Refused.')
    const id = randomBytes(16).toString('hex')
    this.pages.set(id, html)
    while (this.pages.size > MAX_STAGED) this.pages.delete(this.pages.keys().next().value!)
    return id
  }

  get(id: string): string | null {
    return this.pages.get(id) ?? null
  }

  /** The response for `titan117://sandbox/<id>`. */
  respond(pathname: string): Response {
    const id = pathname.replace(/^\/+/, '')
    const html = /^[0-9a-f]{32}$/.test(id) ? this.get(id) : null
    if (html === null) return new Response('Not found.', { status: 404 })
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': SANDBOX_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      }
    })
  }
}

/** Where a sandboxed frame may go: only its own sandbox page. */
export function isSandboxUrl(url: string, scheme: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === `${scheme}:` && u.host === SANDBOX_HOST
  } catch {
    return false
  }
}

/**
 * An app's live preview (6.1): a dev server on this laptop's 127.0.0.1 only,
 * shown in the Apps screen's frame. Never reached from an artifact's frame.
 */
export function isLocalPreviewNavigation(url: string, frameUrl: string, scheme: string): boolean {
  if (isSandboxUrl(frameUrl, scheme)) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port !== '' && !u.username
  } catch {
    return false
  }
}

/** A safe file name for a download (17.20): no path, no reserved or control characters. */
export function safeName(name: unknown, fallback: string): string {
  const clean =
    typeof name === 'string'
      ? [...name]
          .map((c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? ' ' : c))
          .join('')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
      : ''
  return clean || fallback
}

/** Writes a file the user chose in the save dialog. */
export async function writeChosenFile(path: string, data: Buffer): Promise<void> {
  await writeFile(path, data)
}
