/**
 * Our approvals for the user's own Claude Code (13.14, decisions §20, §55).
 * Claude Code, run unmodified in print mode, sends each permission prompt to
 * an MCP tool named with `--permission-prompt-tool`. This is that tool: a
 * minimal MCP server (streamable HTTP, JSON responses) on 127.0.0.1 with a
 * token per run, answering every prompt with the permission layer's
 * decision. Claude Code's own sign-in is never touched.
 *
 * Contract (Anthropic's docs, checked 20 Nov 2026): the tool returns one
 * text block whose text is JSON, `{"behavior":"allow","updatedInput":…}` or
 * `{"behavior":"deny","message":"…"}`. The call's argument names aren't
 * documented; Claude Code sends `tool_name` and `input` (both spellings
 * accepted here).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'

/** One permission prompt from Claude Code. */
export interface ToolPrompt {
  tool: string
  input: Record<string, unknown>
}

export interface ApprovalServer {
  url: string
  port: number
  /** Register a run; returns its token. `decide` answers each prompt. */
  open(decide: (prompt: ToolPrompt) => Promise<{ allowed: boolean; why?: string }>): string
  close(token: string): void
  stop(): Promise<void>
}

export const APPROVE_TOOL = 'approve'
export const APPROVE_SERVER = 'titan117'

const MAX_BODY = 4_000_000

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** The prompt from a tools/call's arguments (exported for tests). */
export function promptOf(args: Record<string, unknown>): ToolPrompt {
  const tool = String(args.tool_name ?? args.toolName ?? '')
  const raw = args.input ?? args.tool_input ?? {}
  const input =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return { tool, input }
}

export async function startApprovalServer(): Promise<ApprovalServer> {
  const runs = new Map<
    string,
    (prompt: ToolPrompt) => Promise<{ allowed: boolean; why?: string }>
  >()

  function runFor(
    req: IncomingMessage
  ): ((p: ToolPrompt) => Promise<{ allowed: boolean; why?: string }>) | null {
    const header = req.headers.authorization ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    for (const [token, decide] of runs) if (given && same(given, token)) return decide
    return null
  }

  async function answer(
    message: { id?: unknown; method?: string; params?: Record<string, unknown> },
    decide: (p: ToolPrompt) => Promise<{ allowed: boolean; why?: string }>
  ): Promise<unknown | null> {
    const reply = (result: unknown): unknown => ({ jsonrpc: '2.0', id: message.id, result })
    switch (message.method) {
      case 'initialize':
        return reply({
          protocolVersion:
            typeof message.params?.protocolVersion === 'string'
              ? message.params.protocolVersion
              : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'titan117-approvals', version: '1.0.0' }
        })
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({
          tools: [
            {
              name: APPROVE_TOOL,
              description: 'Asks Titan117 whether this tool call may run.',
              inputSchema: {
                type: 'object',
                properties: {
                  tool_name: { type: 'string' },
                  input: { type: 'object' },
                  tool_use_id: { type: 'string' }
                },
                required: ['tool_name', 'input']
              }
            }
          ]
        })
      case 'tools/call': {
        const params = message.params ?? {}
        if (params.name !== APPROVE_TOOL)
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32602, message: 'Unknown tool.' }
          }
        const prompt = promptOf((params.arguments as Record<string, unknown>) ?? {})
        let verdict: { allowed: boolean; why?: string }
        try {
          verdict = await decide(prompt)
        } catch {
          verdict = { allowed: false, why: 'Titan117 couldn’t check this, so it was refused.' }
        }
        const json = verdict.allowed
          ? { behavior: 'allow', updatedInput: prompt.input }
          : { behavior: 'deny', message: `Titan117 refused this: ${verdict.why ?? 'not allowed.'}` }
        return reply({ content: [{ type: 'text', text: JSON.stringify(json) }] })
      }
      default:
        // Notifications (no id) get no answer; unknown requests an error.
        if (message.id === undefined) return null
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Method not found.' }
        }
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.origin) return void res.writeHead(403).end()
    const decide = runFor(req)
    if (!decide) return void res.writeHead(401).end()
    if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST' }).end()
    let parsed: unknown
    try {
      parsed = JSON.parse(await body(req))
    } catch {
      return void res.writeHead(400).end()
    }
    const batch = Array.isArray(parsed) ? parsed : [parsed]
    const replies = (
      await Promise.all(batch.map((m) => answer(m as { id?: unknown; method?: string }, decide)))
    ).filter((r) => r !== null)
    if (!replies.length) return void res.writeHead(202).end()
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]))
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    port,
    open(decide) {
      const token = randomBytes(32).toString('hex')
      runs.set(token, decide)
      return token
    },
    close: (token) => void runs.delete(token),
    stop: () =>
      new Promise<void>((r) => {
        server.closeAllConnections()
        server.close(() => r())
      })
  }
}
