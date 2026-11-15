/**
 * Connectors through MCP (feature 3.6, decisions §28): the user adds a
 * service's MCP server (a program on the laptop, or an address), signed in
 * as the user with their own token. Its tools join Titan's tools behind the
 * same permission layer:
 *
 *   - a tool that says it only reads, and whose name doesn't send, post,
 *     delete or pay, runs without asking;
 *   - a tool that sends, posts, publishes, deletes or pays (by name or by
 *     its own "destructive" flag) always asks;
 *   - everything else asks, with "always in this task".
 *
 * Their output is private and untrusted (mail, documents, records). Tokens
 * live in the keychain; the shell hands them to the engine, never to a page.
 */
import { randomUUID } from 'node:crypto'

import type { Connector, Risk } from '../../shared/protocol'
import { defineTool, type ParamSchema, type ToolDefinition } from '../tools/lib/define-tool'
import type { Db } from './db'
import type { Logger } from './log'
import { cleanEnv } from './shell'

/** Names of tools that act outside: they always ask (feature 4.5). */
const EXTERNAL_VERB =
  /(^|_|-|\b)(send|post|publish|delete|remove|destroy|pay|charge|refund|transfer|invite|share|reply|forward|archive|trash|merge|push|tweet|comment|cancel)(_|-|\b|$)/i
/** Names of tools that only look. */
const READ_VERB =
  /(^|_|-|\b)(get|list|search|read|find|fetch|query|describe|show|view|lookup|count)(_|-|\b|$)/i

export function connectorRisk(
  name: string,
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
): Risk {
  if (EXTERNAL_VERB.test(name) || annotations?.destructiveHint === true) return 'external'
  if (annotations?.readOnlyHint === true && READ_VERB.test(name)) return 'read'
  return 'write'
}

/** A model-safe tool name: `<connector>_<tool>`, letters, digits and underscores. */
export function connectorToolName(connector: string, tool: string): string {
  const clean = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  const name = `${clean(connector).slice(0, 20) || 'connector'}_${clean(tool)}`.slice(0, 64)
  return /^[a-z]/.test(name) ? name : `c_${name}`.slice(0, 64)
}

const JSON_TYPES: Record<string, ParamSchema['properties'][string]['type']> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array'
}

/** The checkable part of an MCP input schema; the full schema goes to the model as is. */
export function toParams(schema: unknown): { params: ParamSchema; raw: Record<string, unknown> } {
  const raw = (
    schema && typeof schema === 'object' ? schema : { type: 'object', properties: {} }
  ) as Record<string, unknown>
  const props = (raw.properties ?? {}) as Record<string, { type?: unknown; description?: unknown }>
  const properties: ParamSchema['properties'] = {}
  for (const [name, prop] of Object.entries(props)) {
    const type = typeof prop?.type === 'string' ? JSON_TYPES[prop.type] : undefined
    // A property with a union or no type is passed through unchecked.
    properties[name] = {
      type: type ?? 'string',
      description: typeof prop?.description === 'string' ? prop.description : name,
      ...(type ? {} : { unchecked: true })
    }
  }
  return {
    params: {
      type: 'object',
      properties,
      required: Array.isArray(raw.required)
        ? (raw.required as string[]).filter((r) => typeof r === 'string')
        : []
    },
    raw: { type: 'object', ...raw }
  }
}

interface Live {
  status: Connector['status']
  error: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any | null
  tools: ToolDefinition[]
}

type Row = Record<string, unknown>

export interface ConnectorInput {
  name: string
  kind: 'stdio' | 'http'
  command?: string | null
  args?: string[]
  url?: string | null
}

export interface ConnectorHub {
  list(): Connector[]
  add(input: ConnectorInput): Connector
  remove(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<Connector>
  /** Secrets from the keychain, per connector id (environment variables or a bearer token). */
  setSecrets(secrets: Record<string, Record<string, string>>): void
  /** The tools of every connected connector. */
  tools(): ToolDefinition[]
  connectAll(): Promise<void>
  close(): Promise<void>
}

export class ConnectorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectorError'
  }
}

export function createConnectorHub(deps: {
  db: Db
  log: Logger
  onChange: () => void
  /** Where a program connector starts (the first allowed folder, or the user's home). */
  cwd: () => string | undefined
}): ConnectorHub {
  const { db, log } = deps
  const live = new Map<string, Live>()
  let secrets: Record<string, Record<string, string>> = {}

  function rows(): Row[] {
    return db.prepare('select * from connectors order by created_at').all() as Row[]
  }

  function view(r: Row): Connector {
    const state = live.get(r.id as string)
    return {
      id: r.id as string,
      name: r.name as string,
      kind: r.kind as Connector['kind'],
      command: (r.command as string | null) ?? null,
      args: JSON.parse((r.args as string) || '[]') as string[],
      url: (r.url as string | null) ?? null,
      enabled: r.enabled === 1,
      secretNames: Object.keys(secrets[r.id as string] ?? {}),
      status: r.enabled === 1 ? (state?.status ?? 'connecting') : 'off',
      error: state?.error ?? null,
      tools: (state?.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        risk: t.risk
      })),
      createdAt: r.created_at as number
    }
  }

  async function disconnect(id: string): Promise<void> {
    const state = live.get(id)
    live.delete(id)
    await state?.client?.close().catch(() => undefined)
  }

  async function connect(r: Row): Promise<void> {
    const id = r.id as string
    await disconnect(id)
    if (r.enabled !== 1) return
    const state: Live = { status: 'connecting', error: null, client: null, tools: [] }
    live.set(id, state)
    deps.onChange()
    try {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
      const client = new Client({ name: 'Titan117', version: '0.1.0' })
      const own = secrets[id] ?? {}
      if (r.kind === 'stdio') {
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
        await client.connect(
          new StdioClientTransport({
            command: r.command as string,
            args: JSON.parse((r.args as string) || '[]') as string[],
            // The same scrubbed environment as the shell, plus this connector's own secrets.
            env: {
              ...cleanEnv(process.env, process.env.TEMP ?? process.env.TMPDIR ?? '.'),
              ...own
            },
            cwd: deps.cwd(),
            stderr: 'ignore'
          })
        )
      } else {
        const { StreamableHTTPClientTransport } =
          await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
        const token = own.TOKEN ?? own.token
        await client.connect(
          new StreamableHTTPClientTransport(new URL(r.url as string), {
            requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {}
          })
        )
      }
      const listed = await client.listTools()
      const connectorName = r.name as string
      state.tools = listed.tools
        .slice(0, 100)
        .map(
          (tool: {
            name: string
            description?: string
            inputSchema?: unknown
            annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
          }) => {
            const { params, raw } = toParams(tool.inputSchema)
            const risk = connectorRisk(tool.name, tool.annotations)
            return defineTool<Record<string, unknown>>({
              name: connectorToolName(connectorName, tool.name),
              description: `[${connectorName}] ${(tool.description ?? tool.name).slice(0, 900)}`,
              params,
              rawSchema: raw,
              risk,
              permissions: {},
              untrustedOutput: true,
              privateOutput: true,
              laptopOnly: risk === 'external',
              describe: (input) =>
                `${connectorName}: ${tool.name} ${JSON.stringify(input).slice(0, 300)}`,
              async run(input, ctx) {
                const result = await client.callTool(
                  { name: tool.name, arguments: input },
                  undefined,
                  { signal: ctx.signal, timeout: 120_000 }
                )
                const parts = (result.content ?? []) as { type: string; text?: string }[]
                const text = parts
                  .map((p) => (p.type === 'text' ? (p.text ?? '') : `[${p.type} content]`))
                  .join('\n')
                  .slice(0, 50_000)
                if (result.isError)
                  throw new Error(text.slice(0, 500) || 'The connector reported an error.')
                return { output: text || '(no output)', summary: `${connectorName}: ${tool.name}` }
              }
            })
          }
        )
      state.client = client
      state.status = 'ready'
    } catch (error) {
      state.status = 'error'
      state.error = error instanceof Error ? error.message.slice(0, 300) : 'It could not connect.'
      log.capture('connector', error, { connector: r.name })
    }
    deps.onChange()
  }

  function check(input: ConnectorInput): void {
    if (typeof input.name !== 'string' || !/^[\p{L}\p{N} ._-]{1,40}$/u.test(input.name.trim()))
      throw new ConnectorError('Give the connector a short name.')
    if (input.kind === 'stdio') {
      if (typeof input.command !== 'string' || !input.command.trim())
        throw new ConnectorError('Which program starts the connector?')
      if (
        input.args &&
        (!Array.isArray(input.args) || input.args.some((a) => typeof a !== 'string'))
      )
        throw new ConnectorError('Arguments must be text.')
    } else if (input.kind === 'http') {
      let url: URL
      try {
        url = new URL(String(input.url))
      } catch {
        throw new ConnectorError('That is not an address.')
      }
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
        throw new ConnectorError('A connector address must start with https://')
    } else throw new ConnectorError('A connector is a program or an address.')
  }

  return {
    list: () => rows().map(view),

    add(input) {
      check(input)
      const id = randomUUID()
      db.prepare(
        'insert into connectors (id, name, kind, command, args, url, enabled, created_at) values (?, ?, ?, ?, ?, ?, 1, ?)'
      ).run(
        id,
        input.name.trim(),
        input.kind,
        input.kind === 'stdio' ? input.command!.trim() : null,
        JSON.stringify(input.kind === 'stdio' ? (input.args ?? []) : []),
        input.kind === 'http' ? String(input.url) : null,
        Date.now()
      )
      const row = db.prepare('select * from connectors where id = ?').get(id) as Row
      void connect(row)
      deps.onChange()
      return view(row)
    },

    async remove(id) {
      await disconnect(id)
      db.prepare('delete from connectors where id = ?').run(id)
      deps.onChange()
    },

    async setEnabled(id, enabled) {
      db.prepare('update connectors set enabled = ? where id = ?').run(enabled ? 1 : 0, id)
      const row = db.prepare('select * from connectors where id = ?').get(id) as Row | undefined
      if (!row) throw new ConnectorError('No such connector.')
      if (enabled) void connect(row)
      else await disconnect(id)
      deps.onChange()
      return view(row)
    },

    setSecrets(next) {
      const changed = Object.keys({ ...secrets, ...next }).filter(
        (id) => JSON.stringify(secrets[id] ?? {}) !== JSON.stringify(next[id] ?? {})
      )
      secrets = next
      for (const r of rows()) if (changed.includes(r.id as string)) void connect(r)
    },

    tools() {
      return [...live.values()].flatMap((s) => (s.status === 'ready' ? s.tools : []))
    },

    async connectAll() {
      await Promise.all(rows().map((r) => connect(r)))
    },

    async close() {
      await Promise.all([...live.keys()].map((id) => disconnect(id)))
    }
  }
}
