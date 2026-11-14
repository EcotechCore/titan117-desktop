/**
 * OpenRouter (feature 2.2), called directly from the engine with the user's
 * own key (architecture §5). In phase 1 the key is a development key from
 * the local `.env`; the keychain and our credit proxy arrive in phase 2.
 * The key is held in memory only and never logged or stored.
 *
 * API checked on 14 Nov 2026 against openrouter.ai/docs/api-reference.
 */
import type { ChatMessage, CloudModel, ToolCall } from '../../shared/protocol'
import { ModelError, type ModelProvider, type TurnRequest, type TurnResult } from '../models/types'
import type { Fetch } from './net'

const BASE = 'https://openrouter.ai/api/v1'

interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export function toWire(system: string, messages: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text })
    else if (m.role === 'assistant')
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.input) }
              }))
            }
          : {})
      })
    else out.push({ role: 'tool', tool_call_id: m.callId, content: m.output })
  }
  return out
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    // Left for the permission layer to refuse: the schema check will fail.
    return { _unparsed: raw }
  }
}

async function problem(response: Response): Promise<ModelError> {
  let detail = ''
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    // No readable body.
  }
  if (response.status === 401) return new ModelError('OpenRouter refused the key.')
  if (response.status === 402) return new ModelError('The OpenRouter account has no credit left.')
  if (response.status === 429)
    return new ModelError('OpenRouter is rate limiting. Try again shortly.')
  return new ModelError(`OpenRouter answered ${response.status}${detail ? `: ${detail}` : ''}.`)
}

export function createOpenRouter(deps: {
  fetch: Fetch
  apiKey(): string | null
}): ModelProvider & { listModels(): Promise<CloudModel[]> } {
  return {
    async turn(request: TurnRequest): Promise<TurnResult> {
      const key = deps.apiKey()
      if (!key)
        throw new ModelError(
          'No OpenRouter key. Add OPENROUTER_API_KEY to the local .env file, or use a local model.'
        )

      const response = await deps.fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        signal: request.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'Titan117'
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          messages: toWire(request.system, request.messages),
          ...(request.tools.length
            ? {
                tools: request.tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.params }
                }))
              }
            : {})
        })
      })
      if (!response.ok || !response.body) throw await problem(response)

      let text = ''
      const calls = new Map<number, { id: string; name: string; args: string }>()
      const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          let chunk: {
            error?: { message?: string }
            choices?: {
              delta?: {
                content?: string | null
                tool_calls?: {
                  index: number
                  id?: string
                  function?: { name?: string; arguments?: string }
                }[]
              }
            }[]
            usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
          }
          try {
            chunk = JSON.parse(data)
          } catch {
            continue
          }
          if (chunk.error) throw new ModelError(`OpenRouter: ${chunk.error.message ?? 'error'}.`)
          const delta = chunk.choices?.[0]?.delta
          if (delta?.content) {
            text += delta.content
            request.onText(delta.content)
          }
          for (const part of delta?.tool_calls ?? []) {
            const call = calls.get(part.index) ?? { id: '', name: '', args: '' }
            if (part.id) call.id = part.id
            if (part.function?.name) call.name += part.function.name
            if (part.function?.arguments) call.args += part.function.arguments
            calls.set(part.index, call)
          }
          if (chunk.usage) {
            usage.inputTokens = chunk.usage.prompt_tokens ?? 0
            usage.outputTokens = chunk.usage.completion_tokens ?? 0
            usage.costUsd = chunk.usage.cost ?? 0
          }
        }
      }

      const toolCalls: ToolCall[] = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, c]) => ({
          id: c.id || `call_${index}`,
          name: c.name,
          input: parseArguments(c.args)
        }))
      return { text, toolCalls, usage }
    },

    /** OpenRouter's public model list with prices. Needs no key. */
    async listModels(): Promise<CloudModel[]> {
      const response = await deps.fetch(`${BASE}/models`)
      if (!response.ok) throw await problem(response)
      const body = (await response.json()) as {
        data?: {
          id: string
          name?: string
          context_length?: number
          pricing?: { prompt?: string; completion?: string }
          supported_parameters?: string[]
        }[]
      }
      return (body.data ?? [])
        .filter((m) => m.supported_parameters?.includes('tools'))
        .map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          inputPerMillion: Number(m.pricing?.prompt ?? 0) * 1_000_000,
          outputPerMillion: Number(m.pricing?.completion ?? 0) * 1_000_000,
          contextLength: m.context_length ?? 0
        }))
        .filter((m) => Number.isFinite(m.inputPerMillion) && m.inputPerMillion >= 0)
    }
  }
}
