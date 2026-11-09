// The preload is kept small (guardrails §6): with the sandbox on it can only
// use `electron`'s contextBridge, and it will expose nothing but a client for
// the engine's local API (phase 1). For now: the versions the window shows.
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('titan117', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
})
