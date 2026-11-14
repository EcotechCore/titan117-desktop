// The preload is kept small (guardrails §6): with the sandbox on it can only
// use `electron`'s contextBridge and ipcRenderer. It gives the page where the
// engine's local API is, and the folder dialog; everything else the page does
// goes through that API.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('titan117', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  engine: () => ipcRenderer.invoke('engine:connection'),
  addFolder: () => ipcRenderer.invoke('folders:add'),
  removeFolder: (path: string) => ipcRenderer.invoke('folders:remove', path),
  onEngineRestart: (listener: () => void) => {
    ipcRenderer.on('engine:restarted', () => listener())
  }
})
