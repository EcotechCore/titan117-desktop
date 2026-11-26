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
import { parseAgent } from '../agents'
import {
  fetchPackage,
  fetchRepo,
  parseSource,
  sourcePage,
  type AddonPackage,
  type SourceFetch
} from './source'
import { AddonError, type Addon, type AddonLinks, type AddonStore } from './store'

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
  /**
   * An add-on from a folder in the allowed folders (18.3: larger tools the
   * coding engine wrote, or an agent or skill made there): the same checks as
   * from GitHub; tools are loaded in the sandbox first.
   */
  checkLocal(
    files: Map<string, Uint8Array>
  ): Promise<{ manifest: AddonManifest; checks: AddonChecks; card: string }>
  installLocal(files: Map<string, Uint8Array>, by: string): Promise<Addon>
  /** Any repository at a commit (10.5): files and checks, nothing installed or run. */
  download(
    address: string,
    fetch: SourceFetch
  ): Promise<{ key: string; commit: string; files: Map<string, Uint8Array>; checks: AddonChecks }>
  rollback(name: string): Addon
  setEnabled(name: string, enabled: boolean): Addon
  remove(name: string): void
  takeDown(name: string, reason: string): Addon
  /**
   * At start: in safe mode, MCP server and workflow add-ons' connectors and
   * schedules are removed; otherwise any that are missing are made again.
   */
  sync(safeMode: boolean): void
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
  /**
   * What MCP server and workflow add-ons make outside the store (decisions
   * §66.21): a connector on Connectors, a schedule on Automations.
   */
  effects?: {
    activate(manifest: AddonManifest, addon: string, by: string): AddonLinks
    deactivate(links: AddonLinks): void
  }
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

  /** Make what the version in use brings outside the store match it: on, off or gone. */
  function apply(name: string): void {
    const a = deps.store.get(name)
    if (!a || !deps.effects) return
    if (a.links) deps.effects.deactivate(a.links)
    const v = a.versions.find((x) => x.id === a.current)
    const links =
      a.enabled && !a.takenDown && v && (v.manifest.mcp || v.manifest.workflow)
        ? deps.effects.activate(v.manifest, a.name, a.by)
        : undefined
    deps.store.setLinks(name, links)
  }

  async function local(files: Map<string, Uint8Array>): Promise<AddonManifest> {
    const raw = files.get('titan.json')
    if (!raw) throw new AddonError('The folder has no titan.json.')
    let json: unknown
    try {
      json = JSON.parse(new TextDecoder().decode(raw))
    } catch {
      throw new AddonError('titan.json isn’t valid JSON.')
    }
    const parsed = parseAddonManifest(json)
    if (!parsed.ok) throw new AddonError(`titan.json: ${parsed.error}`)
    const m = parsed.manifest
    if (!['agent', 'skill', 'tool', 'mcp-server', 'workflow'].includes(m.type))
      throw new AddonError(
        'From a folder: agents, skills, tools, MCP servers and workflows. Apps are added on the Apps screen.'
      )
    for (const path of [m.agent, m.tool?.main, ...m.skills].filter((p): p is string => !!p))
      if (!files.has(path))
        throw new AddonError(`titan.json names ${path}, which isn’t in the folder.`)
    if (m.tool) {
      const code = new TextDecoder().decode(files.get(m.tool.main)!)
      await checkTool({ manifest: json, code })
    }
    if (m.agent) {
      try {
        parseAgent(new TextDecoder().decode(files.get(m.agent)!))
      } catch (error) {
        throw new AddonError(
          `${m.agent}: ${error instanceof Error ? error.message : 'not an agent file'}`
        )
      }
    }
    return m
  }

  const service: AddonService = {
    store: deps.store,

    async inspect(address, fetch) {
      prune()
      const src = parseSource(address)
      const pkg = await fetchPackage(src, fetch)
      const repo = pkg.key
      // Our listing is of GitHub repositories only.
      const status =
        deps.marketStatus && pkg.host === 'github'
          ? await deps.marketStatus(repo).catch(() => null)
          : null
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
          ...(pkg.host === 'github'
            ? await compare(repo, was.commit, pkg.commit, fetch)
            : { total: null, commits: [] })
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
      apply(addon.name)
      try {
        if (pkg.host === 'github') deps.onInstalled?.(inspection.repo, pkg.commit)
      } catch {
        // Counting installs is a nicety; it never stops one.
      }
      return { addon: deps.store.get(addon.name) ?? addon, templateFiles }
    },

    async checkLocal(files) {
      const manifest = await local(files)
      const checks = await checkPackage({ files, manifest }, async () => {
        throw new Error('offline')
      })
      // A folder's npm packages aren't checked here, and it's the user's own: no licence line.
      const card = [
        `Install the ${manifest.type} “${manifest.title}” ${manifest.version} from a folder on this laptop.`,
        manifest.description,
        ...describeAddon(manifest),
        ...describeChecks(checks).filter(
          (l) => !l.startsWith('Dependency scan') && !l.startsWith('Licence:')
        )
      ].join('\n')
      return { manifest, checks, card }
    },

    async installLocal(files, by) {
      const manifest = await local(files)
      const existing = deps.store.get(manifest.name)
      if (existing && existing.repo !== null)
        throw new AddonError(
          `${manifest.name} is an add-on from ${existing.repo}; pick another name.`
        )
      const checks = await checkPackage({ files, manifest }, async () => {
        throw new Error('offline')
      })
      if (checks.secrets.length)
        throw new AddonError(
          `Keys were found in its files (${checks.secrets[0].rule} in ${checks.secrets[0].file}); nothing was installed. Keys go on Connectors or Keys, never in an add-on.`
        )
      const addon = deps.store.install({ manifest, files, repo: null, commit: null, by })
      apply(addon.name)
      return deps.store.get(addon.name) ?? addon
    },

    async download(address, fetch) {
      const repo = await fetchRepo(parseSource(address), fetch)
      const checks = await checkPackage({ files: repo.files, manifest: null }, fetch)
      return { key: `${repo.key}@${repo.commit}`, commit: repo.commit, files: repo.files, checks }
    },

    rollback(name) {
      const a = deps.store.rollback(name)
      apply(name)
      return deps.store.get(name) ?? a
    },

    setEnabled(name, enabled) {
      const a = deps.store.setEnabled(name, enabled)
      apply(name)
      return deps.store.get(name) ?? a
    },

    remove(name) {
      const a = deps.store.get(name)
      if (a?.links && deps.effects) deps.effects.deactivate(a.links)
      deps.store.remove(name)
    },

    sync(safeMode) {
      if (!deps.effects) return
      for (const a of deps.store.list()) {
        const v = a.versions.find((x) => x.id === a.current)
        if (!v || !(v.manifest.mcp || v.manifest.workflow)) continue
        if (safeMode) {
          if (a.links) deps.effects.deactivate(a.links)
          deps.store.setLinks(a.name, undefined)
        } else if (!a.links) apply(a.name)
      }
    },

    takeDown(name, reason) {
      const a = deps.store.takeDown(name, reason)
      apply(name)
      return deps.store.get(name) ?? a
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
      const addon = deps.store.install({ manifest, files, repo: null, commit: null, by })
      apply(addon.name)
      return addon
    },

    card(i, summary) {
      const u = i.update
      const updateLines = u
        ? [
            `Update ${u.name} from ${u.fromVersion} (commit ${u.fromCommit.slice(0, 12)}) to ${i.manifest.version}.`,
            u.total === null
              ? 'The commits in between couldn’t be listed.'
              : `${u.total} commit${u.total === 1 ? '' : 's'} since: ${u.commits
                  .slice(0, 10)
                  .map((c) => `${c.sha} ${c.message}`)
                  .join('; ')}${u.total > 10 ? '; …' : ''}`
          ]
        : []
      const lines = [
        ...updateLines,
        `Install the ${i.manifest.type} “${i.manifest.title}” ${i.manifest.version} from ${sourcePage(i.repo).replace('https://', '')} at commit ${i.commit.slice(0, 12)}${i.verified ? ' (verified by Titan117)' : ''}.`,
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
