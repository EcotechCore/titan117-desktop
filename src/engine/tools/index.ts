/**
 * Every built-in tool. test/tool-denials.test.ts fails for any tool listed
 * here without a denial test (guardrails §4). Connector tools (MCP) join at
 * run time through the same registry, behind the same permission layer.
 */
import type { ToolDefinition } from './lib/define-tool'
import { browserTools } from './browser'
import { fileTools } from './files'
import { memoryTools } from './memory'
import { runCode, runCommand } from './shell'
import { speechTools } from './speech'
import { webTools } from './web'
import { artifactTools } from './artifacts'
import { documentTools } from './documents'
import { codeReview, codeTask } from './code'
import { gitTools } from './git'
import { serverTools } from './servers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDefinition<any>

export const builtInTools: AnyTool[] = [
  ...fileTools,
  runCommand,
  runCode,
  ...webTools,
  ...browserTools,
  ...artifactTools,
  ...documentTools,
  codeTask,
  codeReview,
  ...gitTools,
  ...serverTools,
  ...memoryTools,
  ...speechTools
]

export interface ToolRegistry {
  get(name: string): AnyTool | undefined
  values(): AnyTool[]
}

/** A fixed set of tools, plus any that `extra` adds at run time (connectors). */
export function createRegistry(tools: AnyTool[], extra: () => AnyTool[] = () => []): ToolRegistry {
  const map = new Map<string, AnyTool>()
  for (const tool of tools) {
    if (map.has(tool.name)) throw new Error(`Two tools are called ${tool.name}.`)
    map.set(tool.name, tool)
  }
  return {
    get: (name) => map.get(name) ?? extra().find((t) => t.name === name),
    values: () => [...map.values(), ...extra().filter((t) => !map.has(t.name))]
  }
}
