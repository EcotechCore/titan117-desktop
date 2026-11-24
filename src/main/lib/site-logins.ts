/**
 * Saved site logins for recordings (feature 8.5; decisions §61): a user name
 * and password per site, encrypted by the OS keychain (Electron's
 * safeStorage) like the API keys, in one file. A recording never holds a
 * password: its step says "the saved login for this site" and the engine
 * fills it in at replay, only on that site.
 *
 * Never sent to our servers (decisions §32), to a model, or back to the
 * window: the window learns only which sites have a login.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Keychain } from './keys'

const HOST =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/
export const MAX_LOGINS = 100

export interface SiteLogin {
  username: string
  password: string
}

export type LoginResult = { ok: true } | { ok: false; problem: string }

/** A site as the user typed it (an address or a host) as a bare host name, or null. */
export function siteOf(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let host = input.trim().toLowerCase()
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname
  } catch {
    return null
  }
  host = host.replace(/^www\./, '').replace(/\/.*$/, '')
  return HOST.test(host) ? host : null
}

export class SiteLogins {
  private readonly file: string

  constructor(
    private readonly dataDir: string,
    private readonly keychain: Keychain | null
  ) {
    this.file = join(dataDir, 'site-logins.bin')
  }

  /** Every login, for the engine only. */
  all(): Record<string, SiteLogin> {
    if (!this.keychain) return {}
    try {
      const parsed = JSON.parse(this.keychain.decrypt(readFileSync(this.file))) as Record<
        string,
        SiteLogin
      >
      const out: Record<string, SiteLogin> = {}
      for (const [site, login] of Object.entries(parsed))
        if (
          HOST.test(site) &&
          typeof login?.username === 'string' &&
          typeof login?.password === 'string'
        )
          out[site] = { username: login.username, password: login.password }
      return out
    } catch {
      // None saved, saved under another OS user, or damaged.
      return {}
    }
  }

  /** Which sites have a login, with the user name. Never a password. */
  saved(): { site: string; username: string }[] {
    return Object.entries(this.all())
      .map(([site, login]) => ({ site, username: login.username }))
      .sort((a, b) => a.site.localeCompare(b.site))
  }

  set(siteInput: unknown, username: unknown, password: unknown): LoginResult {
    const site = siteOf(siteInput)
    if (!site)
      return { ok: false, problem: 'Give the site as an address, like portal.example.com.' }
    if (typeof username !== 'string' || !username.trim() || username.length > 300)
      return { ok: false, problem: 'Give the user name or email you sign in with.' }
    if (typeof password !== 'string' || !password || password.length > 1000)
      return { ok: false, problem: 'Give the password.' }
    if (!this.keychain)
      return {
        ok: false,
        problem: 'This computer has no keychain Titan117 can use to keep logins safe.'
      }
    const all = this.all()
    if (!all[site] && Object.keys(all).length >= MAX_LOGINS)
      return { ok: false, problem: `There are already ${MAX_LOGINS} saved logins.` }
    all[site] = { username: username.trim(), password }
    this.write(all)
    return { ok: true }
  }

  remove(siteInput: unknown): boolean {
    const site = siteOf(siteInput)
    if (!site || !this.keychain) return false
    const all = this.all()
    if (!all[site]) return false
    delete all[site]
    this.write(all)
    return true
  }

  private write(all: Record<string, SiteLogin>): void {
    if (!this.keychain) return
    if (!Object.keys(all).length) {
      rmSync(this.file, { force: true })
      return
    }
    mkdirSync(this.dataDir, { recursive: true })
    writeFileSync(this.file, this.keychain.encrypt(JSON.stringify(all)))
  }
}
