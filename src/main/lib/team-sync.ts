/**
 * Teams on the laptop (11.6; decisions §68): agents and sidebar apps' data
 * shared between team members' laptops, end to end encrypted under the
 * team key. Sync between the user's own laptops (§65, laptop-sync.ts) is the
 * model; what differs:
 *
 * - **One key pair for all teams** (X25519, kept by the OS keychain), and a
 *   team key per team and generation.
 * - **Only an owner's or admin's laptop lets a laptop in**, after the two
 *   people compared the code both laptops show. A key sealed by a laptop this
 *   one never checked a code with always asks first, so Convex can't slip in
 *   a key of its own.
 * - **Roles are enforced three times:** the shell sends only what this
 *   person's role allows, Convex refuses the rest, and every receiving
 *   laptop drops a package whose sender's role (when sent, and now) doesn't
 *   allow it.
 * - **A shared agent is a standing instruction**, so it waits in the team's
 *   inbox until the user adds it here with a click (as a marketplace item);
 *   an update asks again. Its source reads "team <team> · <person>".
 * - **Apps' data** travels only for apps this laptop shares with the team
 *   and has in its own sidebar; the app itself isn't sent in this part.
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
import type { TeamBrandView, TeamView, TeamsView } from '../../shared/remote-views'
import { teamCan, type TeamRole } from '../../shared/team-roles'
import type { EngineCall } from './remote-commands'
import { openPackage, sealPackage } from './sync-package'

export type { TeamBrandView, TeamView, TeamsView }

const FAST_MS = 5_000
const SLOW_MS = 30_000
const ID = /^[a-z0-9]{10,64}$/

interface Stored {
  on: boolean
  cursor: number
  appCursors: Record<string, number>
  /** Agents shared, by name: the last version sent (their file's updatedAt). */
  sharedAgents: Record<string, number>
  sharedApps: string[]
  /** Apps whose source was shared with the team, by id: the last build sent. */
  sharedAppCode: Record<string, string>
  resendSeen: number
  lastMembers: string[]
  trusted: string[]
  inbox: TeamView['inbox'][number][]
  /** Agents added from the team, by name: the inbox entry they came from (for "update"). */
  added: Record<string, string>
  lastSyncAt: number | null
}

interface Laptop {
  id: string
  name: string
  publicKey: string
  status: 'waiting' | 'in'
  keyGen: number | null
  person: string
  userId: string
  role: TeamRole | null
}

interface Reply {
  error?: string
  on?: boolean
  team?: { id: string; name: string; myRole: TeamRole; myUserId: string }
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
  laptops?: Laptop[]
  people?: { userId: string; name: string; role: TeamRole }[]
  changes?: {
    seq: number
    keyGen: number
    kind: 'item' | 'data'
    role: TeamRole
    from: string
    size: number
    own: boolean
    url: string | null
  }[]
  top?: number
  gap?: boolean
  resendAt?: number | null
  /** The audit log's sealed notes, for owners and admins (decisions §68.9). */
  notes?: { at: number; actor: string; action: string; sealed: string }[]
}

interface Outgoing {
  admit?: { laptopId: string; sealedKey: string; keyMsgId: string; keyGen: number }
  refuse?: string
  remove?: string
  rekey?: { keyGen: number; keys: { laptopId: string; sealedKey: string; keyMsgId: string }[] }
  resend?: boolean
  notes?: { action: 'item.shared' | 'item.updated' | 'item.removed'; sealed: string }[]
}

/** What a team package may hold (`item`: agents; `data`: an app's records). */
export type TeamBody =
  | { type: 'agent'; name: string; text: string; updatedAt: number }
  | { type: 'agent-removed'; name: string }
  | { type: 'data'; app: string; entries: unknown[] }
  | {
      type: 'app'
      id: string
      title: string
      manifest: { reads: string[]; writes: string[]; ai: boolean }
      files: { path: string; data: string }[]
    }

export interface TeamSyncDeps {
  dataDir: string
  laptopName: string
  keychain: { encrypt(text: string): Buffer; decrypt(data: Buffer): string } | null
  apiUrl(): string | null
  deviceToken(): string | null
  engine: EngineCall
  notify(title: string, body: string): void
  onChange(view: TeamsView): void
  fetch?: typeof fetch
  now?: () => number
  manual?: boolean
}

/** One team's state on this laptop (exported for tests). */
export class Team {
  stored: Stored
  keys = new Map<number, Buffer>()
  status: TeamView['status'] = 'off'
  problem: string | null = null
  laptops: Laptop[] = []
  people: NonNullable<Reply['people']> = []
  codes = new Map<string, string>()
  myId: string | null = null
  myUserId: string | null = null
  currentGen = 0
  pending: { gen: number; key: Buffer; by: string; byName: string; code: string } | null = null
  outgoing: Outgoing = {}
  sendOff = false
  activity: TeamView['activity'] = []

  constructor(
    readonly id: string,
    public name: string,
    public role: TeamRole,
    public active: boolean,
    readonly dir: string
  ) {
    this.stored = this.load()
    if (this.stored.on) this.status = 'joining'
  }

  get aad(): Buffer {
    return Buffer.from(`titan117-team-v1:${this.id}`)
  }

  empty(): Stored {
    return {
      on: false,
      cursor: 0,
      appCursors: {},
      sharedAgents: {},
      sharedApps: [],
      sharedAppCode: {},
      resendSeen: 0,
      lastMembers: [],
      trusted: [],
      inbox: [],
      added: {},
      lastSyncAt: null
    }
  }

  load(): Stored {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'team.json'), 'utf8')) as Partial<Stored>
      return { ...this.empty(), ...raw, on: raw.on === true }
    } catch {
      return this.empty()
    }
  }

  save(): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, 'team.json'), JSON.stringify(this.stored))
  }

  /** Someone's role now, by user id (null once they've left). */
  roleOf(userId: string): TeamRole | null {
    return this.people.find((p) => p.userId === userId)?.role ?? null
  }
}

export class TeamSync {
  private teams = new Map<string, Team>()
  private identity: { private: CryptoKey; publicKey: string } | null = null
  private brand: TeamBrandView | null = null
  private problem: string | null = null
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly dir: string
  private readonly fetch: typeof fetch
  private readonly now: () => number

  constructor(private readonly deps: TeamSyncDeps) {
    this.dir = join(deps.dataDir, 'teams')
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
  }

  // ---------------------------------------------------------------- the window

  view(): TeamsView {
    return {
      signedIn: !!this.deps.apiUrl() && !!this.deps.deviceToken(),
      keychain: this.deps.keychain !== null,
      problem: this.problem,
      brand: this.brand,
      teams: [...this.teams.values()].map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        active: t.active,
        on: t.stored.on,
        status: t.stored.on ? t.status : 'off',
        problem: t.problem,
        laptops: t.laptops
          .filter((l) => l.status === 'in')
          .map((l) => ({
            id: l.id,
            name: l.name,
            person: l.person,
            role: l.role,
            me: l.id === t.myId,
            code: l.id === t.myId ? null : (t.codes.get(l.publicKey) ?? null)
          })),
        waiting:
          t.status === 'in' && t.keys.has(t.currentGen) && teamCan(t.role, 'admitLaptop')
            ? t.laptops
                .filter((l) => l.status === 'waiting')
                .map((l) => ({
                  id: l.id,
                  name: l.name,
                  person: l.person,
                  code: t.codes.get(l.publicKey) ?? ''
                }))
            : [],
        confirm: t.pending ? { by: t.pending.byName, code: t.pending.code } : null,
        sharedAgents: Object.keys(t.stored.sharedAgents),
        sharedApps: t.stored.sharedApps,
        sharedAppCode: Object.keys(t.stored.sharedAppCode),
        activity: t.activity,
        inbox: t.stored.inbox,
        lastSyncAt: t.stored.lastSyncAt
      }))
    }
  }

  async start(): Promise<void> {
    this.schedule(0)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private team(teamId: unknown): Team | null {
    return typeof teamId === 'string' && ID.test(teamId) ? (this.teams.get(teamId) ?? null) : null
  }

  /** This laptop joins the team's key (the owner's first laptop makes it). */
  async join(teamId: string): Promise<void> {
    const t = this.team(teamId)
    if (!t) return
    if (!this.deps.keychain) {
      t.problem =
        'This laptop has no keychain Titan117 can use, so it can’t keep the team key safe.'
      return this.changed()
    }
    t.stored = { ...t.empty(), on: true }
    t.status = 'joining'
    t.problem = null
    t.save()
    this.changed()
    this.schedule(0)
  }

  /** This laptop leaves the team's key; the others change theirs. */
  leave(teamId: string): void {
    const t = this.team(teamId)
    if (!t) return
    t.sendOff = true
    t.stored = t.empty()
    t.keys.clear()
    t.pending = null
    t.laptops = []
    t.status = 'off'
    rmSync(join(t.dir, 'keys.bin'), { force: true })
    t.save()
    this.changed()
    this.schedule(0)
  }

  async allow(teamId: string, laptopId: string): Promise<void> {
    const t = this.team(teamId)
    const l = t?.laptops.find((x) => x.id === laptopId && x.status === 'waiting')
    const key = t?.keys.get(t.currentGen)
    if (!t || !l || !key || !this.identity || !teamCan(t.role, 'admitLaptop')) return
    const header = this.header(l.publicKey)
    const sealedKey = await seal(
      header,
      { v: 1, team: t.id, gen: t.currentGen, key: key.toString('base64') },
      this.identity.private
    )
    t.outgoing.admit = { laptopId, sealedKey, keyMsgId: header.id, keyGen: t.currentGen }
    this.trust(t, l.publicKey)
    this.schedule(0)
  }

  refuse(teamId: string, laptopId: string): void {
    const t = this.team(teamId)
    if (!t || !teamCan(t.role, 'admitLaptop')) return
    t.outgoing.refuse = laptopId
    this.schedule(0)
  }

  remove(teamId: string, laptopId: string): void {
    const t = this.team(teamId)
    if (!t || laptopId === t.myId) return
    t.outgoing.remove = laptopId
    this.schedule(0)
  }

  confirmKey(teamId: string, accept: boolean): void {
    const t = this.team(teamId)
    const p = t?.pending
    if (!t || !p) return
    t.pending = null
    if (accept) {
      t.keys.set(p.gen, p.key)
      this.trust(t, p.by)
      this.saveKeys(t)
    } else
      t.problem =
        'You didn’t confirm the code, so this laptop isn’t in the team. Leave and join again to try again.'
    this.changed()
    this.schedule(0)
  }

  /** Share an agent with the team (members and up). It is sent on the next round and again when it changes. */
  async shareAgent(teamId: string, name: string, on: boolean): Promise<void> {
    const t = this.team(teamId)
    if (!t || !teamCan(t.role, 'shareItems')) return
    if (on) t.stored.sharedAgents[name] = 0
    else if (name in t.stored.sharedAgents) {
      delete t.stored.sharedAgents[name]
      await this.sendItem(t, { type: 'agent-removed', name }, 'item.removed')
    }
    t.save()
    this.changed()
    this.schedule(0)
  }

  /** Share an app's data with the team (members and up; viewers receive only). */
  shareApp(teamId: string, appId: string, on: boolean): void {
    const t = this.team(teamId)
    if (!t || !/^[a-z0-9-]{1,60}$/.test(appId)) return
    // A viewer receives the team's records; switching sharing off on a viewer's laptop is allowed.
    t.stored.sharedApps = t.stored.sharedApps.filter((a) => a !== appId)
    if (on) {
      t.stored.sharedApps.push(appId)
      delete t.stored.appCursors[appId]
    }
    t.save()
    this.changed()
    this.schedule(0)
  }

  /** The user's click: add a shared agent from the inbox to this laptop's agents. */
  /**
   * Share a sidebar app itself with the team (members and up, decisions §68.13): its source,
   * without packages, builds or secrets. Sent once now; the user shares it again for a new version.
   */
  async shareAppCode(teamId: string, appId: string): Promise<string | null> {
    const t = this.team(teamId)
    if (!t || !teamCan(t.role, 'shareItems') || !/^[a-z0-9-]{1,60}$/.test(appId))
      return 'Your role doesn’t share apps.'
    if (t.status !== 'in') return 'Join the team on this laptop first.'
    let bundle: TeamBody
    try {
      ;({ bundle } = await this.deps.engine<{ bundle: TeamBody }>(
        'GET',
        `/v1/sync/apps/${encodeURIComponent(appId)}/pack`
      ))
    } catch (e) {
      return e instanceof Error ? e.message : 'The app couldn’t be packed.'
    }
    if (
      !(await this.sendItem(
        t,
        bundle,
        appId in t.stored.sharedAppCode ? 'item.updated' : 'item.shared'
      ))
    )
      return 'The app is too large to share, or Titan117 can’t be reached. Try again later.'
    t.stored.sharedAppCode[appId] = new Date(this.now()).toISOString()
    // Its records go with it from now on.
    if (!t.stored.sharedApps.includes(appId)) t.stored.sharedApps.push(appId)
    t.save()
    await this.pushReadOnly()
    this.changed()
    this.schedule(0)
    return null
  }

  /** The user's click: copy a shared app's source into a new folder named after it inside `parent`. */
  async addAppFromInbox(teamId: string, entryId: string, parent: string): Promise<string | null> {
    const t = this.team(teamId)
    const entry = t?.stored.inbox.find((e) => e.id === entryId && e.type === 'app')
    if (!t || !entry || !entry.appId) return 'That’s gone.'
    const text = this.readInboxFile(t, entry.id)
    if (!text) return 'That’s gone.'
    const folder = `${parent.replace(/[\\/]+$/, '')}/${entry.appId}`
    try {
      await this.deps.engine('POST', '/v1/sync/unpack', {
        bundle: JSON.parse(text) as unknown,
        folder
      })
    } catch (e) {
      return e instanceof Error ? e.message : 'The app couldn’t be copied.'
    }
    // Its records travel once it's in this laptop's sidebar too.
    if (!t.stored.sharedApps.includes(entry.appId)) t.stored.sharedApps.push(entry.appId)
    this.dropInbox(t, entry.id)
    await this.pushReadOnly()
    this.changed()
    return null
  }

  async addFromInbox(teamId: string, entryId: string): Promise<string | null> {
    const t = this.team(teamId)
    const entry = t?.stored.inbox.find((e) => e.id === entryId)
    if (!t || !entry || entry.type !== 'agent') return 'That’s gone.'
    const text = this.readInboxFile(t, entry.id)
    if (!text) return 'That’s gone.'
    try {
      await this.deps.engine('POST', '/v1/agents/team/import', {
        text,
        source: `team ${t.name} · ${entry.from}`.slice(0, 120)
      })
    } catch (e) {
      return e instanceof Error ? e.message : 'The agent couldn’t be added.'
    }
    t.stored.added[entry.name] = entry.id
    this.dropInbox(t, entry.id)
    this.changed()
    return null
  }

  dismiss(teamId: string, entryId: string): void {
    const t = this.team(teamId)
    if (!t) return
    this.dropInbox(t, entryId)
    this.changed()
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
    let busy = false
    try {
      await this.refreshTeams()
      for (const t of this.teams.values()) {
        try {
          await this.round(t)
        } catch {
          t.problem = 'Can’t reach Titan117 right now. The team carries on when it can.'
        }
        busy ||=
          t.stored.on &&
          (t.status !== 'in' || !!t.pending || t.laptops.some((l) => l.status === 'waiting'))
      }
      await this.pushReadOnly()
      this.changed()
    } catch {
      this.problem = 'Can’t reach Titan117 right now.'
      this.changed()
    } finally {
      this.running = false
      this.schedule(busy ? FAST_MS : SLOW_MS)
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T & { error?: string }> {
    const res = await this.fetch(`${this.deps.apiUrl()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.deps.deviceToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const reply = (await res.json().catch(() => ({ error: 'INTERNAL' }))) as T & { error?: string }
    if (!res.ok && !reply.error) reply.error = 'INTERNAL'
    return reply
  }

  /** Which teams this person is in, with their role, and the brand for the header. */
  private async refreshTeams(): Promise<void> {
    if (!this.deps.apiUrl() || !this.deps.deviceToken()) return
    const reply = await this.post<{
      teams?: { id: string; name: string; role: TeamRole; active: boolean }[]
      brand?: TeamBrandView | null
    }>('/desktop/teams', {})
    if (reply.error || !reply.teams) {
      this.problem =
        reply.error === 'UNAUTHENTICATED'
          ? 'Sign in to your Titan117 account again.'
          : 'Titan117 refused that.'
      return
    }
    this.problem = null
    this.brand = reply.brand ?? null
    const seen = new Set<string>()
    for (const row of reply.teams) {
      if (!ID.test(row.id)) continue
      seen.add(row.id)
      const t =
        this.teams.get(row.id) ??
        new Team(row.id, row.name, row.role, row.active, join(this.dir, row.id))
      t.name = row.name
      t.role = row.role
      t.active = row.active
      if (!this.teams.has(row.id)) {
        this.teams.set(row.id, t)
        if (t.stored.on) this.loadTeamKeys(t)
      }
    }
    // Teams this person left or was removed from: keys and inbox go from this laptop.
    for (const [id, t] of this.teams)
      if (!seen.has(id)) {
        this.teams.delete(id)
        rmSync(t.dir, { recursive: true, force: true })
      }
  }

  private async round(t: Team): Promise<void> {
    if (t.sendOff) {
      const r = await this.post<Reply>('/desktop/team', { teamId: t.id, on: false })
      if (!r.error) t.sendOff = false
    }
    if (!t.stored.on || !t.active) return
    await this.loadIdentity(true)
    if (!this.identity) return
    const out = t.outgoing
    t.outgoing = {}
    const reply = await this.post<Reply>('/desktop/team', {
      teamId: t.id,
      on: true,
      publicKey: this.identity.publicKey,
      cursor: t.stored.cursor,
      ...out
    })
    if (reply.error || !reply.me || !reply.team) {
      t.outgoing = { ...out, ...t.outgoing }
      t.problem =
        reply.error === 'PAYMENT_REQUIRED'
          ? 'The team’s plan doesn’t cover you right now.'
          : reply.error === 'FORBIDDEN' && t.role !== 'owner' && t.status === 'joining'
            ? 'The team’s owner has to switch the team on from their laptop first.'
            : 'Titan117 refused that.'
      return
    }
    t.problem = null
    t.role = reply.team.myRole
    t.myUserId = reply.team.myUserId
    t.myId = reply.me.id
    t.laptops = reply.laptops ?? []
    t.people = reply.people ?? []
    t.currentGen = reply.keyGen ?? 1
    for (const l of t.laptops)
      if (!t.codes.has(l.publicKey)) t.codes.set(l.publicKey, await this.codeWith(l.publicKey))
    if (reply.me.status === 'waiting') {
      t.status = 'waiting'
      return
    }
    this.openNotes(t, reply.notes ?? [])
    await this.takeKey(t, reply)
    t.status = 'in'

    const inside = t.laptops.filter((l) => l.status === 'in').map((l) => l.publicKey)
    const gone = t.stored.lastMembers.filter((k) => !inside.includes(k))
    if (t.keys.has(t.currentGen) && gone.length && !reply.rekeyRefused) await this.rekey(t)
    else t.stored.lastMembers = inside

    if (reply.gap) {
      t.outgoing.resend = true
      t.stored.cursor = reply.top ?? t.stored.cursor
    }
    if (reply.resendAt && reply.resendAt > t.stored.resendSeen) {
      t.stored.resendSeen = reply.resendAt
      t.stored.appCursors = {}
      for (const name of Object.keys(t.stored.sharedAgents)) t.stored.sharedAgents[name] = 0
    }
    const key = t.keys.get(t.currentGen)
    if (key) {
      await this.receive(t, reply.changes ?? [])
      await this.sendOurs(t, key)
      t.stored.lastSyncAt = this.now()
    }
    t.save()
  }

  private header(to: string, id = randomId(), from = this.identity!.publicKey): SealHeader {
    return { v: REMOTE_PROTOCOL_VERSION, from, to, kind: 'sync', id }
  }

  private async takeKey(t: Team, reply: Reply): Promise<void> {
    const me = reply.me!
    if (!this.identity) return
    if (
      !me.sealedKey &&
      me.keyGen &&
      !t.keys.has(me.keyGen) &&
      t.keys.size === 0 &&
      t.role === 'owner'
    ) {
      t.keys.set(me.keyGen, randomBytes(32))
      this.saveKeys(t)
      return
    }
    if (!me.sealedKey || !me.sealedBy || !me.keyMsgId || !me.keyGen) return
    if (t.keys.has(me.keyGen) || t.pending?.gen === me.keyGen) return
    const opened = (await open(
      this.header(this.identity.publicKey, me.keyMsgId, me.sealedBy),
      me.sealedKey,
      this.identity.private
    )) as {
      team?: unknown
      gen?: unknown
      key?: unknown
    } | null
    // A key for another team, or another generation, isn't this one.
    if (
      !opened ||
      opened.team !== t.id ||
      opened.gen !== me.keyGen ||
      typeof opened.key !== 'string'
    )
      return
    const key = Buffer.from(opened.key, 'base64')
    if (key.length !== 32) return
    if (t.stored.trusted.includes(me.sealedBy)) {
      t.keys.set(me.keyGen, key)
      this.saveKeys(t)
      return
    }
    const by = t.laptops.find((l) => l.publicKey === me.sealedBy)
    t.pending = {
      gen: me.keyGen,
      key,
      by: me.sealedBy,
      byName: by ? `${by.person} (${by.name})` : 'A team laptop',
      code: await this.codeWith(me.sealedBy)
    }
    this.deps.notify('Check the team code', `${t.pending.byName} let this laptop into ${t.name}.`)
  }

  private async rekey(t: Team): Promise<void> {
    if (!this.identity) return
    const gen = t.currentGen + 1
    const key = randomBytes(32)
    const keys: { laptopId: string; sealedKey: string; keyMsgId: string }[] = []
    for (const l of t.laptops.filter((x) => x.status === 'in' && x.id !== t.myId)) {
      const header = this.header(l.publicKey)
      keys.push({
        laptopId: l.id,
        keyMsgId: header.id,
        sealedKey: await seal(
          header,
          { v: 1, team: t.id, gen, key: key.toString('base64') },
          this.identity.private
        )
      })
    }
    const reply = await this.post<Reply>('/desktop/team', {
      teamId: t.id,
      on: true,
      publicKey: this.identity.publicKey,
      rekey: { keyGen: gen, keys }
    })
    if (!reply.error && !reply.rekeyRefused) {
      t.keys.set(gen, key)
      t.currentGen = gen
      this.saveKeys(t)
    }
    t.stored.lastMembers = t.laptops.filter((l) => l.status === 'in').map((l) => l.publicKey)
  }

  /** Packages from the team, in order; anything a sender's role doesn't allow is dropped here too. */
  private async receive(t: Team, changes: NonNullable<Reply['changes']>): Promise<void> {
    for (const c of changes) {
      if (!c.own && c.url) {
        const key = t.keys.get(c.keyGen)
        if (!key) {
          if (c.keyGen > t.currentGen || t.pending) return
        } else {
          const res = await this.fetch(c.url)
          if (!res.ok) return
          const body = openPackage(key, await res.text(), t.aad) as TeamBody | null
          if (body) await this.apply(t, c, body)
        }
      }
      t.stored.cursor = c.seq
    }
  }

  /** Exported for tests: what a received package does on this laptop. */
  async apply(
    t: Team,
    c: { kind: 'item' | 'data'; role: TeamRole; from: string },
    body: TeamBody
  ): Promise<boolean> {
    const now = t.roleOf(c.from)
    const allowed = (action: 'shareItems' | 'writeData'): boolean =>
      teamCan(c.role, action) && teamCan(now, action)
    const person = t.people.find((p) => p.userId === c.from)?.name ?? 'Someone'
    if (body.type === 'agent' && c.kind === 'item' && allowed('shareItems')) {
      if (
        typeof body.name !== 'string' ||
        typeof body.text !== 'string' ||
        body.text.length > 100_000
      )
        return false
      const name = body.name.slice(0, 40)
      // One waiting entry per agent: a newer version replaces it.
      for (const old of t.stored.inbox.filter((e) => e.name === name)) this.dropInbox(t, old.id)
      const id = randomId()
      mkdirSync(join(t.dir, 'inbox'), { recursive: true })
      writeFileSync(join(t.dir, 'inbox', `${id}.md`), body.text)
      t.stored.inbox.push({
        id,
        type: 'agent',
        name,
        from: person,
        role: c.role,
        at: this.now(),
        update: name in t.stored.added
      })
      this.deps.notify(
        `${t.name}: a shared agent`,
        `${person} shared ${name}. Open Team to add it.`
      )
      return true
    }
    if (body.type === 'app' && c.kind === 'item' && allowed('shareItems')) {
      if (
        typeof body.id !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{0,59}$/.test(body.id) ||
        !Array.isArray(body.files)
      )
        return false
      for (const old of t.stored.inbox.filter((e) => e.type === 'app' && e.appId === body.id))
        this.dropInbox(t, old.id)
      const id = randomId()
      mkdirSync(join(t.dir, 'inbox'), { recursive: true })
      // The engine checks every path again before writing anything (team-share.ts).
      writeFileSync(join(t.dir, 'inbox', `${id}.md`), JSON.stringify(body))
      const m = body.manifest ?? { reads: [], writes: [], ai: false }
      t.stored.inbox.push({
        id,
        type: 'app',
        name: String(body.title).slice(0, 60),
        appId: body.id,
        asks: { reads: m.reads ?? [], writes: m.writes ?? [], ai: m.ai === true },
        from: person,
        role: c.role,
        at: this.now(),
        update: false
      })
      this.deps.notify(
        `${t.name}: a shared app`,
        `${person} shared ${String(body.title).slice(0, 60)}. Open Team to add it.`
      )
      return true
    }
    if (body.type === 'agent-removed' && c.kind === 'item' && allowed('shareItems')) {
      for (const old of t.stored.inbox.filter((e) => e.name === body.name))
        this.dropInbox(t, old.id)
      return true
    }
    if (body.type === 'data' && c.kind === 'data' && allowed('writeData')) {
      if (
        typeof body.app !== 'string' ||
        !Array.isArray(body.entries) ||
        !t.stored.sharedApps.includes(body.app)
      )
        return false
      const { apps } = await this.deps.engine<{ apps: string[] }>('GET', '/v1/sync/apps')
      if (!apps.includes(body.app)) return false
      await this.deps.engine('POST', `/v1/sync/apps/${encodeURIComponent(body.app)}`, {
        entries: body.entries
      })
      return true
    }
    return false
  }

  /** This laptop's shared agents (when they changed) and shared apps' changes, as this role allows. */
  private async sendOurs(t: Team, key: Buffer): Promise<void> {
    if (teamCan(t.role, 'shareItems')) {
      const { agents } = await this.deps.engine<{
        agents: { name: string; builtIn?: boolean; updatedAt?: number }[]
      }>('GET', '/v1/agents')
      for (const [name, sent] of Object.entries(t.stored.sharedAgents)) {
        const agent = agents.find((a) => a.name === name && !a.builtIn)
        if (!agent) continue
        const at = agent.updatedAt ?? 0
        if (sent && at <= sent) continue
        const { text } = await this.deps.engine<{ text: string }>(
          'GET',
          `/v1/agents/${encodeURIComponent(name)}/file`
        )
        if (
          !(await this.sendItem(
            t,
            { type: 'agent', name, text, updatedAt: at },
            sent ? 'item.updated' : 'item.shared',
            key
          ))
        )
          return
        t.stored.sharedAgents[name] = Math.max(at, 1)
        t.save()
      }
    }
    if (!teamCan(t.role, 'writeData')) return
    const { apps } = await this.deps.engine<{ apps: string[] }>('GET', '/v1/sync/apps')
    for (const app of t.stored.sharedApps.filter((a) => apps.includes(a))) {
      for (let round = 0; round < 20; round++) {
        const since = t.stored.appCursors[app] ?? 0
        const page = await this.deps.engine<{ upTo: number; entries: unknown[] }>(
          'GET',
          `/v1/sync/apps/${encodeURIComponent(app)}?since=${since}&limit=200`
        )
        if (page.entries.length === 0) {
          t.stored.appCursors[app] = page.upTo
          break
        }
        const sealed = sealPackage(
          key,
          { type: 'data', app, entries: page.entries } satisfies TeamBody,
          t.aad
        )
        if (sealed.length <= SYNC_MAX_PACKAGE_BYTES && !(await this.upload(t, 'data', sealed)))
          return
        t.stored.appCursors[app] = page.upTo
        t.save()
      }
    }
  }

  private async sendItem(
    t: Team,
    body: TeamBody,
    action: 'item.shared' | 'item.updated' | 'item.removed',
    key = t.keys.get(t.currentGen)
  ): Promise<boolean> {
    if (!key) return false
    const sealed = sealPackage(key, body, t.aad)
    if (sealed.length > SYNC_MAX_PACKAGE_BYTES || !(await this.upload(t, 'item', sealed)))
      return false
    // A note for the audit log, sealed under the team key: which agent, readable only by the team.
    const what =
      body.type === 'app' ? `the app ${body.title}` : 'name' in body ? `the agent ${body.name}` : ''
    const note = sealPackage(key, { action, name: what }, t.aad)
    const urlSafe = Buffer.from(note, 'base64').toString('base64url')
    if (urlSafe.length <= 2000) (t.outgoing.notes ??= []).push({ action, sealed: urlSafe })
    return true
  }

  private async upload(t: Team, kind: 'item' | 'data', sealed: string): Promise<boolean> {
    const res = await this.fetch(`${this.deps.apiUrl()}/desktop/team/package`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.deps.deviceToken()}`,
        'Content-Type': 'application/octet-stream',
        'X-Titan117-Team': t.id,
        'X-Titan117-Kind': kind,
        'X-Titan117-Key-Gen': String(t.currentGen)
      },
      body: sealed
    })
    return res.ok
  }

  /** The audit log's notes this laptop can open: which agent or app was shared, and by whom. */
  private openNotes(t: Team, notes: NonNullable<Reply['notes']>): void {
    const out: TeamView['activity'] = []
    for (const n of notes.slice(0, 50)) {
      let opened: unknown = null
      for (const key of t.keys.values()) {
        opened = openPackage(key, Buffer.from(n.sealed, 'base64url').toString('base64'), t.aad)
        if (opened) break
      }
      const name = (opened as { name?: unknown } | null)?.name
      if (typeof name === 'string' && name)
        out.push({
          at: n.at,
          who: n.actor.slice(0, 60),
          action: n.action,
          what: name.slice(0, 120)
        })
    }
    t.activity = out
  }

  /**
   * Apps shared with a team where this person is a viewer: read-only in the engine
   * (decisions §68.13), for the app's frame and for Titan.
   */
  private lastReadOnly = ''
  async pushReadOnly(): Promise<void> {
    const apps: Record<string, string> = {}
    for (const t of this.teams.values())
      if (t.stored.on && t.role === 'viewer')
        for (const a of t.stored.sharedApps) apps[a] ??= t.name
    const text = JSON.stringify(apps)
    if (text === this.lastReadOnly) return
    try {
      await this.deps.engine('PUT', '/v1/sync/read-only', { apps })
      this.lastReadOnly = text
    } catch {
      // The engine may be starting; the next round tries again.
    }
  }

  // ---------------------------------------------------------------- inbox files

  private readInboxFile(t: Team, id: string): string | null {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null
    try {
      return readFileSync(join(t.dir, 'inbox', `${id}.md`), 'utf8')
    } catch {
      return null
    }
  }

  private dropInbox(t: Team, id: string): void {
    t.stored.inbox = t.stored.inbox.filter((e) => e.id !== id)
    if (/^[A-Za-z0-9_-]{8,64}$/.test(id)) rmSync(join(t.dir, 'inbox', `${id}.md`), { force: true })
    t.save()
  }

  // ---------------------------------------------------------------- keys

  private async codeWith(other: string): Promise<string> {
    if (!this.identity) return ''
    const [a, b] = [this.identity.publicKey, other].sort()
    return pairingCode(a, b)
  }

  private trust(t: Team, publicKey: string): void {
    if (!t.stored.trusted.includes(publicKey)) t.stored.trusted.push(publicKey)
    t.save()
  }

  private async loadIdentity(create = false): Promise<void> {
    if (this.identity || !this.deps.keychain) return
    const idFile = join(this.dir, 'identity.bin')
    try {
      if (existsSync(idFile)) {
        const raw = new Uint8Array(
          Buffer.from(this.deps.keychain.decrypt(readFileSync(idFile)), 'base64')
        )
        this.identity = { private: await importPrivateKey(raw), publicKey: await publicKeyOf(raw) }
        return
      }
    } catch {
      rmSync(idFile, { force: true })
    }
    if (!create) return
    const pair = await generateDeviceKey(true)
    const raw = await exportPrivateKey(pair.privateKey)
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(idFile, this.deps.keychain.encrypt(Buffer.from(raw).toString('base64')))
    this.identity = { private: await importPrivateKey(raw), publicKey: pair.publicKey }
  }

  private loadTeamKeys(t: Team): void {
    if (!this.deps.keychain) return
    try {
      const file = join(t.dir, 'keys.bin')
      if (!existsSync(file)) return
      const saved = JSON.parse(this.deps.keychain.decrypt(readFileSync(file))) as Record<
        string,
        string
      >
      for (const [gen, key] of Object.entries(saved))
        t.keys.set(Number(gen), Buffer.from(key, 'base64'))
    } catch {
      rmSync(join(t.dir, 'keys.bin'), { force: true })
    }
  }

  private saveKeys(t: Team): void {
    if (!this.deps.keychain) return
    mkdirSync(t.dir, { recursive: true })
    const all: Record<string, string> = {}
    for (const [gen, key] of t.keys) all[String(gen)] = key.toString('base64')
    writeFileSync(join(t.dir, 'keys.bin'), this.deps.keychain.encrypt(JSON.stringify(all)))
  }

  private changed(): void {
    this.deps.onChange(this.view())
  }
}
