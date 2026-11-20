/**
 * The model bridge (decisions §53): OpenCode never holds a key or picks a
 * provider. It is told about one OpenAI-compatible provider, this server on
 * 127.0.0.1, and every model step it takes comes here, with a token that
 * belongs to one coding task. The bridge sends the step through our model
 * router, so credits, the user's own keys, local models, budgets, the
 * offline note and local-models-only folders (7.7) work as for every agent.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import type { ChatMessage, ToolCall } from '../../../shared/protocol'
import type { ToolSpec, TurnResult } from '../../models/types'
import type { ParamSchema } from '../../tools/lib/define-tool'

const MAX_BODY_BYTES = 20_000_000

/** One coding task the bridge serves. */
export interface BridgeTask {
  taskId: string
  signal: AbortSignal
  /**
   * Run one model step for this task. Returns the result, or a sentence
   * saying why the step may not run (budget, offline, local-only).
   */
  step(request: {
    system: string
    messages: ChatMessage[]
    tools: ToolSpec[]
    signal: AbortSignal
    onText(delta: string): void
  }): Promise<TurnResult | { refused: string }>
}

export interface ModelBridge {
  /** The base URL OpenCode is given (`…/v1`). */
  url: string
  /** Register a task; returns the token OpenCode sends as its API key. */
  open(task: BridgeTask): string
  close(token: string): void
  /** Swap the task a token serves (a new prompt in the same session). */
  rebind(token: string, task: BridgeTask): void
  port: number
  stop(): Promise<void>
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer'
  content?: string | { type: string; text?: string }[] | null
  tool_calls?: { id: string; type?: string; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

interface OpenAiRequest {
  model?: string
  messages?: OpenAiMessage[]
  tools?: { type: string; function: { name: string; description?: string; parameters?: unknown } }[]
  stream?: boolean
}

function contentText(content: OpenAiMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/** OpenAI chat messages → our conversation (exported for tests). */
export function toConversation(messages: OpenAiMessage[]): {
  system: string
  messages: ChatMessage[]
} {
  const system: string[] = []
  const out: ChatMessage[] = []
  const names = new Map<string, string>()
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') {
      system.push(contentText(m.content))
    } else if (m.role === 'user') {
      out.push({ role: 'user', text: contentText(m.content) })
    } else if (m.role === 'assistant') {
      const toolCalls: ToolCall[] = (m.tool_calls ?? []).map((call) => {
        names.set(call.id, call.function.name)
        return {
          id: call.id,
          name: call.function.name,
          input: parseArguments(call.function.arguments)
        }
      })
      out.push({
        role: 'assistant',
        text: contentText(m.content),
        ...(toolCalls.length ? { toolCalls } : {})
      })
    } else if (m.role === 'tool') {
      const callId = m.tool_call_id ?? ''
      out.push({
        role: 'tool',
        callId,
        name: names.get(callId) ?? 'tool',
        output: contentText(m.content)
      })
    }
  }
  return { system: system.filter(Boolean).join('\n\n'), messages: out }
}

/** OpenAI tool definitions → ours (exported for tests). */
export function toToolSpecs(tools: OpenAiRequest['tools']): ToolSpec[] {
  return (tools ?? [])
    .filter((t) => t.type === 'function' && t.function?.name)
    .map((t) => ({
      name: t.function.name,
      description: t.function.description ?? '',
      params: (t.function.parameters ?? { type: 'object', properties: {} }) as ParamSchema
    }))
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ error: { message, type: 'titan117', code: status } }))
}

export async function startModelBridge(): Promise<ModelBridge> {
  const tasks = new Map<string, BridgeTask>()

  function taskFor(req: IncomingMessage): BridgeTask | null {
    const header = req.headers.authorization ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!given) return null
    for (const [token, task] of tasks) if (sameToken(given, token)) return task
    return null
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Web pages may not call the bridge: a browser always sends an Origin.
    if (req.headers.origin) return sendError(res, 403, 'Forbidden.')
    const task = taskFor(req)
    if (!task) return sendError(res, 401, 'Unknown token.')
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'task', object: 'model', owned_by: 'titan117' }]
        })
      )
      return
    }
    if (req.method !== 'POST' || path !== '/v1/chat/completions')
      return sendError(res, 404, 'Not found.')

    let body: OpenAiRequest
    try {
      body = JSON.parse(await readBody(req)) as OpenAiRequest
    } catch {
      return sendError(res, 400, 'The request could not be read.')
    }
    const { system, messages } = toConversation(body.messages ?? [])
    const tools = toToolSpecs(body.tools)
    const stream = body.stream === true

    // Stop the step when OpenCode hangs up or the task is cancelled.
    const abort = new AbortController()
    const stopStep = (): void => abort.abort()
    res.on('close', () => {
      if (!res.writableFinished) stopStep()
    })
    task.signal.addEventListener('abort', stopStep, { once: true })

    const id = `chatcmpl-${randomBytes(8).toString('hex')}`
    const created = Math.floor(Date.now() / 1000)
    const chunk = (delta: Record<string, unknown>, finish: string | null = null): void => {
      res.write(
        `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'task', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      )
    }
    let started = false
    const start = (): void => {
      if (started) return
      started = true
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
      chunk({ role: 'assistant', content: '' })
    }

    let result: TurnResult | { refused: string }
    try {
      result = await task.step({
        system,
        messages,
        tools,
        signal: abort.signal,
        onText(delta) {
          if (!stream || !delta) return
          start()
          chunk({ content: delta })
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The model step failed.'
      if (started) {
        res.end(`data: ${JSON.stringify({ error: { message } })}\n\n`)
        return
      }
      return sendError(res, 400, message)
    } finally {
      task.signal.removeEventListener('abort', stopStep)
    }

    if ('refused' in result) {
      if (started) {
        res.end(`data: ${JSON.stringify({ error: { message: result.refused } })}\n\n`)
        return
      }
      return sendError(res, 400, result.refused)
    }

    const toolCalls = result.toolCalls.map((call, index) => ({
      index,
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.input) }
    }))
    const finish = toolCalls.length ? 'tool_calls' : 'stop'
    const usage = {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens
    }

    if (!stream) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model: 'task',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: result.text || null,
                ...(toolCalls.length
                  ? {
                      tool_calls: toolCalls.map((c) => ({
                        id: c.id,
                        type: c.type,
                        function: c.function
                      }))
                    }
                  : {})
              },
              finish_reason: finish
            }
          ],
          usage
        })
      )
      return
    }
    start()
    if (toolCalls.length) chunk({ tool_calls: toolCalls })
    chunk({}, finish)
    res.write(
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'task', choices: [], usage })}\n\n`
    )
    res.end('data: [DONE]\n\n')
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => sendError(res, 500, 'The bridge failed.'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  return {
    url: `http://127.0.0.1:${port}/v1`,
    port,
    open(task) {
      const token = randomBytes(32).toString('hex')
      tasks.set(token, task)
      return token
    },
    rebind(token, task) {
      if (tasks.has(token)) tasks.set(token, task)
    },
    close(token) {
      tasks.delete(token)
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
