/**
 * The model router (architecture §5, features 2.1–2.5): sends each call to
 * the right source and says what it will cost before it runs. Local models
 * are free; cloud prices come from OpenRouter's own list, never copied here.
 */
import {
  CLOUD_MODEL_PREFIX,
  LOCAL_MODEL_PREFIX,
  OWN_KEY_PREFIXES,
  type ChatMessage,
  type CloudModel,
  type DirectProvider,
  type Estimate,
  type OwnKeyModel
} from '../shared/protocol'
import { ModelError, type ModelProvider } from './models/types'

export interface Route {
  provider: ModelProvider
  /** The model's id at its source. */
  model: string
  source: 'local' | 'openrouter' | DirectProvider
}

const PROVIDER_NAME: Record<DirectProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google'
}

export interface Router {
  route(modelId: string): Route
  cloudModels(): Promise<CloudModel[]>
  /** Models reachable with the user's own Anthropic, OpenAI and Google keys. */
  ownKeyModels(): Promise<OwnKeyModel[]>
  estimate(modelId: string, messages: ChatMessage[], system: string): Promise<Estimate>
}

const DAY = 24 * 60 * 60 * 1000
/** A rough guess at the answer's length, for the estimate only. */
const ASSUMED_OUTPUT_TOKENS = 600

/** About four characters per token: good enough for "about $0.01". */
export function roughTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function textOf(message: ChatMessage): string {
  if (message.role === 'user') return message.text
  if (message.role === 'tool') return message.output
  return message.text + JSON.stringify(message.toolCalls ?? [])
}

export function formatUsd(usd: number): string {
  if (usd <= 0) return '$0'
  if (usd < 0.01) return 'under $0.01'
  return `about $${usd.toFixed(2)}`
}

export function createRouter(deps: {
  local: ModelProvider
  openrouter: ModelProvider & { listModels(): Promise<CloudModel[]> }
  /** The user's own keys; a provider without a key lists nothing. */
  direct?: Partial<Record<DirectProvider, ModelProvider & { listModels(): Promise<OwnKeyModel[]> }>>
  hasKey?: (provider: DirectProvider) => boolean
  now?: () => number
}): Router {
  const now = deps.now ?? Date.now
  let cache: { at: number; models: CloudModel[] } | null = null

  const router: Router = {
    route(modelId) {
      if (modelId.startsWith(LOCAL_MODEL_PREFIX))
        return {
          provider: deps.local,
          model: modelId.slice(LOCAL_MODEL_PREFIX.length),
          source: 'local'
        }
      if (modelId.startsWith(CLOUD_MODEL_PREFIX))
        return {
          provider: deps.openrouter,
          model: modelId.slice(CLOUD_MODEL_PREFIX.length),
          source: 'openrouter'
        }
      for (const [source, prefix] of Object.entries(OWN_KEY_PREFIXES) as [
        DirectProvider,
        string
      ][]) {
        const provider = deps.direct?.[source]
        if (modelId.startsWith(prefix) && provider)
          return { provider, model: modelId.slice(prefix.length), source }
      }
      throw new ModelError('Choose a model first.')
    },

    async cloudModels() {
      if (cache && now() - cache.at < DAY) return cache.models
      const models = await deps.openrouter.listModels()
      cache = { at: now(), models }
      return models
    },

    async ownKeyModels() {
      const lists = await Promise.all(
        (Object.keys(PROVIDER_NAME) as DirectProvider[])
          .filter((p) => deps.hasKey?.(p) && deps.direct?.[p])
          .map((p) => deps.direct![p]!.listModels().catch(() => []))
      )
      return lists.flat()
    },

    async estimate(modelId, messages, system) {
      const { source, model } = router.route(modelId)
      if (source === 'local') return { free: true, usd: 0, label: 'Free · runs on this laptop' }
      if (source !== 'openrouter')
        return { free: false, usd: null, label: `Billed to your ${PROVIDER_NAME[source]} key` }
      let price: CloudModel | undefined
      try {
        price = (await router.cloudModels()).find((m) => m.id === model)
      } catch {
        // Offline or OpenRouter unreachable: say so instead of guessing.
      }
      if (!price) return { free: false, usd: null, label: 'Cost unknown' }
      const input = roughTokens(system) + messages.reduce((n, m) => n + roughTokens(textOf(m)), 0)
      const usd =
        (input * price.inputPerMillion + ASSUMED_OUTPUT_TOKENS * price.outputPerMillion) / 1_000_000
      return { free: usd === 0, usd, label: usd === 0 ? 'Free model' : `${formatUsd(usd)} a step` }
    }
  }
  return router
}
