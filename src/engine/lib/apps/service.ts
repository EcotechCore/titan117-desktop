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
import { basename, dirname, join } from 'node:path'

import { gitCommit, gitInit, gitLog, gitRestore, gitStatus, type GitVersion } from '../git'
import type { BrowserReport, BrowserTests, EngineName } from './browsers'
import type { CheckResult, Runner } from './runner'
import { slugOf, TEMPLATE_VERSION, webTemplate } from './template'

export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}

export interface AppMeta {
  kind: 'web'
  title: string
  template: string
  createdAt: number
}

export interface AppInfo extends AppMeta {
  folder: string
  name: string
  preview: string | null
}

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
    return meta.kind === 'web' ? meta : null
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
  create(
    parent: string,
    input: { title: string; description: string; lang?: string }
  ): Promise<AppInfo>
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
  stopPreview(dir: string): boolean
  saveVersion(dir: string, message: string): Promise<{ sha: string } | null>
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
}): AppService {
  const { runner, browsers } = deps

  function info(dir: string): AppInfo {
    const meta = readMeta(dir)
    if (!meta) throw new AppError(`"${dir}" isn't an app made with the app builder.`)
    return { ...meta, folder: dir, name: basename(dir), preview: runner.preview(dir)?.url ?? null }
  }

  async function saveVersion(dir: string, message: string): Promise<{ sha: string } | null> {
    const status = await gitStatus(dir)
    if (!status.changes.length) return null
    const { sha } = await gitCommit(dir, { message, coAuthor: deps.coAuthor() })
    deps.onChange?.()
    return { sha }
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

    /** A new web app in its own folder inside `parent`, saved as its first version. */
    async create(
      parent: string,
      input: { title: string; description: string; lang?: string }
    ): Promise<AppInfo> {
      const title = input.title.trim()
      if (!title) throw new AppError('A new app needs a name.')
      const dir = join(parent, slugOf(title))
      if (existsSync(dir) && (await readdir(dir)).length)
        throw new AppError(
          `"${dir}" already exists and isn't empty. Choose another name or folder.`
        )
      const files = webTemplate({
        name: title,
        title,
        description: input.description.trim() || title,
        lang: input.lang ?? 'en'
      })
      for (const [path, content] of files) {
        const target = join(dir, path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content)
      }
      const meta: AppMeta = {
        kind: 'web',
        title,
        template: TEMPLATE_VERSION,
        createdAt: Date.now()
      }
      await mkdir(join(dir, '.titan117'), { recursive: true })
      await writeFile(join(dir, META), JSON.stringify(meta, null, 2) + '\n')
      await gitInit(dir)
      await gitCommit(dir, {
        message: `Version 1: a new web app, "${title}", from the template`,
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
      info(dir)
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
        options.onProgress?.('Opening the preview in Chromium, Firefox and WebKit…')
        const { url } = await runner.startPreview(dir)
        try {
          browserReport = await browsers.run(url, outDir, {
            engines: options.engines,
            signal: options.signal
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

    stopPreview(dir: string): boolean {
      const stopped = runner.stopPreview(dir)
      if (stopped) deps.onChange?.()
      return stopped
    },

    saveVersion,

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
