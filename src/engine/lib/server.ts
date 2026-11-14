/**
 * The local API server (guardrails §6): listens on 127.0.0.1 only, needs the
 * per-install token on every request, and refuses requests from web pages
 * (any origin but the app's own window).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import type { ApiErrorCode, EngineEvent } from '../../shared/protocol'
import type { ApiRequest, ApiResponse } from '../api'

const MAX_BODY_BYTES = 1_000_000

/** The per-install token: made once, kept in the app's data folder. */
export function installToken(dataDir: string): string {
  const file = join(dataDir, 'local-api-token')
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(saved)) return saved
  }
  mkdirSync(dataDir, { recursive: true })
  const token = randomBytes(32).toString('hex')
  writeFileSync(file, token, { mode: 0o600 })
  return token
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface LocalServer {
  port: number
  publish(event: EngineEvent): void
  close(): Promise<void>
}

export async function startServer(options: {
  token: string
  /** The window's own origins. A request with any other Origin is refused. */
  allowedOrigins: string[]
  handle(request: ApiRequest): Promise<ApiResponse>
  port?: number
}): Promise<LocalServer> {
  const { token, handle } = options
  const allowed = new Set(options.allowedOrigins)
  const streams = new Set<ServerResponse>()

  function cors(origin: string | undefined): Record<string, string> {
    return origin && allowed.has(origin)
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          Vary: 'Origin'
        }
      : {}
  }

  function send(
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string>
  ): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    })
    res.end(JSON.stringify(body))
  }

  function refuse(
    res: ServerResponse,
    status: number,
    error: ApiErrorCode,
    headers: Record<string, string>
  ): void {
    send(res, status, { error }, headers)
  }

  async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY_BYTES) throw new Error('too large')
      chunks.push(chunk as Buffer)
    }
    if (size === 0) return null
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const origin = req.headers.origin
      const headers = cors(origin)

      // Requests from web pages carry an Origin. Only the app's own window may call.
      if (origin !== undefined && !allowed.has(origin))
        return refuse(res, 403, 'FORBIDDEN_ORIGIN', {})
      // A rebound DNS name pointing at 127.0.0.1 is refused too.
      const host = (req.headers.host ?? '').replace(/:\d+$/, '')
      if (host !== '127.0.0.1' && host !== 'localhost')
        return refuse(res, 403, 'FORBIDDEN_ORIGIN', {})

      if (req.method === 'OPTIONS') {
        res.writeHead(204, headers)
        return res.end()
      }

      const auth = req.headers.authorization ?? ''
      if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7), token))
        return refuse(res, 401, 'UNAUTHENTICATED', headers)

      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname

      if (req.method === 'GET' && path === '/v1/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          ...headers
        })
        res.write(': connected\n\n')
        streams.add(res)
        req.on('close', () => streams.delete(res))
        return
      }

      let body: unknown
      try {
        body = await readBody(req)
      } catch {
        return refuse(res, 400, 'BAD_REQUEST', headers)
      }
      const response = await handle({ method: req.method ?? 'GET', path, body })
      send(res, response.status, response.body, headers)
    })().catch(() => {
      if (!res.headersSent) refuse(res, 500, 'INTERNAL', {})
      else res.end()
    })
  })

  // 127.0.0.1 only: never reachable from the network.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })

  const beat = setInterval(() => {
    for (const stream of streams) stream.write(': beat\n\n')
  }, 25_000)
  beat.unref()

  return {
    port: (server.address() as AddressInfo).port,
    publish(event) {
      const frame = `data: ${JSON.stringify(event)}\n\n`
      for (const stream of streams) stream.write(frame)
    },
    close() {
      clearInterval(beat)
      for (const stream of streams) stream.end()
      return new Promise((resolve) => server.close(() => resolve()))
    }
  }
}
