/**
 * Puts the engine together: database, log, permission layer, model router,
 * agent runtime and the local API. Started by the engine process
 * (src/engine/main.ts) and, with fakes for models and the network, by tests.
 */
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { EngineEvent } from '../../shared/protocol'
import { createApi } from '../api'
import type { Budget } from '../budgets'
import { createPermissionLayer, type PermissionLayer } from '../permissions'
import { registerSecret } from '../redact'
import { createRouter } from '../router'
import { AGENT, createRuntime, type Runtime } from '../runtime'
import { createMemoryStore, type MemoryStore } from '../memory'
import { createRecordStore, type RecordStore } from '../records'
import { createBrowserHost, type BrowserHost } from './browser'
import { createConnectorHub, type ConnectorHub } from './mcp'
import { createSkillStore, type SkillStore } from './skills'
import { createSpeechEngine, type SpeechEngine } from './speech'
import { createStore, type Store } from '../store'
import { builtInTools, createRegistry, type AnyTool } from '../tools'
import { getMeta, openDb, setMeta, type Db } from './db'
import { checkWritable, realFolder, resolveAllowed, type FolderPolicy } from './folders'
import { createLocalModels, type LocalModels } from './llama'
import { createLogger, type Logger } from './log'
import { engineFetch, type Fetch } from './net'
import { createAnthropic } from './anthropic'
import {
  createOpenRouter,
  DIRECT_BASES,
  listDirectModels,
  OPENROUTER_BASE,
  type CloudAccess
} from './openrouter'
import type { KeyProvider } from '../../shared/protocol'
import { installToken, startServer } from './server'
import { createArtifactStore, type ArtifactStore } from '../artifacts'
import { createPageReader } from './read'
import { createSearchService, DEFAULT_SEARCH_SETTINGS } from './search'
import { createShareService } from './share'
import { createReportService, type ReportService } from './reports'
import { createSetupService } from './setup'
import { createConnectivity, OFFLINE_NOTE, type Connectivity } from './online'
import { createDocIndex, type DocIndex, type Embedder } from './doc-index'
import { createLocalEmbedder } from './embed'
import { findBrowserChannel } from './browser'
import type { SetupInterest } from '../../shared/protocol'
import type { SearchSettings } from '../../shared/protocol'
import { KEY_PROVIDERS } from '../../shared/protocol'
import { stopOcr } from './ocr'
import { startModelBridge } from './code/bridge'
import { createComponents } from './code/components'
import { createOpencodeEngine } from './code/opencode'
import { createCodeService } from './code/service'
import { GitError, gitChangedFiles, gitDiff, gitStatus } from './git'
import { startApprovalServer } from './code/approval-mcp'
import { checkServer, type Server } from './ssh'
import { createOwnTools, NOT_OFFERED, type OwnToolId } from './code/own-tools'
import { createNodeComponent } from './apps/node'
import { createRunner } from './apps/runner'
import { createBrowserTests } from './apps/browsers'
import { AppError, createAppService, type GitHubLink, type Published } from './apps/service'
import { PublishError } from './apps/cloudflare'
import { cleanBrand, STARTERS, type BrandKit } from './apps/starters'
import { assess, probeDevice, type DeviceCheck } from './apps/devices'
import { AndroidError, createAndroidComponent } from './apps/android'
import { cleanEnv } from './shell'
import type { AppModels } from '../tools/lib/define-tool'

export interface AccountState {
  /** The device token, sent only to our credits proxy. */
  token: string | null
  /** The proxy's base URL, e.g. https://titan117.com/api/v1. */
  proxyUrl: string | null
  locked: boolean
  /** What the user sees when locked, e.g. "Sign in to keep using Titan117." */
  reason: string | null
}

/** The user's own API keys, from the shell's keychain (features 2.9, 11.5). */
export type OwnKeys = Partial<Record<KeyProvider, string>>

export interface EngineOptions {
  /** The app's data folder; null keeps everything in memory (tests). */
  dataDir: string | null
  appVersion: string
  /** Folders no agent may touch: the app's install folder and its data. */
  coreDirs: string[]
  /** The window's own origins. */
  allowedOrigins: string[]
  /** A development OpenRouter key from the local .env; never read by a packaged app. */
  openRouterKey?: string | null
  /** Starts locked until the shell says otherwise (tests pass false). */
  locked?: boolean
  fetch?: Fetch
  loadLlama?: Parameters<typeof createLocalModels>[0]['load']
  probeLlama?: Parameters<typeof createLocalModels>[0]['probe']
  tools?: AnyTool[]
  budget?: Budget
  port?: number
  /** The network for tools (web pages); tests pass a fake. Model calls use `fetch`. */
  toolFetch?: Fetch
  /** Show the browser window (the app) or keep it hidden (tests). */
  browserHeadless?: boolean
  browser?: BrowserHost
  speech?: SpeechEngine
  /** The internet came back (1.24): the shell renews the licence lease. */
  onOnline?: () => void
  /** How many tasks are running (1.5): the shell keeps the laptop awake while any is. */
  onBusy?: (running: number) => void
  /** Something the user should hear about when the window isn't in front (1.9). */
  onNotify?: (note: { title: string; body: string; taskId: string }) => void
  /** Search by meaning (7.4); tests pass a fake or null, the app the local model. */
  embedder?: Embedder | null
}

/** A task is resumed by itself at most this many times, and only this soon after it stopped (1.6). */
export const AUTO_RESUME_LIMIT = 2
export const AUTO_RESUME_WITHIN_MS = 60 * 60 * 1000

export interface Engine {
  port: number
  token: string
  addFolder(path: string): string[]
  removeFolder(path: string): string[]
  setAccount(account: AccountState): void
  /** The user's own API keys; only providers present have one. */
  setKeys(keys: OwnKeys): void
  /** Connector secrets from the keychain, per connector id (feature 3.6). */
  setConnectorSecrets(secrets: Record<string, Record<string, string>>): void
  /** The user's GitHub sign-in (decisions §25): kept in memory only, scrubbed from every log. */
  setGitHubToken(token: string | null): void
  close(): Promise<void>
  /** For tests. */
  parts: {
    db: Db
    store: Store
    log: Logger
    runtime: Runtime
    permissions: PermissionLayer
    local: LocalModels
    events: EngineEvent[]
    memory: MemoryStore
    skills: SkillStore
    records: RecordStore
    connectors: ConnectorHub
    artifacts: ArtifactStore
    reports: ReportService
    connectivity: Connectivity
    documents: DocIndex
    /** The token a running task's scripts use (feature 4.10). */
    scriptToken(taskId: string): string | null
  }
}

export async function startEngine(options: EngineOptions): Promise<Engine> {
  const db = openDb(options.dataDir ?? ':memory:')
  const log = createLogger(db, options.dataDir)
  const token = options.dataDir ? installToken(options.dataDir) : randomBytes(32).toString('hex')
  const key = options.openRouterKey?.trim() || null
  registerSecret(key)
  // From the shell (src/main/account.ts): the device token for the credits
  // proxy, and whether the licence lets the app work (decisions §17).
  let account: AccountState = {
    token: null,
    proxyUrl: null,
    locked: options.locked ?? true,
    reason: null
  }
  let ownKeys: OwnKeys = {}
  const cloud = (): CloudAccess | null => {
    // The user's own OpenRouter key goes straight to OpenRouter: no proxy, no credits.
    if (ownKeys.openrouter) return { base: OPENROUTER_BASE, key: ownKeys.openrouter, via: 'own' }
    if (account.token && account.proxyUrl)
      return { base: account.proxyUrl, key: account.token, via: 'credits' }
    if (key) return { base: OPENROUTER_BASE, key, via: 'dev' }
    return null
  }
  registerSecret(token)

  const events: EngineEvent[] = []
  let publish: (event: EngineEvent) => void = () => undefined
  // Notifications (1.9): done, failed, paused, and approvals waiting.
  const lastStatus = new Map<string, string>()
  const notify = (event: EngineEvent): void => {
    if (!options.onNotify || !getMeta<boolean>(db, 'notifications', true)) return
    if (event.type === 'task') {
      const { id, status, title, note } = event.task
      const before = lastStatus.get(id)
      lastStatus.set(id, status)
      if (before === status || before === undefined) return
      if (status === 'done') options.onNotify({ title: 'Titan finished', body: title, taskId: id })
      else if (status === 'error')
        options.onNotify({ title: 'A task failed', body: `${title}: ${note ?? ''}`, taskId: id })
      else if (status === 'stopped' && note === OFFLINE_NOTE)
        options.onNotify({ title: 'Paused: no internet', body: title, taskId: id })
    } else if (event.type === 'approval' && event.approval.status === 'pending')
      options.onNotify({
        title: 'Titan needs your OK',
        body: event.approval.summary,
        taskId: event.approval.taskId
      })
  }
  const emit = (event: EngineEvent): void => {
    if (!options.dataDir && event.type !== 'delta') events.push(event)
    notify(event)
    publish(event)
  }

  // Online or offline (1.22, 1.24): learned from the engine's own requests.
  const connectivity = createConnectivity({
    fetch: engineFetch(options.fetch),
    onChange(online) {
      emit({ type: 'online', online })
      if (!online) return
      // Back online: what waited goes.
      void reportsRef?.flush().then(() => reportsRef?.checkFixed())
      options.onOnline?.()
      // Tasks paused by the lost connection carry on (1.6).
      autoResume(
        store
          .listTasks()
          .filter((t) => t.status === 'stopped' && t.note === OFFLINE_NOTE)
          .map((t) => t.id),
        'the internet is back'
      )
    }
  })
  let reportsRef: ReportService | null = null

  const store = createStore(db, emit)
  // Tasks the app was running when it stopped resume once it's unlocked (1.6).
  let toResume = store.closeInterrupted()

  const core = options.coreDirs.map((dir) => {
    try {
      return realFolder(dir)
    } catch {
      return dir
    }
  })
  const folders = (): string[] => getMeta<string[]>(db, 'folders', [])

  // The folder agent (§7): document folders, their index, and search by meaning on the laptop.
  const embedder: Embedder | null =
    options.embedder !== undefined
      ? options.embedder
      : options.dataDir
        ? createLocalEmbedder({ modelsDir: join(options.dataDir, 'components', 'embeddings') })
        : null
  const documents = createDocIndex({
    db,
    allowed: folders,
    embedder: () => embedder,
    onChange: () => emit({ type: 'changed', what: 'documents' }),
    log: (error, context) => log.capture('documents', error, context)
  })
  const policy = (): FolderPolicy => {
    const docs = documents.folders()
    return {
      allowed: folders(),
      core,
      readOnly: docs.filter((f) => f.readOnly).map((f) => f.path),
      localOnly: docs.filter((f) => f.localOnly).map((f) => f.path)
    }
  }
  // Tasks that read from a local-models-only folder stay on local models (7.7), across restarts.
  const localOnlyTasks = {
    has: (taskId: string) => getMeta<string[]>(db, 'localOnlyTasks', []).includes(taskId),
    add(taskId: string) {
      const list = getMeta<string[]>(db, 'localOnlyTasks', [])
      if (!list.includes(taskId)) setMeta(db, 'localOnlyTasks', [...list, taskId].slice(-2000))
    }
  }

  const changed = (what: 'memory' | 'skills' | 'records' | 'connectors' | 'reports') => (): void =>
    emit({ type: 'changed', what })
  const memory = createMemoryStore(db, changed('memory'))
  const skills = createSkillStore(
    options.dataDir ? join(options.dataDir, 'skills') : null,
    changed('skills')
  )
  const records = createRecordStore({
    db,
    store,
    sites: (id) => store.sites.list(id),
    onChange: changed('records')
  })
  const connectors = createConnectorHub({
    db,
    log,
    onChange: changed('connectors'),
    cwd: () => folders()[0]
  })
  const scratchRoot = join(options.dataDir ?? tmpdir(), 'scratch')
  const browser =
    options.browser ??
    createBrowserHost({
      profileDir: join(
        options.dataDir ?? join(tmpdir(), `titan117-browser-${process.pid}`),
        'browser-profile'
      ),
      headless: options.browserHeadless ?? false
    })
  const speech =
    options.speech ??
    createSpeechEngine({
      modelsDir: join(options.dataDir ?? tmpdir(), 'components', 'speech'),
      scratchDir: join(scratchRoot, 'speech')
    })

  // Scripts a task writes call its tools with a token of their own (feature 4.10).
  const scriptTokens = new Map<string, string>()
  let serverPort = 0
  // The coding engine's model bridge (decisions §53): on 127.0.0.1, never reachable by a tool.
  const codeBridge = await startModelBridge()
  let githubToken: string | null = null
  // The user's own coding tools (13.14): their approvals come to us here.
  const toolApprovals = await startApprovalServer()
  /** Kill switches for the coding-tool adapters (decisions §20), from our web app; kept when offline. */
  async function checkKillSwitches(): Promise<void> {
    if (!account.proxyUrl) return
    try {
      const response = await fetch(`${account.proxyUrl.replace(/\/$/, '')}/kill-switches`)
      if (!response.ok) return
      const body = (await response.json()) as { disabled?: unknown }
      if (Array.isArray(body.disabled))
        setMeta(
          db,
          'killSwitches',
          body.disabled.filter((d): d is string => typeof d === 'string').slice(0, 20)
        )
    } catch {
      // Offline: the last list stays.
    }
  }
  setInterval(() => void checkKillSwitches(), 60 * 60_000).unref()
  const ownTools = createOwnTools({
    approvals: toolApprovals,
    scratch: join(options.dataDir ?? tmpdir(), 'scratch', 'own-tools'),
    enabled: (id) => getMeta<string[]>(db, 'ownToolsEnabled', []).includes(id),
    // The last kill switches heard from our cloud, kept for when the laptop is offline.
    killed: (id) => getMeta<string[]>(db, 'killSwitches', []).includes(id),
    changes: (repo) => gitChangedFiles(repo)
  })
  const scriptToken = (taskId: string): string | null => {
    if (!runtimeRef?.isRunning(taskId)) return null
    let value = scriptTokens.get(taskId)
    if (!value) {
      value = randomBytes(32).toString('hex')
      registerSecret(value)
      scriptTokens.set(taskId, value)
    }
    return value
  }
  let runtimeRef: Runtime | null = null

  const artifacts = createArtifactStore(db, (artifact, byAgent) => {
    emit({ type: 'changed', what: 'artifacts' })
    // What an agent makes opens beside the chat (17.1).
    if (artifact && byAgent) emit({ type: 'artifact', artifact })
  })

  // Search settings (§16): from the laptop's own language and country until the user changes them.
  const searchSettings = (): SearchSettings => {
    const saved = getMeta<SearchSettings | null>(db, 'search', null)
    if (saved) return { ...DEFAULT_SEARCH_SETTINGS, ...saved }
    const locale = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale)
    return {
      ...DEFAULT_SEARCH_SETTINGS,
      country: locale.region && /^[A-Z]{2}$/.test(locale.region) ? locale.region : '',
      language: /^[a-z]{2}$/.test(locale.language) ? locale.language : ''
    }
  }

  const tools = createRegistry(options.tools ?? builtInTools, () => connectors.tools())
  const permissions = createPermissionLayer({
    tools,
    store,
    log,
    folders: policy,
    services: {
      memory,
      skills,
      records,
      browser,
      speech: (files) => speech.access(files),
      scratchRoot,
      fetch: connectivity.track(options.toolFetch ?? fetch),
      enginePorts: () => [serverPort, codeBridge.port, toolApprovals.port],
      gitCoAuthor: () => getMeta<boolean>(db, 'gitCoAuthor', true),
      servers: () => getMeta<Server[]>(db, 'servers', []),
      githubToken: () => githubToken,
      toolApi: (taskId) => {
        const value = scriptToken(taskId)
        return value ? { url: `http://127.0.0.1:${serverPort}`, token: value } : null
      },
      answers: {
        get: (key) => getMeta<Record<string, boolean>>(db, 'answers', {})[key] ?? null,
        set: (key, value) =>
          setMeta(db, 'answers', {
            ...getMeta<Record<string, boolean>>(db, 'answers', {}),
            [key]: value
          })
      }
    }
  })

  const pages = createPageReader()

  const local = createLocalModels({
    db,
    modelsDir: join(options.dataDir ?? tmpdir(), 'components', 'models'),
    onChange: (model) => emit({ type: 'localModel', model }),
    onChecked: () => {
      void local.list().then((localModels) =>
        emit({
          type: 'local',
          hardware: local.hardware(),
          localProblem: local.problem(),
          localModels
        })
      )
    },
    load: options.loadLlama,
    probe: options.probeLlama
  })
  // Finding out whether llama.cpp starts can take a minute; the window doesn't wait for it.
  local.warm()
  const fetchOut = connectivity.track(
    engineFetch(options.fetch, () => (account.proxyUrl ? [new URL(account.proxyUrl).origin] : []))
  )
  const openrouter = createOpenRouter({ fetch: fetchOut, access: cloud })
  const direct = (
    provider: 'openai' | 'google'
  ): Pick<ReturnType<typeof createOpenRouter>, 'turn'> & {
    listModels(): ReturnType<typeof listDirectModels>
  } => {
    const client = createOpenRouter({
      fetch: fetchOut,
      provider,
      access: () => {
        const key = ownKeys[provider]
        return key ? { base: DIRECT_BASES[provider], key, via: 'own' } : null
      }
    })
    return {
      turn: (request) => client.turn(request),
      listModels: () => {
        const key = ownKeys[provider]
        return key ? listDirectModels(fetchOut, provider, key) : Promise.resolve([])
      }
    }
  }
  const reports = createReportService({
    db,
    appVersion: options.appVersion,
    dataDir: options.dataDir,
    fetch: fetchOut,
    account: () =>
      account.token && account.proxyUrl
        ? { token: account.token, apiBase: account.proxyUrl }
        : null,
    onChange: changed('reports')
  })
  reportsRef = reports
  // Every caught error: the window may offer a report (19.2); "send automatically" sends it.
  log.onCapture((errorId, source) => {
    emit({ type: 'error', errorId, source })
    reports.onCaptured(errorId)
  })

  const shares = createShareService({
    fetch: fetchOut,
    account: () =>
      account.token && account.proxyUrl ? { token: account.token, apiBase: account.proxyUrl } : null
  })

  const router = createRouter({
    local,
    openrouter,
    direct: {
      anthropic: createAnthropic({ fetch: fetchOut, key: () => ownKeys.anthropic ?? null }),
      openai: direct('openai'),
      google: direct('google')
    },
    hasKey: (provider) => !!ownKeys[provider]
  })

  // The small model that lists OpenRouter's search results: cheap, with tools.
  const SEARCH_MODELS = [
    'openai/gpt-4.1-nano',
    'google/gemini-2.5-flash-lite',
    'openai/gpt-4o-mini'
  ]
  const search = createSearchService({
    fetch: fetchOut,
    cloud,
    keys: () => ({ exa: ownKeys.exa, tavily: ownKeys.tavily, brave: ownKeys.brave }),
    settings: searchSettings,
    async pickModel() {
      const models = await router.cloudModels().catch(() => [])
      const preferred = SEARCH_MODELS.find((id) => models.some((m) => m.id === id))
      if (preferred || !models.length) return preferred ?? SEARCH_MODELS[0]
      const paid = models.filter((m) => m.inputPerMillion > 0 && !m.id.endsWith(':free'))
      return (
        [...paid].sort((a, b) => a.inputPerMillion - b.inputPerMillion)[0]?.id ?? SEARCH_MODELS[0]
      )
    }
  })
  // The coding engine (§13, decisions §53): OpenCode, downloaded the first time it's used.
  const codeComponents = createComponents({
    dir: join(options.dataDir ?? tmpdir(), 'components', 'code')
  })
  const codeEngine = createOpencodeEngine({
    programs: () => codeComponents.ensure(),
    bridge: codeBridge,
    home: join(options.dataDir ?? tmpdir(), 'code-engine'),
    scratch: join(scratchRoot, 'code-engine'),
    onError: (error) => void log.capture('code', error, {}),
    core
  })
  const code = createCodeService({
    engine: codeEngine,
    router,
    store,
    permissions,
    folders: policy,
    online: () => connectivity.online(),
    log,
    memory,
    ownTools
  })
  // The app builder (§6, decisions §56): Node.js and two test browsers, downloaded the first time.
  const componentsDir = join(options.dataDir ?? tmpdir(), 'components')
  const nodeComponent = createNodeComponent({ dir: join(componentsDir, 'node') })
  const appBrowsers = createBrowserTests({ dir: join(componentsDir, 'browsers') })
  const android = createAndroidComponent({
    dir: join(componentsDir, 'android'),
    baseEnv: () => cleanEnv(process.env, join(scratchRoot, 'android'))
  })
  const apps = createAppService({
    toolchain: async () => {
      const f = await probeDevice(options.dataDir ?? tmpdir())
      return { rust: !!f.rust, msvc: !!f.msvc }
    },
    runner: createRunner({
      node: () => nodeComponent.ensure(),
      npmDir: join(componentsDir, 'npm'),
      scratch: join(scratchRoot, 'apps')
    }),
    browsers: appBrowsers,
    coAuthor: () => getMeta<boolean>(db, 'gitCoAuthor', true),
    onChange: () => emit({ type: 'changed', what: 'apps' }),
    github: {
      token: () => githubToken,
      links: () => getMeta<Record<string, GitHubLink>>(db, 'appGitHub', {}),
      setLinks: (next) => setMeta(db, 'appGitHub', next)
    },
    hosting: {
      token: (host) => ownKeys[host] ?? null,
      published: () => getMeta<Record<string, Published>>(db, 'appPublished', {}),
      setPublished: (next) => setMeta(db, 'appPublished', next)
    }
  })
  const brandKit = (): BrandKit | null => {
    const saved = getMeta<BrandKit | null>(db, 'brandKit', null)
    return saved ? cleanBrand(saved) : null
  }
  const appModels = (): AppModels =>
    getMeta<AppModels>(db, 'appModels', { planner: null, coder: null, fixer: null })
  permissions.useServices({
    search,
    pages,
    artifacts,
    documents,
    localOnlyTasks,
    code,
    apps,
    appModels,
    brandKit
  })

  // Setup and health (1.12, 1.20, 1.21): facts from every part of the engine.
  const setup = createSetupService({
    fetch: fetchOut,
    done: () => getMeta<boolean>(db, 'setupDone', false),
    async facts() {
      const errorsToday = (
        db
          .prepare('select count(*) as n from errors where at > ?')
          .get(Date.now() - 86_400_000) as {
          n: number
        }
      ).n
      return {
        dataDir: options.dataDir,
        signedIn: !!account.token,
        locked: account.locked,
        lockReason: account.reason,
        cloud: cloud() !== null,
        defaultModel: getMeta<string | null>(db, 'defaultModel', null),
        hardware: local.hardware(),
        localProblem: local.problem(),
        localModels: await local.list(),
        folders: folders(),
        ownKeys: { ...ownKeys },
        browser: findBrowserChannel(),
        connectors: connectors
          .list()
          .map((c) => ({ name: c.name, status: c.status, error: c.error })),
        queuedReports: reports.list().filter((r) => r.status === 'queued').length,
        errorsToday,
        interests: getMeta<SetupInterest[]>(db, 'interests', [])
      }
    }
  })

  const runtime = createRuntime({
    store,
    emit,
    log,
    router,
    permissions,
    tools,
    folders,
    locked: () => (account.locked ? (account.reason ?? 'Titan117 is locked.') : null),
    online: () => connectivity.online(),
    localOnly: (taskId) => permissions.isLocalOnly(taskId),
    onBusy: options.onBusy,
    budget: options.budget,
    memory,
    skills,
    records
  })
  runtimeRef = runtime

  /** Resume recent stopped tasks by themselves, a limited number of times each (1.6). */
  function autoResume(ids: string[], why: string): void {
    const counts = getMeta<Record<string, number>>(db, 'autoResumed', {})
    for (const id of ids) {
      const task = store.getTask(id)
      if (!task || Date.now() - task.updatedAt > AUTO_RESUME_WITHIN_MS) continue
      if ((counts[id] ?? 0) >= AUTO_RESUME_LIMIT) continue
      try {
        runtime.resume(id, why)
        counts[id] = (counts[id] ?? 0) + 1
      } catch (error) {
        log.capture('runtime', error, { taskId: id, part: 'auto resume' })
      }
    }
    setMeta(db, 'autoResumed', counts)
  }

  // Started unlocked (tests, or a lease already known): carry on at once.
  if (!account.locked && toResume.length) {
    const ids = toResume
    toResume = []
    queueMicrotask(() => autoResume(ids, 'Titan117 started again'))
  }

  // The code builder screen: a project's git state, read for the user (only inside allowed folders).
  const codeView = {
    async project(folder: string) {
      const real = await resolveAllowed(policy(), folder)
      try {
        const git = await gitStatus(real)
        return { git, diff: await gitDiff(git.root), problem: null }
      } catch (error) {
        if (error instanceof GitError) return { git: null, diff: '', problem: error.message }
        throw error
      }
    },
    components: () => codeComponents.status(),
    coAuthor: () => getMeta<boolean>(db, 'gitCoAuthor', true),
    setCoAuthor: (on: boolean) => setMeta(db, 'gitCoAuthor', on),
    tools: async () => ({ tools: await ownTools.status(), notOffered: NOT_OFFERED }),
    servers: () => getMeta<Server[]>(db, 'servers', []),
    addServer(input: { name?: unknown; target?: unknown; port?: unknown }) {
      const server = checkServer(input)
      const list = getMeta<Server[]>(db, 'servers', []).filter((s) => s.name !== server.name)
      setMeta(db, 'servers', [...list, server].slice(-50))
    },
    removeServer(name: string) {
      setMeta(
        db,
        'servers',
        getMeta<Server[]>(db, 'servers', []).filter((s) => s.name !== name)
      )
    },
    setToolEnabled(id: string, on: boolean) {
      const list = getMeta<string[]>(db, 'ownToolsEnabled', []).filter((t) => t !== id)
      setMeta(db, 'ownToolsEnabled', on ? [...list, id as OwnToolId] : list)
    }
  }
  // The Apps screen (§6): the user's own clicks, on apps inside the allowed folders.
  const realWritable = (folder: string): Promise<string> => checkWritable(policy(), folder)
  const appChecks = new Map<string, string>()
  /** The last background run's problem per app (publishing), shown on the screen. */
  const appProblems = new Map<string, string>()
  /** What this laptop can do for mobile and desktop apps (decisions §57), checked when asked, kept 5 minutes. */
  let deviceChecks: { at: number; checks: DeviceCheck[] } | null = null
  /** The emulator's set-up (decisions §57.19): what it's doing now, its last problem, Google's licence text. */
  const androidState: { note: string | null; problem: string | null; licence: string | null } = {
    note: null,
    problem: null,
    licence: null
  }
  /** Run a long emulator step in the background; the screen hears "changed apps". */
  const androidStep = (work: () => Promise<unknown>): { started: boolean } => {
    if (androidState.note) return { started: false }
    androidState.note = 'Starting…'
    androidState.problem = null
    emit({ type: 'changed', what: 'apps' })
    void work()
      .catch((error) => {
        androidState.problem = error instanceof Error ? error.message : String(error)
        if (!(error instanceof AndroidError)) log.capture('apps', error, {})
      })
      .finally(() => {
        androidState.note = null
        emit({ type: 'changed', what: 'apps' })
      })
    return { started: true }
  }
  const androidProgress = (note: string): void => {
    androidState.note = note
    emit({ type: 'changed', what: 'apps' })
  }
  const appView = {
    async list() {
      const allowed = policy().allowed
      return {
        apps: apps.list(allowed).map((a) => ({
          ...a,
          checking: appChecks.get(a.folder) ?? null,
          installer: a.kind === 'desktop' ? apps.installer(a.folder) : null,
          problem: appProblems.get(a.folder) ?? null
        })),
        models: appModels(),
        brand: brandKit() ?? cleanBrand(null),
        starters: STARTERS.map(({ id, label, description }) => ({ id, label, description })),
        components: { node: nodeComponent.status(), browsers: appBrowsers.status() }
      }
    },
    async create(input: {
      folder: string
      title: string
      description: string
      lang?: string
      starter?: string
      kind?: string
    }) {
      const parent = await realWritable(input.folder)
      const brand = brandKit()
      const logo = brand?.logo ? await resolveAllowed(policy(), brand.logo) : ''
      return apps.create(parent, {
        ...input,
        kind: input.kind === 'mobile' || input.kind === 'desktop' ? input.kind : 'web',
        starter: STARTERS.find((s) => s.id === input.starter)?.id,
        ...(brand ? { brand: { ...brand, logo } } : {})
      })
    },
    setBrand(next: unknown) {
      setMeta(db, 'brandKit', cleanBrand(next as Partial<Record<keyof BrandKit, unknown>>))
    },
    report: async (folder: string) => apps.latestReport(await resolveAllowed(policy(), folder)),
    versions: async (folder: string) => apps.versions(await resolveAllowed(policy(), folder)),
    async screenshot(folder: string, id: string, file: string) {
      return (await apps.screenshot(await resolveAllowed(policy(), folder), id, file)).toString(
        'base64'
      )
    },
    async preview(folder: string, action: 'start' | 'stop') {
      const real = await realWritable(folder)
      if (action === 'stop') {
        apps.stopPreview(real)
        return { url: null }
      }
      return apps.startPreview(real)
    },
    /** The emulator's state (6.22). */
    android() {
      return { ...android.status(), ...androidState }
    },
    /** The user's own clicks on the emulator's set-up; accepting Google's licence happens only here. */
    async androidAction(action: string, folder?: string) {
      switch (action) {
        case 'tools':
          return androidStep(() => android.ensureTools(androidProgress))
        case 'licence':
          androidState.licence = await android.licenceText()
          return { licence: androidState.licence }
        case 'accept':
          await android.acceptLicence()
          androidState.licence = null
          return { accepted: true }
        case 'install':
          return androidStep(() => android.installPhone(androidProgress))
        case 'start':
          return androidStep(() => android.start(androidProgress))
        case 'stop':
          await android.stop()
          emit({ type: 'changed', what: 'apps' })
          return { stopped: true }
        case 'open': {
          if (!folder) throw new AppError('Which app?')
          const real = await realWritable(folder)
          const { url } = await apps.startPreview(real)
          // The emulator reaches this laptop's 127.0.0.1 as 10.0.2.2: nothing opens to the network.
          await android.openUrl(
            url.replace('http://127.0.0.1:', 'exp://10.0.2.2:').replace(/\/$/, '')
          )
          return { opened: true }
        }
        default:
          throw new AppError('Unknown emulator step.')
      }
    },
    /** The user's click: make a desktop app's installer (runs in the background). */
    async installer(folder: string) {
      const real = await realWritable(folder)
      if (appChecks.has(real)) return { started: false }
      appChecks.set(real, 'Making the installer…')
      appProblems.delete(real)
      emit({ type: 'changed', what: 'apps' })
      void apps
        .makeInstaller(real, (note) => {
          appChecks.set(real, note)
          emit({ type: 'changed', what: 'apps' })
        })
        .catch((error) => {
          appProblems.set(real, error instanceof Error ? error.message : String(error))
          if (!(error instanceof AppError)) log.capture('apps', error, {})
        })
        .finally(() => {
          appChecks.delete(real)
          emit({ type: 'changed', what: 'apps' })
        })
      return { started: true }
    },
    /** The user's click: install and open the app in a fresh Windows Sandbox. */
    async sandbox(folder: string) {
      const real = await realWritable(folder)
      return apps.tryInSandbox(real, join(scratchRoot, 'sandbox'))
    },
    /** The user's click: open a mobile app to phones on this Wi-Fi for Expo Go (6.24). */
    async phone(folder: string) {
      return apps.startPhone(await realWritable(folder))
    },
    /** What this laptop can do (6.28): read-only checks; `fresh` checks again. */
    async devices(fresh: boolean) {
      if (fresh || !deviceChecks || Date.now() - deviceChecks.at > 5 * 60_000)
        deviceChecks = {
          at: Date.now(),
          checks: assess(await probeDevice(options.dataDir ?? tmpdir()))
        }
      return deviceChecks
    },
    /** Runs in the background; the screen hears "changed apps" as it moves on. */
    async check(folder: string) {
      const real = await realWritable(folder)
      if (appChecks.has(real)) return { started: false }
      appChecks.set(real, 'Starting…')
      emit({ type: 'changed', what: 'apps' })
      void apps
        .check(real, {
          onProgress: (note) => {
            appChecks.set(real, note)
            emit({ type: 'changed', what: 'apps' })
          }
        })
        .catch((error) => {
          if (!(error instanceof AppError)) log.capture('apps', error, {})
        })
        .finally(() => {
          appChecks.delete(real)
          emit({ type: 'changed', what: 'apps' })
        })
      return { started: true }
    },
    restore: async (folder: string, sha: string) => apps.restore(await realWritable(folder), sha),
    /** Runs in the background, like a test run; the screen hears "changed apps". */
    async publish(folder: string) {
      const real = await realWritable(folder)
      if (appChecks.has(real)) return { started: false }
      appChecks.set(real, 'Publishing…')
      emit({ type: 'changed', what: 'apps' })
      void apps
        .publish(real, (note) => {
          appChecks.set(real, note)
          emit({ type: 'changed', what: 'apps' })
        })
        .then(() => appProblems.delete(real))
        .catch((error) => {
          appProblems.set(real, error instanceof Error ? error.message : String(error))
          if (!(error instanceof AppError) && !(error instanceof PublishError))
            log.capture('apps', error, {})
        })
        .finally(() => {
          appChecks.delete(real)
          emit({ type: 'changed', what: 'apps' })
        })
      return { started: true }
    },
    async zip(folder: string) {
      const file = await apps.zip(await resolveAllowed(policy(), folder))
      return { name: file.name, base64: file.data.toString('base64') }
    },
    /** The user's click: save to their GitHub, or stop pushing new versions. */
    async github(folder: string, action: 'save' | 'stop', isPrivate: boolean) {
      const real = await realWritable(folder)
      if (action === 'stop') {
        apps.stopGitHubSync(real)
        return { status: 'stopped' }
      }
      return apps.saveToGitHub(real, { private: isPrivate })
    },
    setModels(next: AppModels) {
      setMeta(db, 'appModels', next)
    }
  }
  const handle = createApi({
    appVersion: options.appVersion,
    store,
    runtime,
    permissions,
    router,
    local,
    log,
    settings: {
      defaultModel: () => getMeta<string | null>(db, 'defaultModel', null),
      setDefaultModel(model) {
        setMeta(db, 'defaultModel', model)
        emit({ type: 'settings', defaultModel: model })
      },
      folders,
      cloudKey: () => cloud() !== null,
      online: () => connectivity.online(),
      cloudVia: () => cloud()?.via ?? null,
      ownKeys: () =>
        Object.fromEntries(KEY_PROVIDERS.map((p) => [p, !!ownKeys[p]])) as Record<
          (typeof KEY_PROVIDERS)[number],
          boolean
        >
    },
    artifacts,
    shares,
    reports,
    documents,
    code: codeView,
    apps: appView,
    notifications: {
      get: () => getMeta<boolean>(db, 'notifications', true),
      set: (on) => setMeta(db, 'notifications', on)
    },
    setup: {
      state: () => setup.state(),
      runHealth: () => setup.runHealth(),
      save(next) {
        if (next.interests) setMeta(db, 'interests', next.interests)
        if (next.done !== undefined) setMeta(db, 'setupDone', next.done)
      }
    },
    search: {
      get: searchSettings,
      set: (next) => setMeta(db, 'search', next)
    },
    memory,
    skills,
    records,
    connectors,
    speech,
    async scriptCall(taskId, name, input) {
      const task = store.getTask(taskId)
      const signal = runtime.signal(taskId)
      if (!task || !signal)
        return { status: 'refused', output: 'Refused: the task is not running.' }
      if (name === 'run_code')
        return { status: 'refused', output: "Refused: a script can't start another script." }
      return permissions.execute(
        {
          id: `script-${randomBytes(6).toString('hex')}`,
          name: String(name),
          input: (input ?? {}) as Record<string, unknown>
        },
        { taskId, agent: AGENT, model: task.model, signal, via: 'script' }
      )
    }
  })

  const server = await startServer({
    token,
    allowedOrigins: options.allowedOrigins,
    handle,
    port: options.port,
    scriptTask(given) {
      for (const [taskId, value] of scriptTokens)
        if (value === given && runtime.isRunning(taskId)) return taskId
      return null
    }
  })
  serverPort = server.port
  publish = server.publish
  void connectors.connectAll()
  documents.start()
  log.info('engine started', { port: server.port, version: options.appVersion })

  function saveFolders(next: string[]): string[] {
    setMeta(db, 'folders', next)
    emit({ type: 'folders', folders: next })
    return next
  }

  return {
    port: server.port,
    token,
    addFolder(path) {
      const real = realFolder(path)
      const current = folders()
      return current.includes(real) ? current : saveFolders([...current, real])
    },
    removeFolder(path) {
      return saveFolders(folders().filter((folder) => folder !== path))
    },
    setKeys(next) {
      for (const key of Object.values(next)) registerSecret(key ?? null)
      ownKeys = next
      emit({ type: 'settings', defaultModel: getMeta<string | null>(db, 'defaultModel', null) })
    },
    setGitHubToken(next) {
      registerSecret(next)
      githubToken = next
    },
    setConnectorSecrets(next) {
      for (const values of Object.values(next))
        for (const value of Object.values(values)) registerSecret(value)
      connectors.setSecrets(next)
    },
    setAccount(next) {
      registerSecret(next.token)
      account = next
      // Unlocked: tasks interrupted by the app stopping carry on, once.
      if (!next.locked && toResume.length) {
        const ids = toResume
        toResume = []
        autoResume(ids, 'Titan117 started again')
      }
      // Signed in again: reports waiting in the queue go, and fixes are checked (19.5, 19.8).
      void reports.flush().then(() => reports.checkFixed())
      void checkKillSwitches()
      // The window re-reads the state (cloud models on or off) on a settings event.
      emit({ type: 'settings', defaultModel: getMeta<string | null>(db, 'defaultModel', null) })
    },
    async close() {
      reports.close()
      connectivity.close()
      documents.close()
      await stopOcr(true)
      await server.close()
      await browser.close()
      await connectors.close()
      await codeEngine.shutdown()
      apps.stopAll()
      await codeBridge.stop()
      await toolApprovals.stop()
      await local.dispose()
      db.close()
    },
    parts: {
      db,
      store,
      log,
      runtime,
      permissions,
      local,
      events,
      memory,
      skills,
      records,
      connectors,
      artifacts,
      reports,
      connectivity,
      documents,
      scriptToken
    }
  }
}
