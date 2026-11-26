/**
 * Where an add-on comes from (features 10.3, 10.4; decisions §66.4): a public
 * GitHub repository, pinned to a commit. GitHub's REST API is plain HTTPS, so
 * the engine calls it through the task's network policy (no Octokit). The
 * commit's ZIP is unpacked in memory with limits; nothing is written until
 * the user approves the install, and then only as plain files (never links).
 */
import { unzipSync } from 'fflate'

import {
  parseAddonManifest,
  safeAddonPath,
  type AddonManifest
} from '../../../shared/addon-manifest'

export const MAX_ZIP_BYTES = 10 * 1024 * 1024
export const MAX_UNPACKED_BYTES = 30 * 1024 * 1024
export const MAX_FILES = 2000
const GITHUB = 'https://api.github.com'
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const REF = /^[A-Za-z0-9._/-]{1,200}$/

export class SourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceError'
  }
}

export interface AddonSource {
  /** GitHub, or GitLab.com (decisions §66.22). */
  host: 'github' | 'gitlab'
  /** The owner, or on GitLab the whole namespace (`group/subgroup`). */
  owner: string
  repo: string
  /** A branch, tag or commit; null for the default branch. */
  ref: string | null
}

/**
 * What the user (or Titan) gave: `owner/repo`, `owner/repo@ref`, or a GitHub
 * address (`https://github.com/owner/repo`, `/tree/<ref>`, `/commit/<sha>`).
 */
const GITLAB_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/** `owner/repo` on GitHub; `gitlab.com/group/project` on GitLab. Stored with each add-on. */
export function sourceKey(src: { host: 'github' | 'gitlab'; owner: string; repo: string }): string {
  return src.host === 'gitlab' ? `gitlab.com/${src.owner}/${src.repo}` : `${src.owner}/${src.repo}`
}

/** The page a person opens for it. */
export function sourcePage(key: string): string {
  return key.startsWith('gitlab.com/') ? `https://${key}` : `https://github.com/${key}`
}

function parseGitLab(t: string, given: string | null): AddonSource {
  let ref = given
  let path = t.replace(/^https?:\/\//i, '').replace(/^gitlab\.com\//i, '')
  const dash = path.indexOf('/-/')
  if (dash >= 0) {
    const [kind, ...rest] = path.slice(dash + 3).split('/')
    if ((kind === 'tree' || kind === 'commit') && rest.length)
      ref = decodeURIComponent(rest.join('/'))
    path = path.slice(0, dash)
  }
  const parts = path
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean)
  if (
    parts.length < 2 ||
    parts.length > 6 ||
    parts.some((x) => !GITLAB_PART.test(x) || x.startsWith('.'))
  )
    throw new SourceError('Give the GitLab project as gitlab.com/group/project.')
  if (ref !== null && (!REF.test(ref) || ref.includes('..')))
    throw new SourceError('That branch, tag or commit name isn’t valid.')
  return {
    host: 'gitlab',
    owner: parts.slice(0, -1).join('/'),
    repo: parts.at(-1)!,
    ref: ref || null
  }
}

export function parseSource(text: string): AddonSource {
  let t = String(text ?? '').trim()
  let ref: string | null = null
  const at = t.lastIndexOf('@')
  if (at > 0 && !t.includes('://')) {
    ref = t.slice(at + 1)
    t = t.slice(0, at)
  }
  if (/^(https?:\/\/)?gitlab\.com\//i.test(t)) return parseGitLab(t, ref)
  if (/^https?:\/\//i.test(t)) {
    let url: URL
    try {
      url = new URL(t)
    } catch {
      throw new SourceError('That isn’t a GitHub address.')
    }
    if (url.hostname.toLowerCase() !== 'github.com')
      throw new SourceError(
        'Add-ons come from GitHub or GitLab.com for now (github.com/owner/repo).'
      )
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2) throw new SourceError('Give the repository: github.com/owner/repo.')
    const [owner, repoRaw, kind, ...rest] = parts
    t = `${owner}/${repoRaw.replace(/\.git$/, '')}`
    if ((kind === 'tree' || kind === 'commit') && rest.length)
      ref = decodeURIComponent(rest.join('/'))
  }
  const [owner, repo, extra] = t.split('/')
  if (
    extra !== undefined ||
    !owner ||
    !repo ||
    !OWNER.test(owner) ||
    !REPO.test(repo) ||
    repo.startsWith('.')
  )
    throw new SourceError('Give the repository as owner/repo, or its GitHub address.')
  if (ref !== null && (!REF.test(ref) || ref.includes('..')))
    throw new SourceError('That branch, tag or commit name isn’t valid.')
  return { host: 'github', owner, repo, ref: ref || null }
}

export type SourceFetch = (url: string, init?: RequestInit) => Promise<Response>

export interface AddonPackage {
  host: 'github' | 'gitlab'
  owner: string
  repo: string
  /** `owner/repo`, or `gitlab.com/group/project`. */
  key: string
  /** The full commit it is pinned to. */
  commit: string
  manifest: AddonManifest
  /** Every file, by its path inside the repository. */
  files: Map<string, Uint8Array>
}

function headers(accept: string): Record<string, string> {
  return { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' }
}

async function check(res: Response, what: string): Promise<Response> {
  if (res.ok) return res
  await res.body?.cancel().catch(() => undefined)
  if (res.status === 404) throw new SourceError(`GitHub has no ${what} there (or it’s private).`)
  if (res.status === 403 || res.status === 429)
    throw new SourceError(
      'GitHub’s limit for this hour is used up. Try again later, or sign in with GitHub.'
    )
  throw new SourceError(`GitHub answered ${res.status} for the ${what}.`)
}

/** The commit a branch, tag or the default branch points to now. */
export async function resolveCommit(src: AddonSource, fetch: SourceFetch): Promise<string> {
  const ref = src.ref ?? 'HEAD'
  const res = await check(
    await fetch(`${GITHUB}/repos/${src.owner}/${src.repo}/commits/${encodeURIComponent(ref)}`, {
      headers: headers('application/vnd.github.sha')
    }),
    'repository or commit'
  )
  const sha = (await res.text()).trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new SourceError('GitHub didn’t give a commit for that.')
  return sha
}

async function readZip(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_ZIP_BYTES) throw new SourceError('The repository is larger than 10 MB packed.')
  const reader = res.body?.getReader()
  if (!reader) throw new SourceError('GitHub sent nothing.')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_ZIP_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new SourceError('The repository is larger than 10 MB packed.')
    }
    chunks.push(value)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

/**
 * Unpack a GitHub ZIP in memory: its one top folder is dropped, and anything
 * outside the limits, outside the repository or hidden in `.git` is refused.
 */
export function unpack(zip: Uint8Array): Map<string, Uint8Array> {
  let count = 0
  let total = 0
  let problem: string | null = null
  let unzipped: Record<string, Uint8Array>
  // A ZIP starts with "PK".
  if (zip.length < 22 || zip[0] !== 0x50 || zip[1] !== 0x4b)
    throw new SourceError('The repository’s ZIP couldn’t be read.')
  try {
    unzipped = unzipSync(zip, {
      filter(file) {
        if (file.name.endsWith('/')) return false
        count++
        total += file.originalSize
        if (count > MAX_FILES) problem = `The repository has more than ${MAX_FILES} files.`
        else if (total > MAX_UNPACKED_BYTES)
          problem = 'The repository is larger than 30 MB unpacked.'
        return problem === null
      }
    })
  } catch {
    throw new SourceError('The repository’s ZIP couldn’t be read.')
  }
  if (problem) throw new SourceError(problem)
  const files = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(unzipped)) {
    const slash = name.indexOf('/')
    const inner = slash >= 0 ? name.slice(slash + 1) : name
    if (!inner) continue
    // `.github`, `.gitignore` and the like are kept out; everything else must be a safe path.
    if (inner.split('/').some((p) => p.startsWith('.'))) continue
    const path = safeAddonPath(inner)
    if (!path || path === '.')
      throw new SourceError(`The repository has a file with an unsafe name: ${inner.slice(0, 80)}`)
    files.set(path, data)
  }
  return files
}

export function readManifest(files: Map<string, Uint8Array>): AddonManifest {
  const raw = files.get('titan.json')
  if (!raw)
    throw new SourceError('The repository has no titan.json, so it isn’t a Titan117 add-on.')
  if (raw.byteLength > 64 * 1024) throw new SourceError('titan.json is too large.')
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw new SourceError('titan.json isn’t valid JSON.')
  }
  const parsed = parseAddonManifest(json)
  if (!parsed.ok) throw new SourceError(`titan.json: ${parsed.error}`)
  const m = parsed.manifest
  for (const path of [m.agent, m.tool?.main, ...m.skills].filter((p): p is string => !!p))
    if (!files.has(path))
      throw new SourceError(`titan.json names ${path}, which isn’t in the repository.`)
  if (m.app && m.app.dir !== '.' && ![...files.keys()].some((f) => f.startsWith(`${m.app!.dir}/`)))
    throw new SourceError(
      `titan.json names the folder ${m.app.dir}, which isn’t in the repository.`
    )
  return m
}

const GITLAB = 'https://gitlab.com/api/v4'

async function checkGitLab(res: Response, what: string): Promise<Response> {
  if (res.ok) return res
  await res.body?.cancel().catch(() => undefined)
  if (res.status === 404) throw new SourceError(`GitLab has no ${what} there (or it’s private).`)
  if (res.status === 401 || res.status === 403)
    throw new SourceError(
      'GitLab didn’t say which commit that is without a sign-in. Give the commit: gitlab.com/group/project@<commit>.'
    )
  if (res.status === 429)
    throw new SourceError('GitLab’s limit is used up for now. Try again in a minute.')
  throw new SourceError(`GitLab answered ${res.status} for the ${what}.`)
}

/** A GitLab commit for a branch, tag or the default branch (decisions §66.22). */
async function gitlabCommit(src: AddonSource, fetch: SourceFetch): Promise<string> {
  const id = encodeURIComponent(`${src.owner}/${src.repo}`)
  let ref = src.ref
  if (!ref) {
    const project = await checkGitLab(await fetch(`${GITLAB}/projects/${id}`), 'project')
    ref = String(((await project.json()) as { default_branch?: unknown }).default_branch ?? '')
    if (!REF.test(ref)) throw new SourceError('GitLab didn’t say the project’s main branch.')
  }
  const res = await checkGitLab(
    await fetch(`${GITLAB}/projects/${id}/repository/commits/${encodeURIComponent(ref)}`),
    'project or commit'
  )
  const sha = String(((await res.json()) as { id?: unknown }).id ?? '')
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new SourceError('GitLab didn’t give a commit for that.')
  return sha
}

/** Download a repository at one commit, any repository (10.5): no titan.json needed. */
export async function fetchRepo(
  src: AddonSource,
  fetch: SourceFetch
): Promise<Omit<AddonPackage, 'manifest'>> {
  const pinned = /^[0-9a-f]{40}$/.test(src.ref ?? '') ? src.ref! : null
  let commit: string
  let res: Response
  if (src.host === 'gitlab') {
    commit = pinned ?? (await gitlabCommit(src, fetch))
    const id = encodeURIComponent(`${src.owner}/${src.repo}`)
    res = await checkGitLab(
      await fetch(`${GITLAB}/projects/${id}/repository/archive.zip?sha=${commit}`),
      'project'
    )
  } else {
    commit = pinned ?? (await resolveCommit(src, fetch))
    res = await check(
      await fetch(`${GITHUB}/repos/${src.owner}/${src.repo}/zipball/${commit}`, {
        headers: headers('application/vnd.github+json')
      }),
      'repository'
    )
  }
  const files = unpack(await readZip(res))
  return { host: src.host, owner: src.owner, repo: src.repo, key: sourceKey(src), commit, files }
}

/** Download a repository at one commit and read its titan.json. */
export async function fetchPackage(src: AddonSource, fetch: SourceFetch): Promise<AddonPackage> {
  const repo = await fetchRepo(src, fetch)
  return { ...repo, manifest: readManifest(repo.files) }
}
