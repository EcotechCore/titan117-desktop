/**
 * `defineTool` is the only way to make a tool (guardrails §4). A tool
 * declares what it needs and how risky it is; the permission layer gives it
 * exactly that and nothing else. A tool never imports `fs`, `child_process`
 * or the network itself: ESLint blocks those outside the building blocks.
 */
import type { Risk } from '../../../shared/protocol'
import type { FileAccess } from '../../lib/folders'

/** A small JSON schema: what models are told and what input is checked against. */
export interface ParamSchema {
  type: 'object'
  properties: Record<string, { type: 'string' | 'number' | 'boolean'; description: string }>
  required: string[]
}

export interface ToolPermissions {
  /** Access to the folders the user allowed. Without it, `ctx.files` refuses. */
  folders?: 'read' | 'write'
}

export interface ToolContext {
  files: FileAccess
  signal: AbortSignal
}

export interface ToolResult {
  /** What goes back to the model. */
  output: string
  /** One line for the activity timeline. */
  summary: string
}

export interface ToolDefinition<Input = Record<string, unknown>> {
  name: string
  description: string
  params: ParamSchema
  risk: Risk
  permissions: ToolPermissions
  /**
   * True when the output comes from outside (files, pages, mail): it is
   * passed to the model marked as data, never as instructions (guardrails §5).
   */
  untrustedOutput: boolean
  /** Answerable only on the laptop, never remotely (guardrails §9). */
  laptopOnly: boolean
  /** One line for the approval card: what will happen. */
  describe(input: Input): string
  run(input: Input, ctx: ToolContext): Promise<ToolResult>
}

const TOOL_NAME = /^[a-z][a-z0-9_]{1,40}$/

export function defineTool<Input = Record<string, unknown>>(
  definition: Omit<ToolDefinition<Input>, 'laptopOnly' | 'untrustedOutput'> &
    Partial<Pick<ToolDefinition<Input>, 'laptopOnly' | 'untrustedOutput'>>
): ToolDefinition<Input> {
  if (!TOOL_NAME.test(definition.name)) throw new Error(`Bad tool name: ${definition.name}`)
  if (!['read', 'write', 'external'].includes(definition.risk))
    throw new Error(`Tool ${definition.name} needs a risk level.`)
  if (definition.risk === 'read' && definition.permissions.folders === 'write')
    throw new Error(`Tool ${definition.name} writes to folders, so its risk can't be "read".`)
  return Object.freeze({
    untrustedOutput: false,
    // External actions are laptop-only unless a tool says otherwise.
    laptopOnly: definition.risk === 'external',
    ...definition
  })
}

/** Check a model's arguments against the tool's schema. Returns what's wrong, or null. */
export function checkInput(schema: ParamSchema, input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return 'The input must be an object.'
  const record = input as Record<string, unknown>
  for (const name of schema.required)
    if (record[name] === undefined || record[name] === null) return `"${name}" is missing.`
  for (const [name, value] of Object.entries(record)) {
    const property = schema.properties[name]
    if (!property) return `"${name}" is not a parameter of this tool.`
    if (typeof value !== property.type) return `"${name}" must be a ${property.type}.`
  }
  return null
}
