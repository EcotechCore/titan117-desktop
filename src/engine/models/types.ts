/**
 * What every model source looks like to the agent runtime: one model turn
 * in, text and tool calls out. Local models and OpenRouter both implement it;
 * the user's own Anthropic, OpenAI and Google keys follow in phase 2.
 */
import type { ChatMessage, ToolCall } from '../../shared/protocol'
import type { ParamSchema } from '../tools/lib/define-tool'

export interface ToolSpec {
  name: string
  description: string
  params: ParamSchema
}

export interface TurnRequest {
  /** The model's own id at its source, without our `local:` or `openrouter:` prefix. */
  model: string
  system: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  signal: AbortSignal
  onText(delta: string): void
}

export interface TurnResult {
  text: string
  toolCalls: ToolCall[]
  usage: { inputTokens: number; outputTokens: number; costUsd: number }
}

export interface ModelProvider {
  turn(request: TurnRequest): Promise<TurnResult>
}

/** A problem the user can act on (no key, model not downloaded, no credit). */
export class ModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelError'
  }
}
