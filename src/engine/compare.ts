/**
 * Compare models side by side (feature 2.8, decisions §59.8): one prompt on
 * up to four models at once, with no tools, each answer with its time and
 * cost. Nothing is kept; the prompt leaves the laptop only for cloud models.
 */
import { ModelError } from './models/types'
import type { Router } from './router'

export const MAX_COMPARE = 4
const MAX_PROMPT = 20_000
const SYSTEM =
  'You are being compared with other models on the same prompt in the Titan117 app. Answer the prompt as well as you can, plainly and without mentioning the comparison.'

export interface CompareResult {
  model: string
  text: string
  ms: number
  costUsd: number
  via: string | null
  error: string | null
}

export class CompareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompareError'
  }
}

export function createComparer(deps: {
  router: Router
  locked: () => string | null
  online: () => boolean
  now?: () => number
}): (prompt: unknown, models: unknown, signal?: AbortSignal) => Promise<CompareResult[]> {
  const now = deps.now ?? Date.now
  return async (prompt, models, signal = new AbortController().signal) => {
    const lock = deps.locked()
    if (lock) throw new CompareError(lock)
    const text = typeof prompt === 'string' ? prompt.trim() : ''
    if (!text) throw new CompareError('Write a prompt first.')
    if (text.length > MAX_PROMPT) throw new CompareError('That prompt is too long.')
    const list = Array.isArray(models) ? [...new Set(models.map(String))] : []
    if (list.length < 2 || list.length > MAX_COMPARE)
      throw new CompareError(`Choose two to ${MAX_COMPARE} different models.`)
    return Promise.all(
      list.map(async (model): Promise<CompareResult> => {
        const started = now()
        const result = (
          error: string | null,
          over: Partial<CompareResult> = {}
        ): CompareResult => ({
          model,
          text: '',
          ms: now() - started,
          costUsd: 0,
          via: null,
          error,
          ...over
        })
        let route
        try {
          route = deps.router.route(model)
        } catch (error) {
          return result(error instanceof Error ? error.message : 'Unknown model.')
        }
        if (route.source !== 'local' && !deps.online())
          return result('No internet connection: cloud models need the internet.')
        try {
          const answer = await route.provider.turn({
            model: route.model,
            system: SYSTEM,
            messages: [{ role: 'user', text }],
            tools: [],
            signal,
            onText: () => undefined
          })
          return result(null, {
            text: answer.text,
            costUsd: answer.usage.costUsd,
            via: answer.via ?? (route.source === 'local' ? 'on this laptop' : null)
          })
        } catch (error) {
          return result(
            error instanceof ModelError ? error.message : 'This model failed to answer.'
          )
        }
      })
    )
  }
}
