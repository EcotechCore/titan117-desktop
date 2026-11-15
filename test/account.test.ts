// The Titan117 account on this laptop (decisions §17, §39): the signed
// licence lease, the browser sign-in with a loopback redirect and PKCE, the
// lock, and cloud calls through the credits proxy with the device token.
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { engineFetch, NetworkError } from '../src/engine/lib/net'
import { Account, type AccountView } from '../src/main/lib/account'
import { accountStatus, verifyLease, type Lease } from '../src/main/lease'
import type { Engine } from '../src/engine/lib/engine'
import type { TaskDetail } from '../src/shared/protocol'
import { call, MODEL, scripted, tempFolder, testEngine, until } from './helpers'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 10, 15, 12)

const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const PUBLIC = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

function signLease(payload: Partial<Lease>, key: KeyObject = keys.privateKey): string {
  const full: Lease = {
    v: 1,
    sub: 'user_1',
    dev: 'dev_1',
    plan: 'pro',
    devices: 3,
    iat: T0,
    exp: T0 + 14 * DAY,
    ...payload
  }
  const body = Buffer.from(JSON.stringify(full)).toString('base64url')
  const sig = sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url'
  )
  return `${body}.${sig}`
}

describe('the lease', () => {
  it('accepts only our signature over the exact contents', () => {
    const lease = signLease({})
    expect(verifyLease(lease, [PUBLIC])).toMatchObject({ plan: 'pro', exp: T0 + 14 * DAY })
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    expect(verifyLease(signLease({}, other.privateKey), [PUBLIC])).toBeNull()

    const [body, sig] = lease.split('.')
    const edited = JSON.parse(Buffer.from(body, 'base64url').toString())
    edited.exp = T0 + 999 * DAY
    expect(
      verifyLease(`${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${sig}`, [PUBLIC])
    ).toBeNull()
    expect(verifyLease('nonsense', [PUBLIC])).toBeNull()
    expect(verifyLease(`${lease}.extra`, [PUBLIC])).toBeNull()
  })

  it('locks when signed out, without a plan, or once expired', () => {
    const lease = verifyLease(signLease({}), [PUBLIC])!
    expect(accountStatus({ signedIn: false, lease, now: T0 })).toMatchObject({
      locked: true,
      reason: 'signedOut'
    })
    expect(accountStatus({ signedIn: true, lease: null, now: T0 })).toMatchObject({
      locked: true,
      reason: 'noPlan'
    })
    expect(
      accountStatus({ signedIn: true, lease: { ...lease, plan: null }, now: T0 })
    ).toMatchObject({
      locked: true,
      reason: 'noPlan'
    })
    expect(accountStatus({ signedIn: true, lease, now: T0 + DAY })).toMatchObject({
      locked: false,
      warn: false
    })
    expect(accountStatus({ signedIn: true, lease, now: T0 + 12 * DAY })).toMatchObject({
      locked: false,
      warn: true
    })
    expect(accountStatus({ signedIn: true, lease, now: T0 + 14 * DAY })).toMatchObject({
      locked: true,
      reason: 'expired'
    })
  })

  it("a clock set before the lease was signed doesn't stretch it", () => {
    const lease = verifyLease(signLease({}), [PUBLIC])!
    // Thirteen days left from the signing time, however far back the clock goes.
    const status = accountStatus({ signedIn: true, lease, now: T0 - 365 * DAY })
    expect(status.expiresAt! - T0).toBe(14 * DAY)
    expect(status.warn).toBe(false)
  })
})

describe('signing in on this laptop', () => {
  const keychain = {
    encrypt: (text: string) => Buffer.from(`enc:${Buffer.from(text).toString('base64')}`),
    decrypt: (data: Buffer) => Buffer.from(data.toString().slice(4), 'base64').toString()
  }

  interface FakeServer {
    fetchFake: typeof fetch
    openExternal(page: string): Promise<void>
    opened(): URL | null
  }

  /** Our web page and Convex, faked: the browser hands back a code, the exchange checks PKCE. */
  function fakeServer(
    opts: { lease?: string; refreshStatus?: number; refreshLease?: string } = {}
  ): FakeServer {
    let challenge = ''
    let opened: URL | null = null
    const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/desktop/exchange') {
        const body = JSON.parse(String(init?.body)) as { code: string; verifier: string }
        const ok =
          body.code === 'the-code' &&
          createHash('sha256').update(body.verifier).digest('base64url') === challenge
        return ok
          ? Response.json({
              token: 't117d_' + 'a'.repeat(43),
              deviceId: 'dev_1',
              lease: opts.lease ?? signLease({})
            })
          : Response.json({ error: 'FORBIDDEN' }, { status: 400 })
      }
      if (url.pathname === '/desktop/lease')
        return opts.refreshStatus
          ? Response.json({ error: 'UNAUTHENTICATED' }, { status: opts.refreshStatus })
          : Response.json({
              lease: opts.refreshLease ?? signLease({ iat: T0 + DAY, exp: T0 + 15 * DAY })
            })
      return new Response(null, { status: 404 })
    }) as typeof fetch
    const openExternal = async (page: string): Promise<void> => {
      opened = new URL(page)
      challenge = opened.searchParams.get('challenge')!
      // The user approves in the browser; the page sends the code to 127.0.0.1 only.
      const back = `http://127.0.0.1:${opened.searchParams.get('port')}/callback?code=the-code&state=${opened.searchParams.get('state')}`
      await fetch(back)
    }
    return { fetchFake, openExternal, opened: () => opened }
  }

  function account(server: FakeServer, dir = tempFolder(), now = T0): Account {
    return new Account({
      dataDir: dir,
      appVersion: '0.0.0-test',
      webUrl: 'https://titan117.test',
      apiUrl: 'https://api.titan117.test',
      openExternal: server.openExternal,
      keychain,
      fetch: server.fetchFake,
      now: () => now,
      leaseKeys: [PUBLIC],
      onChange: () => undefined
    })
  }

  it('signs in through the browser and keeps the token only through the keychain', async () => {
    const server = fakeServer()
    const dir = tempFolder()
    const a = account(server, dir)
    expect(a.status()).toMatchObject({ signedIn: false, locked: true, reason: 'signedOut' })

    const after: AccountView = await a.signIn()
    expect(after).toMatchObject({ signedIn: true, locked: false, plan: 'pro', problem: null })
    expect(server.opened()!.origin + server.opened()!.pathname).toBe(
      'https://titan117.test/desktop/sign-in'
    )
    expect(a.deviceToken()).toMatch(/^t117d_/)

    // On disk the token is only in the keychain's form.
    const stored = readFileSync(join(dir, 'account', 'token.bin'), 'utf8')
    expect(stored).not.toContain('t117d_')
    // A restart reads it back.
    expect(account(server, dir).status()).toMatchObject({ signedIn: true, locked: false })
  })

  it('refreshes the lease, and locks when the account page signed this laptop out', async () => {
    const dir = tempFolder()
    await account(fakeServer(), dir).signIn()
    const renewed = await account(fakeServer(), dir, T0 + DAY).refresh()
    expect(renewed.expiresAt).toBe(T0 + 15 * DAY)

    const out = await account(fakeServer({ refreshStatus: 401 }), dir, T0 + DAY).refresh()
    expect(out).toMatchObject({ signedIn: false, locked: true, reason: 'signedOut' })
    expect(existsSync(join(dir, 'account', 'token.bin'))).toBe(false)
  })

  it('offline, the lease it has keeps working until it expires', async () => {
    const dir = tempFolder()
    await account(fakeServer(), dir).signIn()
    const offline = {
      ...fakeServer(),
      fetchFake: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch
    }
    expect(await account(offline, dir, T0 + 13 * DAY).refresh()).toMatchObject({
      locked: false,
      warn: true
    })
    expect(await account(offline, dir, T0 + 14 * DAY).refresh()).toMatchObject({
      locked: true,
      reason: 'expired'
    })
  })

  it('ignores a lease for another device', async () => {
    const dir = tempFolder()
    await account(fakeServer({ lease: signLease({ dev: 'someone-else' }) }), dir).signIn()
    expect(account(fakeServer(), dir).status()).toMatchObject({
      signedIn: true,
      locked: true,
      reason: 'noPlan'
    })
  })

  it("says what's wrong when the plan's devices are all signed in", async () => {
    const server = fakeServer()
    const limited = {
      ...server,
      fetchFake: (async () =>
        Response.json({ error: 'DEVICE_LIMIT' }, { status: 409 })) as typeof fetch
    }
    const result = await account(limited).signIn()
    expect(result.signedIn).toBe(false)
    expect(result.problem).toMatch(/Sign one out on your account page/)
  })
})

describe('the engine when locked, and with credits', () => {
  let engine: Engine | null = null
  afterEach(async () => {
    await engine?.close()
    engine = null
  })

  async function finished(taskId: string): Promise<TaskDetail> {
    await until(() => !engine!.parts.runtime.isRunning(taskId))
    return (await call(engine!, 'GET', `/v1/tasks/${taskId}`)).body
  }

  it('refuses new tasks while locked, and works once unlocked', async () => {
    engine = await testEngine({ locked: true, fetch: scripted([{ text: 'ok' }]).fetch })
    const refused = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL })
    expect(refused.status).toBe(423)
    expect(refused.body.error).toBe('LOCKED')

    engine.setAccount({ token: null, proxyUrl: null, locked: false, reason: null })
    expect((await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL })).status).toBe(200)
  })

  it('sends cloud calls to the credits proxy with the device token once signed in', async () => {
    const or = scripted([{ text: 'via credits' }])
    engine = await testEngine({ openRouterKey: null, fetch: or.fetch })
    engine.setAccount({
      token: 't117d_' + 'b'.repeat(43),
      proxyUrl: 'http://localhost:3100/api/v1',
      locked: false,
      reason: null
    })
    const state = (await call(engine, 'GET', '/v1/state')).body
    expect(state).toMatchObject({ cloudKey: true, cloudVia: 'credits' })

    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL })
    const done = await finished(body.task.id)
    expect(done.task.status).toBe('done')
    expect(or.requests[0].url).toBe('http://localhost:3100/api/v1/chat/completions')
    expect(or.requests[0].headers.Authorization).toBe('Bearer t117d_' + 'b'.repeat(43))
    // The token never shows up in the activity log.
    expect(JSON.stringify(done)).not.toContain('t117d_')
  })

  it('says what to do when the credits run out', async () => {
    engine = await testEngine({ openRouterKey: null, fetch: scripted([{ status: 402 }]).fetch })
    engine.setAccount({
      token: 't117d_' + 'c'.repeat(43),
      proxyUrl: 'http://localhost:3100/api/v1',
      locked: false,
      reason: null
    })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'hi', model: MODEL })
    expect((await finished(body.task.id)).task.note).toMatch(/No credits left/)
  })

  it('a task running when the app locks stops at the next step, not halfway', async () => {
    const or = scripted([
      { toolCalls: [{ name: 'list_folder', input: { path: '.' } }] },
      { text: 'should not run' }
    ])
    const folder = tempFolder()
    engine = await testEngine({ fetch: or.fetch, folder })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'look around', model: MODEL })
    await until(() => or.requests.length >= 1)
    engine.setAccount({
      token: null,
      proxyUrl: null,
      locked: true,
      reason: 'Sign in to keep using Titan117.'
    })
    const done = await finished(body.task.id)
    expect(done.task.status).toBe('stopped')
    expect(done.task.note).toMatch(
      /Sign in to keep using Titan117\. Then send a message to continue/
    )
    expect(or.requests).toHaveLength(1)
  })

  it("the engine reaches the proxy's exact origin and still refuses any other host", async () => {
    const reached: string[] = []
    const base = (async (input: RequestInfo | URL) => {
      reached.push(String(input))
      return new Response('ok')
    }) as typeof fetch
    const f = engineFetch(base, () => ['http://localhost:3100'])
    await f('http://localhost:3100/api/v1/chat/completions')
    await f('https://openrouter.ai/api/v1/models')
    for (const bad of [
      'http://localhost.evil.example:3100/x',
      'http://localhost:3101/x',
      'https://evil.example/x'
    ])
      await expect(f(bad)).rejects.toThrow(NetworkError)
    expect(reached).toHaveLength(2)
  })
})
