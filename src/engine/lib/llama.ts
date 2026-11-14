/**
 * Local models (feature 2.1): llama.cpp built in, through node-llama-cpp
 * (MIT). Models download completely into the components folder and then
 * work with no internet. Only models whose licence we checked are listed
 * (decisions §33); the full catalogue grows with the hardware check.
 */
import { execFile } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { totalmem } from 'node:os'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  ChatHistoryItem,
  ChatModelFunctionCall,
  ChatModelFunctions,
  ChatModelResponse,
  Llama,
  LlamaChat,
  LlamaContext,
  LlamaModel,
  ModelDownloader
} from 'node-llama-cpp'

import type { ChatMessage, LocalModel, ModelFit, ToolCall } from '../../shared/protocol'
import { ModelError, type ModelProvider, type TurnRequest, type TurnResult } from '../models/types'
import { getMeta, setMeta, type Db } from './db'

export interface CatalogueEntry {
  id: string
  name: string
  /** Where node-llama-cpp downloads it from (Hugging Face, public, no account). */
  uri: string
  sizeBytes: number
  licence: string
  /** Where and when the licence was checked. */
  licenceChecked: string
  note: string
}

export const LOCAL_CATALOGUE: CatalogueEntry[] = [
  {
    id: 'qwen2.5-1.5b-instruct-q4_k_m',
    name: 'Qwen2.5 1.5B Instruct',
    uri: 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sizeBytes: 1_117_320_736,
    licence: 'Apache 2.0',
    licenceChecked: 'huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF, 14 Nov 2026',
    note: 'Small and quick. Good for simple questions; weak at long tasks.'
  },
  {
    id: 'qwen3-4b-q4_k_m',
    name: 'Qwen3 4B',
    uri: 'hf:Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf',
    sizeBytes: 2_497_280_256,
    licence: 'Apache 2.0',
    licenceChecked: 'huggingface.co/Qwen/Qwen3-4B-GGUF, 14 Nov 2026',
    note: 'A middle size that thinks before it answers. Fine on most laptops.'
  },
  {
    id: 'qwen2.5-7b-instruct-q4_k_m',
    name: 'Qwen2.5 7B Instruct',
    uri: 'hf:Qwen/Qwen2.5-7B-Instruct-GGUF/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf',
    sizeBytes: 4_683_073_632,
    licence: 'Apache 2.0',
    licenceChecked: 'huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF, 14 Nov 2026',
    note: 'A good everyday model with tool use. Wants a graphics card with 6 GB or more.'
  }
]

export interface Hardware {
  ramBytes: number
  vramBytes: number
  gpu: string | null
}

/** "Runs well", "runs slowly" or "too big" on this laptop (feature 2.1). */
export function fitFor(sizeBytes: number, hardware: Hardware): ModelFit {
  const needed = sizeBytes * 1.2 // the file plus room for the context
  if (hardware.vramBytes > 0 && needed <= hardware.vramBytes) return 'runs well'
  if (needed > hardware.ramBytes * 0.7) return 'too big'
  // Small models are fine on the processor alone.
  return sizeBytes <= 2.5 * 1024 ** 3 ? 'runs well' : 'runs slowly'
}

export function toHistory(system: string, messages: ChatMessage[]): ChatHistoryItem[] {
  const out: ChatHistoryItem[] = [{ type: 'system', text: system }]
  const calls = new Map<string, ChatModelFunctionCall>()
  let current: ChatModelResponse | null = null
  for (const m of messages) {
    if (m.role === 'user') {
      current = null
      out.push({ type: 'user', text: m.text })
    } else if (m.role === 'assistant') {
      // Consecutive model turns (a call, its result, the next call) are one response.
      if (!current) {
        current = { type: 'model', response: [] }
        out.push(current)
      }
      if (m.text) current.response.push(m.text)
      for (const call of m.toolCalls ?? []) {
        const item: ChatModelFunctionCall = {
          type: 'functionCall',
          name: call.name,
          params: call.input,
          result: undefined
        }
        calls.set(call.id, item)
        current.response.push(item)
      }
    } else {
      const item = calls.get(m.callId)
      if (item) item.result = m.output
    }
  }
  if (!current) out.push({ type: 'model', response: [] })
  return out
}

/** What a side process found when it tried to start llama.cpp. */
export interface Probe {
  ok: boolean
  /** The graphics back end that works here ("cuda", "vulkan", "metal"), or null. */
  gpu: string | null
  vramBytes: number
  gpuName: string | null
}

const PROBE_MARK = 'TITAN117_PROBE '
const PROBE_SCRIPT = `
import(process.argv[1]).then(async (m) => {
  const llama = await m.getLlama({ build: 'never', progressLogs: false })
  const state = llama.gpu ? await llama.getVramState() : { total: 0, unifiedSize: 0 }
  // Memory a built-in graphics chip shares with the system isn't counted.
  const vram = state.unifiedSize > 0 && state.unifiedSize < state.total ? state.total - state.unifiedSize : state.total
  const names = llama.gpu ? await llama.getGpuDeviceNames() : []
  const name = names.find((n) => !/intel/i.test(n)) || names[0] || null
  process.stdout.write('${PROBE_MARK}' + JSON.stringify({ gpu: llama.gpu || null, vramBytes: vram, gpuName: name }))
  await llama.dispose()
  process.exit(0)
}).catch(() => process.exit(3))`

/**
 * Start llama.cpp once in a side process first. A prebuilt binary that
 * doesn't suit the laptop crashes the process that loads it (on Windows,
 * when the Visual C++ runtime is older than 14.40), and that must never be
 * the engine. It is also never built from source on the user's laptop.
 */
export function probeLlama(): Promise<Probe> {
  const failed: Probe = { ok: false, gpu: null, vramBytes: 0, gpuName: null }
  return new Promise((resolve) => {
    let entry: string
    try {
      entry = pathToFileURL(require.resolve('node-llama-cpp')).href
    } catch {
      return resolve(failed)
    }
    execFile(
      process.execPath,
      ['-e', PROBE_SCRIPT, entry],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 120_000, windowsHide: true },
      (error, stdout) => {
        const at = String(stdout).lastIndexOf(PROBE_MARK)
        if (error || at < 0) return resolve(failed)
        try {
          const found = JSON.parse(String(stdout).slice(at + PROBE_MARK.length)) as Omit<
            Probe,
            'ok'
          >
          resolve({ ok: true, ...found })
        } catch {
          resolve(failed)
        }
      }
    )
  })
}

export const LOCAL_PROBLEM =
  process.platform === 'win32'
    ? "Local models can't start on this laptop yet. The usual cause is an old Microsoft Visual C++ runtime: install the latest one (x64), then restart Titan117."
    : "Local models can't start on this laptop yet."

export interface LocalModels extends ModelProvider {
  /** What is known so far; the graphics card is unknown until the check ends. */
  hardware(): Hardware
  /** Why local models can't run here, in plain words; null when they can. */
  problem(): string | null
  /** True while llama.cpp is still being tried in its side process. */
  checking(): boolean
  /** Start that check in the background; `onChecked` fires when it ends. */
  warm(): void
  list(): Promise<LocalModel[]>
  download(id: string): Promise<void>
  cancelDownload(id: string): Promise<void>
  remove(id: string): Promise<void>
  dispose(): Promise<void>
}

type Module = typeof import('node-llama-cpp')

export function createLocalModels(deps: {
  db: Db
  modelsDir: string
  onChange(model: LocalModel): void
  onChecked?(): void
  /** Replaced in tests, so they need no real model or graphics card. */
  load?: () => Promise<Module>
  probe?: () => Promise<Probe>
}): LocalModels {
  const { db } = deps
  const load = deps.load ?? (() => import('node-llama-cpp'))

  let llama: Promise<Llama> | null = null
  let probed: Promise<Probe> | null = null
  let found: Probe | null = null
  const downloads = new Map<string, { downloader: ModelDownloader | null; bytes: number }>()
  let loaded: { id: string; model: LlamaModel; context: LlamaContext; chat: LlamaChat } | null =
    null
  let queue: Promise<unknown> = Promise.resolve()
  let callCount = 0

  function probe(): Promise<Probe> {
    probed ??= (deps.probe ?? probeLlama)().then((result) => {
      found = result
      deps.onChecked?.()
      return result
    })
    return probed
  }

  function getLlama(): Promise<Llama> {
    if (!llama) {
      const starting = probe().then(async (result) => {
        if (!result.ok) throw new ModelError(LOCAL_PROBLEM)
        // Exactly the back end the probe saw working; never a build from source.
        return (await load()).getLlama({
          build: 'never',
          gpu: (result.gpu ?? false) as 'cuda' | 'vulkan' | 'metal' | false,
          progressLogs: false
        })
      })
      // A failed start is forgotten, so the next call tries again.
      starting.catch(() => {
        if (llama === starting) llama = null
      })
      llama = starting
    }
    return llama
  }

  function pathOf(id: string): string | null {
    const path = getMeta<string | null>(db, `localModel:${id}`, null)
    return path && existsSync(path) ? path : null
  }

  async function describe(entry: CatalogueEntry): Promise<LocalModel> {
    const downloading = downloads.get(entry.id)
    const ready = !downloading && pathOf(entry.id) !== null
    return {
      id: entry.id,
      name: entry.name,
      sizeBytes: entry.sizeBytes,
      licence: entry.licence,
      note: entry.note,
      fit: fitFor(entry.sizeBytes, api.hardware()),
      state: downloading ? 'downloading' : ready ? 'ready' : 'not downloaded',
      downloadedBytes: downloading ? downloading.bytes : ready ? entry.sizeBytes : 0
    }
  }

  function find(id: string): CatalogueEntry {
    const entry = LOCAL_CATALOGUE.find((e) => e.id === id)
    if (!entry) throw new ModelError('That model is not in the catalogue.')
    return entry
  }

  async function unload(): Promise<void> {
    const old = loaded
    loaded = null
    if (old) {
      await old.context.dispose()
      await old.model.dispose()
    }
  }

  async function ensureLoaded(id: string): Promise<NonNullable<typeof loaded>> {
    if (loaded?.id === id) return loaded
    const path = pathOf(id)
    if (!path) throw new ModelError('That model is not downloaded yet. Download it under Models.')
    await unload()
    const module = await load()
    const model = await (await getLlama()).loadModel({ modelPath: path })
    const context = await model.createContext({ contextSize: { max: 8192 } })
    const chat = new module.LlamaChat({ contextSequence: context.getSequence() })
    loaded = { id, model, context, chat }
    return loaded
  }

  const api: LocalModels = {
    hardware() {
      return {
        ramBytes: totalmem(),
        vramBytes: found?.vramBytes ?? 0,
        gpu: found?.gpuName ?? found?.gpu ?? null
      }
    },

    problem() {
      return found && !found.ok ? LOCAL_PROBLEM : null
    },

    checking() {
      return found === null
    },

    warm() {
      void probe()
    },

    async list() {
      return Promise.all(LOCAL_CATALOGUE.map(describe))
    },

    async download(id) {
      const entry = find(id)
      if (downloads.has(id) || pathOf(id)) return
      const state: { downloader: ModelDownloader | null; bytes: number } = {
        downloader: null,
        bytes: 0
      }
      downloads.set(id, state)
      deps.onChange(await describe(entry))
      try {
        mkdirSync(deps.modelsDir, { recursive: true })
        const module = await load()
        let lastTold = 0
        const downloader = await module.createModelDownloader({
          modelUri: entry.uri,
          dirPath: deps.modelsDir,
          showCliProgress: false,
          onProgress: ({ downloadedSize }) => {
            state.bytes = downloadedSize
            // At most twice a second: the window only needs a moving bar.
            if (Date.now() - lastTold > 500) {
              lastTold = Date.now()
              void describe(entry).then(deps.onChange)
            }
          }
        })
        state.downloader = downloader
        const path = await downloader.download()
        setMeta(db, `localModel:${id}`, path)
      } finally {
        downloads.delete(id)
        deps.onChange(await describe(entry))
      }
    },

    async cancelDownload(id) {
      await downloads.get(id)?.downloader?.cancel({ deleteTempFile: true })
    },

    async remove(id) {
      const entry = find(id)
      if (loaded?.id === id) await unload()
      const path = pathOf(id)
      if (path) {
        // Split models keep their parts side by side; remove every part.
        const stem = path.replace(/-\d{5}-of-\d{5}\.gguf$/, '')
        if (stem !== path) {
          const total = Number(path.match(/-of-(\d{5})\.gguf$/)?.[1] ?? 1)
          for (let part = 1; part <= total; part++)
            rmSync(
              `${stem}-${String(part).padStart(5, '0')}-of-${String(total).padStart(5, '0')}.gguf`,
              {
                force: true
              }
            )
        } else if (dirname(path) === deps.modelsDir) rmSync(path, { force: true })
      }
      setMeta(db, `localModel:${id}`, null)
      deps.onChange(await describe(entry))
    },

    turn(request: TurnRequest): Promise<TurnResult> {
      // One generation at a time: a laptop has one graphics card.
      const run = queue.then(async () => {
        if (request.signal.aborted) return { text: '', toolCalls: [], usage: zero() }
        const { chat } = await ensureLoaded(request.model)
        const functions: Record<string, { description: string; params: unknown }> = {}
        for (const tool of request.tools)
          functions[tool.name] = {
            description: tool.description,
            params: { type: 'object', properties: tool.params.properties }
          }
        const meter = chat.sequence.tokenMeter
        const before = { in: meter.usedInputTokens, out: meter.usedOutputTokens }

        const result = await chat.generateResponse(toHistory(request.system, request.messages), {
          functions: request.tools.length
            ? (functions as unknown as ChatModelFunctions)
            : undefined,
          documentFunctionParams: true,
          signal: request.signal,
          stopOnAbortSignal: true,
          maxTokens: 2048,
          onTextChunk: request.onText
        } as Parameters<LlamaChat['generateResponse']>[1])

        const toolCalls: ToolCall[] = (
          (result.functionCalls ?? []) as { functionName: string; params: unknown }[]
        ).map((call) => ({
          id: `local_${++callCount}`,
          name: call.functionName,
          input:
            call.params && typeof call.params === 'object'
              ? (call.params as Record<string, unknown>)
              : {}
        }))
        return {
          // Models that think first leave blank lines where the thinking was.
          text: result.response.trim(),
          toolCalls,
          usage: {
            inputTokens: meter.usedInputTokens - before.in,
            outputTokens: meter.usedOutputTokens - before.out,
            costUsd: 0 // Local models cost nothing.
          }
        }
      })
      queue = run.catch(() => undefined)
      return run
    },

    async dispose() {
      for (const id of downloads.keys()) await api.cancelDownload(id).catch(() => undefined)
      await unload().catch(() => undefined)
      const starting = llama
      llama = null
      if (starting) await starting.then((instance) => instance.dispose()).catch(() => undefined)
    }
  }
  return api
}

function zero(): TurnResult['usage'] {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 }
}
