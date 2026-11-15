/**
 * The sandboxed shell (feature 3.8, guardrails §4): every command runs in its
 * own process, in an allowed folder, with a timeout, a scrubbed environment
 * (no keys, tokens or Titan117 settings) and capped output.
 *
 * On macOS the process runs inside Seatbelt (`sandbox-exec`, as Codex does):
 * it may read the disk except credential folders, write only inside the
 * allowed folders and its own temp folder, and reach the network only when
 * the user approved a command that needs it. On Windows there is no OS
 * sandbox yet (decisions §43): the approval rules carry the weight, and the
 * process can't see the engine's secrets.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { PermissionError, resolveAllowed, type FolderPolicy } from './folders'

export interface ShellResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunOptions {
  /** A folder inside the allowed folders; the first allowed folder when left out. */
  cwd?: string
  timeoutMs?: number
  /** Whether the command may use the network (macOS sandbox). */
  network?: boolean
  /** Extra environment variables (the local tool API's address and token for scripts). */
  env?: Record<string, string>
  /** Text written to the command's input. */
  stdin?: string
}

export interface ShellAccess {
  run(command: string, options?: RunOptions): Promise<ShellResult>
  /** Run a program directly with arguments (no shell parsing): scripts, the coding engine. */
  exec(program: string, args: string[], options?: RunOptions): Promise<ShellResult>
  /** A private scratch folder for this task, outside the user's folders. */
  scratch(): string
  /** Save a script and the `titan` helper beside it; returns how to run it (feature 4.10). */
  script(language: string, code: string): Promise<Script>
}

export interface Script {
  program: string
  args: string[]
  env: Record<string, string>
}

/** Where scripts reach the local tool API, and the token that ties them to one task. */
export interface ToolApi {
  url: string
  token: string
}

const JS_HELPER = `import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
globalThis.require = require
globalThis.titan = {
  async call(name, input = {}) {
    const response = await fetch(process.env.TITAN_TOOL_URL + '/v1/tool-calls', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.TITAN_TOOL_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, input })
    })
    return response.json()
  }
}
`

const PY_HELPER = `import json, os, urllib.request

def call(name, input=None):
    request = urllib.request.Request(
        os.environ["TITAN_TOOL_URL"] + "/v1/tool-calls",
        data=json.dumps({"name": name, "input": input or {}}).encode("utf-8"),
        headers={"Authorization": "Bearer " + os.environ["TITAN_TOOL_TOKEN"], "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return json.loads(error.read().decode("utf-8"))
`

let pythonFound: string | null | undefined

/** The Python on this laptop, if any (built-in Python arrives with phase 5, feature 1.15). */
function findPython(): string | null {
  if (pythonFound !== undefined) return pythonFound
  pythonFound = null
  for (const candidate of process.platform === 'win32'
    ? ['python', 'py', 'python3']
    : ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10_000
    })
    if (probe.status === 0 && probe.stdout.trim() === '3') {
      pythonFound = candidate
      break
    }
  }
  return pythonFound
}

const MAX_OUTPUT = 100_000
export const DEFAULT_TIMEOUT_MS = 120_000
export const MAX_TIMEOUT_MS = 600_000

/** Only these variables reach a command: nothing that could hold a key. */
const ENV_KEEP = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'WINDIR',
  'COMSPEC',
  'ComSpec',
  'SystemDrive',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE',
  'USERNAME',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
  'CommonProgramFiles',
  'APPDATA',
  'LOCALAPPDATA',
  'PSModulePath'
]

export function cleanEnv(
  source: NodeJS.ProcessEnv,
  scratch: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of ENV_KEEP) {
    const value = source[name]
    if (typeof value === 'string') env[name] = value
  }
  env.TEMP = scratch
  env.TMP = scratch
  env.TMPDIR = scratch
  env.NO_COLOR = '1'
  return { ...env, ...extra }
}

function cap(text: string): string {
  return text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n[Output cut at ${MAX_OUTPUT} characters.]`
    : text
}

/** Credential folders a sandboxed command may not even read (macOS). */
function credentialFolders(): string[] {
  const home = homedir()
  return [
    '.ssh',
    '.aws',
    '.azure',
    '.gnupg',
    '.kube',
    '.docker',
    '.claude',
    '.codex',
    '.cursor',
    '.config/gcloud',
    'Library/Keychains',
    'Library/Cookies',
    'Library/Application Support/Google/Chrome',
    'Library/Application Support/Firefox'
  ].map((p) => join(home, p))
}

function sbString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** The Seatbelt profile for one command (after Codex's base policy, Apache 2.0). */
export function seatbeltProfile(options: {
  writable: string[]
  core: string[]
  network: boolean
  /** Scripts may reach the local tool API on this laptop. */
  localTools?: boolean
}): string {
  const hidden = [...credentialFolders(), ...options.core]
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow signal (target same-sandbox))',
    '(allow process-info* (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix-shm)',
    '(allow pseudo-tty)',
    '(allow file-ioctl)',
    `(allow file-read* (require-all (subpath "/") ${hidden
      .map((p) => `(require-not (subpath ${sbString(p)}))`)
      .join(' ')}))`,
    `(allow file-write* (literal "/dev/null") (literal "/dev/tty") ${options.writable
      .map((p) => `(subpath ${sbString(p)})`)
      .join(' ')})`,
    ...(options.network
      ? ['(allow network*)', '(allow system-socket)']
      : options.localTools
        ? ['(allow network-outbound (remote ip "localhost:*"))', '(allow system-socket)']
        : [])
  ].join('\n')
}

export function createShell(deps: {
  policy: () => FolderPolicy
  /** The engine's data folder; each task's scratch folder lives under it. */
  scratchRoot: string
  taskId: string
  /** Called with a command line before it runs; throws to block it (private content going out). */
  guard?: (commandLine: string, network: boolean) => void
  /** The local tool API for scripts (feature 4.10). */
  toolApi?: () => ToolApi | null
  signal: AbortSignal
  platform?: NodeJS.Platform
}): ShellAccess {
  const platform = deps.platform ?? process.platform
  const scratchDir = join(deps.scratchRoot, deps.taskId.replace(/[^a-zA-Z0-9-]/g, ''))

  function scratch(): string {
    mkdirSync(scratchDir, { recursive: true })
    return scratchDir
  }

  async function launch(
    program: string,
    args: string[],
    shown: string,
    options: RunOptions
  ): Promise<ShellResult> {
    const policy = deps.policy()
    if (policy.allowed.length === 0)
      throw new PermissionError('No folder is allowed yet. Choose a folder first.')
    const cwd = await resolveAllowed(policy, options.cwd ?? '.')
    deps.guard?.(shown, options.network ?? false)
    const timeout = Math.min(
      Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000),
      MAX_TIMEOUT_MS
    )
    const env = cleanEnv(process.env, scratch(), options.env)

    let file = program
    let argv = args
    if (platform === 'darwin') {
      const profile = seatbeltProfile({
        writable: [...policy.allowed, scratch(), tmpdir()],
        core: policy.core,
        network: options.network ?? false,
        localTools: !!options.env?.TITAN_TOOL_URL
      })
      file = '/usr/bin/sandbox-exec'
      argv = ['-p', profile, program, ...args]
    }

    return new Promise<ShellResult>((resolve, reject) => {
      const child = spawn(file, argv, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (stdout.length <= MAX_OUTPUT) stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length <= MAX_OUTPUT) stderr += chunk
      })
      const kill = (): void => {
        if (child.exitCode !== null || child.pid === undefined) return
        if (platform === 'win32')
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        else child.kill('SIGKILL')
      }
      const timer = setTimeout(() => {
        timedOut = true
        kill()
      }, timeout)
      const onAbort = (): void => kill()
      deps.signal.addEventListener('abort', onAbort, { once: true })
      child.on('error', (error) => {
        clearTimeout(timer)
        deps.signal.removeEventListener('abort', onAbort)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        deps.signal.removeEventListener('abort', onAbort)
        resolve({ exitCode: code, stdout: cap(stdout), stderr: cap(stderr), timedOut })
      })
      if (options.stdin) child.stdin.write(options.stdin)
      child.stdin.end()
    })
  }

  return {
    scratch,
    async script(language, code) {
      // A script that talks to the internet may not carry private content.
      deps.guard?.(
        code,
        /https?:|fetch\(|urllib|requests\.|https?\.request|socket|net\.connect/i.test(code)
      )
      const dir = scratch()
      const api = deps.toolApi?.() ?? null
      const env: Record<string, string> = api
        ? { TITAN_TOOL_URL: api.url, TITAN_TOOL_TOKEN: api.token }
        : {}
      const stamp = Date.now().toString(36)
      if (language === 'javascript') {
        const file = join(dir, `script-${stamp}.mjs`)
        writeFileSync(join(dir, 'titan-helper.mjs'), JS_HELPER)
        writeFileSync(
          file,
          `import './titan-helper.mjs'
${code}
`
        )
        return {
          program: process.execPath,
          args: [file],
          env: { ...env, ELECTRON_RUN_AS_NODE: '1' }
        }
      }
      if (language === 'python') {
        const python = findPython()
        const file = join(dir, `script-${stamp}.py`)
        writeFileSync(join(dir, 'titan.py'), PY_HELPER)
        writeFileSync(
          file,
          `import sys
sys.path.insert(0, ${JSON.stringify(dir)})
import titan
${code}
`
        )
        if (!python)
          throw new PermissionError(
            "Python isn't installed on this laptop. Use JavaScript instead (built-in Python comes later)."
          )
        return { program: python, args: [file], env: { ...env, PYTHONIOENCODING: 'utf-8' } }
      }
      throw new PermissionError('Scripts can be javascript or python.')
    },
    run(command, options = {}) {
      if (typeof command !== 'string' || !command.trim())
        throw new PermissionError('Write a command first.')
      if (platform === 'win32')
        return launch(
          'powershell.exe',
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            command
          ],
          command,
          options
        )
      return launch('/bin/sh', ['-c', command], command, options)
    },
    exec(program, args, options = {}) {
      return launch(program, args, [program, ...args].join(' '), options)
    }
  }
}
