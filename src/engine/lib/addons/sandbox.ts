/**
 * The add-on sandbox (features 10.8, 18.5; decisions §66.6): a tool add-on's
 * JavaScript runs in QuickJS compiled to WebAssembly, never as a Node program.
 * QuickJS has no files, network, processes, timers or modules of its own, so
 * the code reaches only what we hand it:
 *
 *   - `titan.define({ name: async (input) => result, ... })` to declare its tools;
 *   - `titan.fetch(url, { method, headers, body })`, which goes to `fetch` below
 *     only for the hosts its titan.json names (the engine passes the task's
 *     network policy as `fetch`, so the usual asks and blocks apply);
 *   - `console.log`, kept for the error message when a call fails.
 *
 * Each call gets a fresh runtime with a memory cap, a stack cap and a CPU
 * deadline; nothing carries over between calls.
 */
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule
} from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-wasmfile-release-sync'

export const SANDBOX_MEMORY_BYTES = 32 * 1024 * 1024
export const SANDBOX_CPU_MS = 10_000
/** A call that waits on the network gets this long in all. */
export const SANDBOX_TOTAL_MS = 60_000
export const SANDBOX_MAX_OUTPUT = 200_000
const MAX_CODE = 512 * 1024
const MAX_FETCHES = 20
const MAX_RESPONSE = 2 * 1024 * 1024
const MAX_REQUEST = 256 * 1024

export class SandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxError'
  }
}

/** What an add-on's `titan.fetch` gets back. */
export interface SandboxResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  text: string
}

/** One request, redirects not followed (the sandbox follows them itself, each checked). */
export type SandboxFetch = (url: string, init: RequestInit) => Promise<Response>

let modulePromise: Promise<QuickJSWASMModule> | null = null
function quickjs(): Promise<QuickJSWASMModule> {
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant)
  return modulePromise
}

function checkUrl(raw: string, hosts: string[]): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SandboxError(`"${raw.slice(0, 100)}" isn't an address.`)
  }
  if (url.protocol !== 'https:') throw new SandboxError('Add-ons may use only https:// addresses.')
  if (url.username || url.password)
    throw new SandboxError('Addresses with a user name are refused.')
  if (url.port && url.port !== '443') throw new SandboxError('Add-ons may not use other ports.')
  if (!hosts.includes(url.hostname.toLowerCase()))
    throw new SandboxError(
      hosts.length
        ? `This add-on may reach only ${hosts.join(', ')}, not ${url.hostname}.`
        : 'This add-on may not use the internet.'
    )
  return url
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_RESPONSE) {
      await reader.cancel().catch(() => undefined)
      throw new SandboxError('The answer was larger than 2 MB.')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** `titan.fetch` on the host side: allowed hosts only, redirects checked one by one. */
async function hostFetch(
  rawUrl: string,
  options: { method?: string; headers?: Record<string, string>; body?: string },
  hosts: string[],
  fetch: SandboxFetch
): Promise<SandboxResponse> {
  const method = String(options.method ?? 'GET').toUpperCase()
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method))
    throw new SandboxError(`The method ${method} isn't allowed.`)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(options.headers ?? {}).slice(0, 30)) {
    // Cookies are never set by an add-on.
    if (/^(cookie|host|content-length)$/i.test(k)) continue
    headers[String(k)] = String(v).slice(0, 4000)
  }
  const body =
    options.body === undefined || options.body === null ? undefined : String(options.body)
  if (body && body.length > MAX_REQUEST) throw new SandboxError('The request body is too large.')
  let url = checkUrl(rawUrl, hosts)
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
      credentials: 'omit'
    })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined)
      url = checkUrl(new URL(location, url).toString(), hosts)
      continue
    }
    const out: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      if (k !== 'set-cookie') out[k] = v
    })
    return { status: res.status, ok: res.ok, headers: out, text: await readCapped(res) }
  }
  throw new SandboxError('Too many redirects.')
}

function toHandle(vm: QuickJSContext, value: unknown): QuickJSHandle {
  const json = JSON.stringify(value ?? null)
  const result = vm.evalCode(`(${json})`)
  return vm.unwrapResult(result)
}

function render(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  return text.length > SANDBOX_MAX_OUTPUT
    ? `${text.slice(0, SANDBOX_MAX_OUTPUT)}\n[cut: the add-on's answer was longer than 200 KB]`
    : text
}

export interface SandboxRun {
  /** The add-on's JavaScript file. */
  code: string
  /** The tool to call, or null to only load the file and list what it defines. */
  tool: string | null
  input?: Record<string, unknown>
  hosts: string[]
  fetch?: SandboxFetch
  signal?: AbortSignal
  cpuMs?: number
  totalMs?: number
}

export interface SandboxResult {
  /** The tools the file defined. */
  defined: string[]
  output: string
  logs: string[]
}

/** Run one call in a fresh QuickJS runtime. */
export async function runInSandbox(run: SandboxRun): Promise<SandboxResult> {
  if (run.code.length > MAX_CODE) throw new SandboxError('The add-on’s code is larger than 512 KB.')
  const mod = await quickjs()
  const runtime = mod.newRuntime()
  runtime.setMemoryLimit(SANDBOX_MEMORY_BYTES)
  runtime.setMaxStackSize(1024 * 1024)
  // CPU time: wall time minus the time spent waiting for requests.
  const started = Date.now()
  let waited = 0
  let waitingSince: number | null = null
  const cpu = run.cpuMs ?? SANDBOX_CPU_MS
  runtime.setInterruptHandler(() => Date.now() - started - waited > cpu)
  const vm = runtime.newContext()
  const logs: string[] = []
  const pending = new Set<Promise<unknown>>()
  let fetches = 0
  let disposed = false
  try {
    const titan = vm.newObject()
    const log = vm.newFunction('log', (...args) => {
      if (logs.length < 50)
        logs.push(
          args
            .map((a) => String(vm.dump(a)))
            .join(' ')
            .slice(0, 500)
        )
    })
    const consoleObj = vm.newObject()
    vm.setProp(consoleObj, 'log', log)
    vm.setProp(consoleObj, 'error', log)
    vm.setProp(vm.global, 'console', consoleObj)
    consoleObj.dispose()
    log.dispose()

    const define = vm.newFunction('define', (tools) => {
      vm.setProp(vm.global, '__titanTools', tools)
    })
    vm.setProp(titan, 'define', define)
    define.dispose()

    const fetchFn = vm.newFunction('fetch', (urlHandle, optionsHandle) => {
      const deferred = vm.newPromise()
      const url = String(vm.dump(urlHandle))
      const options = (optionsHandle ? vm.dump(optionsHandle) : {}) as Record<string, unknown>
      const job = (async () => {
        if (++fetches > MAX_FETCHES)
          throw new SandboxError(`An add-on call may make ${MAX_FETCHES} requests at most.`)
        if (!run.fetch) throw new SandboxError('This add-on may not use the internet.')
        return hostFetch(
          url,
          options && typeof options === 'object'
            ? (options as Parameters<typeof hostFetch>[1])
            : {},
          run.hosts,
          run.fetch
        )
      })()
      const settled = job.then(
        (res) => {
          if (disposed) return
          const h = toHandle(vm, res)
          deferred.resolve(h)
          h.dispose()
        },
        (error: unknown) => {
          if (disposed) return
          const e = vm.newError(error instanceof Error ? error.message : 'The request failed.')
          deferred.reject(e)
          e.dispose()
        }
      )
      if (pending.size === 0) waitingSince = Date.now()
      pending.add(settled)
      void settled.finally(() => {
        pending.delete(settled)
        if (pending.size === 0 && waitingSince !== null) {
          waited += Date.now() - waitingSince
          waitingSince = null
        }
        if (!disposed) runtime.executePendingJobs()
      })
      return deferred.handle
    })
    vm.setProp(titan, 'fetch', fetchFn)
    fetchFn.dispose()
    vm.setProp(vm.global, 'titan', titan)
    titan.dispose()

    const loaded = vm.evalCode(run.code, 'tool.js')
    if (loaded.error) {
      const err = vm.dump(loaded.error) as { message?: string } | string
      loaded.error.dispose()
      throw new SandboxError(
        `The add-on didn't load: ${typeof err === 'string' ? err : (err?.message ?? 'an error')}`.slice(
          0,
          500
        )
      )
    }
    loaded.value.dispose()

    const toolsHandle = vm.getProp(vm.global, '__titanTools')
    const defined =
      vm.typeof(toolsHandle) === 'object'
        ? (vm.dump(vm.unwrapResult(vm.evalCode('Object.keys(__titanTools)'))) as string[]).filter(
            (k) => typeof k === 'string'
          )
        : []
    if (run.tool === null) {
      toolsHandle.dispose()
      return { defined, output: '', logs }
    }
    if (!defined.includes(run.tool)) {
      toolsHandle.dispose()
      throw new SandboxError(`The add-on doesn't define the tool ${run.tool}.`)
    }
    const fn = vm.getProp(toolsHandle, run.tool)
    toolsHandle.dispose()
    if (vm.typeof(fn) !== 'function') {
      fn.dispose()
      throw new SandboxError(`${run.tool} isn't a function.`)
    }
    const input = toHandle(vm, run.input ?? {})
    const called = vm.callFunction(fn, vm.undefined, input)
    fn.dispose()
    input.dispose()
    if (called.error) {
      const err = vm.dump(called.error) as { message?: string } | string
      called.error.dispose()
      throw new SandboxError(
        String(typeof err === 'string' ? err : (err?.message ?? 'The tool failed.')).slice(0, 500)
      )
    }
    const resultPromise = vm.resolvePromise(called.value)
    called.value.dispose()
    runtime.executePendingJobs()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new SandboxError('The add-on took too long.')),
        run.totalMs ?? SANDBOX_TOTAL_MS
      )
    })
    const aborted = new Promise<never>((_, reject) => {
      run.signal?.addEventListener('abort', () => reject(new SandboxError('Stopped.')), {
        once: true
      })
    })
    try {
      const settled = await Promise.race([resultPromise, timeout, aborted])
      if (settled.error) {
        const err = vm.dump(settled.error) as { message?: string } | string
        settled.error.dispose()
        throw new SandboxError(
          String(typeof err === 'string' ? err : (err?.message ?? 'The tool failed.')).slice(0, 500)
        )
      }
      const value = vm.dump(settled.value)
      settled.value.dispose()
      return { defined, output: render(value), logs }
    } finally {
      clearTimeout(timer)
    }
  } finally {
    disposed = true
    // Requests still running finish against nothing; the runtime goes now.
    try {
      vm.dispose()
      runtime.dispose()
    } catch {
      // A runtime interrupted mid-call can't always be torn down cleanly; it's garbage either way.
    }
  }
}
