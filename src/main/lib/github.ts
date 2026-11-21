/**
 * Sign in with GitHub (decisions §25, §55): our GitHub App's device flow,
 * so pull requests, forks and repos are made as the user. Checked against
 * GitHub's docs on 21 Nov 2026:
 *  - the device flow needs only the app's client ID (not secret), and must
 *    be turned on in the app's settings;
 *  - the user access token (`ghu_`) lasts 8 hours; its refresh token (`ghr_`)
 *    6 months, and refreshing a device-flow token needs no client secret;
 *  - a refresh token works once: the new pair replaces the old.
 * The tokens are kept only in the OS keychain (encrypted with it), never in
 * our cloud, logs or reports; the engine gets the current access token.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Keychain } from './keys'

export interface GitHubTokens {
  access: string
  accessExpiresAt: number | null
  refresh: string | null
  refreshExpiresAt: number | null
  login: string | null
}

export interface DeviceCode {
  userCode: string
  verificationUri: string
  expiresAt: number
}

export interface GitHubStatus {
  /** False until our GitHub App is registered and its client ID is in the app. */
  configured: boolean
  signedIn: boolean
  login: string | null
  /** A sign-in waiting for the user to enter the code on GitHub. */
  pending: DeviceCode | null
  problem: string | null
}

const REFRESH_MARGIN_MS = 10 * 60_000

type Fetch = typeof fetch

/** GitHub's OAuth endpoints answer in JSON when asked (form-encoded otherwise). */
async function post(
  fetchFn: Fetch,
  url: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetchFn(`${url}?${new URLSearchParams(params)}`, {
    method: 'POST',
    headers: { Accept: 'application/json' }
  })
  const text = await response.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return Object.fromEntries(new URLSearchParams(text))
  }
}

export class GitHubSignIn {
  private readonly file: string
  private pending: DeviceCode | null = null
  private problem: string | null = null
  private polling: AbortController | null = null

  constructor(
    dataDir: string,
    private readonly keychain: Keychain | null,
    private readonly clientId: string | null,
    private readonly fetchFn: Fetch = fetch,
    private readonly onChange: () => void = () => undefined,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms))
  ) {
    this.file = join(dataDir, 'github.bin')
  }

  private load(): GitHubTokens | null {
    if (!this.keychain || !existsSync(this.file)) return null
    try {
      return JSON.parse(this.keychain.decrypt(readFileSync(this.file))) as GitHubTokens
    } catch {
      return null
    }
  }

  private save(tokens: GitHubTokens | null): void {
    if (!tokens) rmSync(this.file, { force: true })
    else {
      if (!this.keychain)
        throw new Error(
          'This computer has no keychain Titan117 can use to keep the GitHub sign-in safe.'
        )
      mkdirSync(join(this.file, '..'), { recursive: true })
      writeFileSync(this.file, this.keychain.encrypt(JSON.stringify(tokens)))
    }
    this.onChange()
  }

  status(): GitHubStatus {
    const tokens = this.load()
    const alive =
      !!tokens && (tokens.refreshExpiresAt === null || tokens.refreshExpiresAt > Date.now())
    return {
      configured: !!this.clientId,
      signedIn: alive,
      login: alive ? (tokens?.login ?? null) : null,
      pending: this.pending && this.pending.expiresAt > Date.now() ? this.pending : null,
      problem: this.problem
    }
  }

  /** Starts the device flow: the user enters the code on GitHub's own page. */
  async start(): Promise<DeviceCode> {
    if (!this.clientId) throw new Error('GitHub sign-in comes once our GitHub App is registered.')
    if (!this.keychain)
      throw new Error(
        'This computer has no keychain Titan117 can use to keep the GitHub sign-in safe.'
      )
    this.polling?.abort()
    const code = await post(this.fetchFn, 'https://github.com/login/device/code', {
      client_id: this.clientId
    })
    if (typeof code.device_code !== 'string' || typeof code.user_code !== 'string')
      throw new Error(
        code.error === 'device_flow_disabled'
          ? 'GitHub sign-in isn’t switched on for our GitHub App yet (device flow).'
          : 'GitHub didn’t start the sign-in. Try again.'
      )
    const device: DeviceCode = {
      userCode: code.user_code,
      verificationUri:
        typeof code.verification_uri === 'string'
          ? code.verification_uri
          : 'https://github.com/login/device',
      expiresAt: Date.now() + (Number(code.expires_in) || 900) * 1000
    }
    this.pending = device
    this.problem = null
    const controller = new AbortController()
    this.polling = controller
    void this.poll(
      code.device_code,
      Number(code.interval) || 5,
      device.expiresAt,
      controller.signal
    )
    this.onChange()
    return device
  }

  cancel(): void {
    this.polling?.abort()
    this.pending = null
    this.onChange()
  }

  private async poll(
    deviceCode: string,
    interval: number,
    until: number,
    signal: AbortSignal
  ): Promise<void> {
    let wait = interval
    while (!signal.aborted && Date.now() < until) {
      await this.sleep(wait * 1000)
      if (signal.aborted) return
      let reply: Record<string, unknown>
      try {
        reply = await post(this.fetchFn, 'https://github.com/login/oauth/access_token', {
          client_id: this.clientId!,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      } catch {
        continue // offline for a moment: try again at the next interval
      }
      if (typeof reply.access_token === 'string') {
        this.pending = null
        await this.store(reply)
        return
      }
      if (reply.error === 'authorization_pending') continue
      if (reply.error === 'slow_down') {
        wait = Number(reply.interval) || wait + 5
        continue
      }
      this.pending = null
      this.problem =
        reply.error === 'access_denied'
          ? 'The GitHub sign-in was cancelled on GitHub.'
          : reply.error === 'expired_token' || reply.error === 'token_expired'
            ? 'The GitHub code expired. Start the sign-in again.'
            : 'GitHub didn’t finish the sign-in. Try again.'
      this.onChange()
      return
    }
    if (!signal.aborted && this.pending) {
      this.pending = null
      this.problem = 'The GitHub code expired. Start the sign-in again.'
      this.onChange()
    }
  }

  private async store(reply: Record<string, unknown>): Promise<GitHubTokens> {
    const now = Date.now()
    const tokens: GitHubTokens = {
      access: reply.access_token as string,
      accessExpiresAt: reply.expires_in ? now + Number(reply.expires_in) * 1000 : null,
      refresh: typeof reply.refresh_token === 'string' ? reply.refresh_token : null,
      refreshExpiresAt: reply.refresh_token_expires_in
        ? now + Number(reply.refresh_token_expires_in) * 1000
        : null,
      login: this.load()?.login ?? null
    }
    // Who signed in, for "Signed in as …" (the token itself never leaves the keychain and the engine).
    try {
      const user = await this.fetchFn('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokens.access}`, Accept: 'application/vnd.github+json' }
      })
      if (user.ok)
        tokens.login = String(((await user.json()) as { login?: string }).login ?? '') || null
    } catch {
      // Offline: the name shows next time.
    }
    this.save(tokens)
    return tokens
  }

  /** A current access token, refreshed when it's about to expire; null when signed out. */
  async token(): Promise<string | null> {
    const tokens = this.load()
    if (!tokens) return null
    if (tokens.accessExpiresAt === null || tokens.accessExpiresAt - REFRESH_MARGIN_MS > Date.now())
      return tokens.access
    if (
      !tokens.refresh ||
      !this.clientId ||
      (tokens.refreshExpiresAt !== null && tokens.refreshExpiresAt < Date.now())
    ) {
      this.save(null)
      this.problem = 'The GitHub sign-in ran out. Sign in with GitHub again.'
      return null
    }
    try {
      const reply = await post(this.fetchFn, 'https://github.com/login/oauth/access_token', {
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh
      })
      if (typeof reply.access_token === 'string') return (await this.store(reply)).access
      if (reply.error === 'bad_refresh_token') {
        this.save(null)
        this.problem = 'The GitHub sign-in ran out. Sign in with GitHub again.'
        return null
      }
    } catch {
      // Offline: keep the old token; it may still work for a few minutes.
    }
    return tokens.access
  }

  signOut(): void {
    this.polling?.abort()
    this.pending = null
    this.problem = null
    this.save(null)
  }
}
