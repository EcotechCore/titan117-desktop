/**
 * The coding engine adapter (decisions §12, §53): OpenCode, pinned, run as
 * its own program behind this interface so it can be swapped or upgraded
 * with the contract tests as the gate.
 *
 * Each coding task gets its own OpenCode server on 127.0.0.1, with:
 *  - a scrubbed environment (no keys or tokens), ripgrep on its PATH, and
 *    its own config, data and cache folders inside our data folder, so the
 *    user's own OpenCode setup is never read or changed;
 *  - every outside call switched off: updates, the model catalogue,
 *    language-server downloads, plugins, sharing, project config files
 *    (a repo can't widen its own permissions), Claude Code's files;
 *  - one model provider: our bridge, with a token for this task only;
 *  - web tools denied, files outside the project denied, commands and
 *    edits asking: each ask is decided by our permission layer and
 *    answered "once", so OpenCode never remembers an "always" of its own;
 *  - a password on its server, so nothing else on the laptop can drive it.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'

import { cleanEnv, seatbeltProfile } from '../shell'
import type { EngineAsk } from './assess'
import type { BridgeTask, ModelBridge } from './bridge'
import { OPENCODE_VERSION } from './components'

export type CodeAgent = 'build' | 'plan'

export type CodeEvent =
  | { type: 'tool'; callId: string; tool: string; status: string; title: string }
  | { type: 'text'; text: string }
  | { type: 'note'; text: string }

export interface CodeRun {
  taskId: string
  /** The project folder: an allowed folder, already checked. */
  repo: string
  prompt: string
  /** Extra instructions for this job (project memory, 13.8). */
  system?: string
  /** `plan` only reads and proposes; `build` changes files (13.2). */
  agent: CodeAgent
  signal: AbortSignal
  /** One model step through our router (the bridge calls it). */
  step: BridgeTask['step']
  /** Decide on one of OpenCode's asks; true lets it go ahead. */
  decide(ask: EngineAsk): Promise<{ allowed: boolean; why?: string }>
  onEvent?(event: CodeEvent): void
}

export interface ChangedFile {
  file: string
  additions: number
  deletions: number
}

export interface CodeResult {
  status: 'done' | 'failed' | 'stopped'
  /** The engine's last answer. */
  text: string
  error?: string
  files: ChangedFile[]
}

/** What the rest of the app sees. OpenCode is one implementation. */
export interface CodingEngine {
  run(run: CodeRun): Promise<CodeResult>
  /** Let go of a task's server (the task ended). */
  release(taskId: string): Promise<void>
  shutdown(): Promise<void>
}

/** The config OpenCode gets (exported for the contract tests). */
export function opencodeConfig(
  bridgeUrl: string,
  token: string,
  envPlugin: string
): Record<string, unknown> {
  return {
    autoupdate: false,
    share: 'disabled',
    snapshot: true,
    enabled_providers: ['titan117'],
    model: 'titan117/task',
    small_model: 'titan117/task',
    lsp: false,
    formatter: false,
    // Our one plugin (envPluginSource); no other plugin can load: project
    // and home settings are off and nothing is installed from npm.
    plugin: [envPlugin],
    mcp: {},
    instructions: [],
    provider: {
      titan117: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Titan117',
        options: { baseURL: bridgeUrl, apiKey: token },
        models: {
          task: {
            name: 'The task’s model',
            tool_call: true,
            limit: { context: 128_000, output: 16_000 }
          }
        }
      }
    },
    permission: {
      // Reading inside the project runs at once, as for our own file tools;
      // saved secrets never (guardrails §8).
      read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny', '*.env.example': 'allow' },
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      todowrite: 'allow',
      task: 'allow',
      edit: 'ask',
      bash: 'ask',
      doom_loop: 'ask',
      external_directory: 'deny',
      webfetch: 'deny',
      websearch: 'deny',
      question: 'deny',
      skill: 'deny',
      lsp: 'deny'
    }
  }
}

/** Environment flags that switch off OpenCode's own outside calls (checked against v1.19.6's source). */
export const OPENCODE_FLAGS: Record<string, string> = {
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_MODELS_FETCH: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_EMBEDDED_WEB_UI: '1',
  OPENCODE_CLIENT: 'titan117'
}

/**
 * Our plugin for OpenCode: commands it runs inherit its environment, which
 * holds its server password and the bridge token. This blanks every
 * `OPENCODE_` variable in a command's environment, so a command can't
 * drive OpenCode's server (and answer its own asks) or spend the task's
 * model budget. Checked by the contract tests.
 */
export const envPluginSource = `export const Titan117Env = async () => ({
  'shell.env': async (_input, output) => {
    for (const key of Object.keys(process.env))
      if (/^opencode_/i.test(key)) output.env[key] = ''
  }
})
`

export function envPluginPath(home: string): string {
  return join(home, 'plugins', 'titan117-env.mjs')
}

/**
 * OpenCode's folders, made before it starts. On every start it installs its
 * plugin helper (`@opencode-ai/plugin`) from npm into its config folder
 * unless that folder already lists it as installed; we use no plugins, so
 * the folder says it's there and OpenCode never reaches npm (caught by the
 * contract tests' recording proxy).
 */
export function prepareHome(home: string): void {
  for (const sub of ['config/opencode/node_modules', 'data', 'cache', 'state', 'home', 'plugins'])
    mkdirSync(join(home, sub), { recursive: true })
  writeFileSync(envPluginPath(home), envPluginSource)
  const config = join(home, 'config', 'opencode')
  const deps = { '@opencode-ai/plugin': OPENCODE_VERSION }
  writeFileSync(
    join(config, 'package.json'),
    JSON.stringify({ private: true, dependencies: deps }, null, 2)
  )
  writeFileSync(
    join(config, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: deps } } }, null, 2)
  )
}

/** The files an approved edit changes, with lines added and removed (exported for tests). */
export function editedFiles(ask: EngineAsk): ChangedFile[] {
  const listed = ask.metadata.files
  if (Array.isArray(listed) && listed.length)
    return listed.map((f: Record<string, unknown>) => ({
      file: String(f.relativePath ?? f.filePath ?? f.file ?? ''),
      additions: Number(f.additions ?? 0),
      deletions: Number(f.deletions ?? 0)
    }))
  const diff = typeof ask.metadata.diff === 'string' ? ask.metadata.diff.split(/\r?\n/) : []
  const additions = diff.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
  const deletions = diff.filter((l) => l.startsWith('-') && !l.startsWith('---')).length
  return ask.patterns.map((file) => ({ file: file.replace(/\\/g, '/'), additions, deletions }))
}

/**
 * OpenCode's Seatbelt profile on macOS (exported for tests): it may write
 * only in the project, its own folders and its temp folder; credential
 * folders and the app's own data are unreadable, except OpenCode's own
 * home and program; the network stays on, because the commands the user
 * approves may need it (installing packages, running tests against a server).
 */
export function opencodeSeatbelt(
  repo: string,
  home: string,
  scratch: string,
  core: string[],
  program: string
): string {
  return seatbeltProfile({
    writable: [repo, home, scratch],
    core,
    network: true,
    // OpenCode's program and ripgrep: <data>/components/code/<name>/<version>/<file>.
    readable: [home, scratch, dirname(dirname(dirname(program)))]
  })
}

interface Running {
  proc: ChildProcess
  client: OpencodeClient
  token: string
  sessionId: string | null
  /** The run in progress; asks and events go to it. */
  current: CodeRun | null
  events: AbortController
  /** Files changed in the current run, from the edits we approved. */
  edited: Map<string, ChangedFile>
  /** Stops an idle server; reset by every run. */
  idle: ReturnType<typeof setTimeout> | null
}

const START_TIMEOUT_MS = 30_000
/** A task's server stays up between messages, for follow-ups in the same coding session. */
const IDLE_MS = 15 * 60_000

export function createOpencodeEngine(deps: {
  /** Path to the OpenCode program and the folder holding ripgrep (components.ts). */
  programs(): Promise<{ opencode: string; ripgrepDir: string }>
  bridge: ModelBridge
  /** `<data>/code-engine`: OpenCode's own config, data and cache. */
  home: string
  /** A scratch folder for its temp files. */
  scratch: string
  onError?(error: unknown): void
  /** Tests only: extra variables (a recording proxy that proves nothing calls out). */
  testEnv?: Record<string, string>
  /** The app's own folders (its data and program): hidden from OpenCode on macOS. */
  core?: string[]
}): CodingEngine {
  const running = new Map<string, Running>()

  async function start(run: CodeRun): Promise<Running> {
    const { opencode, ripgrepDir } = await deps.programs()
    const token = deps.bridge.open({ taskId: run.taskId, signal: run.signal, step: run.step })
    const password = randomBytes(24).toString('hex')
    prepareHome(deps.home)
    mkdirSync(deps.scratch, { recursive: true })
    const base = cleanEnv(process.env, deps.scratch)
    const pathKey = Object.keys(base).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
    const env = {
      ...base,
      [pathKey]: [ripgrepDir, base[pathKey] ?? ''].filter(Boolean).join(delimiter),
      XDG_CONFIG_HOME: join(deps.home, 'config'),
      XDG_DATA_HOME: join(deps.home, 'data'),
      XDG_CACHE_HOME: join(deps.home, 'cache'),
      XDG_STATE_HOME: join(deps.home, 'state'),
      // OpenCode's own idea of home: it reads plugins, agents and commands
      // from `~/.opencode`, so it gets an empty home of its own. Commands it
      // runs keep the user's real home (git needs their identity).
      OPENCODE_TEST_HOME: join(deps.home, 'home'),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(
        opencodeConfig(deps.bridge.url, token, pathToFileURL(envPluginPath(deps.home)).href)
      ),
      OPENCODE_SERVER_USERNAME: 'titan117',
      OPENCODE_SERVER_PASSWORD: password,
      ...OPENCODE_FLAGS,
      ...deps.testEnv
    }
    const serveArgs = ['serve', '--hostname=127.0.0.1', '--port=0']
    // macOS: OpenCode and every command it runs inside Seatbelt (decisions §55).
    const [program, args] =
      process.platform === 'darwin' && deps.core
        ? [
            '/usr/bin/sandbox-exec',
            [
              '-p',
              opencodeSeatbelt(run.repo, deps.home, deps.scratch, deps.core, opencode),
              opencode,
              ...serveArgs
            ]
          ]
        : [opencode, serveArgs]
    const proc = spawn(program, args, {
      cwd: run.repo,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const url = await new Promise<string>((resolve, reject) => {
      let out = ''
      const timer = setTimeout(() => {
        proc.kill()
        reject(new Error('The coding engine didn’t start in time.'))
      }, START_TIMEOUT_MS)
      const onData = (chunk: Buffer): void => {
        out = (out + chunk.toString()).slice(-8000)
        const found = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(out)
        if (found) {
          clearTimeout(timer)
          resolve(found[1])
        }
      }
      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onData)
      proc.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`The coding engine stopped while starting (exit ${code}).`))
      })
      proc.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    const client = createOpencodeClient({
      baseUrl: url,
      directory: run.repo,
      headers: {
        Authorization: `Basic ${Buffer.from(`titan117:${password}`).toString('base64')}`
      }
    })
    const state: Running = {
      proc,
      client,
      token,
      sessionId: null,
      current: null,
      events: new AbortController(),
      edited: new Map(),
      idle: null
    }
    proc.once('exit', () => {
      deps.bridge.close(token)
      state.events.abort()
      if (running.get(run.taskId) === state) running.delete(run.taskId)
    })
    void listen(state)
    return state
  }

  /** Answer asks and pass progress on, for as long as the server runs. */
  async function listen(state: Running): Promise<void> {
    try {
      const events = await state.client.event.subscribe(undefined, { signal: state.events.signal })
      for await (const event of events.stream) {
        const run = state.current
        if (!run || !event || typeof event !== 'object') continue
        const props = (event as { properties?: Record<string, unknown> }).properties ?? {}
        if (props.sessionID !== undefined && props.sessionID !== state.sessionId) {
          // Sub-agents run in child sessions: their asks still come to us.
          if (event.type !== 'permission.asked') continue
        }
        if (event.type === 'permission.asked') {
          const ask = props as unknown as EngineAsk
          void answer(state, run, ask)
        } else if (event.type === 'message.part.updated') {
          const part = props.part as {
            type?: string
            callID?: string
            tool?: string
            state?: { status?: string; title?: string }
          }
          if (part?.type === 'tool')
            run.onEvent?.({
              type: 'tool',
              callId: part.callID ?? '',
              tool: part.tool ?? '',
              status: part.state?.status ?? '',
              title: part.state?.title ?? ''
            })
        } else if (event.type === 'message.part.delta') {
          if (props.field === 'text' && typeof props.delta === 'string')
            run.onEvent?.({ type: 'text', text: props.delta })
        }
      }
    } catch (error) {
      if (!state.events.signal.aborted) deps.onError?.(error)
    }
  }

  async function answer(state: Running, run: CodeRun, ask: EngineAsk): Promise<void> {
    let reply: 'once' | 'reject' = 'reject'
    let message: string | undefined
    try {
      const decision = await run.decide(ask)
      if (decision.allowed) {
        reply = 'once'
        if (ask.permission === 'edit') for (const f of editedFiles(ask)) state.edited.set(f.file, f)
      } else message = `Titan117 refused this: ${decision.why ?? 'not allowed.'}`
    } catch (error) {
      deps.onError?.(error)
      message = 'Titan117 couldn’t check this, so it was refused.'
    }
    await state.client.permission
      .reply({ requestID: ask.id, reply, ...(message ? { message } : {}) })
      .catch((error) => deps.onError?.(error))
  }

  async function waitForIdle(state: Running, signal: AbortSignal): Promise<string | null> {
    // Poll the status as well as events, so a missed event can't hang the task.
    for (;;) {
      if (signal.aborted) return null
      const status = await state.client.session.status()
      const mine = state.sessionId
        ? (status.data as Record<string, { type?: string }> | undefined)?.[state.sessionId]
        : undefined
      if (!mine || mine.type === 'idle') return null
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  return {
    async run(run) {
      let state = running.get(run.taskId)
      if (!state) {
        state = await start(run)
        running.set(run.taskId, state)
      } else {
        deps.bridge.rebind(state.token, { taskId: run.taskId, signal: run.signal, step: run.step })
      }
      if (state.idle) clearTimeout(state.idle)
      state.current = run
      state.edited = new Map()
      const client = state.client
      if (!state.sessionId) {
        const created = await client.session.create({ title: run.prompt.slice(0, 80) })
        if (!created.data) throw new Error('The coding engine couldn’t start a session.')
        state.sessionId = created.data.id
      }
      const sessionID = state.sessionId
      const onAbort = (): void => {
        void client.session.abort({ sessionID })
      }
      run.signal.addEventListener('abort', onAbort, { once: true })
      let error: string | undefined
      try {
        const sent = await client.session.promptAsync({
          sessionID,
          agent: run.agent,
          model: { providerID: 'titan117', modelID: 'task' },
          ...(run.system ? { system: run.system } : {}),
          parts: [{ type: 'text', text: run.prompt }]
        })
        if (sent.error) error = 'The coding engine refused the request.'
        else {
          // Give the session a moment to become busy before watching for idle.
          await new Promise((r) => setTimeout(r, 300))
          await waitForIdle(state, run.signal)
        }
      } finally {
        run.signal.removeEventListener('abort', onAbort)
        state.current = null
        const done = state
        done.idle = setTimeout(() => void this.release(run.taskId), IDLE_MS)
        done.idle.unref?.()
      }

      const messages = (await client.session.messages({ sessionID })).data ?? []
      const last = [...messages].reverse().find((m) => m.info.role === 'assistant')
      const text = (last?.parts ?? [])
        .map((p) => (p.type === 'text' ? p.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim()
      const lastError = last?.info.role === 'assistant' ? last.info.error : undefined
      if (lastError && !error) {
        const data = (lastError as { data?: { message?: string } }).data
        error = data?.message ?? lastError.name
      }
      // OpenCode's own diff can come back empty; the edits we approved are the record.
      const diff = (await client.session.diff({ sessionID }).catch(() => null))?.data ?? []
      const byFile = new Map(state.edited)
      for (const d of diff)
        if (d.file)
          byFile.set(d.file, { file: d.file, additions: d.additions, deletions: d.deletions })
      const files = [...byFile.values()]
      if (run.signal.aborted) return { status: 'stopped', text, files }
      return error ? { status: 'failed', text, error, files } : { status: 'done', text, files }
    },

    async release(taskId) {
      const state = running.get(taskId)
      if (!state) return
      running.delete(taskId)
      if (state.idle) clearTimeout(state.idle)
      state.events.abort()
      deps.bridge.close(state.token)
      state.proc.kill()
    },

    async shutdown() {
      for (const taskId of [...running.keys()]) await this.release(taskId)
    }
  }
}
