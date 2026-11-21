/**
 * Sign in with GitHub (decisions §25, §55) against a stand-in GitHub: the
 * device flow, the token kept encrypted, refreshed without any secret and
 * replaced on refresh, and pull requests through the API as the user.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { GitHubSignIn } from '../src/main/lib/github'
import { createWithApi } from '../src/engine/lib/git'
import { tempFolder } from './helpers'

/** A keychain that really changes the bytes, so the test can see nothing is stored in clear. */
const keychain = {
  encrypt: (text: string) => Buffer.from(Buffer.from(text).map((b) => b ^ 0x5a)),
  decrypt: (data: Buffer) => Buffer.from(data.map((b) => b ^ 0x5a)).toString()
}

function fakeGitHub(script: Record<string, unknown>[]): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  let i = 0
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('https://api.github.com/user')) return Response.json({ login: 'octo-user' })
    if (url.startsWith('https://github.com/login/device/code'))
      return Response.json({
        device_code: 'dev-123',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })
    return Response.json(script[Math.min(i++, script.length - 1)])
  }) as typeof fetch
  return { fetch: fetchFn, calls }
}

const noSleep = async (): Promise<void> => {}

describe('Sign in with GitHub', () => {
  it('says it isn’t ready until the app is registered', async () => {
    const gh = new GitHubSignIn(tempFolder('t117-gh-'), keychain, null)
    expect(gh.status().configured).toBe(false)
    await expect(gh.start()).rejects.toThrow(/once our GitHub App is registered/)
  })

  it('runs the device flow with only the client ID, waits politely, and keeps the token encrypted', async () => {
    const dir = tempFolder('t117-gh-')
    const github = fakeGitHub([
      { error: 'authorization_pending' },
      { error: 'slow_down', interval: 10 },
      {
        access_token: 'ghu_access1',
        expires_in: 28800,
        refresh_token: 'ghr_refresh1',
        refresh_token_expires_in: 15897600,
        token_type: 'bearer'
      }
    ])
    let changed = 0
    const waits: number[] = []
    const gh = new GitHubSignIn(
      dir,
      keychain,
      'Iv1.client',
      github.fetch,
      () => changed++,
      async (ms) => {
        waits.push(ms)
      }
    )
    const code = await gh.start()
    expect(code.userCode).toBe('WDJB-MJHT')
    expect(gh.status().pending?.userCode).toBe('WDJB-MJHT')
    await new Promise((r) => setTimeout(r, 20))
    expect(gh.status()).toMatchObject({ signedIn: true, login: 'octo-user', pending: null })
    expect(waits).toEqual([5000, 5000, 10000])
    expect(github.calls.every((c) => !c.includes('client_secret'))).toBe(true)
    expect(
      github.calls.some((c) =>
        c.includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code')
      )
    ).toBe(true)
    expect(await gh.token()).toBe('ghu_access1')
    // Stored only encrypted.
    const stored = readFileSync(join(dir, 'github.bin'))
    expect(stored.toString()).not.toContain('ghu_access1')
    expect(changed).toBeGreaterThan(0)
    gh.signOut()
    expect(existsSync(join(dir, 'github.bin'))).toBe(false)
    expect(await gh.token()).toBeNull()
  })

  it('refreshes an expiring token without a secret, and the new pair replaces the old', async () => {
    const dir = tempFolder('t117-gh-')
    const github = fakeGitHub([
      {
        access_token: 'ghu_old',
        expires_in: 60,
        refresh_token: 'ghr_old',
        refresh_token_expires_in: 15897600
      },
      {
        access_token: 'ghu_new',
        expires_in: 28800,
        refresh_token: 'ghr_new',
        refresh_token_expires_in: 15897600
      }
    ])
    const gh = new GitHubSignIn(dir, keychain, 'Iv1.client', github.fetch, () => undefined, noSleep)
    await gh.start()
    await new Promise((r) => setTimeout(r, 20))
    // The first token expires within the margin: refreshed.
    expect(await gh.token()).toBe('ghu_new')
    const refresh = github.calls.find((c) => c.includes('grant_type=refresh_token'))!
    expect(refresh).toContain('refresh_token=ghr_old')
    expect(refresh).not.toContain('client_secret')
    expect(await gh.token()).toBe('ghu_new')
  })

  it('stops when the user cancels on GitHub', async () => {
    const github = fakeGitHub([{ error: 'access_denied' }])
    const gh = new GitHubSignIn(
      tempFolder('t117-gh-'),
      keychain,
      'Iv1.client',
      github.fetch,
      () => undefined,
      noSleep
    )
    await gh.start()
    await new Promise((r) => setTimeout(r, 20))
    expect(gh.status()).toMatchObject({ signedIn: false, pending: null })
    expect(gh.status().problem).toMatch(/cancelled/)
  })
})

describe('pull requests through GitHub’s API', () => {
  it('opens one as the user, or finds the one already open for the branch', async () => {
    const seen: { url: string; auth: string | null; body: string | null }[] = []
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      seen.push({
        url,
        auth: new Headers(init?.headers).get('authorization'),
        body: typeof init?.body === 'string' ? init.body : null
      })
      if (init?.method === 'POST' && url.endsWith('/pulls'))
        return url.includes('/dup/')
          ? new Response('{}', { status: 422 })
          : Response.json({ html_url: 'https://github.com/o/r/pull/7' }, { status: 201 })
      return Response.json([{ html_url: 'https://github.com/o/dup/pull/3' }])
    }) as typeof fetch
    const pr = { title: 'Fix', body: 'Fixes #1', head: 'fix/x', base: 'main' }
    expect(await createWithApi(fetchFn, 'ghu_t', { owner: 'o', repo: 'r' }, pr)).toBe(
      'https://github.com/o/r/pull/7'
    )
    expect(seen[0].auth).toBe('Bearer ghu_t')
    expect(JSON.parse(seen[0].body!)).toEqual(pr)
    expect(await createWithApi(fetchFn, 'ghu_t', { owner: 'o', repo: 'dup' }, pr)).toBe(
      'https://github.com/o/dup/pull/3'
    )
    expect(seen.at(-1)!.url).toContain('head=o%3Afix%2Fx')
  })
})
