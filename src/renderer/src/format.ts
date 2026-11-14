// How sizes, costs, times and model names are written in the window.
import { CLOUD_MODEL_PREFIX, LOCAL_MODEL_PREFIX, type EngineState } from '../../shared/protocol'

export function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.round(n / 1024)} KB`
}

export function usd(n: number): string {
  if (n === 0) return 'free'
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function modelName(id: string | null, engine: EngineState | null): string {
  if (!id) return 'Choose a model'
  if (id.startsWith(LOCAL_MODEL_PREFIX)) {
    const local = engine?.localModels.find((m) => LOCAL_MODEL_PREFIX + m.id === id)
    return local ? `${local.name} · local` : 'Local model'
  }
  return id.slice(CLOUD_MODEL_PREFIX.length)
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
