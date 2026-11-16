/**
 * Budgets and limits on every task (guardrails §4, feature 4.8): steps, time,
 * cost and loop detection. When one is reached the task stops and says why;
 * the user decides whether to carry on. Credits replace dollars in phase 2.
 */
import type { ToolCall } from '../shared/protocol'

export interface Budget {
  maxSteps: number
  maxSeconds: number
  /** Provider cost in US dollars; local models cost nothing. */
  maxCostUsd: number
  /** The same call, with the same input, this many times in a row is a loop. */
  maxRepeats: number
}

export const DEFAULT_BUDGET: Budget = {
  maxSteps: 25,
  maxSeconds: 15 * 60,
  maxCostUsd: 0.5,
  maxRepeats: 3
}

/** Deep research (16.8, decisions §44): many searches and pages, so a bigger budget. */
export const RESEARCH_BUDGET: Budget = {
  maxSteps: 60,
  maxSeconds: 30 * 60,
  maxCostUsd: 2,
  maxRepeats: 3
}

export interface BudgetMeter {
  /** Call before each model step. Returns why the task must stop, or null. */
  beforeStep(): string | null
  addCost(usd: number): void
  /** Call for each tool call. Returns why the task must stop, or null. */
  onToolCall(call: ToolCall): string | null
  /** Time spent waiting for the user doesn't count. */
  pause(): void
  resume(): void
  readonly steps: number
  readonly costUsd: number
}

function stable(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return JSON.stringify(value)
}

export function createBudgetMeter(budget: Budget, now: () => number = Date.now): BudgetMeter {
  let steps = 0
  let costUsd = 0
  let activeMs = 0
  let since: number | null = now()
  let lastCall = ''
  let repeats = 0

  function elapsed(): number {
    return activeMs + (since === null ? 0 : now() - since)
  }

  return {
    beforeStep() {
      if (steps >= budget.maxSteps)
        return `Stopped after ${budget.maxSteps} steps, the limit for one task.`
      if (elapsed() > budget.maxSeconds * 1000)
        return `Stopped after ${Math.round(budget.maxSeconds / 60)} minutes, the time limit for one task.`
      if (costUsd >= budget.maxCostUsd)
        return `Stopped at $${costUsd.toFixed(2)}, the cost limit for one task.`
      steps += 1
      return null
    },
    addCost(usd) {
      if (Number.isFinite(usd) && usd > 0) costUsd += usd
    },
    onToolCall(call) {
      const key = `${call.name}:${stable(call.input)}`
      repeats = key === lastCall ? repeats + 1 : 1
      lastCall = key
      return repeats >= budget.maxRepeats
        ? `Stopped: the agent repeated the same step ${budget.maxRepeats} times (${call.name}).`
        : null
    },
    pause() {
      if (since !== null) {
        activeMs += now() - since
        since = null
      }
    },
    resume() {
      if (since === null) since = now()
    },
    get steps() {
      return steps
    },
    get costUsd() {
      return costUsd
    }
  }
}
