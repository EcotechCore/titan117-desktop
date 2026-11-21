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
import { networkInterfaces } from 'node:os'
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
  /**
   * A mobile app opened to phones on this Wi-Fi (6.24, decisions §57): its
   * Expo server listens on the network instead of 127.0.0.1 only, and
   * Expo Go opens `phone` (an `exp://` address on this laptop's network).
   */
  startPhone(dir: string): Promise<{ url: string; phone: string }>
  stopPreview(dir: string): boolean
  preview(dir: string): { url: string; log: string; phone: string | null } | null
  stopAll(): void
}

/** An Expo app (mobile, decisions §57): `expo` among its packages. */
export function isExpoApp(dir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    return !!pkg.dependencies?.expo
  } catch {
    return false
  }
}

/** Private IPv4 ranges a home or office network uses. */
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
/** Adapters that aren't the Wi-Fi or cable a phone shares: virtual machines, WSL, VPNs. */
const VIRTUAL =
  /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Docker|Tailscale|ZeroTier|vpn|utun|bridge|tap/i

/** This laptop's address on its Wi-Fi or cable network, for a phone to reach; null when there's none. */
export function lanAddress(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()
): string | null {
  const candidates: { name: string; address: string }[] = []
  for (const [name, list] of Object.entries(interfaces))
    for (const entry of list ?? [])
      if (entry.family === 'IPv4' && !entry.internal && PRIVATE_V4.test(entry.address))
        candidates.push({ name, address: entry.address })
  const real = candidates.filter((c) => !VIRTUAL.test(c.name))
  const preferred = real.find((c) => /wi-?fi|wlan|wireless|^en0$/i.test(c.name)) ?? real[0]
  return preferred?.address ?? null
}

export function createRunner(deps: {
  node: () => Promise<NodeRuntime>
  /** Our data folder's npm cache and settings: `<data>/components/npm`. */
  npmDir: string
  /** Each run's temp folder. */
  scratch: string
  /** This laptop's network address for phones (tests name one). */
  lan?: () => string | null
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
      // Expo (decisions §57): no telemetry, and no calls to Expo's servers (manifest signing, version checks).
      EXPO_NO_TELEMETRY: '1',
      EXPO_OFFLINE: '1',
      EXPO_NO_DEPENDENCY_VALIDATION: '1',
      ...extra
    }
  }

  /** The environment of a long-running dev server: no CI flag, since Metro stops watching files under CI. */
  function serverEnv(
    runtime: NodeRuntime,
    extra: Record<string, string> = {}
  ): Record<string, string> {
    const all = env(runtime, extra)
    delete all.CI
    return all
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
    { url: string; phone: string | null; pid: number | undefined; log: string; stop(): void }
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
      return startServer(dir, null)
    },

    async startPhone(dir: string): Promise<{ url: string; phone: string }> {
      if (!isExpoApp(dir)) throw new Error('Only a mobile app opens on a phone.')
      const running = previews.get(dir)
      if (running?.phone) return { url: running.url, phone: running.phone }
      const lan = (deps.lan ?? lanAddress)()
      if (!lan)
        throw new Error(
          'This laptop isn’t on a Wi-Fi or cable network a phone can share, so Expo Go can’t reach it. Connect both to the same Wi-Fi.'
        )
      // One server per app: the preview on 127.0.0.1 makes way for one the phone can reach.
      if (running) {
        running.stop()
        previews.delete(dir)
      }
      const started = await startServer(dir, lan)
      return { url: started.url, phone: started.phone ?? '' }
    },

    stopPreview(dir: string): boolean {
      const running = previews.get(dir)
      if (!running) return false
      running.stop()
      previews.delete(dir)
      return true
    },

    preview(dir: string): { url: string; log: string; phone: string | null } | null {
      const running = previews.get(dir)
      return running
        ? { url: running.url, log: running.log.slice(-4000), phone: running.phone }
        : null
    },

    stopAll(): void {
      for (const [dir, running] of previews) {
        running.stop()
        previews.delete(dir)
      }
    }
  }

  /**
   * The dev server: Vite for a web app; Expo's for a mobile app, on 127.0.0.1
   * only, or on the laptop's network address when `lan` is given (for Expo Go).
   */
  async function startServer(
    dir: string,
    lan: string | null
  ): Promise<{ url: string; phone: string | null }> {
    {
      const runtime = await deps.node()
      const port = await freePort()
      const url = `http://127.0.0.1:${port}/`
      const expo = isExpoApp(dir)
      const args = expo
        ? lan
          ? ['run', 'phone', '--', '--port', String(port)]
          : ['run', 'dev', '--', '--localhost', '--port', String(port)]
        : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
      const child = spawn(runtime.node, [runtime.npmCli, ...args], {
        cwd: dir,
        // Expo Go is told this laptop's address on the Wi-Fi, not a virtual adapter's.
        env: serverEnv(runtime, lan ? { REACT_NATIVE_PACKAGER_HOSTNAME: lan } : {}),
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const entry = {
        url,
        phone: lan ? `exp://${lan}:${port}` : null,
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
        if (ok) return { url, phone: entry.phone }
        await new Promise((r) => setTimeout(r, 400))
      }
      entry.stop()
      previews.delete(dir)
      throw new Error('The preview didn’t start within a minute.')
    }
  }
}
