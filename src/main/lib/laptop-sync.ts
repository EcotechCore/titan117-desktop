/**
 * Sync between the user's own laptops (decisions §58.12, §65; §32: sync, end
 * to end encrypted). Runs in the shell, which holds the keychain and the
 * device token; records and conversations come from and go to the engine's
 * local API (`/v1/sync/...`), and only sealed packages leave the laptop.
 *
 * - **Its own switch**, off by default, apart from remote control (§65.2).
 * - **Keys:** this laptop's X25519 sync key pair and the account's sync keys
 *   (one per generation) are kept encrypted by the OS keychain.
 * - **Joining is confirmed on both laptops** (§65.4): a laptop already in
 *   shows "Let <laptop> sync?" with a code made from both keys; the new laptop
 *   keeps the key it is sent only after the user checks the same code there.
 *   A key sealed by a laptop this one never checked a code with always asks
 *   the same way, so Convex can't slip in a key of its own.
 * - **A laptop leaving changes the key** (§65.5): the first laptop in that
 *   notices seals a new generation to every laptop still in.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

import {
  REMOTE_PROTOCOL_VERSION,
  SYNC_MAX_PACKAGE_BYTES,
  exportPrivateKey,
  generateDeviceKey,
  importPrivateKey,
  open,
  pairingCode,
  publicKeyOf,
  randomId,
  seal,
  type SealHeader
} from '../../shared/remote-protocol'
import type { SyncView } from '../../shared/remote-views'
import type { EngineCall } from './remote-commands'
import { openPackage, sealPackage } from './sync-package'

export type { SyncView }

/** A conversation sealed alone is at most this big; a longer one stays where it is (§65.3). */
export const MAX_CONVERSATION_BYTES = 4_000_000
const FAST_MS = 5_000
const SLOW_MS = 30_000

interface Stored {
  on: boolean
  /** Convex's package cursor: the last package read. */
  cursor: number
  /** Per sidebar app, the last change of ours already sent. */
  appCursors: Record<string, number>
  /** Conversations changed after this were not sent yet. */
  taskCursor: number
  /** The last "send everything again" this laptop followed. */
  resendSeen: number
  /** Laptops in at the last look, by sync public key: one missing means the key changes. */
  lastMembers: string[]
  /** Sync keys of laptops this one checked a code with: a new key from them needs no new check. */
  trusted: string[]
  tooLong: number
  lastSyncAt: number | null
}

interface Member {
  id: string
  name: string
  publicKey: string
  status: 'waiting' | 'in'
  keyGen: number | null
}

interface Reply {
  error?: string
  on?: boolean
  me?: {
    id: string
    status: 'waiting' | 'in'
    keyGen: number | null
    sealedKey: string | null
    sealedBy: string | null
    keyMsgId: string | null
    cursor: number
  }
  keyGen?: number
  rekeyRefused?: boolean
  members?: Member[]
  changes?: { seq: number; keyGen: number; size: number; own: boolean; url: string | null }[]
  top?: number
  gap?: boolean
  resendAt?: number | null
}

export interface LaptopSyncDeps {
  dataDir: string
  laptopName: string
  keychain: { encrypt(text: string): Buffer; decrypt(data: Buffer): string } | null
  apiUrl(): string | null
  deviceToken(): string | null
  engine: EngineCall
  notify(title: string, body: string): void
  onChange(view: SyncView): void
  fetch?: typeof fetch
  now?: () => number
  /** Tests call `tick` themselves. */
  manual?: boolean
}

export class LaptopSync {
  private stored: Stored
  private identity: { private: CryptoKey; publicKey: string } | null = null
  /** The account's sync keys by generation. */
  private keys = new Map<number, Buffer>()
  private problem: string | null = null
  private status: SyncView['status'] = 'off'
  private members: Member[] = []
  private codes = new Map<string, string>()
  private myId: string | null = null
  private currentGen = 0
  /** A key sealed to this laptop by a laptop it hasn't checked a code with: waits for the user. */
  private pending: { gen: number; key: Buffer; by: string; byName: string; code: string } | null =
    null
  private outgoing: {
    admit?: { memberId: string; sealedKey: string; keyMsgId: string; keyGen: number }
    refuse?: string
    remove?: string
    rekey?: { keyGen: number; keys: { memberId: string; sealedKey: string; keyMsgId: string }[] }
    resend?: boolean
  } = {}
  private sendOff = false
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly dir: string
  private readonly fetch: typeof fetch
  private readonly now: () => number

  constructor(private readonly deps: LaptopSyncDeps) {
    this.dir = join(deps.dataDir, 'sync')
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
    this.stored = this.load()
    if (this.stored.on) this.status = 'joining'
  }

  // ---------------------------------------------------------------- the window

  view(): SyncView {
    return {
      on: this.stored.on,
      status: this.stored.on ? this.status : 'off',
      problem: this.problem,
      laptops: this.members
        .filter((m) => m.status === 'in')
        .map((m) => ({
          id: m.id,
          name: m.name,
          me: m.id === this.myId,
          code: m.id === this.myId ? null : (this.codes.get(m.publicKey) ?? null)
        })),
      waiting:
        this.status === 'in' && this.keys.has(this.currentGen)
          ? this.members
              .filter((m) => m.status === 'waiting')
              .map((m) => ({ id: m.id, name: m.name, code: this.codes.get(m.publicKey) ?? '' }))
          : [],
      confirm: this.pending ? { by: this.pending.byName, code: this.pending.code } : null,
      tooLong: this.stored.tooLong,
      lastSyncAt: this.stored.lastSyncAt,
      keychain: this.deps.keychain !== null
    }
  }

  async start(): Promise<void> {
    if (this.stored.on) await this.loadKeys()
    this.schedule(0)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async switchOn(): Promise<void> {
    if (!this.deps.keychain) {
      this.problem =
        'This laptop has no keychain Titan117 can use, so sync can’t keep its keys safe.'
      return this.changed()
    }
    if (!this.deps.apiUrl() || !this.deps.deviceToken()) {
      this.problem = 'Sign in to your Titan117 account first.'
      return this.changed()
    }
    this.stored = { ...this.empty(), on: true }
    this.status = 'joining'
    this.problem = null
    this.save()
    await this.loadKeys(true)
    this.changed()
    this.schedule(0)
  }

  /** Switching off: this laptop leaves; its keys are forgotten and the others change theirs. */
  switchOff(): void {
    this.sendOff = true
    this.stored = this.empty()
    this.keys.clear()
    this.identity = null
    this.pending = null
    this.members = []
    this.status = 'off'
    rmSync(this.dir, { recursive: true, force: true })
    this.save()
    this.changed()
    this.schedule(0)
  }

  /** The user compared the code and let a waiting laptop in. */
  async allow(memberId: string): Promise<void> {
    const m = this.members.find((x) => x.id === memberId && x.status === 'waiting')
    const key = this.keys.get(this.currentGen)
    if (!m || !key || !this.identity) return
    const header: SealHeader = {
      v: REMOTE_PROTOCOL_VERSION,
      from: this.identity.publicKey,
      to: m.publicKey,
      kind: 'sync',
      id: randomId()
    }
    const sealedKey = await seal(
      header,
      { v: 1, gen: this.currentGen, key: key.toString('base64') },
      this.identity.private
    )
    this.outgoing.admit = { memberId, sealedKey, keyMsgId: header.id, keyGen: this.currentGen }
    this.trust(m.publicKey)
    this.schedule(0)
  }

  refuse(memberId: string): void {
    this.outgoing.refuse = memberId
    this.schedule(0)
  }

  /** "Stop syncing with <laptop>": it leaves, and this laptop changes the key. */
  remove(memberId: string): void {
    if (memberId === this.myId) return
    this.outgoing.remove = memberId
    this.schedule(0)
  }

  /** The user checked the code on the laptop that sent the key (or didn't). */
  confirmKey(accept: boolean): void {
    const p = this.pending
    if (!p) return
    this.pending = null
    if (accept) {
      this.keys.set(p.gen, p.key)
      this.trust(p.by)
      this.saveKeys()
    } else {
      this.problem =
        'You didn’t confirm the code, so this laptop isn’t syncing. Switch sync off and on to try again.'
    }
    this.changed()
    this.schedule(0)
  }

  // ---------------------------------------------------------------- the loop

  private schedule(ms: number): void {
    if (this.deps.manual) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), ms)
    this.timer.unref?.()
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.syncOnce()
    } catch {
      this.problem = 'Can’t reach Titan117 right now. Sync carries on when it can.'
      this.changed()
    } finally {
      this.running = false
      if (this.stored.on)
        this.schedule(
          this.status === 'in' && !this.pending && this.waitingCount() === 0 ? SLOW_MS : FAST_MS
        )
    }
  }

  private waitingCount(): number {
    return this.members.filter((m) => m.status === 'waiting').length
  }

  private async call(body: Record<string, unknown>): Promise<Reply> {
    const res = await this.fetch(`${this.deps.apiUrl()}/desktop/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.deps.deviceToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const reply = (await res.json().catch(() => ({ error: 'INTERNAL' }))) as Reply
    if (!res.ok && !reply.error) reply.error = 'INTERNAL'
    return reply
  }

  private async syncOnce(): Promise<void> {
    if (!this.deps.apiUrl() || !this.deps.deviceToken()) {
      if (this.stored.on) this.problem = 'Sign in to your Titan117 account first.'
      return this.changed()
    }
    if (this.sendOff) {
      const reply = await this.call({ on: false })
      if (!reply.error) this.sendOff = false
      if (!this.stored.on) return
    }
    if (!this.stored.on) return
    await this.loadKeys(true)
    if (!this.identity) return

    const out = this.outgoing
    this.outgoing = {}
    const reply = await this.call({
      on: true,
      publicKey: this.identity.publicKey,
      cursor: this.stored.cursor,
      ...out
    })
    if (reply.error || !reply.me) {
      // Nothing was taken: try again next time.
      this.outgoing = { ...out, ...this.outgoing }
      this.problem =
        reply.error === 'PAYMENT_REQUIRED'
          ? 'Sync needs an active plan.'
          : reply.error === 'UNAUTHENTICATED'
            ? 'Sign in to your Titan117 account again.'
            : 'Titan117 refused that. Try switching sync off and on.'
      return this.changed()
    }
    this.problem = null
    this.myId = reply.me.id
    this.members = reply.members ?? []
    this.currentGen = reply.keyGen ?? 1
    for (const m of this.members)
      if (!this.codes.has(m.publicKey))
        this.codes.set(m.publicKey, await this.codeWith(m.publicKey))

    if (reply.me.status === 'waiting') {
      this.status = 'waiting'
      return this.changed()
    }
    await this.takeKey(reply)
    this.status = 'in'

    // Someone left: change the key (the first laptop to do it wins; the others get it sealed).
    const inside = this.members.filter((m) => m.status === 'in').map((m) => m.publicKey)
    const gone = this.stored.lastMembers.filter((k) => !inside.includes(k))
    if (this.keys.has(this.currentGen) && gone.length && !reply.rekeyRefused) await this.rekey()
    else this.stored.lastMembers = inside
    const myKey = this.keys.get(this.currentGen)

    if (reply.gap) {
      this.outgoing.resend = true
      this.stored.cursor = reply.top ?? this.stored.cursor
    }
    if (reply.resendAt && reply.resendAt > this.stored.resendSeen) {
      this.stored.resendSeen = reply.resendAt
      this.stored.appCursors = {}
      this.stored.taskCursor = 0
    }
    if (myKey) {
      await this.receive(reply.changes ?? [])
      await this.sendOurs(myKey)
      this.stored.lastSyncAt = this.now()
    }
    this.save()
    this.changed()
  }

  /** The account's key sealed to this laptop: kept at once from a laptop it trusts, else after the code check. */
  private async takeKey(reply: Reply): Promise<void> {
    const me = reply.me!
    if (!this.identity) return
    // The first laptop in makes the key.
    if (!me.sealedKey && me.keyGen && !this.keys.has(me.keyGen) && this.keys.size === 0) {
      this.keys.set(me.keyGen, randomBytes(32))
      this.saveKeys()
      return
    }
    if (!me.sealedKey || !me.sealedBy || !me.keyMsgId || !me.keyGen) return
    if (this.keys.has(me.keyGen) || this.pending?.gen === me.keyGen) return
    const header: SealHeader = {
      v: REMOTE_PROTOCOL_VERSION,
      from: me.sealedBy,
      to: this.identity.publicKey,
      kind: 'sync',
      id: me.keyMsgId
    }
    const opened = (await open(header, me.sealedKey, this.identity.private)) as {
      gen?: unknown
      key?: unknown
    } | null
    if (!opened || opened.gen !== me.keyGen || typeof opened.key !== 'string') return
    const key = Buffer.from(opened.key, 'base64')
    if (key.length !== 32) return
    if (this.stored.trusted.includes(me.sealedBy)) {
      this.keys.set(me.keyGen, key)
      this.saveKeys()
      return
    }
    const by = this.members.find((m) => m.publicKey === me.sealedBy)
    this.pending = {
      gen: me.keyGen,
      key,
      by: me.sealedBy,
      byName: by?.name ?? 'Another laptop',
      code: await this.codeWith(me.sealedBy)
    }
    this.deps.notify('Check the sync code', `${this.pending.byName} sent this laptop the sync key.`)
  }

  private async rekey(): Promise<void> {
    if (!this.identity) return
    const gen = this.currentGen + 1
    const key = randomBytes(32)
    const keys: { memberId: string; sealedKey: string; keyMsgId: string }[] = []
    for (const m of this.members.filter((x) => x.status === 'in' && x.id !== this.myId)) {
      const header: SealHeader = {
        v: REMOTE_PROTOCOL_VERSION,
        from: this.identity.publicKey,
        to: m.publicKey,
        kind: 'sync',
        id: randomId()
      }
      keys.push({
        memberId: m.id,
        keyMsgId: header.id,
        sealedKey: await seal(
          header,
          { v: 1, gen, key: key.toString('base64') },
          this.identity.private
        )
      })
    }
    const reply = await this.call({
      on: true,
      publicKey: this.identity.publicKey,
      rekey: { keyGen: gen, keys }
    })
    if (!reply.error && !reply.rekeyRefused) {
      this.keys.set(gen, key)
      this.currentGen = gen
      this.saveKeys()
    }
    this.stored.lastMembers = this.members.filter((m) => m.status === 'in').map((m) => m.publicKey)
  }

  /** Packages from the other laptops, in order; one sealed under a key not here yet waits. */
  private async receive(changes: NonNullable<Reply['changes']>): Promise<void> {
    for (const c of changes) {
      if (!c.own && c.url) {
        const key = this.keys.get(c.keyGen)
        if (!key) {
          if (c.keyGen > this.currentGen || this.pending) return
        } else {
          const res = await this.fetch(c.url)
          if (!res.ok) return
          const body = openPackage(key, await res.text()) as {
            from?: unknown
            app?: unknown
            entries?: unknown
            conversations?: unknown
          } | null
          if (body) await this.apply(body)
        }
      }
      this.stored.cursor = c.seq
    }
  }

  private async apply(body: {
    from?: unknown
    app?: unknown
    entries?: unknown
    conversations?: unknown
  }): Promise<void> {
    const from = typeof body.from === 'string' ? body.from.slice(0, 60) : 'Another laptop'
    if (typeof body.app === 'string' && Array.isArray(body.entries)) {
      const { apps } = await this.deps.engine<{ apps: string[] }>('GET', '/v1/sync/apps')
      // Only apps in this laptop's own sidebar (§58.12).
      if (apps.includes(body.app))
        await this.deps.engine('POST', `/v1/sync/apps/${encodeURIComponent(body.app)}`, {
          entries: body.entries
        })
    }
    if (Array.isArray(body.conversations))
      await this.deps.engine('POST', '/v1/sync/tasks', { from, tasks: body.conversations })
  }

  /** This laptop's changes since the last time, sealed and sent. */
  private async sendOurs(key: Buffer): Promise<void> {
    const { apps } = await this.deps.engine<{ apps: string[] }>('GET', '/v1/sync/apps')
    for (const app of apps) {
      let limit = 500
      for (let round = 0; round < 20; round++) {
        const since = this.stored.appCursors[app] ?? 0
        const page = await this.deps.engine<{ upTo: number; entries: unknown[] }>(
          'GET',
          `/v1/sync/apps/${encodeURIComponent(app)}?since=${since}&limit=${limit}`
        )
        if (page.entries.length === 0) {
          this.stored.appCursors[app] = page.upTo
          break
        }
        const sealed = sealPackage(key, { from: this.deps.laptopName, app, entries: page.entries })
        if (sealed.length > SYNC_MAX_PACKAGE_BYTES) {
          if (limit === 1) {
            // One record can't be this big (the data layer refuses it); skip it rather than stall.
            this.stored.appCursors[app] = page.upTo
            continue
          }
          limit = Math.max(1, Math.floor(limit / 4))
          continue
        }
        if (!(await this.upload(sealed))) return
        this.stored.appCursors[app] = page.upTo
        this.save()
      }
    }
    for (let round = 0; round < 10; round++) {
      const { tasks } = await this.deps.engine<{ tasks: { updatedAt: number }[] }>(
        'GET',
        `/v1/sync/tasks?since=${this.stored.taskCursor}&limit=5`
      )
      if (!tasks.length) break
      for (const task of tasks) {
        const sealed = sealPackage(key, { from: this.deps.laptopName, conversations: [task] })
        if (sealed.length > MAX_CONVERSATION_BYTES) this.stored.tooLong++
        else if (!(await this.upload(sealed))) return
        this.stored.taskCursor = task.updatedAt
        this.save()
      }
    }
  }

  private async upload(sealed: string): Promise<boolean> {
    const res = await this.fetch(`${this.deps.apiUrl()}/desktop/sync/package`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.deps.deviceToken()}`,
        'Content-Type': 'application/octet-stream',
        'X-Titan117-Key-Gen': String(this.currentGen)
      },
      body: sealed
    })
    return res.ok
  }

  // ---------------------------------------------------------------- keys

  /** The code both laptops show (symmetric: the same whichever laptop computes it). */
  private async codeWith(other: string): Promise<string> {
    if (!this.identity) return ''
    const [a, b] = [this.identity.publicKey, other].sort()
    return pairingCode(a, b)
  }

  private trust(publicKey: string): void {
    if (!this.stored.trusted.includes(publicKey)) this.stored.trusted.push(publicKey)
    this.save()
  }

  private async loadKeys(create = false): Promise<void> {
    if (this.identity || !this.deps.keychain) return
    const idFile = join(this.dir, 'identity.bin')
    try {
      if (existsSync(idFile)) {
        const raw = new Uint8Array(
          Buffer.from(this.deps.keychain.decrypt(readFileSync(idFile)), 'base64')
        )
        this.identity = { private: await importPrivateKey(raw), publicKey: await publicKeyOf(raw) }
        const keysFile = join(this.dir, 'keys.bin')
        if (existsSync(keysFile)) {
          const saved = JSON.parse(this.deps.keychain.decrypt(readFileSync(keysFile))) as Record<
            string,
            string
          >
          for (const [gen, key] of Object.entries(saved))
            this.keys.set(Number(gen), Buffer.from(key, 'base64'))
        }
        return
      }
    } catch {
      // Keys the keychain can't open any more: start again; this laptop joins as a new one.
      rmSync(idFile, { force: true })
      rmSync(join(this.dir, 'keys.bin'), { force: true })
      this.keys.clear()
    }
    if (!create) return
    const pair = await generateDeviceKey(true)
    const raw = await exportPrivateKey(pair.privateKey)
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(idFile, this.deps.keychain.encrypt(Buffer.from(raw).toString('base64')))
    this.identity = { private: await importPrivateKey(raw), publicKey: pair.publicKey }
  }

  private saveKeys(): void {
    if (!this.deps.keychain) return
    mkdirSync(this.dir, { recursive: true })
    const all: Record<string, string> = {}
    for (const [gen, key] of this.keys) all[String(gen)] = key.toString('base64')
    writeFileSync(join(this.dir, 'keys.bin'), this.deps.keychain.encrypt(JSON.stringify(all)))
  }

  // ---------------------------------------------------------------- storage

  private empty(): Stored {
    return {
      on: false,
      cursor: 0,
      appCursors: {},
      taskCursor: 0,
      resendSeen: 0,
      lastMembers: [],
      trusted: [],
      tooLong: 0,
      lastSyncAt: null
    }
  }

  private load(): Stored {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'sync.json'), 'utf8')) as Partial<Stored>
      const e = this.empty()
      return {
        on: raw.on === true,
        cursor: typeof raw.cursor === 'number' ? raw.cursor : 0,
        appCursors: raw.appCursors && typeof raw.appCursors === 'object' ? raw.appCursors : {},
        taskCursor: typeof raw.taskCursor === 'number' ? raw.taskCursor : 0,
        resendSeen: typeof raw.resendSeen === 'number' ? raw.resendSeen : 0,
        lastMembers: Array.isArray(raw.lastMembers) ? raw.lastMembers : [],
        trusted: Array.isArray(raw.trusted) ? raw.trusted : [],
        tooLong: typeof raw.tooLong === 'number' ? raw.tooLong : 0,
        lastSyncAt: typeof raw.lastSyncAt === 'number' ? raw.lastSyncAt : e.lastSyncAt
      }
    } catch {
      return this.empty()
    }
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, 'sync.json'), JSON.stringify(this.stored))
  }

  private changed(): void {
    this.deps.onChange(this.view())
  }
}
