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
  },
  keys: {
    saved: () => ipcRenderer.invoke('keys:saved'),
    save: (provider: string, key: string) => ipcRenderer.invoke('keys:save', provider, key),
    remove: (provider: string) => ipcRenderer.invoke('keys:remove', provider)
  },
  connectors: {
    setSecrets: (id: string, secrets: Record<string, string>) =>
      ipcRenderer.invoke('connectors:setSecrets', id, secrets),
    removeSecrets: (id: string) => ipcRenderer.invoke('connectors:removeSecrets', id)
  },
  artifacts: {
    stage: (html: string) => ipcRenderer.invoke('artifacts:stage', html),
    pdf: (html: string, name: string, pageSize: 'A4' | 'Letter') =>
      ipcRenderer.invoke('artifacts:pdf', html, name, pageSize),
    png: (html: string, name: string) => ipcRenderer.invoke('artifacts:png', html, name),
    save: (name: string, base64: string) => ipcRenderer.invoke('artifacts:save', name, base64)
  },
  account: {
    status: () => ipcRenderer.invoke('account:status'),
    signIn: () => ipcRenderer.invoke('account:signIn'),
    cancelSignIn: () => ipcRenderer.invoke('account:cancelSignIn'),
    refresh: () => ipcRenderer.invoke('account:refresh'),
    signOut: () => ipcRenderer.invoke('account:signOut'),
    openPage: () => ipcRenderer.invoke('account:openPage'),
    onChange: (listener: (view: unknown) => void) => {
      ipcRenderer.on('account:changed', (_event, view) => listener(view))
    }
  }
})
