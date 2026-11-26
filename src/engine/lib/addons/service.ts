/**
 * Add-ons for Titan's tools and the Add-ons screen (decisions §66): inspect a
 * repository at a commit (download, titan.json, checks, our takedown list),
 * install what was inspected, make a tool add-on on request, roll back.
 * What was inspected is kept for 30 minutes, so the install is exactly the
 * commit the user saw on the card.
 */
import {
  describeAddon,
  parseAddonManifest,
  type AddonManifest
} from '../../../shared/addon-manifest'
import { checkPackage, describeChecks, type AddonChecks } from './checks'
import { runInSandbox } from './sandbox'
import { fetchPackage, parseSource, type AddonPackage, type SourceFetch } from './source'
import { AddonError, type Addon, type AddonStore } from './store'

const KEEP_INSPECTED_MS = 30 * 60_000
const TEXT_FILE = /\.(md|txt|json|js|mjs|cjs|ts|tsx|jsx|css|html|ya?ml|toml)$/i

export interface Inspection {
  /** `owner/repo@commit`: what `install` takes. */
  key: string
  repo: string
  commit: string
  manifest: AddonManifest
  checks: AddonChecks
  /** What it may do, in plain words (decisions §66.5). */
  permissions: string[]
  /** null when the marketplace couldn't be asked (offline, signed out). */
  takenDown: boolean | null
  /** When an older commit of the same repository is installed: what changed (decisions §66.4). */
  update: {
    name: string
    fromVersion: string
    fromCommit: string
    /** null when GitHub couldn't list them. */
    total: number | null
    commits: { sha: string; message: string }[]
  } | null
  verified: boolean
  files: string[]
}

export interface AddonService {
  store: AddonStore
  inspect(address: string, fetch: SourceFetch): Promise<Inspection>
  /** A text file of an inspected package, for Titan's summary (as outside content). */
  readInspected(key: string, path: string): string
  inspection(key: string): Inspection | null
  /** Install what was inspected; an app template's files come back for the caller to copy. */
  install(key: string, by: string): { addon: Addon; templateFiles: Map<string, Uint8Array> | null }
  /** A tool add-on Titan wrote (18.3): loaded in the sandbox first. */
  checkTool(input: {
    manifest: unknown
    code: string
  }): Promise<{ manifest: AddonManifest; defined: string[] }>
  createTool(input: { manifest: unknown; code: string }, by: string): Promise<Addon>
  /** A card's text for an inspected package. */
  card(i: Inspection, summary: string | null): string
  /** Our listing's status for a repository; null when it can't be asked. */
  status(repo: string): Promise<{ takenDown: boolean; verifiedCommit: string | null } | null>
}

const GITHUB = 'https://api.github.com'

/** The commits between two of a repository's commits (GitHub's compare), newest last. */
async function compare(
  repo: string,
  from: string,
  to: string,
  fetch: SourceFetch
): Promise<{ total: number | null; commits: { sha: string; message: string }[] }> {
  try {
    const res = await fetch(`${GITHUB}/repos/${repo}/compare/${from}...${to}?per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    })
    if (!res.ok) return { total: null, commits: [] }
    const body = (await res.json()) as {
      total_commits?: number
      commits?: { sha?: string; commit?: { message?: string } }[]
    }
    const commits = (body.commits ?? []).slice(-50).map((c) => ({
      sha: String(c.sha ?? '').slice(0, 7),
      // Commit messages are someone else's words: one line, no control characters.
      message: String(c.commit?.message ?? '')
        .split('\n')[0]
        .replace(/\p{Cc}+/gu, ' ')
        .slice(0, 120)
    }))
    return {
      total: typeof body.total_commits === 'number' ? body.total_commits : commits.length,
      commits
    }
  } catch {
    return { total: null, commits: [] }
  }
}

export function createAddonService(deps: {
  store: AddonStore
  /** Our listing's status for a repository (decisions §66.11); null when it can't be asked. */
  marketStatus?: (
    repo: string
  ) => Promise<{ takenDown: boolean; verifiedCommit: string | null } | null>
  /** Tell our listing it was installed (decisions §66.12); failures are ignored. */
  onInstalled?: (repo: string, commit: string) => void
  now?: () => number
}): AddonService {
  const now = deps.now ?? Date.now
  const inspected = new Map<string, { at: number; pkg: AddonPackage; inspection: Inspection }>()

  function prune(): void {
    for (const [k, v] of inspected) if (now() - v.at > KEEP_INSPECTED_MS) inspected.delete(k)
  }

  async function checkTool(input: {
    manifest: unknown
    code: string
  }): Promise<{ manifest: AddonManifest; defined: string[] }> {
    const parsed = parseAddonManifest(input.manifest)
    if (!parsed.ok) throw new AddonError(`titan.json: ${parsed.error}`)
    const manifest = parsed.manifest
    if (manifest.type !== 'tool' || !manifest.tool)
      throw new AddonError('That titan.json isn’t a tool add-on.')
    const code = String(input.code ?? '')
    if (!code.trim()) throw new AddonError('The tool’s code is empty.')
    const { defined } = await runInSandbox({ code, tool: null, hosts: manifest.tool.hosts })
    const missing = manifest.tool.tools.filter((t) => !defined.includes(t.name)).map((t) => t.name)
    if (missing.length)
      throw new AddonError(
        `The code doesn’t define ${missing.join(', ')}. It must call titan.define({ ${missing[0]}: async (input) => … }).`
      )
    return { manifest, defined }
  }

  const service: AddonService = {
    store: deps.store,

    async inspect(address, fetch) {
      prune()
      const src = parseSource(address)
      const pkg = await fetchPackage(src, fetch)
      const repo = `${pkg.owner}/${pkg.repo}`
      const status = deps.marketStatus ? await deps.marketStatus(repo).catch(() => null) : null
      const checks = await checkPackage(pkg, fetch)
      // An older commit of this repository is installed: show what changed since (decisions §66.4).
      const installed = deps.store.list().find((a) => a.repo?.toLowerCase() === repo.toLowerCase())
      const was = installed?.versions.find((v) => v.id === installed.current)
      let update: Inspection['update'] = null
      if (installed && was?.commit && was.commit !== pkg.commit)
        update = {
          name: installed.name,
          fromVersion: was.version,
          fromCommit: was.commit,
          ...(await compare(repo, was.commit, pkg.commit, fetch))
        }
      const inspection: Inspection = {
        key: `${repo}@${pkg.commit}`,
        repo,
        commit: pkg.commit,
        manifest: pkg.manifest,
        checks,
        permissions: describeAddon(pkg.manifest),
        takenDown: status ? status.takenDown : null,
        verified: status?.verifiedCommit === pkg.commit,
        update,
        files: [...pkg.files.keys()].sort().slice(0, 500)
      }
      inspected.set(inspection.key, { at: now(), pkg, inspection })
      return inspection
    },

    readInspected(key, path) {
      const entry = inspected.get(key)
      if (!entry)
        throw new AddonError(
          'Inspect the add-on first (it was more than 30 minutes ago, or never).'
        )
      const data = entry.pkg.files.get(path)
      if (!data) throw new AddonError(`There is no file ${path} in it.`)
      if (!TEXT_FILE.test(path) || data.subarray(0, 8000).includes(0))
        throw new AddonError(`${path} isn’t a text file.`)
      return new TextDecoder().decode(data.subarray(0, 100_000))
    },

    inspection: (key) => inspected.get(key)?.inspection ?? null,

    install(key, by) {
      const entry = inspected.get(key)
      if (!entry || now() - entry.at > KEEP_INSPECTED_MS)
        throw new AddonError(
          'Inspect the add-on again: what was checked is more than 30 minutes old.'
        )
      const { pkg, inspection } = entry
      if (inspection.takenDown)
        throw new AddonError(
          'Titan117 took this add-on down after a report, so it can’t be installed.'
        )
      if (inspection.checks.secrets.length && pkg.manifest.type === 'tool')
        throw new AddonError(
          'This tool add-on has keys in its files; it isn’t installed. Tell its author.'
        )
      const addon = deps.store.install({
        manifest: pkg.manifest,
        files: pkg.files,
        repo: inspection.repo,
        commit: pkg.commit,
        by
      })
      let templateFiles: Map<string, Uint8Array> | null = null
      if (pkg.manifest.app) {
        const dir = pkg.manifest.app.dir
        templateFiles = new Map()
        for (const [path, data] of pkg.files) {
          if (dir === '.' ? path === 'titan.json' : !path.startsWith(`${dir}/`)) continue
          templateFiles.set(dir === '.' ? path : path.slice(dir.length + 1), data)
        }
      }
      inspected.delete(key)
      try {
        deps.onInstalled?.(inspection.repo, pkg.commit)
      } catch {
        // Counting installs is a nicety; it never stops one.
      }
      return { addon, templateFiles }
    },

    checkTool,

    status: (repo) => (deps.marketStatus ? deps.marketStatus(repo) : Promise.resolve(null)),

    async createTool(input, by) {
      const { manifest } = await checkTool(input)
      const existing = deps.store.get(manifest.name)
      if (existing && existing.repo !== null)
        throw new AddonError(
          `${manifest.name} is an add-on from ${existing.repo}; pick another name.`
        )
      const files = new Map<string, Uint8Array>([
        ['titan.json', new TextEncoder().encode(JSON.stringify(input.manifest, null, 2) + '\n')],
        [manifest.tool!.main, new TextEncoder().encode(String(input.code))]
      ])
      return deps.store.install({ manifest, files, repo: null, commit: null, by })
    },

    card(i, summary) {
      const u = i.update
      const updateLines = u
        ? [
            `Update ${u.name} from ${u.fromVersion} (commit ${u.fromCommit.slice(0, 12)}) to ${i.manifest.version}.`,
            u.total === null
              ? 'GitHub couldn’t list the commits in between.'
              : `${u.total} commit${u.total === 1 ? '' : 's'} since: ${u.commits
                  .slice(0, 10)
                  .map((c) => `${c.sha} ${c.message}`)
                  .join('; ')}${u.total > 10 ? '; …' : ''}`
          ]
        : []
      const lines = [
        ...updateLines,
        `Install the ${i.manifest.type} “${i.manifest.title}” ${i.manifest.version} from github.com/${i.repo} at commit ${i.commit.slice(0, 12)}${i.verified ? ' (verified by Titan117)' : ''}.`,
        i.manifest.description,
        ...i.permissions,
        ...describeChecks(i.checks)
      ]
      if (i.takenDown === null)
        lines.push('Titan117’s takedown list couldn’t be checked (offline or signed out).')
      if (summary)
        lines.push(
          `Titan’s summary of the code (from files it read as outside content): ${summary.slice(0, 800)}`
        )
      return lines.join('\n')
    }
  }
  return service
}
