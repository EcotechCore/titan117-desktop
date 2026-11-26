/**
 * The add-on sandbox (decisions §66.6, guardrails §7): a tool add-on that
 * tries to escape must fail.
 */
import { describe, expect, it } from 'vitest'

import { runInSandbox, SandboxError, type SandboxFetch } from '../src/engine/lib/addons/sandbox'

const ok = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, { status: 200, ...init })

describe('the add-on sandbox', () => {
  it('loads a file, lists its tools and calls one with its input', async () => {
    const code = `titan.define({
      add: async (input) => ({ sum: input.a + input.b }),
      hello: (input) => 'hi ' + input.name
    })`
    const listed = await runInSandbox({ code, tool: null, hosts: [] })
    expect(listed.defined).toEqual(['add', 'hello'])
    const r = await runInSandbox({ code, tool: 'add', input: { a: 2, b: 3 }, hosts: [] })
    expect(JSON.parse(r.output)).toEqual({ sum: 5 })
    expect(
      (await runInSandbox({ code, tool: 'hello', input: { name: 'Ana' }, hosts: [] })).output
    ).toBe('hi Ana')
  })

  it('has no files, processes, modules, timers or network of its own', async () => {
    const code = `titan.define({ probe: async () => [
      typeof require, typeof process, typeof fetch, typeof XMLHttpRequest, typeof WebSocket,
      typeof setTimeout, typeof Buffer, typeof globalThis.os, typeof globalThis.std, typeof import_meta
    ].join(',') })`
    const r = await runInSandbox({
      code: code.replace('typeof import_meta', "'x'"),
      tool: 'probe',
      hosts: []
    })
    expect(
      r.output
        .split(',')
        .slice(0, 9)
        .every((t) => t === 'undefined')
    ).toBe(true)
    await expect(
      runInSandbox({
        code: `titan.define({ x: async () => (await import('fs')).readFileSync('C:/Windows/win.ini') })`,
        tool: 'x',
        hosts: []
      })
    ).rejects.toThrow()
  })

  it('reaches only the hosts it declared, over https, and checks every redirect', async () => {
    const seen: string[] = []
    const fetch: SandboxFetch = async (url) => {
      seen.push(url)
      if (url.includes('/moved'))
        return new Response('', {
          status: 302,
          headers: { location: 'https://evil.example/steal' }
        })
      return ok('{"rate":4.97}', {
        headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' }
      })
    }
    const code = `titan.define({
      get: async (i) => { const r = await titan.fetch(i.url); return { status: r.status, text: r.text, cookie: r.headers['set-cookie'] || null } }
    })`
    const good = await runInSandbox({
      code,
      tool: 'get',
      input: { url: 'https://www.bnr.ro/nbrfxrates.xml' },
      hosts: ['www.bnr.ro'],
      fetch
    })
    expect(JSON.parse(good.output)).toEqual({ status: 200, text: '{"rate":4.97}', cookie: null })
    for (const url of [
      'https://evil.example/x',
      'http://www.bnr.ro/x',
      'https://www.bnr.ro:8443/x',
      'https://u:p@www.bnr.ro/',
      'file:///C:/Windows/win.ini'
    ])
      await expect(
        runInSandbox({ code, tool: 'get', input: { url }, hosts: ['www.bnr.ro'], fetch })
      ).rejects.toThrow(SandboxError)
    await expect(
      runInSandbox({
        code,
        tool: 'get',
        input: { url: 'https://www.bnr.ro/moved' },
        hosts: ['www.bnr.ro'],
        fetch
      })
    ).rejects.toThrow(/may reach only www.bnr.ro, not evil.example/)
    expect(seen.some((u) => u.includes('evil'))).toBe(false)
    await expect(
      runInSandbox({ code, tool: 'get', input: { url: 'https://www.bnr.ro/' }, hosts: [], fetch })
    ).rejects.toThrow(/may not use the internet/)
  })

  it('stops a loop that never ends, and a call that eats memory', async () => {
    await expect(
      runInSandbox({
        code: `titan.define({ spin: () => { for(;;){} } })`,
        tool: 'spin',
        hosts: [],
        cpuMs: 200
      })
    ).rejects.toThrow(/interrupted/i)
    await expect(
      runInSandbox({
        code: `titan.define({ eat: () => { const a=[]; for(;;) a.push('x'.repeat(1e6)) } })`,
        tool: 'eat',
        hosts: [],
        cpuMs: 3000
      })
    ).rejects.toThrow()
  })

  it('refuses a file that doesn’t load or a tool it doesn’t define, and cuts long answers', async () => {
    await expect(runInSandbox({ code: 'this is not js', tool: null, hosts: [] })).rejects.toThrow(
      /didn't load/
    )
    await expect(
      runInSandbox({ code: 'titan.define({})', tool: 'nope', hosts: [] })
    ).rejects.toThrow(/doesn't define/)
    const long = await runInSandbox({
      code: `titan.define({ big: () => 'y'.repeat(300000) })`,
      tool: 'big',
      hosts: []
    })
    expect(long.output).toContain('[cut:')
  })

  it('gives up on a call that waits too long', async () => {
    const fetch: SandboxFetch = () => new Promise(() => undefined)
    await expect(
      runInSandbox({
        code: `titan.define({ wait: async () => (await titan.fetch('https://a.example.com/')).text })`,
        tool: 'wait',
        hosts: ['a.example.com'],
        fetch,
        totalMs: 200
      })
    ).rejects.toThrow(/too long/)
  })
})
