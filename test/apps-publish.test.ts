// Publishing to the user's own Cloudflare account (6.15, decisions §56.18),
// against a fake Cloudflare that follows the documented static assets
// upload: session, buckets with the session's token, then the Worker.
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  publishToCloudflare,
  siteFiles,
  workerName,
  WORKER
} from '../src/engine/lib/apps/cloudflare'
import { createAppService, type Published } from '../src/engine/lib/apps/service'
import type { CheckResult, Runner } from '../src/engine/lib/apps/runner'
import type { BrowserTests } from '../src/engine/lib/apps/browsers'
import { tempFolder } from './helpers'

const TOKEN = 'cfut_0000000000000000000000000000000000test'

beforeAll(() => {
  const home = tempFolder('titan117-home-')
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n\tname = Test User\n\temail = test@example.com\n'
  )
  process.env.HOME = home
})

function builtSite(): string {
  const dist = tempFolder('titan117-dist-')
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><h1>Hi</h1>')
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(dist, 'robots.txt'), 'User-agent: *')
  return dist
}

interface Call {
  method: string
  path: string
  auth: string
  body: unknown
}

/** A fake Cloudflare: it asks for every file in one bucket. */
function fakeCloudflare(options: { subdomain?: string | null; refuse?: boolean } = {}): {
  fetch: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/client/v4', '') + url.search
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '')
    calls.push({ method: init?.method ?? 'GET', path, auth, body: init?.body })
    if (options.refuse)
      return Response.json({ success: false, errors: [{ message: 'no' }] }, { status: 403 })
    if (path.startsWith('/accounts?'))
      return Response.json({ success: true, result: [{ id: 'acc1', name: 'Ana' }] })
    if (path.endsWith('/assets-upload-session')) {
      const { manifest } = JSON.parse(String(init?.body)) as {
        manifest: Record<string, { hash: string; size: number }>
      }
      return Response.json({
        success: true,
        result: { jwt: 'upload-jwt', buckets: [Object.values(manifest).map((m) => m.hash)] }
      })
    }
    if (path.startsWith('/accounts/acc1/workers/assets/upload'))
      return Response.json({ success: true, result: { jwt: 'done-jwt' } }, { status: 201 })
    if (path === '/accounts/acc1/workers/scripts/cluj-bakery' && init?.method === 'PUT')
      return Response.json({ success: true, result: {} })
    if (path === '/accounts/acc1/workers/subdomain')
      return Response.json({
        success: true,
        result: options.subdomain === null ? {} : { subdomain: options.subdomain ?? 'ana' }
      })
    if (path.endsWith('/subdomain'))
      return Response.json({ success: true, result: { enabled: true } })
    return Response.json({ success: false }, { status: 404 })
  }) as typeof fetch
  return { fetch: fetchFn, calls }
}

describe('publishing to Cloudflare', () => {
  it('uploads every file through the documented steps and gives the workers.dev address', async () => {
    const cf = fakeCloudflare()
    const result = await publishToCloudflare({
      fetch: cf.fetch,
      token: TOKEN,
      dist: builtSite(),
      name: 'cluj-bakery'
    })
    expect(result).toEqual({
      url: 'https://cluj-bakery.ana.workers.dev',
      account: 'Ana',
      files: 3,
      uploaded: 3
    })
    expect(cf.calls.map((c) => `${c.method} ${c.path.replace(/\?.*$/, '')}`)).toEqual([
      'GET /accounts',
      'POST /accounts/acc1/workers/scripts/cluj-bakery/assets-upload-session',
      'POST /accounts/acc1/workers/assets/upload',
      'PUT /accounts/acc1/workers/scripts/cluj-bakery',
      'GET /accounts/acc1/workers/subdomain',
      'POST /accounts/acc1/workers/scripts/cluj-bakery/subdomain'
    ])
    // The upload uses the session's token, never the user's; everything else the user's.
    const upload = cf.calls.find((c) => c.path.includes('/assets/upload'))!
    expect(upload.auth).toBe('Bearer upload-jwt')
    expect(cf.calls.filter((c) => c !== upload).every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(
      true
    )
    // The Worker gets the completion token and serves only the files.
    const script = cf.calls.find((c) => c.method === 'PUT')!.body as FormData
    const metadata = JSON.parse(await (script.get('metadata') as Blob).text())
    expect(metadata.assets.jwt).toBe('done-jwt')
    expect(metadata.bindings).toEqual([{ type: 'assets', name: 'ASSETS' }])
    expect(await (script.get('worker.js') as Blob).text()).toBe(WORKER)
  })

  it('says plainly what to do when Cloudflare refuses or has no workers.dev address', async () => {
    await expect(
      publishToCloudflare({
        fetch: fakeCloudflare({ refuse: true }).fetch,
        token: TOKEN,
        dist: builtSite(),
        name: 'x'
      })
    ).rejects.toThrow(/Edit Cloudflare Workers/)
    await expect(
      publishToCloudflare({
        fetch: fakeCloudflare({ subdomain: null }).fetch,
        token: TOKEN,
        dist: builtSite(),
        name: 'cluj-bakery'
      })
    ).rejects.toThrow(/workers\.dev address/)
  })

  it('reads the built site and names the Worker safely', async () => {
    const files = await siteFiles(builtSite())
    expect(files.map((f) => f.path).sort()).toEqual([
      '/assets/app.js',
      '/index.html',
      '/robots.txt'
    ])
    expect(files.every((f) => /^[0-9a-f]{32}$/.test(f.hash))).toBe(true)
    await expect(siteFiles(tempFolder('titan117-empty-'))).rejects.toThrow(/no index.html/)
    expect(workerName('Cluj_Bakery!!')).toBe('cluj-bakery')
    expect(workerName('---')).toBe('my-site')
  })
})

describe('the app service publishes only what passes', () => {
  const ok = (name: CheckResult['name']): CheckResult => ({
    name,
    ran: true,
    ok: true,
    exitCode: 0,
    output: '',
    timedOut: false,
    ms: 1
  })

  async function service(
    checks: CheckResult[],
    token: string | null
  ): Promise<{
    apps: ReturnType<typeof createAppService>
    app: Awaited<ReturnType<ReturnType<typeof createAppService>['create']>>
    cf: ReturnType<typeof fakeCloudflare>
  }> {
    let published: Record<string, Published> = {}
    const cf = fakeCloudflare()
    const apps = createAppService({
      runner: {
        preview: () => null,
        install: async () => ok('install'),
        checks: async () => checks
      } as unknown as Runner,
      browsers: {} as BrowserTests,
      coAuthor: () => true,
      hosting: {
        token: () => token,
        published: () => published,
        setPublished: (next) => (published = next),
        fetch: cf.fetch
      }
    })
    const app = await apps.create(tempFolder('titan117-apps-'), {
      title: 'Cluj Bakery',
      description: 'Bread.'
    })
    return { apps, app, cf }
  }

  it('publishes a passing app and remembers where', async () => {
    const { apps, app } = await service([ok('typecheck'), ok('build'), ok('test')], TOKEN)
    // The fake build: what `npm run build` would leave.
    mkdirSync(join(app.folder, 'dist'))
    writeFileSync(join(app.folder, 'dist', 'index.html'), '<h1>Hi</h1>')
    const result = await apps.publish(app.folder)
    expect(result.url).toBe('https://cluj-bakery.ana.workers.dev')
    expect(apps.info(app.folder).published?.url).toBe(result.url)
  })

  it('refuses without a token, and when a check fails', async () => {
    const none = await service([ok('build')], null)
    await expect(none.apps.publish(none.app.folder)).rejects.toThrow(/Cloudflare token first/)
    const failing = await service([ok('typecheck'), { ...ok('test'), ok: false }], TOKEN)
    await expect(failing.apps.publish(failing.app.folder)).rejects.toThrow(
      /Not published: test failed/
    )
    expect(failing.cf.calls).toHaveLength(0)
  })
})
