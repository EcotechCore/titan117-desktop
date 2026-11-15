/**
 * Online or offline (features 1.22, 1.24; decisions §17, §47). The engine
 * learns it from its own requests: a request that can't reach the network
 * marks it offline; while offline it asks a small address every 20 seconds;
 * any answer at all, even an error page, means the internet is back. Then
 * whatever waited (error reports, the licence lease) goes.
 */
import type { Fetch } from './net'

export const PROBE_EVERY_MS = 20_000
/** Any answer here means the internet works; no key is sent. */
export const PROBE_URL = 'https://openrouter.ai/api/v1/key'

export const OFFLINE_NOTE =
  'No internet connection. Cloud models, web search and sharing need it; local models, files and tools keep working.'

/** A request that never reached a server: the network, not the server, said no. */
export function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (
    error.name === 'AbortError' ||
    error.name === 'NetworkError' ||
    error.name === 'PermissionError'
  )
    return false
  if (error instanceof TypeError && /fetch failed|network|Failed to fetch/i.test(error.message))
    return true
  const code =
    (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code
  return (
    !!code &&
    /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(
      code
    )
  )
}

export interface Connectivity {
  online(): boolean
  /** A fetch that keeps track: a network failure marks the engine offline. */
  track(fetchFn: Fetch): Fetch
  /** Check now (a window came back to the front, a test). */
  probe(): Promise<boolean>
  close(): void
}

export function createConnectivity(deps: {
  /** The plain network, for the probe. */
  fetch: Fetch
  onChange(online: boolean): void
  every?: number
}): Connectivity {
  let online = true
  let timer: ReturnType<typeof setInterval> | null = null

  function set(next: boolean): void {
    if (next === online) return
    online = next
    if (!online && !timer) {
      timer = setInterval(() => void connectivity.probe(), deps.every ?? PROBE_EVERY_MS)
      timer.unref?.()
    }
    if (online && timer) {
      clearInterval(timer)
      timer = null
    }
    deps.onChange(online)
  }

  const connectivity: Connectivity = {
    online: () => online,

    track(fetchFn) {
      return async (input, init) => {
        try {
          const response = await fetchFn(input, init)
          set(true)
          return response
        } catch (error) {
          if (isNetworkFailure(error)) set(false)
          throw error
        }
      }
    },

    async probe() {
      try {
        await deps.fetch(PROBE_URL, { method: 'GET', signal: AbortSignal.timeout(8000) })
        set(true)
      } catch (error) {
        if (isNetworkFailure(error) || (error as Error).name === 'TimeoutError') set(false)
      }
      return online
    },

    close() {
      if (timer) clearInterval(timer)
      timer = null
    }
  }
  return connectivity
}
