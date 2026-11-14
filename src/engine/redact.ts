/**
 * Redaction (guardrails §8): keys and tokens never reach logs, the errors
 * table or the activity timeline. Everything written there passes through
 * `redact` first.
 */

const PATTERNS: RegExp[] = [
  /sk-or-v1-[0-9a-zA-Z]{8,}/g, // OpenRouter
  /sk-ant-[0-9A-Za-z_-]{8,}/g, // Anthropic
  /sk-(?:proj-)?[0-9A-Za-z_-]{20,}/g, // OpenAI and look-alikes
  /sk_(?:live|test)_[0-9A-Za-z]{8,}/g, // Stripe
  /AIza[0-9A-Za-z_-]{30,}/g, // Google
  /gh[pousr]_[0-9A-Za-z]{20,}/g, // GitHub
  /github_pat_[0-9A-Za-z_]{20,}/g,
  /hf_[0-9A-Za-z]{20,}/g, // Hugging Face
  /xox[abprs]-[0-9A-Za-z-]{10,}/g, // Slack
  /eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/g, // JWTs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
]

/** `Authorization: Bearer abc`, `api_key=abc`, `"token": "abc"`, `password: abc`. */
const LABELLED =
  /((?:authorization|bearer|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)["']?\s*[:=]\s*["']?(?:bearer\s+)?)([^\s"',;&]{6,})/gi

export const REDACTED = '[redacted]'

const exact = new Set<string>()

/** Register a secret the engine holds, so its exact value is always scrubbed. */
export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) exact.add(value)
}

export function redact(text: string): string {
  let out = text
  for (const secret of exact) out = out.split(secret).join(REDACTED)
  for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED)
  return out.replace(LABELLED, (_, label: string) => `${label}${REDACTED}`)
}

/** Redacts every string inside a value that is about to be stored or logged. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v)
    return out as T
  }
  return value
}
