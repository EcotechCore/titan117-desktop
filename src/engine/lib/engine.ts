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
import { realFolder, type FolderPolicy } from './folders'
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
import type { SearchSettings } from '../../shared/protocol'
import { KEY_PROVIDERS } from '../../shared/protocol'

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
}

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
  const emit = (event: EngineEvent): void => {
    if (!options.dataDir && event.type !== 'delta') events.push(event)
    publish(event)
  }

  const store = createStore(db, emit)
  store.closeInterrupted()

  const core = options.coreDirs.map((dir) => {
    try {
      return realFolder(dir)
    } catch {
      return dir
    }
  })
  const folders = (): string[] => getMeta<string[]>(db, 'folders', [])
  const policy = (): FolderPolicy => ({ allowed: folders(), core })

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
      fetch: options.toolFetch,
      enginePorts: () => [serverPort],
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
  const fetchOut = engineFetch(options.fetch, () =>
    account.proxyUrl ? [new URL(account.proxyUrl).origin] : []
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
  permissions.useServices({ search, pages, artifacts })

  const runtime = createRuntime({
    store,
    emit,
    log,
    router,
    permissions,
    tools,
    folders,
    locked: () => (account.locked ? (account.reason ?? 'Titan117 is locked.') : null),
    budget: options.budget,
    memory,
    skills,
    records
  })
  runtimeRef = runtime

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
    setConnectorSecrets(next) {
      for (const values of Object.values(next))
        for (const value of Object.values(values)) registerSecret(value)
      connectors.setSecrets(next)
    },
    setAccount(next) {
      registerSecret(next.token)
      account = next
      // Signed in again: reports waiting in the queue go, and fixes are checked (19.5, 19.8).
      void reports.flush().then(() => reports.checkFixed())
      // The window re-reads the state (cloud models on or off) on a settings event.
      emit({ type: 'settings', defaultModel: getMeta<string | null>(db, 'defaultModel', null) })
    },
    async close() {
      reports.close()
      await server.close()
      await browser.close()
      await connectors.close()
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
      scriptToken
    }
  }
}
