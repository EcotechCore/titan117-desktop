/**
 * Running an app on the laptop (6.1, 6.29): npm with our pinned Node.js to
 * install its packages, its checks (typecheck, build, tests) and its live
 * preview, a Vite dev server on 127.0.0.1 only. Every command gets the
 * shell's scrubbed environment (no keys or tokens), npm's own settings
 * from here rather than the user's or the project's `.npmrc` (the public
 * registry, no install scripts, no update checks), and a time limit.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { cleanEnv } from '../shell'
import type { NodeRuntime } from './node'

const MAX_OUTPUT = 60_000
export const INSTALL_TIMEOUT_MS = 10 * 60_000
export const CHECK_TIMEOUT_MS = 5 * 60_000
const PREVIEW_START_MS = 60_000
/** Colour codes in a program's output. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

export interface RunOutput {
  ok: boolean
  exitCode: number | null
  output: string
  timedOut: boolean
  ms: number
}

export interface CheckResult extends RunOutput {
  name: 'install' | 'typecheck' | 'build' | 'test'
  /** False when the app has no such script. */
  ran: boolean
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  else
    try {
      // Started in its own process group: end the whole group (npm, then vite).
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
}

/** The last part of a long output: errors are at the end. */
function tail(text: string): string {
  return text.length > MAX_OUTPUT ? `[…]\n${text.slice(-MAX_OUTPUT)}` : text
}

export interface Runner {
  needsInstall(dir: string): boolean
  install(dir: string, signal?: AbortSignal): Promise<CheckResult>
  checks(dir: string, signal?: AbortSignal): Promise<CheckResult[]>
  startPreview(dir: string): Promise<{ url: string }>
  stopPreview(dir: string): boolean
  preview(dir: string): { url: string; log: string } | null
  stopAll(): void
}

export function createRunner(deps: {
  node: () => Promise<NodeRuntime>
  /** Our data folder's npm cache and settings: `<data>/components/npm`. */
  npmDir: string
  /** Each run's temp folder. */
  scratch: string
}): Runner {
  mkdirSync(deps.npmDir, { recursive: true })
  mkdirSync(deps.scratch, { recursive: true })
  // An empty user config: the user's own ~/.npmrc (and any tokens in it) is never read.
  const userConfig = join(deps.npmDir, 'npmrc')
  const globalConfig = join(deps.npmDir, 'npmrc-global')
  for (const file of [userConfig, globalConfig]) if (!existsSync(file)) writeFileSync(file, '')

  function env(runtime: NodeRuntime, extra: Record<string, string> = {}): Record<string, string> {
    const base = cleanEnv(process.env, deps.scratch)
    const pathKey = Object.keys(base).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
    const sepChar = process.platform === 'win32' ? ';' : ':'
    return {
      ...base,
      [pathKey]: `${runtime.binDir}${sepChar}${base[pathKey] ?? ''}`,
      // Higher than any project .npmrc: a repo can't point installs elsewhere or run install scripts.
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_userconfig: userConfig,
      npm_config_globalconfig: globalConfig,
      npm_config_cache: join(deps.npmDir, 'cache'),
      npm_config_ignore_scripts: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_loglevel: 'warn',
      CI: '1',
      BROWSER: 'none',
      ...extra
    }
  }

  async function npm(
    dir: string,
    args: string[],
    options: { timeoutMs: number; signal?: AbortSignal; onOutput?: (text: string) => void }
  ): Promise<RunOutput> {
    const runtime = await deps.node()
    const started = Date.now()
    return new Promise<RunOutput>((resolve) => {
      const child = spawn(runtime.node, [runtime.npmCli, ...args], {
        cwd: dir,
        env: env(runtime),
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      let timedOut = false
      const add = (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        output = (output + text).slice(-MAX_OUTPUT * 2)
        options.onOutput?.(text)
      }
      child.stdout.on('data', add)
      child.stderr.on('data', add)
      const timer = setTimeout(() => {
        timedOut = true
        killTree(child.pid)
      }, options.timeoutMs)
      const onAbort = (): void => killTree(child.pid)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const done = (exitCode: number | null): void => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        resolve({
          ok: exitCode === 0 && !timedOut,
          exitCode,
          output: tail(output.replace(ANSI, '')),
          timedOut,
          ms: Date.now() - started
        })
      }
      child.on('error', (error) => {
        add(Buffer.from(String(error)))
        done(null)
      })
      child.on('close', (code) => done(code))
    })
  }

  /** Whether the packages need installing: none yet, or the package files changed since. */
  function needsInstall(dir: string): boolean {
    const marker = join(dir, 'node_modules', '.package-lock.json')
    if (!existsSync(marker)) return true
    const since = statSync(marker).mtimeMs
    return ['package.json', 'package-lock.json'].some(
      (f) => existsSync(join(dir, f)) && statSync(join(dir, f)).mtimeMs > since + 1000
    )
  }

  function scripts(dir: string): Record<string, string> {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
      }
      return pkg.scripts ?? {}
    } catch {
      return {}
    }
  }

  const previews = new Map<
    string,
    { url: string; pid: number | undefined; log: string; stop(): void }
  >()

  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        server.close(() => resolve(port))
      })
    })
  }

  return {
    needsInstall,

    async install(dir: string, signal?: AbortSignal): Promise<CheckResult> {
      if (!needsInstall(dir))
        return {
          name: 'install',
          ran: false,
          ok: true,
          exitCode: 0,
          output: 'Packages already installed.',
          timedOut: false,
          ms: 0
        }
      const result = await npm(dir, ['install', '--no-audit', '--no-fund'], {
        timeoutMs: INSTALL_TIMEOUT_MS,
        signal
      })
      return { name: 'install', ran: true, ...result }
    },

    /** Typecheck, build and tests, each when the app has the script; all of them run, so every problem shows at once. */
    async checks(dir: string, signal?: AbortSignal): Promise<CheckResult[]> {
      const available = scripts(dir)
      const results: CheckResult[] = []
      for (const name of ['typecheck', 'build', 'test'] as const) {
        if (signal?.aborted) break
        if (!available[name]) {
          results.push({
            name,
            ran: false,
            ok: true,
            exitCode: null,
            output: `No "${name}" script.`,
            timedOut: false,
            ms: 0
          })
          continue
        }
        const result = await npm(dir, ['run', name], { timeoutMs: CHECK_TIMEOUT_MS, signal })
        results.push({ name, ran: true, ...result })
      }
      return results
    },

    /** Start the app's dev server on 127.0.0.1 (or return the one running). */
    async startPreview(dir: string): Promise<{ url: string }> {
      const running = previews.get(dir)
      if (running) return { url: running.url }
      const runtime = await deps.node()
      const port = await freePort()
      const url = `http://127.0.0.1:${port}/`
      const child = spawn(
        runtime.node,
        [
          runtime.npmCli,
          'run',
          'dev',
          '--',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort'
        ],
        {
          cwd: dir,
          env: env(runtime),
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      const entry = {
        url,
        pid: child.pid,
        log: '',
        stop: () => killTree(child.pid)
      }
      const add = (chunk: Buffer): void => {
        entry.log = (entry.log + chunk.toString('utf8')).slice(-20_000)
      }
      child.stdout.on('data', add)
      child.stderr.on('data', add)
      child.on('close', () => {
        if (previews.get(dir) === entry) previews.delete(dir)
      })
      previews.set(dir, entry)
      const deadline = Date.now() + PREVIEW_START_MS
      while (Date.now() < deadline) {
        if (!previews.has(dir))
          throw new Error(
            `The preview stopped while starting:\n${tail(entry.log.replace(ANSI, '')).slice(-3000)}`
          )
        const ok = await fetch(url, { signal: AbortSignal.timeout(2000) })
          .then((r) => r.ok)
          .catch(() => false)
        if (ok) return { url }
        await new Promise((r) => setTimeout(r, 400))
      }
      entry.stop()
      previews.delete(dir)
      throw new Error('The preview didn’t start within a minute.')
    },

    stopPreview(dir: string): boolean {
      const running = previews.get(dir)
      if (!running) return false
      running.stop()
      previews.delete(dir)
      return true
    },

    preview(dir: string): { url: string; log: string } | null {
      const running = previews.get(dir)
      return running ? { url: running.url, log: running.log.slice(-4000) } : null
    },

    stopAll(): void {
      for (const [dir, running] of previews) {
        running.stop()
        previews.delete(dir)
      }
    }
  }
}
