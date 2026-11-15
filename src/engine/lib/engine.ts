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
import { createRuntime, type Runtime } from '../runtime'
import { createStore, type Store } from '../store'
import { builtInTools, createRegistry, type AnyTool } from '../tools'
import { getMeta, openDb, setMeta, type Db } from './db'
import { realFolder, type FolderPolicy } from './folders'
import { createLocalModels, type LocalModels } from './llama'
import { createLogger, type Logger } from './log'
import { engineFetch, type Fetch } from './net'
import { createOpenRouter, OPENROUTER_BASE, type CloudAccess } from './openrouter'
import { installToken, startServer } from './server'

export interface AccountState {
  /** The device token, sent only to our credits proxy. */
  token: string | null
  /** The proxy's base URL, e.g. https://titan117.com/api/v1. */
  proxyUrl: string | null
  locked: boolean
  /** What the user sees when locked, e.g. "Sign in to keep using Titan117." */
  reason: string | null
}

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
}

export interface Engine {
  port: number
  token: string
  addFolder(path: string): string[]
  removeFolder(path: string): string[]
  setAccount(account: AccountState): void
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
  const cloud = (): CloudAccess | null => {
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

  const tools = createRegistry(options.tools ?? builtInTools)
  const permissions = createPermissionLayer({ tools, store, log, folders: policy })

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
  const openrouter = createOpenRouter({
    fetch: engineFetch(options.fetch, () =>
      account.proxyUrl ? [new URL(account.proxyUrl).origin] : []
    ),
    access: cloud
  })
  const router = createRouter({ local, openrouter })

  const runtime = createRuntime({
    store,
    emit,
    log,
    router,
    permissions,
    tools,
    folders,
    locked: () => (account.locked ? (account.reason ?? 'Titan117 is locked.') : null),
    budget: options.budget
  })

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
      cloudVia: () => cloud()?.via ?? null
    }
  })

  const server = await startServer({
    token,
    allowedOrigins: options.allowedOrigins,
    handle,
    port: options.port
  })
  publish = server.publish
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
    setAccount(next) {
      registerSecret(next.token)
      account = next
      // The window re-reads the state (cloud models on or off) on a settings event.
      emit({ type: 'settings', defaultModel: getMeta<string | null>(db, 'defaultModel', null) })
    },
    async close() {
      await server.close()
      await local.dispose()
      db.close()
    },
    parts: { db, store, log, runtime, permissions, local, events }
  }
}
