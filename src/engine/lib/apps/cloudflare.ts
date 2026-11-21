/**
 * Publishing a built site to the user's own Cloudflare account (6.15;
 * decisions §30, §56.18), with the user's own API token ("Edit Cloudflare
 * Workers"), through Cloudflare's documented Workers static assets upload
 * (developers.cloudflare.com/workers/static-assets/direct-upload, read
 * 21 Nov 2026): an upload session with a manifest of the files, the files
 * Cloudflare asks for in buckets, then a small Worker that serves them. The
 * site gets `<name>.<the account's subdomain>.workers.dev`.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'

const API = 'https://api.cloudflare.com/client/v4'
/** Free plan: 20,000 files and 25 MiB each per version. */
const MAX_FILES = 20_000
const MAX_FILE_BYTES = 25 * 1024 * 1024
const COMPATIBILITY_DATE = '2026-11-01'

/** The Worker that serves the files: every request goes to the static assets. */
export const WORKER = `export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request)
  }
}
`

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2'
}

export class PublishError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublishError'
  }
}

export interface SiteFile {
  /** `/index.html` */
  path: string
  data: Buffer
  /** 32 hex characters, Cloudflare's key for the content. */
  hash: string
}

/** Every file of the built site, with its path and hash. */
export async function siteFiles(dist: string): Promise<SiteFile[]> {
  const out: SiteFile[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        if ((await stat(full)).size > MAX_FILE_BYTES)
          throw new PublishError(`${entry.name} is over 25 MB, Cloudflare's limit for one file.`)
        const data = await readFile(full)
        out.push({
          path: '/' + relative(dist, full).split(sep).join('/'),
          data,
          hash: createHash('sha256').update(data).update(extname(full)).digest('hex').slice(0, 32)
        })
      }
      if (out.length > MAX_FILES)
        throw new PublishError('The site has more than 20,000 files, over Cloudflare’s free limit.')
    }
  }
  await walk(dist)
  if (!out.some((f) => f.path === '/index.html'))
    throw new PublishError('The built site has no index.html.')
  return out
}

interface CfResponse<T> {
  success?: boolean
  errors?: { message?: string }[]
  result?: T
}

async function cf<T>(
  fetchFn: typeof fetch,
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: CfResponse<T> }> {
  const res = await fetchFn(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }
  })
  const body = (await res.json().catch(() => ({}))) as CfResponse<T>
  if (res.status === 401 || res.status === 403)
    throw new PublishError(
      'Cloudflare refused the token. Check it has "Workers Scripts: Edit" (the "Edit Cloudflare Workers" template), or make a new one.'
    )
  if (!res.ok || body.success === false)
    throw new PublishError(
      `Cloudflare answered ${res.status}: ${body.errors?.map((e) => e.message).join('; ') || 'no reason given'}.`
    )
  return { status: res.status, body }
}

/** A Worker name: lowercase letters, digits and dashes, at most 63. */
export function workerName(slug: string): string {
  const name = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
  return name || 'my-site'
}

export async function publishToCloudflare(input: {
  fetch?: typeof fetch
  token: string
  /** The built site (`dist`). */
  dist: string
  name: string
  onProgress?: (note: string) => void
}): Promise<{ url: string; account: string; files: number; uploaded: number }> {
  const fetchFn = input.fetch ?? fetch
  const name = workerName(input.name)
  const files = await siteFiles(input.dist)

  const accounts = await cf<{ id: string; name: string }[]>(
    fetchFn,
    input.token,
    '/accounts?per_page=5'
  )
  const account = accounts.body.result?.[0]
  if (!account) throw new PublishError('The token reaches no Cloudflare account.')

  input.onProgress?.(`Uploading ${files.length} files to Cloudflare…`)
  const manifest = Object.fromEntries(
    files.map((f) => [f.path, { hash: f.hash, size: f.data.length }])
  )
  const session = await cf<{ jwt: string; buckets?: string[][] }>(
    fetchFn,
    input.token,
    `/accounts/${account.id}/workers/scripts/${name}/assets-upload-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest })
    }
  )
  let completion = session.body.result?.jwt ?? ''
  const buckets = session.body.result?.buckets ?? []
  const byHash = new Map(files.map((f) => [f.hash, f]))
  let uploaded = 0
  for (const bucket of buckets) {
    const form = new FormData()
    for (const hash of bucket) {
      const file = byHash.get(hash)
      if (!file) throw new PublishError('Cloudflare asked for a file that isn’t in the site.')
      form.append(
        hash,
        new Blob([file.data.toString('base64')], {
          type: TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream'
        }),
        hash
      )
      uploaded++
    }
    // Uploads use the session's own token, not the user's.
    const done = await cf<{ jwt?: string }>(
      fetchFn,
      session.body.result?.jwt ?? '',
      `/accounts/${account.id}/workers/assets/upload?base64=true`,
      { method: 'POST', body: form }
    )
    if (done.body.result?.jwt) completion = done.body.result.jwt
  }

  input.onProgress?.('Starting the site on Cloudflare…')
  const script = new FormData()
  script.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          main_module: 'worker.js',
          compatibility_date: COMPATIBILITY_DATE,
          assets: { jwt: completion, config: { not_found_handling: 'single-page-application' } },
          bindings: [{ type: 'assets', name: 'ASSETS' }]
        })
      ],
      { type: 'application/json' }
    )
  )
  script.append(
    'worker.js',
    new Blob([WORKER], { type: 'application/javascript+module' }),
    'worker.js'
  )
  await cf(fetchFn, input.token, `/accounts/${account.id}/workers/scripts/${name}`, {
    method: 'PUT',
    body: script
  })

  // Its address on workers.dev: the account needs a workers.dev subdomain (set once in Cloudflare).
  const sub = await cf<{ subdomain?: string }>(
    fetchFn,
    input.token,
    `/accounts/${account.id}/workers/subdomain`
  ).catch(() => null)
  const subdomain = sub?.body.result?.subdomain
  if (!subdomain)
    throw new PublishError(
      'The site is on Cloudflare, but the account has no workers.dev address yet. Open Workers & Pages in Cloudflare once to choose one, then publish again.'
    )
  await cf(fetchFn, input.token, `/accounts/${account.id}/workers/scripts/${name}/subdomain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true })
  })
  return {
    url: `https://${name}.${subdomain}.workers.dev`,
    account: account.name,
    files: files.length,
    uploaded
  }
}
