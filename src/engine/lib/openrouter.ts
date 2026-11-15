/**
 * OpenRouter (feature 2.2), called directly from the engine with the user's
 * own key (architecture §5). In phase 1 the key is a development key from
 * the local `.env`; the keychain and our credit proxy arrive in phase 2.
 * The key is held in memory only and never logged or stored.
 *
 * API checked on 14 Nov 2026 against openrouter.ai/docs/api-reference.
 */
import type { ChatMessage, CloudModel, OwnKeyModel, ToolCall } from '../../shared/protocol'
import { ModelError, type ModelProvider, type TurnRequest, type TurnResult } from '../models/types'
import type { Fetch } from './net'

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/**
 * Where a cloud call goes: our credits proxy with the device token (it speaks
 * OpenRouter's API and charges credits), or OpenRouter itself with a key.
 */
export interface CloudAccess {
  base: string
  key: string
  via: 'own' | 'credits' | 'dev'
}

/**
 * Providers that speak this same Chat Completions format with the user's own
 * key: OpenAI's own API, and Google's OpenAI-compatible Gemini endpoint (beta,
 * per Google's docs, checked 15 Nov 2026; external-services.md).
 */
export const DIRECT_BASES = {
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai'
} as const

const LABEL = { openrouter: 'OpenRouter', openai: 'OpenAI', google: 'Google' } as const
type Label = keyof typeof LABEL

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

async function problem(
  response: Response,
  via: CloudAccess['via'] = 'dev',
  provider: Label = 'openrouter'
): Promise<ModelError> {
  const name = LABEL[provider]
  let detail = ''
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    // No readable body.
  }
  if (via === 'credits') {
    if (response.status === 401)
      return new ModelError('Your sign-in has ended. Sign in again to use cloud models.')
    if (response.status === 402)
      return new ModelError(
        'No credits left, or no active plan. Top up on your account page, or use a local model.'
      )
    if (response.status === 429)
      return new ModelError('Too many cloud calls at once. Wait for one to finish, then try again.')
  }
  if (response.status === 401) return new ModelError(`${name} refused the key.`)
  if (response.status === 402) return new ModelError(`The ${name} account has no credit left.`)
  if (response.status === 429) return new ModelError(`${name} is rate limiting. Try again shortly.`)
  return new ModelError(`${name} answered ${response.status}${detail ? `: ${detail}` : ''}.`)
}

export function createOpenRouter(deps: {
  fetch: Fetch
  access(): CloudAccess | null
  /** Who answers (for messages); OpenRouter unless this is the user's own OpenAI or Google key. */
  provider?: Label
}): ModelProvider & { listModels(): Promise<CloudModel[]> } {
  const provider = deps.provider ?? 'openrouter'
  return {
    async turn(request: TurnRequest): Promise<TurnResult> {
      const access = deps.access()
      if (!access)
        throw new ModelError(
          provider === 'openrouter'
            ? 'Sign in to use cloud models with your credits, or use a local model.'
            : `Add your ${LABEL[provider]} API key in Models to use it directly.`
        )

      const response = await deps.fetch(`${access.base}/chat/completions`, {
        method: 'POST',
        signal: request.signal,
        headers: {
          Authorization: `Bearer ${access.key}`,
          'Content-Type': 'application/json',
          'X-Title': 'Titan117'
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          messages: toWire(request.system, request.messages),
          // OpenAI and Google send token counts only when asked; OpenRouter always does.
          ...(provider === 'openrouter' ? {} : { stream_options: { include_usage: true } }),
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
      if (!response.ok || !response.body) throw await problem(response, access.via, provider)

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
          if (chunk.error)
            throw new ModelError(`${LABEL[provider]}: ${chunk.error.message ?? 'error'}.`)
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
      const via =
        access.via === 'credits'
          ? 'via credits'
          : access.via === 'dev'
            ? 'via the development key'
            : `via your ${LABEL[provider]} key`
      return { text, toolCalls, usage, via }
    },

    /** OpenRouter's public model list with prices. Needs no key. */
    async listModels(): Promise<CloudModel[]> {
      const response = await deps.fetch(`${OPENROUTER_BASE}/models`)
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

/** Chat models an OpenAI or Google key may use, from that provider's own model list. */
export async function listDirectModels(
  fetch: Fetch,
  provider: keyof typeof DIRECT_BASES,
  key: string
): Promise<OwnKeyModel[]> {
  const response = await fetch(`${DIRECT_BASES[provider]}/models`, {
    headers: { Authorization: `Bearer ${key}` }
  })
  if (!response.ok) throw await problem(response, 'own', provider)
  const body = (await response.json()) as { data?: { id: string }[] }
  // Google lists "models/gemini-…"; OpenAI also lists embedding, audio and image models.
  const chat =
    provider === 'google'
      ? (id: string): boolean => id.includes('gemini')
      : (id: string): boolean =>
          /^(gpt-|o\d|chatgpt-)/.test(id) &&
          !/(audio|realtime|transcribe|tts|image|search)/.test(id)
  return (body.data ?? [])
    .map((m) => m.id.replace(/^models\//, ''))
    .filter(chat)
    .sort()
    .map((id) => ({ id: `${provider}:${id}`, name: id, provider }))
}
