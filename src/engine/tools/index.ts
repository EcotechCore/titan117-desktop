/**
 * Every built-in tool. test/tool-denials.test.ts fails for any tool listed
 * here without a denial test (guardrails §4).
 */
import type { ToolDefinition } from './lib/define-tool'
import { listFolder, readFile, writeFile } from './files'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDefinition<any>

export const builtInTools: AnyTool[] = [listFolder, readFile, writeFile]

export type ToolRegistry = ReadonlyMap<string, AnyTool>

export function createRegistry(tools: AnyTool[]): ToolRegistry {
  const map = new Map<string, AnyTool>()
  for (const tool of tools) {
    if (map.has(tool.name)) throw new Error(`Two tools are called ${tool.name}.`)
    map.set(tool.name, tool)
  }
  return map
}
