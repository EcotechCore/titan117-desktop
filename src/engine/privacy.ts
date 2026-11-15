/**
 * What a task has seen that is private (security.md A3). Files, memory, mail,
 * shell output and connector results are private; once a task has seen any,
 * it is "private" and a new website needs the user's OK. Passages of what it
 * saw are kept as fingerprints, never as text, so a request that carries one
 * (in an address, a form field, an upload) can be blocked, even when the
 * passage was URL-encoded or base64-encoded on the way.
 */
import { createHash } from 'node:crypto'

import { knownSecrets, looksSecret } from './redact'

/** A passage this long (letters and digits only) counts as a copy, not a coincidence. */
export const PASSAGE = 32
/** Fingerprints kept per task; enough for a few large files. */
const MAX_PRINTS = 400_000

/** Lowercase letters and digits only, so spacing, case and punctuation tricks don't hide a copy. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function print(window: string): string {
  return createHash('sha1').update(window).digest('base64').slice(0, 12)
}

/** Every readable form a request might carry its content in. */
export function decodings(text: string): string[] {
  const out = new Set<string>([text])
  let current = text
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(current.replace(/\+/g, ' '))
      if (next === current) break
      out.add(next)
      current = next
    } catch {
      break
    }
  }
  for (const form of [...out]) {
    // base64 and base64url runs (whole, and split at "/", at every alignment), and hex runs,
    // decoded where they read mostly as text.
    const runs = new Set<string>()
    for (const run of form.match(/[A-Za-z0-9+/_-]{24,}={0,2}/g) ?? []) {
      runs.add(run)
      for (const part of run.split('/')) if (part.length >= 24) runs.add(part)
    }
    for (const run of runs)
      for (let shift = 0; shift < 4; shift++) {
        const decoded = Buffer.from(
          run.slice(shift).replace(/-/g, '+').replace(/_/g, '/'),
          'base64'
        ).toString('utf8')
        if (readable(decoded)) out.add(decoded)
      }
    for (const run of form.match(/(?:[0-9a-f]{2}){16,}/gi) ?? []) {
      const decoded = Buffer.from(run, 'hex').toString('utf8')
      if (readable(decoded)) out.add(decoded)
    }
  }
  return [...out]
}

/** Mostly letters, digits, punctuation and spaces: decoded text, not noise. */
function readable(text: string): boolean {
  if (text.length < 16) return false
  const good = text.match(/[\p{L}\p{N}\p{P}\p{Zs}\n\r\t]/gu)?.length ?? 0
  return good / text.length >= 0.85
}

export interface PrivateLeak {
  /** Where the private passage came from (a tool name). */
  source: string
  /** A short, redacted hint of what matched, for the activity log. */
  hint: string
}

export interface TaskPrivacy {
  /** True once the task has read anything private. */
  readonly isPrivate: boolean
  /** What the task read that was private, by source (for the approval card). */
  readonly sources: string[]
  /**
   * Record private content the task has seen. `quiet` keeps its passages from
   * leaving without making the task private (memory placed in the prompt).
   */
  saw(text: string, source: string, quiet?: boolean): void
  /** The private passage a piece of outgoing data carries, or null. */
  leak(outgoing: string): PrivateLeak | null
}

export function createTaskPrivacy(): TaskPrivacy {
  const prints = new Map<string, string>()
  const sources = new Set<string>()

  function check(text: string): PrivateLeak | null {
    // Secrets the engine knows (keys, tokens) are blocked whatever their length.
    for (const secret of knownSecrets())
      if (secret.length >= 8 && text.includes(secret))
        return { source: 'a saved key or token', hint: '[a key or token]' }
    if (looksSecret(text)) return { source: 'a key or token', hint: '[a key or token]' }
    const flat = normalize(text)
    for (let i = 0; i + PASSAGE <= flat.length; i++) {
      const source = prints.get(print(flat.slice(i, i + PASSAGE)))
      if (source) return { source, hint: `${flat.slice(i, i + 12)}…` }
    }
    return null
  }

  return {
    get isPrivate() {
      return sources.size > 0
    },
    get sources() {
      return [...sources]
    },
    saw(text, source, quiet = false) {
      if (!quiet) sources.add(source)
      const flat = normalize(text)
      for (let i = 0; i + PASSAGE <= flat.length && prints.size < MAX_PRINTS; i++)
        prints.set(print(flat.slice(i, i + PASSAGE)), source)
    },
    leak(outgoing) {
      for (const form of decodings(outgoing)) {
        const found = check(form)
        if (found) return found
      }
      return null
    }
  }
}
