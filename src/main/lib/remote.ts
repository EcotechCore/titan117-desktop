/**
 * Remote control on this laptop (decisions §64; security.md A1, A2;
 * guardrails §9). Runs in the shell, which holds the keychain and the device
 * token; everything it runs goes through the engine's local API
 * (remote-commands.ts).
 *
 * - **Off by default.** Nothing remote is read or run until the user switches
 *   it on here *and* confirms with a second factor on the web; switching off
 *   here needs nothing and Convex follows.
 * - **Keys:** this laptop's X25519 private key is kept encrypted by the OS
 *   keychain; Convex has only the public key.
 * - **Pairing is confirmed here:** a paired device is trusted only after the
 *   user clicks Allow next to the matching 6-character code.
 * - **Every message is sealed** (shared/remote-protocol.ts): commands opened
 *   only if they come from a trusted key, once, before they expire.
 * - **Removing a device rotates the key**; "Revoke all" forgets every device,
 *   rotates the key and unlinks the chat channels.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  REMOTE_MESSAGE_TTL_MS,
  REMOTE_PROTOCOL_VERSION,
  exportPrivateKey,
  generateDeviceKey,
  importPrivateKey,
  open,
  pairingCode,
  parseCommandEnvelope,
  publicKeyOf,
  randomId,
  seal,
  type RemoteEvent,
  type SealHeader
} from '../../shared/remote-protocol'
import type { RemoteView, TrustedDevice } from '../../shared/remote-views'
import type { RemoteCommands } from './remote-commands'

interface Stored {
  on: boolean
  devices: TrustedDevice[]
  /** Command ids already run, with their expiry (no replays). */
  seen: Record<string, number>
  revokedAllAt: number
  inboxFolder: string | null
}

interface InboxMessage {
  id: string
  from: string
  kind: 'command' | 'event' | 'key'
  msgId: string
  sealed: string
}

interface SyncReply {
  error?: string
  enabled?: boolean
  wakeAt?: number | null
  revokedAllAt?: number | null
  inbox?: InboxMessage[]
  keys?: { publicKey: string; name: string; kind: string }[]
  pairings?: { id: string; publicKey: string; name: string }[]
  openPairing?: { id: string; expiresAt: number } | null
}

export type { RemoteView, TrustedDevice }

export interface RemoteDeps {
  dataDir: string
  laptopName: string
  keychain: { encrypt(text: string): Buffer; decrypt(data: Buffer): string } | null
  apiUrl(): string | null
  webUrl(): string | null
  deviceToken(): string | null
  deviceId(): string | null
  openExternal(url: string): Promise<void>
  commands: RemoteCommands
  notify(title: string, body: string): void
  /** "Revoke all" was used somewhere: unlink every chat channel (decisions §64.8). */
  onRevokedAll(): void
  onChange(view: RemoteView): void
  fetch?: typeof fetch
  now?: () => number
  /** Tests call `tick` themselves. */
  manual?: boolean
}

const FAST_MS = 3_000
const SLOW_MS = 15_000
const WAKE_WINDOW_MS = 10 * 60_000

export class Remote {
  private stored: Stored
  private key: { private: CryptoKey; publicKey: string } | null = null
  private rotating: { privateRaw: Uint8Array; publicKey: string } | null = null
  private confirmed = false
  private problem: string | null = null
  private outbox: { to: string; kind: 'event' | 'key'; msgId: string; sealed: string }[] = []
  private ack: string[] = []
  private wantPairing = false
  private pairing: RemoteView['pairing'] = null
  private waiting: RemoteView['waiting'] = []
  private answers: { pairingId: string; accept: boolean }[] = []
  private revokeKeys: string[] = []
  private revokeAll = false
  private sendOff = false
  private wakeAt = 0
  private lastState = ''
  private watched = new Map<string, { until: number; last: string }>()
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly dir: string
  private readonly fetch: typeof fetch
  private readonly now: () => number

  constructor(private readonly deps: RemoteDeps) {
    this.dir = join(deps.dataDir, 'remote')
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
    this.stored = this.load()
  }

  // ---------------------------------------------------------------- the window

  view(): RemoteView {
    return {
      on: this.stored.on,
      confirmed: this.stored.on && this.confirmed,
      problem: this.problem,
      devices: this.stored.devices,
      pairing: this.pairing && this.pairing.expiresAt > this.now() ? this.pairing : null,
      waiting: this.waiting,
      inboxFolder: this.stored.inboxFolder,
      keychain: this.deps.keychain !== null
    }
  }

  async start(): Promise<void> {
    if (this.stored.on) await this.loadKey()
    this.schedule(0)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Switch on (decisions §64.5): the web page asks for the second factor; Convex then confirms. */
  async switchOn(): Promise<void> {
    if (!this.deps.keychain) {
      this.problem =
        'This laptop has no keychain Titan117 can use, so remote control can’t keep its key safe.'
      return this.changed()
    }
    const web = this.deps.webUrl()
    const deviceId = this.deps.deviceId()
    if (!web || !deviceId || !this.deps.deviceToken()) {
      this.problem = 'Sign in to your Titan117 account first.'
      return this.changed()
    }
    await this.loadKey(true)
    this.stored.on = true
    this.problem = null
    this.save()
    this.changed()
    await this.deps.openExternal(`${web}/remote/enable?device=${encodeURIComponent(deviceId)}`)
    this.schedule(0)
  }

  /** Switch off: needs no second factor; nothing remote runs from now on. */
  switchOff(): void {
    this.stored.on = false
    this.confirmed = false
    this.pairing = null
    this.waiting = []
    this.sendOff = true
    this.save()
    this.changed()
    this.schedule(0)
  }

  startPairing(): void {
    if (!this.stored.on) return
    this.wantPairing = true
    this.schedule(0)
  }

  /** The user compared the code and clicked Allow, or Don't allow. */
  answerPairing(pairingId: string, accept: boolean): void {
    const w = this.waiting.find((x) => x.pairingId === pairingId)
    if (!w) return
    this.waiting = this.waiting.filter((x) => x.pairingId !== pairingId)
    this.answers.push({ pairingId, accept })
    if (accept) {
      const claim = this.claims.get(pairingId)
      if (claim) {
        this.stored.devices.push({
          publicKey: claim.publicKey,
          name: claim.name,
          kind: 'browser',
          pairedAt: this.now()
        })
        this.save()
        this.lastState = ''
      }
      this.pairing = null
    }
    this.changed()
    this.schedule(0)
  }

  /** Remove one device: it is dropped here and in Convex, and this laptop's key is rotated. */
  removeDevice(publicKey: string): void {
    if (!this.stored.devices.some((d) => d.publicKey === publicKey)) return
    this.stored.devices = this.stored.devices.filter((d) => d.publicKey !== publicKey)
    this.revokeKeys.push(publicKey)
    this.save()
    void this.beginRotation()
    this.changed()
    this.schedule(0)
  }

  /** "Revoke all devices" from the laptop (decisions §64.8). */
  revokeAllDevices(): void {
    this.revokeAll = true
    this.forgetAll()
    this.schedule(0)
  }

  setInboxFolder(folder: string | null): void {
    this.stored.inboxFolder = folder
    this.save()
    this.changed()
  }

  inboxFolder(): string | null {
    return this.stored.inboxFolder
  }

  /** Something remote happened (an alert): tell every paired device. */
  broadcast(event: RemoteEvent, except?: string): void {
    for (const d of this.stored.devices) if (d.name !== except) void this.queue(d.publicKey, event)
  }

  // ---------------------------------------------------------------- the loop

  private claims = new Map<string, { publicKey: string; name: string }>()

  private schedule(ms: number): void {
    if (this.deps.manual) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), ms)
    this.timer.unref?.()
  }

  private interval(): number {
    const busy =
      this.now() - this.wakeAt < WAKE_WINDOW_MS ||
      this.pairing !== null ||
      this.waiting.length > 0 ||
      this.watched.size > 0 ||
      this.outbox.length > 0
    return busy ? FAST_MS : SLOW_MS
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.syncOnce()
    } catch {
      this.problem = 'Can’t reach Titan117 right now. Remote control carries on when it can.'
      this.changed()
    } finally {
      this.running = false
      if (this.stored.on) this.schedule(this.interval())
    }
  }

  /** One exchange with Convex. Exported for tests through `tick`. */
  private async syncOnce(): Promise<void> {
    if (!this.stored.on && !this.sendOff && !this.revokeAll) return
    const api = this.deps.apiUrl()
    const token = this.deps.deviceToken()
    if (!api || !token) {
      this.problem = 'Sign in to your Titan117 account first.'
      return this.changed()
    }
    if (this.stored.on) await this.loadKey()
    if (this.stored.on) await this.pushUpdates()

    const outgoing = this.outbox.splice(0, 50)
    const body = {
      on: this.stored.on,
      ...(this.key ? { laptopKey: this.key.publicKey } : {}),
      outgoing,
      ack: this.ack.splice(0, 200),
      ...(this.wantPairing ? { startPairing: true } : {}),
      ...(this.answers.length ? { answerPairing: this.answers[0] } : {}),
      ...(this.revokeKeys.length ? { revokeKeys: this.revokeKeys.slice(0, 25) } : {}),
      ...(this.revokeAll ? { revokeAll: true } : {})
    }
    const res = await this.fetch(`${api}/desktop/remote`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const reply = (await res.json().catch(() => ({ error: 'INTERNAL' }))) as SyncReply
    if (!res.ok || reply.error) {
      // Nothing was taken: send again next time.
      this.outbox.unshift(...outgoing)
      this.problem =
        reply.error === 'PAYMENT_REQUIRED'
          ? 'Remote control needs an active plan.'
          : reply.error === 'UNAUTHENTICATED'
            ? 'Sign in to your Titan117 account again.'
            : 'Titan117 refused that. Try switching remote control off and on.'
      return this.changed()
    }
    this.sendOff = false
    this.revokeAll = false
    if (body.answerPairing) this.answers.shift()
    if (body.revokeKeys) this.revokeKeys.splice(0, body.revokeKeys.length)
    if (body.startPairing) this.wantPairing = false
    // The rotation's key messages went out under the old key: now the new key takes over.
    if (this.rotating && outgoing.some((m) => m.kind === 'key')) await this.finishRotation()
    else if (this.rotating && this.stored.devices.length === 0) await this.finishRotation()

    this.problem = null
    this.confirmed = reply.enabled === true
    if (reply.wakeAt) this.wakeAt = Math.max(this.wakeAt, reply.wakeAt)

    if (reply.revokedAllAt && reply.revokedAllAt > this.stored.revokedAllAt) {
      this.stored.revokedAllAt = reply.revokedAllAt
      this.forgetAll()
      this.deps.notify(
        'All devices were revoked',
        'Every paired phone, browser and chat was disconnected.'
      )
    }
    if (!this.confirmed) return this.changed()

    // Devices removed elsewhere (the web's Remove, Revoke all): forget them and rotate.
    const active = new Set((reply.keys ?? []).map((k) => k.publicKey))
    const gone = this.stored.devices.filter((d) => !active.has(d.publicKey))
    if (gone.length) {
      this.stored.devices = this.stored.devices.filter((d) => active.has(d.publicKey))
      this.save()
      await this.beginRotation()
    }

    if (reply.openPairing && this.key) {
      const web = this.deps.webUrl() ?? ''
      const fragment = new URLSearchParams({
        p: reply.openPairing.id,
        k: this.key.publicKey,
        n: this.deps.laptopName
      })
      this.pairing = {
        link: `${web}/remote/pair#${fragment.toString()}`,
        expiresAt: reply.openPairing.expiresAt
      }
    }
    for (const p of reply.pairings ?? []) {
      if (this.claims.has(p.id) || !this.key) continue
      this.claims.set(p.id, { publicKey: p.publicKey, name: p.name })
      this.waiting.push({
        pairingId: p.id,
        name: p.name,
        code: await pairingCode(this.key.publicKey, p.publicKey)
      })
      this.deps.notify(
        'Allow a new device?',
        `${p.name} wants to pair. Check the code in Titan117.`
      )
    }

    for (const m of reply.inbox ?? []) await this.receive(m)
    this.changed()
    if (this.outbox.length) this.schedule(0)
  }

  private async receive(m: InboxMessage): Promise<void> {
    this.ack.push(m.id)
    const device = this.stored.devices.find((d) => d.publicKey === m.from)
    if (!device || !this.key || m.kind !== 'command') return
    const header: SealHeader = {
      v: REMOTE_PROTOCOL_VERSION,
      from: m.from,
      to: this.key.publicKey,
      kind: 'command',
      id: m.msgId
    }
    const envelope = parseCommandEnvelope(
      await open(header, m.sealed, this.key.private),
      this.now()
    )
    if (!envelope || this.stored.seen[envelope.id]) return
    this.stored.seen[envelope.id] = envelope.expiresAt
    this.prune()
    this.save()

    const c = envelope.command
    const result = await this.deps.commands.run(c, device.name)
    if (c.type === 'task.get' || (c.type === 'task.start' && result.ok && result.taskId)) {
      const id = c.type === 'task.get' ? c.taskId : result.ok ? result.taskId! : ''
      this.watched.set(id, { until: this.now() + WAKE_WINDOW_MS, last: '' })
    }
    // The asker gets the current state next, even if nothing changed.
    if (c.type !== 'task.get') this.lastState = ''
    await this.queue(
      device.publicKey,
      result.ok
        ? {
            type: 'done',
            commandId: envelope.id,
            ok: true,
            ...(result.taskId ? { taskId: result.taskId } : {})
          }
        : { type: 'done', commandId: envelope.id, ok: false, error: result.error }
    )
  }

  /** The state and watched tasks, sent to every device when they changed. */
  private async pushUpdates(): Promise<void> {
    if (!this.confirmed || this.stored.devices.length === 0) return
    const state = await this.deps.commands.state()
    const text = JSON.stringify(state)
    if (text !== this.lastState) {
      this.lastState = text
      for (const d of this.stored.devices)
        await this.queue(d.publicKey, { type: 'state', laptop: this.deps.laptopName, ...state })
    }
    for (const [taskId, w] of this.watched) {
      if (w.until < this.now()) {
        this.watched.delete(taskId)
        continue
      }
      const detail = await this.deps.commands.task(taskId).catch(() => null)
      if (!detail) {
        this.watched.delete(taskId)
        continue
      }
      const t = JSON.stringify(detail)
      if (t === w.last) continue
      w.last = t
      for (const d of this.stored.devices)
        await this.queue(d.publicKey, { type: 'task', ...detail })
    }
  }

  private async queue(to: string, event: RemoteEvent): Promise<void> {
    if (!this.key) return
    const header: SealHeader = {
      v: REMOTE_PROTOCOL_VERSION,
      from: this.key.publicKey,
      to,
      kind: 'event',
      id: randomId()
    }
    const sealed = await seal(
      header,
      { v: REMOTE_PROTOCOL_VERSION, id: randomId(), sentAt: this.now(), event },
      this.key.private
    )
    this.outbox.push({ to, kind: 'event', msgId: header.id, sealed })
  }

  // ---------------------------------------------------------------- keys

  private async beginRotation(): Promise<void> {
    if (!this.key || this.rotating) return
    const next = await generateDeviceKey(true)
    const raw = await exportPrivateKey(next.privateKey)
    this.rotating = { privateRaw: raw, publicKey: next.publicKey }
    // Each remaining device learns the new key, sealed under the old one it already trusts.
    for (const d of this.stored.devices) {
      const header: SealHeader = {
        v: REMOTE_PROTOCOL_VERSION,
        from: this.key.publicKey,
        to: d.publicKey,
        kind: 'key',
        id: randomId()
      }
      const sealed = await seal(
        header,
        { v: REMOTE_PROTOCOL_VERSION, newKey: next.publicKey, sentAt: this.now() },
        this.key.private
      )
      this.outbox.push({ to: d.publicKey, kind: 'key', msgId: header.id, sealed })
    }
  }

  private async finishRotation(): Promise<void> {
    if (!this.rotating) return
    this.writeKey(this.rotating.privateRaw)
    this.key = {
      private: await importPrivateKey(this.rotating.privateRaw),
      publicKey: this.rotating.publicKey
    }
    this.rotating = null
    this.lastState = ''
  }

  private forgetAll(): void {
    this.stored.devices = []
    this.waiting = []
    this.pairing = null
    this.claims.clear()
    this.watched.clear()
    this.outbox = []
    this.save()
    if (this.key) void this.beginRotation()
    this.deps.onRevokedAll()
    this.changed()
  }

  private keyFile(): string {
    return join(this.dir, 'key.bin')
  }

  private writeKey(raw: Uint8Array): void {
    if (!this.deps.keychain) throw new Error('No keychain.')
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.keyFile(), this.deps.keychain.encrypt(Buffer.from(raw).toString('base64')))
  }

  private async loadKey(create = false): Promise<void> {
    if (this.key || !this.deps.keychain) return
    if (existsSync(this.keyFile())) {
      try {
        const raw = new Uint8Array(
          Buffer.from(this.deps.keychain.decrypt(readFileSync(this.keyFile())), 'base64')
        )
        this.key = { private: await importPrivateKey(raw), publicKey: await publicKeyOf(raw) }
        return
      } catch {
        // A key the keychain can't open any more: make a new one; devices pair again.
        rmSync(this.keyFile(), { force: true })
        this.stored.devices = []
      }
    }
    if (!create && !this.stored.on) return
    const pair = await generateDeviceKey(true)
    const raw = await exportPrivateKey(pair.privateKey)
    this.writeKey(raw)
    this.key = { private: await importPrivateKey(raw), publicKey: pair.publicKey }
  }

  // ---------------------------------------------------------------- storage

  private prune(): void {
    const now = this.now()
    for (const [id, expires] of Object.entries(this.stored.seen))
      if (expires < now - REMOTE_MESSAGE_TTL_MS) delete this.stored.seen[id]
  }

  private load(): Stored {
    const empty: Stored = { on: false, devices: [], seen: {}, revokedAllAt: 0, inboxFolder: null }
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'remote.json'), 'utf8')) as Partial<Stored>
      return {
        on: raw.on === true,
        devices: Array.isArray(raw.devices) ? raw.devices : [],
        seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {},
        revokedAllAt: typeof raw.revokedAllAt === 'number' ? raw.revokedAllAt : 0,
        inboxFolder: typeof raw.inboxFolder === 'string' ? raw.inboxFolder : null
      }
    } catch {
      return empty
    }
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, 'remote.json'), JSON.stringify(this.stored))
  }

  private changed(): void {
    this.deps.onChange(this.view())
  }
}
