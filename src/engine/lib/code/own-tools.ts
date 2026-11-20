/**
 * The user's own coding tools (13.14; decisions §20, §55). Titan117 starts
 * the vendor's own, unmodified program, installed and signed in by the user
 * through the vendor's own flow; usage stays on the user's plan. We never
 * read, copy or store their sign-in: whether a tool is signed in comes only
 * from its own status command's exit code.
 *
 *  - Claude Code (Anthropic's rules checked): every action it wants to take
 *    goes through our permission layer, via its permission prompt tool
 *    (approval-mcp.ts), exactly like our own engine's asks. Its own web
 *    tools are switched off; Titan does web work.
 *  - Codex, Cursor's agent and Grok: their terms say nothing either way
 *    about another app running them, so they're experimental and off until
 *    the user turns them on. They run in their own most restrictive mode
 *    that still works on files, after one approval for the whole job, and
 *    their changes are shown as a diff afterwards.
 *  - Antigravity is not offered: its terms forbid third-party software
 *    accessing the service. Gemini CLI is now for Google's business plans.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'

import { cleanEnv } from '../shell'
import type { EngineAsk } from './assess'
import { APPROVE_SERVER, APPROVE_TOOL, type ToolPrompt } from './approval-mcp'
import type { ChangedFile, CodeResult } from './opencode'

export type OwnToolId = 'claude-code' | 'codex' | 'cursor' | 'grok'

export interface OwnToolSpec {
  id: OwnToolId
  /** Plain text only (decisions §20.5): never a logo or our product name. */
  name: string
  /** Commands to look for, in order. */
  commands: string[]
  /** Its own status command; exit code 0 means signed in. Null: it has none. */
  status: string[] | null
  /** How the user signs in, in the vendor's own flow. */
  signIn: string
  experimental: boolean
}

export const OWN_TOOLS: OwnToolSpec[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    commands: ['claude'],
    status: ['auth', 'status'],
    signIn: 'claude auth login',
    experimental: false
  },
  {
    id: 'codex',
    name: 'Codex',
    commands: ['codex'],
    status: ['login', 'status'],
    signIn: 'codex login',
    experimental: true
  },
  {
    id: 'cursor',
    name: 'Cursor’s agent',
    commands: ['agent', 'cursor-agent'],
    status: null,
    signIn: 'agent login',
    experimental: true
  },
  {
    id: 'grok',
    name: 'Grok',
    commands: ['grok'],
    status: null,
    signIn: 'grok login',
    experimental: true
  }
]

/** Tools we deliberately don't run, and why (shown in the app). */
export const NOT_OFFERED = [
  {
    name: 'Antigravity',
    why: 'Google’s terms for Antigravity forbid third-party software accessing the service.'
  },
  {
    name: 'Gemini CLI',
    why: 'Gemini CLI is now for Google’s business plans; personal plans moved to Antigravity.'
  }
]

export interface OwnToolStatus {
  id: OwnToolId
  name: string
  installed: boolean
  /** True, false, or null when the tool has no status command. */
  signedIn: boolean | null
  experimental: boolean
  enabled: boolean
  signIn: string
}

interface Proc {
  code: number | null
  stdout: string
  stderr: string
}

export type Runner = (
  program: string,
  args: string[],
  options: {
    cwd: string
    stdin?: string
    timeoutMs: number
    signal?: AbortSignal
    onLine?(line: string): void
  }
) => Promise<Proc>

function toolEnv(): Record<string, string> {
  // The scrubbed environment (no keys or tokens of ours), plus what these
  // tools need to find their own sign-in: the user's home and app folders.
  return cleanEnv(process.env, tmpdir(), { NO_COLOR: '1', CI: '1' })
}

/** Runs a program; `.cmd` shims (npm installs on Windows) go through cmd with fixed arguments only. */
export const runProgram: Runner = (program, args, options) =>
  new Promise((resolve) => {
    const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(program)
    const child = spawn(shim ? `"${program}"` : program, shim ? args.map((a) => `"${a}"`) : args, {
      cwd: options.cwd,
      env: toolEnv(),
      shell: shim,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let pending = ''
    const timer = setTimeout(() => child.kill(), options.timeoutMs)
    const stop = (): void => {
      child.kill()
    }
    options.signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', (c: Buffer) => {
      const text = c.toString()
      stdout = (stdout + text).slice(-2_000_000)
      if (options.onLine) {
        pending += text
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) options.onLine(line)
      }
    })
    child.stderr.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-20_000)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', stop)
      if (pending && options.onLine) options.onLine(pending)
      resolve({ code, stdout, stderr })
    })
    child.stdin.end(options.stdin ?? '')
  })

/** Where a command lives on PATH, preferring a real program over a script shim. */
export async function findProgram(
  command: string,
  run: Runner = runProgram
): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  const found = await run(finder, [command], { cwd: tmpdir(), timeoutMs: 5000 })
  if (found.code !== 0) return null
  const paths = found.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return (
    paths.find((p) => /\.exe$/i.test(p)) ??
    paths.find((p) => /\.(cmd|bat)$/i.test(p)) ??
    paths[0] ??
    null
  )
}

/** Claude Code's prompt as one of our engine asks, or a direct answer (exported for tests). */
export function claudeAsk(
  prompt: ToolPrompt,
  repo: string
): { ask: EngineAsk } | { direct: { allowed: boolean; why?: string } } | { read: string } {
  const input = prompt.input
  const str = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const base = {
    id: randomBytes(6).toString('hex'),
    sessionID: 'claude-code',
    always: [] as string[]
  }
  switch (prompt.tool) {
    case 'Bash': {
      const command = str('command')
      return { ask: { ...base, permission: 'bash', patterns: [command], metadata: { command } } }
    }
    case 'Edit': {
      const diff = [
        ...str('old_string')
          .split('\n')
          .map((l) => `-${l}`),
        ...str('new_string')
          .split('\n')
          .map((l) => `+${l}`)
      ]
      return {
        ask: {
          ...base,
          permission: 'edit',
          patterns: [str('file_path')],
          metadata: { diff: diff.join('\n') }
        }
      }
    }
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []
      const diff = edits.flatMap((e) => [
        ...String(e.old_string ?? '')
          .split('\n')
          .map((l) => `-${l}`),
        ...String(e.new_string ?? '')
          .split('\n')
          .map((l) => `+${l}`)
      ])
      return {
        ask: {
          ...base,
          permission: 'edit',
          patterns: [str('file_path')],
          metadata: { diff: diff.join('\n') }
        }
      }
    }
    case 'Write':
      return {
        ask: {
          ...base,
          permission: 'edit',
          patterns: [str('file_path')],
          metadata: {
            diff: str('content')
              .split('\n')
              .map((l) => `+${l}`)
              .join('\n')
          }
        }
      }
    case 'NotebookEdit':
      return {
        ask: { ...base, permission: 'edit', patterns: [str('notebook_path')], metadata: {} }
      }
    case 'Read':
    case 'NotebookRead':
    case 'Glob':
    case 'Grep':
    case 'LS': {
      const path = str('file_path') || str('notebook_path') || str('path') || repo
      return { read: isAbsolute(path) ? path : join(repo, path) }
    }
    case 'TodoWrite':
    case 'Task':
    case 'ExitPlanMode':
      return { direct: { allowed: true } }
    case 'WebFetch':
    case 'WebSearch':
      return {
        ask: {
          ...base,
          permission: 'webfetch',
          patterns: [str('url') || str('query')],
          metadata: {}
        }
      }
    default:
      return { ask: { ...base, permission: prompt.tool || 'unknown', patterns: [], metadata: {} } }
  }
}

/** The text and cost from Claude Code's stream-json output (exported for tests). */
export function readClaudeStream(lines: string[]): {
  text: string
  error: string | null
  costUsd: number | null
} {
  let text = ''
  let error: string | null = null
  let costUsd: number | null = null
  for (const line of lines) {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'result') {
      if (typeof event.result === 'string') text = event.result
      if (typeof event.total_cost_usd === 'number') costUsd = event.total_cost_usd
      if (event.is_error === true)
        error = typeof event.result === 'string' ? event.result : 'It stopped with an error.'
    } else if (event.type === 'assistant' && !text) {
      const message = event.message as { content?: { type: string; text?: string }[] } | undefined
      const parts = (message?.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
      if (parts.length) text = parts.join('\n')
    }
  }
  return { text, error, costUsd }
}

export interface OwnToolRun {
  tool: OwnToolId
  repo: string
  prompt: string
  mode: 'plan' | 'build'
  signal: AbortSignal
  /** Decide on one of the tool's asks (our permission layer). */
  decide(ask: EngineAsk): Promise<{ allowed: boolean; why?: string }>
  /** A read the tool wants: allowed inside the project, refused outside. */
  readAllowed(path: string): Promise<boolean>
  /** The whole job, for the experimental tools (one approval, laptop only). */
  approveJob(summary: string): Promise<{ allowed: boolean; why?: string }>
  onEvent?(text: string): void
}

const MAX_PROMPT = 20_000
const JOB_TIMEOUT_MS = 60 * 60_000

export interface OwnTools {
  status(): Promise<OwnToolStatus[]>
  run(run: OwnToolRun): Promise<CodeResult & { usedTool: boolean; note?: string }>
}

export function createOwnTools(deps: {
  approvals: import('./approval-mcp').ApprovalServer
  /** Scratch folder for the per-run MCP config file. */
  scratch: string
  /** Experimental tools the user turned on. */
  enabled(id: OwnToolId): boolean
  /** Files changed in the project (git), to report what the tool changed. */
  changes(repo: string): Promise<Map<string, ChangedFile>>
  run?: Runner
}): OwnTools {
  const run = deps.run ?? runProgram
  const found = new Map<OwnToolId, { at: number; program: string | null }>()

  async function programOf(spec: OwnToolSpec): Promise<string | null> {
    const cached = found.get(spec.id)
    if (cached && Date.now() - cached.at < 60_000) return cached.program
    let program: string | null = null
    for (const command of spec.commands) {
      program = await findProgram(command, run)
      if (program) break
    }
    found.set(spec.id, { at: Date.now(), program })
    return program
  }

  async function signedIn(spec: OwnToolSpec, program: string): Promise<boolean | null> {
    if (!spec.status) return null
    // Only the exit code is read: the tool's account details stay its own.
    const result = await run(program, spec.status, { cwd: tmpdir(), timeoutMs: 15_000 })
    return result.code === 0
  }

  async function statusOf(spec: OwnToolSpec): Promise<OwnToolStatus> {
    const program = await programOf(spec)
    return {
      id: spec.id,
      name: spec.name,
      installed: !!program,
      signedIn: program ? await signedIn(spec, program) : false,
      experimental: spec.experimental,
      enabled: !spec.experimental || deps.enabled(spec.id),
      signIn: spec.signIn
    }
  }

  async function runClaude(r: OwnToolRun, program: string): Promise<CodeResult> {
    const token = deps.approvals.open(async (prompt) => {
      const mapped = claudeAsk(prompt, r.repo)
      if ('direct' in mapped) return mapped.direct
      if ('read' in mapped)
        return (await r.readAllowed(mapped.read))
          ? { allowed: true }
          : { allowed: false, why: 'Claude Code works only inside the project folder.' }
      return r.decide(mapped.ask)
    })
    const dir = join(deps.scratch, `claude-${token.slice(0, 12)}`)
    mkdirSync(dir, { recursive: true })
    const config = join(dir, 'mcp.json')
    writeFileSync(
      config,
      JSON.stringify({
        mcpServers: {
          [APPROVE_SERVER]: {
            type: 'http',
            url: deps.approvals.url,
            headers: { Authorization: `Bearer ${token}` }
          }
        }
      }),
      { mode: 0o600 }
    )
    const lines: string[] = []
    try {
      const result = await run(
        program,
        [
          '-p',
          '--output-format',
          'stream-json',
          '--verbose',
          '--permission-mode',
          r.mode === 'plan' ? 'plan' : 'default',
          '--mcp-config',
          config,
          '--strict-mcp-config',
          '--permission-prompt-tool',
          `mcp__${APPROVE_SERVER}__${APPROVE_TOOL}`,
          '--disallowedTools',
          'WebFetch',
          'WebSearch'
        ],
        {
          cwd: r.repo,
          // The request goes in on stdin, never on a command line.
          stdin: r.prompt.slice(0, MAX_PROMPT),
          timeoutMs: JOB_TIMEOUT_MS,
          signal: r.signal,
          onLine(line) {
            lines.push(line)
            const parsed = readClaudeStream([line])
            if (parsed.text) r.onEvent?.(parsed.text.slice(0, 300))
          }
        }
      )
      const read = readClaudeStream(lines.length ? lines : result.stdout.split('\n'))
      if (r.signal.aborted) return { status: 'stopped', text: read.text, files: [] }
      if (result.code !== 0 || read.error)
        return {
          status: 'failed',
          text: read.text,
          error:
            read.error ??
            (result.stderr.trim().split('\n').slice(-3).join(' ') ||
              `Claude Code stopped (exit ${result.code}).`),
          files: []
        }
      return { status: 'done', text: read.text, files: [] }
    } finally {
      deps.approvals.close(token)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  async function runExperimental(
    r: OwnToolRun,
    spec: OwnToolSpec,
    program: string
  ): Promise<CodeResult> {
    const approved = await r.approveJob(
      `Run ${spec.name} (your own plan) in ${r.repo}. It works on its own in this folder, in its own ${r.mode === 'plan' ? 'read-only' : 'workspace'} mode, and its changes are shown afterwards.`
    )
    if (!approved.allowed)
      return { status: 'stopped', text: '', error: approved.why ?? 'You said no.', files: [] }
    const prompt = r.prompt.slice(0, MAX_PROMPT)
    const shim = /\.(cmd|bat)$/i.test(program)
    let args: string[]
    let stdin: string | undefined
    switch (spec.id) {
      case 'codex':
        // Its own sandbox: writes only in the workspace, no network; "-" reads the request from stdin.
        args = ['exec', '--sandbox', r.mode === 'plan' ? 'read-only' : 'workspace-write', '-']
        stdin = prompt
        break
      case 'cursor':
        args = shim
          ? ['-p', '--sandbox', 'enabled']
          : ['-p', prompt, '--sandbox', 'enabled', '--output-format', 'text']
        stdin = shim ? prompt : undefined
        break
      default:
        args = shim
          ? ['-p', '--output-format', 'plain', '--no-auto-update']
          : ['-p', prompt, '--output-format', 'plain', '--no-auto-update']
        stdin = shim ? prompt : undefined
    }
    const result = await run(program, args, {
      cwd: r.repo,
      stdin,
      timeoutMs: JOB_TIMEOUT_MS,
      signal: r.signal,
      onLine: (line) => line.trim() && r.onEvent?.(line.slice(0, 300))
    })
    const text = result.stdout.trim().slice(-8000)
    if (r.signal.aborted) return { status: 'stopped', text, files: [] }
    return result.code === 0
      ? { status: 'done', text, files: [] }
      : {
          status: 'failed',
          text,
          error:
            result.stderr.trim().split('\n').slice(-3).join(' ') ||
            `${spec.name} stopped (exit ${result.code}).`,
          files: []
        }
  }

  return {
    status: () => Promise.all(OWN_TOOLS.map(statusOf)),

    async run(r) {
      const spec = OWN_TOOLS.find((t) => t.id === r.tool)
      if (!spec)
        return {
          status: 'failed',
          text: '',
          error: 'Unknown coding tool.',
          files: [],
          usedTool: false
        }
      const status = await statusOf(spec)
      // Missing, signed out or not turned on: the caller falls back to our engine (decisions §20).
      if (!status.installed)
        return {
          status: 'failed',
          text: '',
          files: [],
          usedTool: false,
          note: `${spec.name} isn’t installed on this laptop.`
        }
      if (status.signedIn === false)
        return {
          status: 'failed',
          text: '',
          files: [],
          usedTool: false,
          note: `${spec.name} isn’t signed in. Sign in with \`${spec.signIn}\` in a terminal.`
        }
      if (!status.enabled)
        return {
          status: 'failed',
          text: '',
          files: [],
          usedTool: false,
          note: `${spec.name} is experimental and turned off. Turn it on in the Code screen to use it.`
        }
      const program = (await programOf(spec))!
      const before = await deps.changes(r.repo).catch(() => new Map<string, ChangedFile>())
      const result =
        spec.id === 'claude-code'
          ? await runClaude(r, program)
          : await runExperimental(r, spec, program)
      const after = await deps.changes(r.repo).catch(() => new Map<string, ChangedFile>())
      const files = [...after.values()].filter((f) => {
        const was = before.get(f.file)
        return !was || was.additions !== f.additions || was.deletions !== f.deletions
      })
      return { ...result, files, usedTool: true }
    }
  }
}
