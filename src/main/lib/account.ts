/**
 * The Titan117 account on this laptop (decisions §17, §39): signing in
 * through the system browser, the device token in the OS keychain, and the
 * signed licence lease that says whether the app may be used.
 *
 * Runs in the main process, the only one that can reach the keychain
 * (Electron's safeStorage). The engine is told only what it needs: the device
 * token for the credits proxy, and whether the app is locked.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { accountStatus, verifyLease, type AccountStatus, type Lease } from '../lease'

export interface AccountDeps {
  dataDir: string
  appVersion: string
  /** The web app, e.g. https://titan117.com (http://localhost:3100 in development). */
  webUrl: string | null
  /** Convex's HTTP actions, e.g. https://<deployment>.convex.site. */
  apiUrl: string | null
  openExternal(url: string): Promise<void>
  /** The OS keychain (safeStorage); null where it isn't available. */
  keychain: { encrypt(text: string): Buffer; decrypt(data: Buffer): string } | null
  fetch?: typeof fetch
  now?: () => number
  /** The lease's public keys; tests pass their own. */
  leaseKeys?: string[]
  onChange(status: AccountView): void
}

export interface AccountView extends AccountStatus {
  /** Why the last sign-in or check failed, in words for the user. */
  problem: string | null
  configured: boolean
}

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000
const base64url = (b: Buffer): string => b.toString('base64url')

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Titan117</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;text-align:center">
<div><p style="font-weight:600;letter-spacing:.04em">TITAN117</p><h1 style="font-weight:500">You're signed in</h1>
<p style="color:#6b6b6b">Go back to the Titan117 app. You can close this tab.</p></div>`

export class Account {
  private token: string | null = null
  private deviceId: string | null = null
  private lease: Lease | null = null
  private lastSeen = 0
  private problem: string | null = null
  private signingIn: { server: Server; cancel(): void } | null = null
  private readonly dir: string
  private readonly fetch: typeof fetch
  private readonly now: () => number

  constructor(private readonly deps: AccountDeps) {
    this.dir = join(deps.dataDir, 'account')
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
    this.load()
  }

  // ------------------------------------------------------------ state

  /** The device token, for the engine's calls to the credits proxy. Never shown or logged. */
  deviceToken(): string | null {
    return this.token
  }

  /** This laptop's device id in our cloud, for remote control's switch-on page. Not a secret. */
  deviceIdentifier(): string | null {
    return this.deviceId
  }

  status(): AccountView {
    this.remember(this.now())
    return {
      ...accountStatus({ signedIn: this.token !== null, lease: this.lease, now: this.lastSeen }),
      problem: this.problem,
      configured: this.deps.webUrl !== null && this.deps.apiUrl !== null
    }
  }

  private changed(): void {
    this.deps.onChange(this.status())
  }

  /** The latest time this app has seen, kept so a clock set back can't extend the lease. */
  private remember(time: number): void {
    if (time <= this.lastSeen) return
    this.lastSeen = time
    this.write('seen.json', JSON.stringify({ lastSeen: time }))
  }

  private write(name: string, data: string | Buffer): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, name), data)
  }

  /**
   * This install's fingerprint for sign-in: the SHA-256 of a random ID made
   * once and kept here. Signing in again from the same install then replaces
   * its old device instead of using up another place on the plan. The ID
   * itself never leaves the laptop, and it isn't a secret: it proves nothing.
   */
  installFingerprint(): string {
    const file = join(this.dir, 'install-id')
    let id = ''
    try {
      id = readFileSync(file, 'utf8').trim()
    } catch {
      // Not made yet.
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) {
      id = base64url(randomBytes(32))
      this.write('install-id', id)
    }
    return base64url(createHash('sha256').update(id).digest())
  }

  private load(): void {
    try {
      this.lastSeen = (
        JSON.parse(readFileSync(join(this.dir, 'seen.json'), 'utf8')) as { lastSeen: number }
      ).lastSeen
    } catch {
      this.lastSeen = 0
    }
    try {
      if (this.deps.keychain && existsSync(join(this.dir, 'token.bin')))
        this.token = this.deps.keychain.decrypt(readFileSync(join(this.dir, 'token.bin')))
    } catch {
      // The keychain can't read it (another OS user, a reinstalled system): sign in again.
      this.token = null
    }
    try {
      this.deviceId = (
        JSON.parse(readFileSync(join(this.dir, 'device.json'), 'utf8')) as { id: string }
      ).id
      this.setLease(readFileSync(join(this.dir, 'lease.txt'), 'utf8'))
    } catch {
      this.lease = null
    }
  }

  private setLease(text: string | null): void {
    const signed = text ? verifyLease(text, this.deps.leaseKeys) : null
    // A lease for another device (a file copied from another laptop) counts as none.
    const lease = signed && signed.dev === this.deviceId ? signed : null
    this.lease = lease
    if (lease) {
      this.remember(lease.iat)
      this.write('lease.txt', text!)
    }
  }

  private forget(): void {
    this.token = null
    this.deviceId = null
    this.lease = null
    rmSync(join(this.dir, 'token.bin'), { force: true })
    rmSync(join(this.dir, 'device.json'), { force: true })
    rmSync(join(this.dir, 'lease.txt'), { force: true })
  }

  // ------------------------------------------------------------ sign-in

  /**
   * Opens the browser at our sign-in page and waits, at 127.0.0.1 on a
   * random port, for the one-time code it sends back (RFC 8252). Then trades
   * the code and the PKCE verifier for the device token.
   */
  async signIn(): Promise<AccountView> {
    const { webUrl, apiUrl } = this.deps
    if (!webUrl || !apiUrl) {
      this.problem = 'Signing in isn’t set up in this build yet.'
      this.changed()
      return this.status()
    }
    if (!this.deps.keychain) {
      this.problem = 'This computer has no keychain Titan117 can use to keep your sign-in safe.'
      this.changed()
      return this.status()
    }
    this.signingIn?.cancel()

    const verifier = base64url(randomBytes(48))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(24))

    const code = await new Promise<string | null>((resolve) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE)
        finish(url.searchParams.get('code'))
      })
      const timer = setTimeout(() => finish(null), SIGN_IN_TIMEOUT_MS)
      const finish = (value: string | null): void => {
        clearTimeout(timer)
        server.close()
        this.signingIn = null
        resolve(value)
      }
      this.signingIn = { server, cancel: () => finish(null) }
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        const page = new URL('/desktop/sign-in', webUrl)
        page.searchParams.set('challenge', challenge)
        page.searchParams.set('state', state)
        page.searchParams.set('port', String(port))
        page.searchParams.set('name', hostname().slice(0, 60))
        page.searchParams.set('install', this.installFingerprint())
        void this.deps.openExternal(page.toString())
      })
    })
    if (!code) {
      this.problem = 'Sign-in was cancelled or took too long. Try again.'
      this.changed()
      return this.status()
    }

    try {
      const res = await this.fetch(new URL('/desktop/exchange', apiUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, verifier, appVersion: this.deps.appVersion })
      })
      const body = (await res.json()) as {
        token?: string
        deviceId?: string
        lease?: string | null
        error?: string
      }
      if (!res.ok || !body.token || !body.deviceId) {
        this.problem =
          body.error === 'DEVICE_LIMIT'
            ? 'Your plan’s devices are all signed in. Sign one out on your account page, then try again.'
            : 'Sign-in didn’t complete. Try again.'
      } else {
        this.forget()
        this.token = body.token
        this.deviceId = body.deviceId
        this.write('token.bin', this.deps.keychain.encrypt(body.token))
        this.write('device.json', JSON.stringify({ id: body.deviceId }))
        this.setLease(body.lease ?? null)
        this.problem = null
      }
    } catch {
      this.problem = 'Couldn’t reach Titan117. Check your internet connection and try again.'
    }
    this.changed()
    return this.status()
  }

  cancelSignIn(): void {
    this.signingIn?.cancel()
  }

  /** Signs this laptop out here (the account page can also sign it out remotely). */
  signOut(): AccountView {
    this.forget()
    this.problem = null
    this.changed()
    return this.status()
  }

  // ------------------------------------------------------------ the lease

  /**
   * Asks for a fresh lease. Offline, the current one stays (that's the point
   * of the 14 days); a 401 means this device was signed out, so it locks.
   */
  async refresh(): Promise<AccountView> {
    const { apiUrl } = this.deps
    if (!this.token || !apiUrl) return this.status()
    try {
      const res = await this.fetch(new URL('/desktop/lease', apiUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appVersion: this.deps.appVersion })
      })
      if (res.status === 401) {
        this.forget()
        this.problem =
          'This computer was signed out of your account. Sign in again to keep using Titan117.'
      } else if (res.ok) {
        const { lease } = (await res.json()) as { lease?: string }
        if (lease && verifyLease(lease, this.deps.leaseKeys)) {
          this.setLease(lease)
          this.problem = null
        }
      }
    } catch {
      // Offline: keep the lease we have.
    }
    this.changed()
    return this.status()
  }
}
