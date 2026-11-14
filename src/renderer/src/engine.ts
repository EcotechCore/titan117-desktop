// The window's only way to the engine: its local API on 127.0.0.1, with the
// per-install token (architecture §3). The page has no other system access.
import type { EngineEvent } from '../../shared/protocol'

export interface EngineClient {
  get<T>(path: string): Promise<T>
  send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>
  /** Follow the engine's events until `signal` aborts. Rejects when the stream breaks. */
  events(onEvent: (event: EngineEvent) => void, signal: AbortSignal): Promise<void>
}

export class EngineProblem extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'EngineProblem'
  }
}

export async function connect(): Promise<EngineClient> {
  const { url, token } = await window.titan117.engine()
  const auth = { Authorization: `Bearer ${token}` }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: body === undefined ? auth : { ...auth, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const data = (await response.json().catch(() => null)) as
      (T & { error?: string; message?: string }) | null
    if (!response.ok)
      throw new EngineProblem(
        data?.error ?? 'INTERNAL',
        data?.message ?? 'The engine could not do that.'
      )
    return data as T
  }

  return {
    get: (path) => request('GET', path),
    send: (method, path, body) => request(method, path, body ?? {}),

    async events(onEvent, signal) {
      const response = await fetch(`${url}/v1/events`, { headers: auth, signal })
      if (!response.ok || !response.body) throw new EngineProblem('INTERNAL', 'No event stream.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) throw new EngineProblem('INTERNAL', 'The engine closed the stream.')
        buffer += decoder.decode(value, { stream: true })
        let end: number
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          if (!frame.startsWith('data: ')) continue
          try {
            onEvent(JSON.parse(frame.slice(6)) as EngineEvent)
          } catch {
            // A broken frame is skipped; the next state refresh puts things right.
          }
        }
      }
    }
  }
}
