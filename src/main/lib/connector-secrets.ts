/**
 * Connector secrets (feature 3.6): tokens and environment variables for the
 * user's MCP connectors, encrypted by the OS keychain (Electron's
 * safeStorage) like the API keys, one file per connector. Never sent to our
 * servers (decisions §32) or back to the window; the engine receives them to
 * start or call each connector.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Keychain } from './keys'

const ID = /^[0-9a-f-]{36}$/
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export type SecretsResult = { ok: true } | { ok: false; problem: string }

export class ConnectorSecrets {
  private readonly dir: string

  constructor(
    dataDir: string,
    private readonly keychain: Keychain | null
  ) {
    this.dir = join(dataDir, 'connector-secrets')
  }

  set(id: unknown, secrets: unknown): SecretsResult {
    if (typeof id !== 'string' || !ID.test(id)) return { ok: false, problem: 'Unknown connector.' }
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets))
      return { ok: false, problem: 'Secrets must be names and values.' }
    const clean: Record<string, string> = {}
    for (const [name, value] of Object.entries(secrets as Record<string, unknown>)) {
      if (!NAME.test(name) || typeof value !== 'string' || !value || value.length > 4000)
        return { ok: false, problem: `"${name}" isn't a valid secret.` }
      clean[name] = value
    }
    if (!this.keychain)
      return {
        ok: false,
        problem: 'This computer has no keychain Titan117 can use to keep secrets safe.'
      }
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, `${id}.bin`), this.keychain.encrypt(JSON.stringify(clean)))
    return { ok: true }
  }

  remove(id: unknown): void {
    if (typeof id === 'string' && ID.test(id)) rmSync(join(this.dir, `${id}.bin`), { force: true })
  }

  /** Every connector's secrets, for the engine only. */
  all(): Record<string, Record<string, string>> {
    if (!this.keychain) return {}
    const out: Record<string, Record<string, string>> = {}
    let files: string[]
    try {
      files = readdirSync(this.dir)
    } catch {
      return out
    }
    for (const file of files) {
      const id = file.replace(/\.bin$/, '')
      if (!ID.test(id)) continue
      try {
        out[id] = JSON.parse(this.keychain.decrypt(readFileSync(join(this.dir, file)))) as Record<
          string,
          string
        >
      } catch {
        // Saved under another OS user, or damaged: skipped.
      }
    }
    return out
  }
}
