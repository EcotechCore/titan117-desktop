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

/**
 * Visits (feature 15.10; decisions §63), when the site counts them. Pages
 * are still served as free static files; each page view sends one small
 * request to \`/_t117/visit\`, which isn't a file, so it reaches this Worker.
 * It writes one data point to Workers Analytics Engine in the user's own
 * account: the page, the site that linked to it, the country Cloudflare
 * reports and phone or computer. No cookies, no IP address, no user agent
 * kept; bots aren't counted. Over the free plan's daily Worker requests only
 * the counting stops, never the site.
 */
export const VISIT_PATH = '/_t117/visit'
export const VISIT_SCRIPT_PATH = '/_t117/v.js'
export const VISITS_DATASET = 'titan117_visits'

export const COUNTING_WORKER = `const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor/i
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '${VISIT_PATH}') return env.ASSETS.fetch(request)
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    const agent = request.headers.get('user-agent') || ''
    if (!BOT.test(agent) && env.VISITS) {
      let body = {}
      try {
        body = JSON.parse((await request.text()).slice(0, 2000))
      } catch {}
      const path = String(body.p || '/').split('?')[0].slice(0, 200)
      let from = ''
      try {
        const ref = new URL(String(body.r || ''))
        if (ref.hostname !== url.hostname) from = ref.hostname.slice(0, 100)
      } catch {}
      const country = String((request.cf && request.cf.country) || '').slice(0, 2)
      const device = /mobile|android|iphone|ipad/i.test(agent) ? 'phone' : 'computer'
      env.VISITS.writeDataPoint({ blobs: [path, from, country, device], indexes: [env.SITE] })
    }
    return new Response(null, { status: 204 })
  }
}
`

/** The page's side: one beacon per page view, also when a one-page app changes page. Respects Do Not Track. */
export const VISIT_SCRIPT = `(function () {
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return
  var last = ''
  function send() {
    if (location.pathname === last) return
    last = location.pathname
    var body = JSON.stringify({ p: location.pathname, r: document.referrer })
    if (navigator.sendBeacon) navigator.sendBeacon('${VISIT_PATH}', body)
    else fetch('${VISIT_PATH}', { method: 'POST', body: body, keepalive: true })
  }
  send()
  var push = history.pushState
  history.pushState = function () {
    push.apply(history, arguments)
    setTimeout(send, 0)
  }
  addEventListener('popstate', send)
})()
`

/** Each HTML page loads the visit script once, before </head>. */
export function withVisitScript(html: string): string {
  if (html.includes(VISIT_SCRIPT_PATH)) return html
  const tag = `<script src="${VISIT_SCRIPT_PATH}" defer></script>`
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tag}</head>`) : `${tag}${html}`
}

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
function fileOf(path: string, data: Buffer): SiteFile {
  return {
    path,
    data,
    hash: createHash('sha256').update(data).update(extname(path)).digest('hex').slice(0, 32)
  }
}

export async function siteFiles(
  dist: string,
  options: { visits?: boolean } = {}
): Promise<SiteFile[]> {
  const out: SiteFile[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        if ((await stat(full)).size > MAX_FILE_BYTES)
          throw new PublishError(`${entry.name} is over 25 MB, Cloudflare's limit for one file.`)
        let data = await readFile(full)
        const path = '/' + relative(dist, full).split(sep).join('/')
        if (options.visits && /\.html?$/i.test(path))
          data = Buffer.from(withVisitScript(data.toString('utf8')))
        out.push(fileOf(path, data))
      }
      if (out.length > MAX_FILES)
        throw new PublishError('The site has more than 20,000 files, over Cloudflare’s free limit.')
    }
  }
  await walk(dist)
  if (!out.some((f) => f.path === '/index.html'))
    throw new PublishError('The built site has no index.html.')
  if (options.visits) out.push(fileOf(VISIT_SCRIPT_PATH, Buffer.from(VISIT_SCRIPT)))
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
  /** Count visits into the account's own Workers Analytics Engine (15.10). */
  visits?: boolean
  onProgress?: (note: string) => void
}): Promise<{ url: string; account: string; files: number; uploaded: number }> {
  const fetchFn = input.fetch ?? fetch
  const name = workerName(input.name)
  const files = await siteFiles(input.dist, { visits: input.visits })

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
          bindings: [
            { type: 'assets', name: 'ASSETS' },
            ...(input.visits
              ? [
                  { type: 'analytics_engine', name: 'VISITS', dataset: VISITS_DATASET },
                  { type: 'plain_text', name: 'SITE', text: name }
                ]
              : [])
          ]
        })
      ],
      { type: 'application/json' }
    )
  )
  script.append(
    'worker.js',
    new Blob([input.visits ? COUNTING_WORKER : WORKER], { type: 'application/javascript+module' }),
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

export interface SiteVisits {
  site: string
  days: number
  total: number
  byDay: { day: string; views: number }[]
  pages: { name: string; views: number }[]
  from: { name: string; views: number }[]
  countries: { name: string; views: number }[]
  devices: { name: string; views: number }[]
}

/**
 * A published site's visits from the account's Workers Analytics Engine,
 * through its SQL API. Reading needs the token's "Account Analytics: Read"
 * permission, which Cloudflare's "Edit Cloudflare Workers" template lacks.
 */
export async function readVisits(input: {
  fetch?: typeof fetch
  token: string
  name: string
  days: number
}): Promise<SiteVisits> {
  const fetchFn = input.fetch ?? fetch
  const site = workerName(input.name)
  const days = Math.max(1, Math.min(90, Math.round(input.days)))
  const accounts = await cf<{ id: string }[]>(fetchFn, input.token, '/accounts?per_page=5')
  const account = accounts.body.result?.[0]
  if (!account) throw new PublishError('The token reaches no Cloudflare account.')
  const where = `index1 = '${site}' AND timestamp > NOW() - INTERVAL '${days}' DAY`
  const query = async (
    select: string,
    group: string,
    limit: number
  ): Promise<{ name: string; views: number }[]> => {
    const res = await fetchFn(`${API}/accounts/${account.id}/analytics_engine/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.token}` },
      body: `SELECT ${select} AS name, SUM(_sample_interval) AS views FROM ${VISITS_DATASET} WHERE ${where} GROUP BY ${group} ORDER BY ${group === 'name' && select.startsWith('toStartOf') ? 'name ASC' : 'views DESC'} LIMIT ${limit} FORMAT JSON`
    })
    if (res.status === 401 || res.status === 403)
      throw new PublishError(
        'Cloudflare didn’t let this token read visits. Edit the token in Cloudflare (My Profile → API Tokens) and add the permission "Account → Account Analytics → Read".'
      )
    const text = await res.text()
    if (!res.ok) throw new PublishError(`Cloudflare answered ${res.status}: ${text.slice(0, 200)}`)
    const body = JSON.parse(text) as { data?: { name: unknown; views: unknown }[] }
    return (body.data ?? []).map((r) => ({
      name: String(r.name ?? ''),
      views: Math.round(Number(r.views) || 0)
    }))
  }
  const [byDay, pages, from, countries, devices] = await Promise.all([
    query("toStartOfInterval(timestamp, INTERVAL '1' DAY)", 'name', days + 1),
    query('blob1', 'name', 15),
    query('blob2', 'name', 10),
    query('blob3', 'name', 10),
    query('blob4', 'name', 2)
  ])
  return {
    site,
    days,
    total: pages.reduce((sum, p) => sum + p.views, 0),
    byDay: byDay.map((d) => ({ day: d.name.slice(0, 10), views: d.views })),
    pages,
    from: from.map((f) => ({ ...f, name: f.name || '(direct or unknown)' })),
    countries: countries.map((c) => ({ ...c, name: c.name || '(unknown)' })),
    devices
  }
}

/** The visits as a short report, for an artifact. */
export function visitsReport(v: SiteVisits): string {
  const table = (title: string, rows: { name: string; views: number }[]): string[] =>
    rows.length
      ? [
          `## ${title}`,
          '',
          '| | Views |',
          '|---|---:|',
          ...rows.map((r) => `| ${r.name.replace(/\|/g, '/')} | ${r.views} |`),
          ''
        ]
      : []
  return [
    `# Visits: ${v.site}`,
    '',
    `The last ${v.days} day(s): **${v.total} page view(s)**, counted on your own Cloudflare account without cookies or IP addresses.`,
    '',
    ...table(
      'By day',
      v.byDay.map((d) => ({ name: d.day, views: d.views }))
    ),
    ...table('Pages', v.pages),
    ...table('Came from', v.from),
    ...table('Countries', v.countries),
    ...table('Phone or computer', v.devices)
  ].join('\n')
}
