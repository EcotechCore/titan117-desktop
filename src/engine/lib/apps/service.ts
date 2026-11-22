/**
 * The app builder's projects on the laptop (§6, decisions §56): making a
 * new web app from the template, its checks and test report (6.29), its
 * live preview, and its versions (6.13) as git commits. Folders reach this
 * module already checked by the permission layer: inside the allowed
 * folders and writable.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import {
  gitArchiveZip,
  gitCommit,
  gitInit,
  gitLog,
  gitRestore,
  gitStatus,
  type GitVersion
} from '../git'
import type { BrowserReport, BrowserTests, EngineName } from './browsers'
import type { CheckResult, Runner } from './runner'
import {
  APP_KINDS,
  desktopTemplate,
  mobileTemplate,
  slugOf,
  TEMPLATE_VERSIONS,
  webTemplate,
  type AppKind
} from './template'
import { findOrMakeRepo, pushApp, type GitHubRepo } from './github'
import { publishToCloudflare } from './cloudflare'
import { openInSandbox } from './sandbox'
import {
  agentNotes,
  cleanBrand,
  LOGO_TYPES,
  mobileAgentNotes,
  mobileTheme,
  STARTERS,
  themeCss,
  type BrandKit,
  type StarterId
} from './starters'

export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}

export interface NewApp {
  /** What it's built for (decisions §7): a website (default) or a mobile app (Expo). */
  kind?: AppKind
  title: string
  description: string
  lang?: string
  /** A starting point per kind of business (6.8). */
  starter?: StarterId
  /** The brand kit; its logo, if any, is a real path already checked by the caller. */
  brand?: BrandKit
}

export interface AppMeta {
  kind: AppKind
  title: string
  template: string
  createdAt: number
}

export interface AppInfo extends AppMeta {
  folder: string
  name: string
  preview: string | null
  /** A mobile app open to phones on this Wi-Fi: the `exp://` address Expo Go opens. */
  phone: string | null
  /** The app's repository on the user's GitHub (6.18), when saved there. */
  github: GitHubLink | null
  /** Where it was last published (6.15). */
  published: Published | null
}

export interface Published {
  host: 'cloudflare'
  url: string
  at: number
}

export interface GitHubLink extends GitHubRepo {
  /** Push each new version (on until the user stops it). */
  sync: boolean
  /** Why the last push failed, if it did. */
  error: string | null
}

/** Saving an app to the user's GitHub (6.18): a repository, or GitHub's page to make one. */
export type GitHubSave =
  | { status: 'saved'; repo: GitHubRepo; created: boolean }
  | { status: 'make-it'; url: string; name: string }

export interface AppReport {
  id: string
  at: number
  passed: boolean
  checks: CheckResult[]
  browsers: BrowserReport | null
  /** Plain text for the model and the screen: what failed and how to see it again. */
  summary: string
}

const META = join('.titan117', 'app.json')
const REPORTS = join('.titan117', 'reports')
const KEEP_REPORTS = 10

export function readMeta(dir: string): AppMeta | null {
  try {
    const meta = JSON.parse(readFileSync(join(dir, META), 'utf8')) as AppMeta
    return APP_KINDS.includes(meta.kind) ? meta : null
  } catch {
    return null
  }
}

/** What failed, short enough for a model's next step. */
export function summarize(checks: CheckResult[], browsers: BrowserReport | null): string {
  const lines: string[] = []
  for (const c of checks)
    if (c.ran && !c.ok)
      lines.push(
        `✗ ${c.name}${c.timedOut ? ' (timed out)' : ''}:\n${c.output.trim().split('\n').slice(-40).join('\n')}`
      )
  if (browsers) {
    for (const e of browsers.engines)
      if (!e.ran) lines.push(`- ${e.engine} wasn't tested: ${e.note ?? 'not available'}`)
    for (const s of browsers.shots) {
      const where = `${s.engine}, ${s.size}`
      for (const e of s.pageErrors) lines.push(`✗ Page error (${where}): ${e}`)
      for (const e of s.consoleErrors) lines.push(`✗ Console error (${where}): ${e}`)
      for (const r of s.failedRequests) lines.push(`✗ Request (${where}): ${r}`)
      if (s.overflow) lines.push(`✗ Wider than the screen (${where}): the page scrolls sideways.`)
      if (s.slow)
        lines.push(
          `✗ Slow on a slow network (${where}): ${Math.round(s.loadMs / 1000)} seconds to load.`
        )
    }
    for (const f of browsers.seo) if (!f.ok) lines.push(`✗ SEO, ${f.check}: ${f.detail}`)
  }
  const ran = checks.filter((c) => c.ran).map((c) => c.name)
  const head = lines.length
    ? `Checks found ${lines.length} problem(s).`
    : `All checks passed (${[...ran, browsers ? 'browsers' : ''].filter(Boolean).join(', ')}).`
  // Dedupe: the same console error in every engine and size reads as one problem.
  return [head, ...[...new Set(lines)].slice(0, 60)].join('\n')
}

export interface AppService {
  info(dir: string): AppInfo
  list(roots: string[]): AppInfo[]
  create(parent: string, input: NewApp): Promise<AppInfo>
  check(
    dir: string,
    options?: {
      browsers?: boolean
      engines?: EngineName[]
      signal?: AbortSignal
      onProgress?: (note: string) => void
    }
  ): Promise<AppReport>
  latestReport(dir: string): Promise<AppReport | null>
  screenshot(dir: string, id: string, file: string): Promise<Buffer>
  startPreview(dir: string): Promise<{ url: string }>
  /** Open a mobile app to phones on this Wi-Fi, for Expo Go (6.24). */
  startPhone(dir: string): Promise<{ url: string; phone: string }>
  stopPreview(dir: string): boolean
  saveVersion(
    dir: string,
    message: string
  ): Promise<{ sha: string; pushed: string | null; pushError: string | null } | null>
  /** Save to the user's own GitHub and keep it up to date with each version (6.18). */
  saveToGitHub(dir: string, options: { private: boolean }): Promise<GitHubSave>
  stopGitHubSync(dir: string): void
  /** Build, check and publish to the user's own Cloudflare account (6.15). */
  publish(dir: string, onProgress?: (note: string) => void): Promise<Published>
  /**
   * A desktop app's Windows installer (6.17): checks first, then Tauri's
   * build with Rust (NSIS only). Needs Rust and Microsoft's C++ build tools.
   */
  makeInstaller(dir: string, onProgress?: (note: string) => void): Promise<{ path: string }>
  /** The latest installer, if one was made. */
  installer(dir: string): string | null
  /** Install and open the app in a fresh Windows Sandbox (6.26). */
  tryInSandbox(dir: string, workDir: string): Promise<{ resultsDir: string }>
  /** The current version's files as a ZIP (6.18). */
  zip(dir: string): Promise<{ name: string; data: Buffer }>
  versions(dir: string): Promise<GitVersion[]>
  restore(dir: string, sha: string): Promise<{ sha: string }>
  stopAll(): void
}

export function createAppService(deps: {
  runner: Runner
  browsers: BrowserTests
  /** Whether agent commits carry the co-author line (decisions §25). */
  coAuthor: () => boolean
  onChange?: () => void
  /** The user's GitHub sign-in through our app, and where each app is saved (decisions §25, §56.16). */
  github?: {
    token(): string | null
    links(): Record<string, GitHubLink>
    setLinks(next: Record<string, GitHubLink>): void
    fetch?: typeof fetch
    /** How a push happens (tests push to a local repository). */
    push?: typeof pushApp
  }
  /** Rust and the build tools on this laptop (Tauri's installer); tests say yes or no. */
  toolchain?: () => Promise<{ rust: boolean; msvc: boolean }>
  /** Publishing (6.15): the user's own hosting token, and where each app was published. */
  hosting?: {
    token(host: 'cloudflare'): string | null
    published(): Record<string, Published>
    setPublished(next: Record<string, Published>): void
    fetch?: typeof fetch
  }
}): AppService {
  const { runner, browsers } = deps

  function info(dir: string): AppInfo {
    const meta = readMeta(dir)
    if (!meta) throw new AppError(`"${dir}" isn't an app made with the app builder.`)
    return {
      ...meta,
      folder: dir,
      name: basename(dir),
      preview: runner.preview(dir)?.url ?? null,
      phone: runner.preview(dir)?.phone ?? null,
      github: deps.github?.links()[dir] ?? null,
      published: deps.hosting?.published()[dir] ?? null
    }
  }

  function setLink(dir: string, link: GitHubLink | null): void {
    if (!deps.github) return
    const next = { ...deps.github.links() }
    if (link) next[dir] = link
    else delete next[dir]
    deps.github.setLinks(next)
  }

  /** Push to the app's GitHub repository; the error is kept on the link, never thrown. */
  async function syncGitHub(
    dir: string
  ): Promise<{ pushed: string | null; pushError: string | null }> {
    const link = deps.github?.links()[dir]
    if (!link?.sync) return { pushed: null, pushError: null }
    try {
      await (deps.github?.push ?? pushApp)(dir, link, deps.github?.token() ?? null)
      setLink(dir, { ...link, error: null })
      return { pushed: link.url, pushError: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLink(dir, { ...link, error: message })
      return { pushed: null, pushError: message }
    }
  }

  async function saveVersion(
    dir: string,
    message: string
  ): Promise<{ sha: string; pushed: string | null; pushError: string | null } | null> {
    const status = await gitStatus(dir)
    if (!status.changes.length) return null
    const { sha } = await gitCommit(dir, { message, coAuthor: deps.coAuthor() })
    const pushed = await syncGitHub(dir)
    deps.onChange?.()
    return { sha, ...pushed }
  }

  return {
    info,

    /** Apps inside the allowed folders: the folders themselves and two levels down. */
    list(roots: string[]): AppInfo[] {
      const found = new Map<string, AppInfo>()
      const visit = (dir: string, depth: number): void => {
        if (readMeta(dir)) found.set(dir, info(dir))
        if (depth === 0) return
        let entries: string[]
        try {
          entries = readdirSync(dir)
        } catch {
          return
        }
        for (const entry of entries) {
          if (entry.startsWith('.') || entry === 'node_modules') continue
          const child = join(dir, entry)
          try {
            if (statSync(child).isDirectory()) visit(child, depth - 1)
          } catch {
            /* unreadable */
          }
        }
      }
      for (const root of roots) visit(root, 2)
      return [...found.values()].sort((a, b) => b.createdAt - a.createdAt)
    },

    /** A new web or mobile app in its own folder inside `parent`, saved as its first version. */
    async create(parent: string, input: NewApp): Promise<AppInfo> {
      const kind: AppKind = input.kind && APP_KINDS.includes(input.kind) ? input.kind : 'web'
      const title = input.title.trim()
      if (!title) throw new AppError('A new app needs a name.')
      const dir = join(parent, slugOf(title))
      if (existsSync(dir) && (await readdir(dir)).length)
        throw new AppError(
          `"${dir}" already exists and isn't empty. Choose another name or folder.`
        )
      const files = { web: webTemplate, mobile: mobileTemplate, desktop: desktopTemplate }[kind]({
        name: title,
        title,
        description: input.description.trim() || title,
        lang: input.lang ?? 'en'
      })
      // The starter's pages and the brand kit (6.8). Starters are kinds of website; a mobile app starts blank.
      const starter =
        (kind === 'web' && STARTERS.find((s) => s.id === input.starter)) || STARTERS[0]
      const brand = cleanBrand(input.brand)
      let logoFile: string | null = null
      if (brand.logo) {
        const type = LOGO_TYPES[extname(brand.logo).toLowerCase()]
        if (!type) throw new AppError('The logo must be a PNG, SVG, JPEG or WebP file.')
        const data = await readFile(brand.logo)
        if (data.length > 2_000_000)
          throw new AppError('The logo is over 2 MB; use a smaller file.')
        logoFile = `logo.${type}`
        const assets = kind === 'mobile' ? 'assets' : 'public'
        await mkdir(join(dir, assets), { recursive: true })
        await writeFile(join(dir, assets, logoFile), data)
      }
      if (kind === 'mobile') {
        files.set('src/theme.ts', mobileTheme(brand))
        files.set('AGENTS.md', (files.get('AGENTS.md') ?? '') + mobileAgentNotes(brand, logoFile))
      } else {
        const css = files.get('src/index.css')
        if (css) files.set('src/index.css', css.replace(/@theme \{[^}]*\}/, themeCss(brand)))
        files.set(
          'AGENTS.md',
          (files.get('AGENTS.md') ?? '') +
            agentNotes(starter.id, brand, logoFile, kind === 'desktop' ? 'This app' : 'This site')
        )
      }
      if (kind === 'web' && starter.pages.length > 1) {
        const site = JSON.parse(files.get('site.config.json') ?? '{}') as {
          pages: { path: string; title: string; description: string }[]
        }
        for (const page of starter.pages)
          if (!site.pages.some((p) => p.path === page.path))
            site.pages.push({
              path: page.path,
              title: `${page.title} · ${title}`,
              description: input.description.trim() || title
            })
        files.set('site.config.json', JSON.stringify(site, null, 2) + '\n')
      }
      for (const [path, content] of files) {
        const target = join(dir, path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content)
      }
      const meta: AppMeta = {
        kind,
        title,
        template:
          starter.id === 'blank'
            ? TEMPLATE_VERSIONS[kind]
            : `${TEMPLATE_VERSIONS[kind]}/${starter.id}`,
        createdAt: Date.now()
      }
      await mkdir(join(dir, '.titan117'), { recursive: true })
      await writeFile(join(dir, META), JSON.stringify(meta, null, 2) + '\n')
      await gitInit(dir)
      await gitCommit(dir, {
        message: `Version 1: a new ${kind} app, "${title}", from the template`,
        coAuthor: deps.coAuthor()
      })
      deps.onChange?.()
      return info(dir)
    },

    /** Install, typecheck, build and test; then, when it built, the three browsers (6.20, 6.21). */
    async check(
      dir: string,
      options: {
        browsers?: boolean
        engines?: EngineName[]
        signal?: AbortSignal
        onProgress?: (note: string) => void
      } = {}
    ): Promise<AppReport> {
      const kind = info(dir).kind
      const mobile = kind === 'mobile'
      const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(2).toString('hex')}`
      const outDir = join(dir, REPORTS, id)
      await mkdir(outDir, { recursive: true })
      options.onProgress?.('Installing packages…')
      const install = await runner.install(dir, options.signal)
      const checks: CheckResult[] = [install]
      if (install.ok) {
        options.onProgress?.('Typecheck, build and tests…')
        checks.push(...(await runner.checks(dir, options.signal)))
      }
      let browserReport: BrowserReport | null = null
      const built = checks.find((c) => c.name === 'build')
      if (options.browsers !== false && install.ok && (!built || built.ok)) {
        await browsers.ensure(options.onProgress)
        const wasRunning = !!runner.preview(dir)
        options.onProgress?.(
          kind === 'web'
            ? 'Opening the preview in Chromium, Firefox and WebKit…'
            : `Opening the app at ${mobile ? 'phone' : 'window'} sizes in Chromium and WebKit…`
        )
        const { url } = await runner.startPreview(dir)
        try {
          // A mobile app's first bundle is made on request: make it once before the browsers time it.
          if (mobile) await warmUp(url)
          browserReport = await browsers.run(url, outDir, {
            engines: options.engines,
            signal: options.signal,
            profile: kind,
            ...(mobile ? { loadTimeoutMs: 90_000 } : {})
          })
        } finally {
          if (!wasRunning) runner.stopPreview(dir)
        }
      }
      const summary = summarize(checks, browserReport)
      const report: AppReport = {
        id,
        at: Date.now(),
        passed: summary.startsWith('All checks passed'),
        checks,
        browsers: browserReport,
        summary
      }
      await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
      // Older reports go: their screenshots add up.
      const all = (await readdir(join(dir, REPORTS))).sort()
      for (const old of all.slice(0, Math.max(0, all.length - KEEP_REPORTS)))
        await rm(join(dir, REPORTS, old), { recursive: true, force: true })
      deps.onChange?.()
      return report
    },

    async latestReport(dir: string): Promise<AppReport | null> {
      const root = join(dir, REPORTS)
      if (!existsSync(root)) return null
      for (const id of (await readdir(root)).sort().reverse()) {
        try {
          return JSON.parse(await readFile(join(root, id, 'report.json'), 'utf8')) as AppReport
        } catch {
          /* a run that didn't finish */
        }
      }
      return null
    },

    /** A screenshot from a report, by its file name only. */
    async screenshot(dir: string, id: string, file: string): Promise<Buffer> {
      if (!/^[\w-]{1,80}$/.test(id) || !/^[a-z]+-[a-z-]+\.png$/.test(file))
        throw new AppError('No such screenshot.')
      return readFile(join(dir, REPORTS, id, file))
    },

    async startPreview(dir: string): Promise<{ url: string }> {
      info(dir)
      const install = await runner.install(dir)
      if (!install.ok)
        throw new AppError(
          `The packages didn't install:\n${install.output.trim().split('\n').slice(-15).join('\n')}`
        )
      const started = await runner.startPreview(dir)
      deps.onChange?.()
      return started
    },

    async startPhone(dir: string): Promise<{ url: string; phone: string }> {
      if (info(dir).kind !== 'mobile')
        throw new AppError(
          'Only a mobile app opens on a phone; preview a website on the Apps screen.'
        )
      const install = await runner.install(dir)
      if (!install.ok)
        throw new AppError(
          `The packages didn't install:\n${install.output.trim().split('\n').slice(-15).join('\n')}`
        )
      let started: { url: string; phone: string }
      try {
        started = await runner.startPhone(dir)
      } catch (error) {
        throw new AppError(error instanceof Error ? error.message : String(error))
      }
      deps.onChange?.()
      return started
    },

    stopPreview(dir: string): boolean {
      const stopped = runner.stopPreview(dir)
      if (stopped) deps.onChange?.()
      return stopped
    },

    saveVersion,

    async saveToGitHub(dir, options) {
      const meta = info(dir)
      const token = deps.github?.token() ?? null
      if (!deps.github || !token)
        throw new AppError(
          'Sign in with GitHub first (Code screen, under GitHub), then save again.'
        )
      // Already saved there: just push what's new.
      const known = deps.github.links()[dir]
      let repo: GitHubRepo
      let created = false
      if (known) repo = known
      else {
        const status = await gitStatus(dir)
        const own = status.remote?.github
        if (own) repo = { ...own, url: `https://github.com/${own.owner}/${own.repo}` }
        else {
          const found = await findOrMakeRepo(deps.github.fetch ?? fetch, token, {
            name: meta.name,
            description: readFileSafe(dir) ?? meta.title,
            private: options.private
          })
          if (found.status === 'make-it') return found
          repo = found.repo
          created = found.created
        }
      }
      try {
        await (deps.github.push ?? pushApp)(dir, repo, token)
      } catch (error) {
        setLink(dir, {
          ...repo,
          sync: true,
          error: error instanceof Error ? error.message : String(error)
        })
        deps.onChange?.()
        throw error
      }
      setLink(dir, { ...repo, sync: true, error: null })
      deps.onChange?.()
      return { status: 'saved', repo, created }
    },

    async zip(dir) {
      const app = info(dir)
      const [latest] = await gitLog(dir, 1)
      return {
        name: `${app.name}${latest ? `-${latest.sha}` : ''}.zip`,
        data: await gitArchiveZip(dir)
      }
    },

    async publish(dir, onProgress) {
      const app = info(dir)
      if (app.kind === 'mobile')
        throw new AppError(
          'A mobile app is published to the App Store and Google Play, not to a website host. That comes later in phase 9.'
        )
      if (app.kind === 'desktop')
        throw new AppError(
          'A desktop app is shared as an installer, not on a website host. That comes later in phase 9.'
        )
      const token = deps.hosting?.token('cloudflare') ?? null
      if (!deps.hosting || !token)
        throw new AppError(
          'Add your Cloudflare token first (Apps screen, Your hosting), then publish again.'
        )
      // Only what passes its checks is published.
      onProgress?.('Installing packages…')
      const install = await runner.install(dir)
      if (!install.ok) throw new AppError('The packages didn’t install, so nothing was published.')
      onProgress?.('Typecheck, build and tests…')
      const failed = (await runner.checks(dir)).filter((c) => c.ran && !c.ok)
      if (failed.length)
        throw new AppError(
          `Not published: ${failed.map((c) => c.name).join(', ')} failed. Fix them first (Test it shows what's wrong).`
        )
      const result = await publishToCloudflare({
        fetch: deps.hosting.fetch,
        token,
        dist: join(dir, 'dist'),
        name: app.name,
        onProgress
      })
      const published: Published = { host: 'cloudflare', url: result.url, at: Date.now() }
      deps.hosting.setPublished({ ...deps.hosting.published(), [dir]: published })
      deps.onChange?.()
      return published
    },

    installer(dir) {
      const folder = join(dir, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
      try {
        const found = readdirSync(folder).filter((f) => /-setup\.exe$/i.test(f))
        return found.length ? join(folder, found.sort().at(-1) as string) : null
      } catch {
        return null
      }
    },

    async makeInstaller(dir, onProgress) {
      const app = info(dir)
      if (app.kind !== 'desktop') throw new AppError('Only a desktop app gets an installer.')
      const tools = (await deps.toolchain?.()) ?? { rust: false, msvc: false }
      const missing = [
        ...(tools.rust ? [] : ['Rust (rustup.rs)']),
        ...(tools.msvc || process.platform !== 'win32'
          ? []
          : [
              'Microsoft’s C++ build tools ("Build Tools for Visual Studio", with "Desktop development with C++")'
            ])
      ]
      if (missing.length)
        throw new AppError(
          `Making the installer needs ${missing.join(' and ')} on this laptop. Install them, then try again (Apps → This laptop shows what's there).`
        )
      onProgress?.('Installing packages…')
      const install = await runner.install(dir)
      if (!install.ok) throw new AppError('The packages didn’t install, so no installer was made.')
      onProgress?.('Typecheck, build and tests…')
      const failed = (await runner.checks(dir)).filter((c) => c.ran && !c.ok)
      if (failed.length)
        throw new AppError(
          `No installer: ${failed.map((c) => c.name).join(', ')} failed. Fix them first (Test it shows what's wrong).`
        )
      if (!existsSync(join(dir, 'src-tauri', 'icons', 'icon.ico'))) {
        onProgress?.('Making the icons…')
        const icons = await runner.script(dir, 'tauri', ['icon', 'app-icon.svg'], {
          timeoutMs: 2 * 60_000
        })
        if (!icons.ok) throw new AppError(`The icons weren't made:\n${icons.output.slice(-1500)}`)
      }
      onProgress?.('Building the installer with Rust (the first time takes several minutes)…')
      const built = await runner.script(dir, 'tauri', ['build', '--bundles', 'nsis'], {
        timeoutMs: 45 * 60_000
      })
      const path = this.installer(dir)
      if (!built.ok || !path)
        throw new AppError(
          `The installer wasn't made:\n${built.output.trim().split('\n').slice(-25).join('\n')}`
        )
      deps.onChange?.()
      return { path }
    },

    async tryInSandbox(dir, workDir) {
      const app = info(dir)
      const path = this.installer(dir)
      if (app.kind !== 'desktop' || !path) throw new AppError('Make the installer first.')
      let productName = app.title
      try {
        const conf = JSON.parse(
          readFileSync(join(dir, 'src-tauri', 'tauri.conf.json'), 'utf8')
        ) as { productName?: string }
        if (conf.productName) productName = conf.productName
      } catch {
        /* the title */
      }
      try {
        const run = await openInSandbox({ installerPath: path, productName, workDir })
        return { resultsDir: run.resultsDir }
      } catch (error) {
        throw new AppError(error instanceof Error ? error.message : String(error))
      }
    },

    stopGitHubSync(dir) {
      const link = deps.github?.links()[dir]
      if (link) {
        setLink(dir, { ...link, sync: false })
        deps.onChange?.()
      }
    },

    versions: (dir: string): Promise<GitVersion[]> => gitLog(dir, 100),

    async restore(dir: string, sha: string): Promise<{ sha: string }> {
      const versions = await gitLog(dir, 500)
      const target = versions.find((v) => v.sha === sha)
      if (!target) throw new AppError(`"${sha}" isn't one of this app's versions.`)
      const result = await gitRestore(dir, sha, {
        message: `Back to the version "${target.subject.slice(0, 80)}" (${sha})`,
        coAuthor: deps.coAuthor()
      })
      deps.onChange?.()
      return result
    },

    stopAll: () => runner.stopAll()
  }
}

/** The site's description from its config, for the repository's description. */
function readFileSafe(dir: string): string | null {
  try {
    const site = JSON.parse(readFileSync(join(dir, 'site.config.json'), 'utf8')) as {
      description?: unknown
    }
    return typeof site.description === 'string' ? site.description : null
  } catch {
    return null
  }
}

/** Ask the dev server for the page and its scripts once, so the first bundle is built before the browsers time it. */
async function warmUp(url: string): Promise<void> {
  try {
    const html = await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).text()
    for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g))
      await fetch(new URL(src, url), { signal: AbortSignal.timeout(180_000) }).then((r) => r.text())
  } catch {
    /* the browsers report it */
  }
}
