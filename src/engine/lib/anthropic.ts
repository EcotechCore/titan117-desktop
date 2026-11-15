/**
 * Claude with the user's own Anthropic API key (features 2.9, 11.5), called
 * from the engine straight to Anthropic with the official SDK; nothing passes
 * through our servers and no credits are used (architecture §5).
 *
 * One streamed Messages API turn per step: text is shown as it arrives, the
 * final message's tool_use blocks become tool calls for the permission
 * layer, and the turn's content blocks (thinking blocks included) are kept so
 * the next turn sends them back unchanged.
 */
import Anthropic from '@anthropic-ai/sdk'

import type { ChatMessage, OwnKeyModel, ToolCall } from '../../shared/protocol'
import { ModelError, type ModelProvider, type TurnRequest, type TurnResult } from '../models/types'
import type { Fetch } from './net'

/** Room to answer; streaming keeps a long answer from timing out. */
const MAX_TOKENS = 64_000

/** Our conversation in the Messages API's shape. Tool results ride in a user turn. */
export function toAnthropic(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text })
    } else if (m.role === 'assistant') {
      if (m.raw?.source === 'anthropic') {
        out.push({ role: 'assistant', content: m.raw.content as Anthropic.ContentBlockParam[] })
        continue
      }
      // A turn from another source (a local model, OpenRouter): rebuilt from its text and calls.
      const content: Anthropic.ContentBlockParam[] = []
      if (m.text) content.push({ type: 'text', text: m.text })
      for (const call of m.toolCalls ?? [])
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
      if (content.length) out.push({ role: 'assistant', content })
    } else {
      const result: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.callId,
        content: m.output,
        ...(m.isError ? { is_error: true } : {})
      }
      // All results of one assistant turn go back in one user message.
      const last = out[out.length - 1]
      if (
        last?.role === 'user' &&
        Array.isArray(last.content) &&
        last.content.every((b) => b.type === 'tool_result')
      )
        last.content.push(result)
      else out.push({ role: 'user', content: [result] })
    }
  }
  return out
}

function explain(error: unknown): ModelError {
  if (error instanceof Anthropic.AuthenticationError)
    return new ModelError('Anthropic refused your API key. Check it in Models → Your own API keys.')
  if (error instanceof Anthropic.PermissionDeniedError)
    return new ModelError('Your Anthropic key may not use this model.')
  if (error instanceof Anthropic.NotFoundError)
    return new ModelError('Anthropic doesn’t know this model.')
  if (error instanceof Anthropic.RateLimitError)
    return new ModelError('Anthropic is rate limiting your key. Try again shortly.')
  if (error instanceof Anthropic.APIError)
    return new ModelError(`Anthropic answered ${error.status ?? 'with an error'}.`)
  if (error instanceof Anthropic.APIConnectionError)
    return new ModelError('Couldn’t reach Anthropic.')
  return error instanceof ModelError ? error : new ModelError('The call to Anthropic failed.')
}

export function createAnthropic(deps: {
  fetch: Fetch
  key(): string | null
}): ModelProvider & { listModels(): Promise<OwnKeyModel[]> } {
  const client = (): Anthropic => {
    const apiKey = deps.key()
    if (!apiKey)
      throw new ModelError('Add your Anthropic API key in Models to use Claude directly.')
    // The engine's fetch: only the hosts the engine may reach.
    return new Anthropic({ apiKey, fetch: deps.fetch, maxRetries: 2 })
  }

  return {
    async turn(request: TurnRequest): Promise<TurnResult> {
      const anthropic = client()
      try {
        const tools: Anthropic.Tool[] = request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          // Our tool schemas are plain JSON Schema objects; the SDK's type also allows extra keys.
          input_schema: { ...t.params },
          // Inputs stream as they're written; the permission layer checks each against its schema.
          eager_input_streaming: true
        }))
        const stream = anthropic.messages.stream(
          {
            model: request.model,
            max_tokens: MAX_TOKENS,
            system: request.system,
            messages: toAnthropic(request.messages),
            ...(tools.length ? { tools } : {})
          },
          { signal: request.signal }
        )
        stream.on('text', (delta) => request.onText(delta))
        const message = await stream.finalMessage()

        const toolCalls: ToolCall[] = message.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          .map((b) => ({
            id: b.id,
            name: b.name,
            input: (b.input ?? {}) as Record<string, unknown>
          }))
        // A tool input cut off by the token limit, or a declined request, is never run.
        if (message.stop_reason === 'max_tokens' && toolCalls.length)
          throw new ModelError(
            'Claude ran out of room in the middle of a tool call. Try a shorter request.'
          )
        if (message.stop_reason === 'refusal') throw new ModelError('Claude declined this request.')

        const text = message.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        return {
          text,
          toolCalls,
          // Billed by Anthropic to the user's key; no credits.
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            costUsd: 0
          },
          via: 'via your Anthropic key',
          raw: { source: 'anthropic', content: message.content as unknown[] }
        }
      } catch (error) {
        if (request.signal.aborted) throw error
        throw explain(error)
      }
    },

    /** The models this key may use, from Anthropic's Models API. */
    async listModels(): Promise<OwnKeyModel[]> {
      const anthropic = client()
      const models: OwnKeyModel[] = []
      try {
        for await (const m of anthropic.models.list())
          models.push({
            id: `anthropic:${m.id}`,
            name: m.display_name || m.id,
            provider: 'anthropic'
          })
      } catch (error) {
        throw explain(error)
      }
      return models
    }
  }
}
