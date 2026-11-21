// Finding links in text (kept apart from components for fast refresh, and testable).

export type Piece = { text: string } | { url: string }

const URL_PATTERN = /https:\/\/[^\s<>"'`]+/g
/** Punctuation that ends a sentence, not the address. */
const TRAILING = /[.,;:!?)\]}*_]+$/

/**
 * Splits text into plain parts and `https://` links. Only https: the window
 * opens those in the user's own browser and nothing else (window.ts).
 */
export function splitLinks(text: string): Piece[] {
  const out: Piece[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0]
    // Keep a closing bracket that belongs to the address, e.g. .../Foo_(bar).
    const trail = TRAILING.exec(url)?.[0] ?? ''
    let cut = trail.length
    if (trail.includes(')') && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0))
      cut = trail.length - trail.lastIndexOf(')') - 1
    if (cut) url = url.slice(0, -cut)
    const start = match.index ?? 0
    if (start > last) out.push({ text: text.slice(last, start) })
    out.push({ url })
    last = start + url.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** The first GitHub pull request address in text, if any. */
export function pullRequestUrl(text: string): string | null {
  return /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(text)?.[0] ?? null
}
