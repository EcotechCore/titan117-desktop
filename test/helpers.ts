// Shared test helpers: an engine with everything in memory, a scripted
// OpenRouter, and a client for the local API over real HTTP.
import { mkdtempSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { startEngine, type Engine, type EngineOptions } from '../src/engine/lib/engine'
import type { ToolCall } from '../src/shared/protocol'

export const ORIGIN = 'titan117://app'
export const MODEL = 'openrouter:test/model'
// Not a real key: the shape of one, so redaction can be tested.
export const FAKE_KEY = ['sk', 'or', 'v1', '0000000000000000testkeytestkeytestkey'].join('-')

export interface ScriptedTurn {
  text?: string
  toolCalls?: Omit<ToolCall, 'id'>[]
  cost?: number
  status?: number
}

export interface Scripted {
  fetch: typeof fetch
  requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[]
}

/**
 * A fake OpenRouter: answers each chat call with the next scripted turn, or
 * with what `turns` returns for the request (when calls run at the same time).
 */
export function scripted(
  turns: ScriptedTurn[] | ((body: Record<string, unknown>, n: number) => ScriptedTurn)
): Scripted {
  const requests: Scripted['requests'] = []
  let index = 0
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/models'))
      return Response.json({
        data: [
          {
            id: 'test/model',
            name: 'Test model',
            context_length: 8000,
            pricing: { prompt: '0.000001', completion: '0.000002' },
            supported_parameters: ['tools']
          },
          {
            id: 'test/no-tools',
            pricing: { prompt: '0', completion: '0' },
            supported_parameters: []
          }
        ]
      })
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body })
    const turn =
      typeof turns === 'function'
        ? turns(body, index++)
        : turns[Math.min(index++, turns.length - 1)]
    if (turn.status) return Response.json({ error: { message: 'nope' } }, { status: turn.status })
    const frames: unknown[] = []
    // Split the text in two, as a real stream would.
    const text = turn.text ?? ''
    const half = Math.ceil(text.length / 2)
    for (const piece of [text.slice(0, half), text.slice(half)])
      if (piece) frames.push({ choices: [{ delta: { content: piece } }] })
    ;(turn.toolCalls ?? []).forEach((call, i) => {
      const args = JSON.stringify(call.input)
      frames.push({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: i,
                  id: `call_${index}_${i}`,
                  function: { name: call.name, arguments: args.slice(0, 3) }
                }
              ]
            }
          }
        ]
      })
      frames.push({
        choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: args.slice(3) } }] } }]
      })
    })
    frames.push({
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: turn.cost ?? 0.001 }
    })
    const stream = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n'
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch
  return { fetch: fake, requests }
}

export function tempFolder(prefix = 'titan117-'): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
}

export async function testEngine(
  options: Partial<EngineOptions> & { folder?: string } = {}
): Promise<Engine> {
  const { folder, ...rest } = options
  const engine = await startEngine({
    dataDir: null,
    appVersion: '0.0.0-test',
    coreDirs: [],
    allowedOrigins: [ORIGIN],
    openRouterKey: FAKE_KEY,
    locked: false,
    loadLlama: async () => {
      throw new Error('No local model in tests.')
    },
    probeLlama: async () => ({ ok: true, gpu: null, vramBytes: 0, gpuName: null }),
    ...rest
  })
  if (folder) engine.addFolder(folder)
  return engine
}

export async function call(
  engine: Engine,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(`http://127.0.0.1:${engine.port}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${engine.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers
  }
}

/** Wait until something is true (an approval appears, a task finishes). */
export async function until<T>(
  read: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  ms = 4000
): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() > end) throw new Error('Timed out waiting.')
    await new Promise((r) => setTimeout(r, 5))
  }
}
