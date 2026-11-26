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
  github: {
    status: () => ipcRenderer.invoke('github:status'),
    signIn: () => ipcRenderer.invoke('github:signIn'),
    cancel: () => ipcRenderer.invoke('github:cancel'),
    signOut: () => ipcRenderer.invoke('github:signOut'),
    install: () => ipcRenderer.invoke('github:install'),
    onChange: (listener: () => void) => {
      ipcRenderer.on('github:changed', () => listener())
    }
  },
  code: {
    editors: () => ipcRenderer.invoke('code:editors'),
    open: (folder: string, editor: string) => ipcRenderer.invoke('code:open', folder, editor)
  },
  /** Show a file in the system's file manager: only one inside the allowed folders. */
  files: {
    reveal: (path: string) => ipcRenderer.invoke('files:reveal', path)
  },
  onEngineRestart: (listener: () => void) => {
    ipcRenderer.on('engine:restarted', () => listener())
  },
  updates: {
    state: () => ipcRenderer.invoke('update:state'),
    install: () => ipcRenderer.invoke('update:install'),
    onChange: (listener: (state: unknown) => void) => {
      ipcRenderer.on('update:state', (_event, state) => listener(state))
    }
  },
  /** A notification was clicked (1.9): open that task. */
  onOpenTask: (listener: (taskId: string) => void) => {
    ipcRenderer.on('task:open', (_event, taskId: string) => listener(String(taskId)))
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
  /** Saved site logins for recordings (8.5): a password goes in and never comes back. */
  logins: {
    saved: () => ipcRenderer.invoke('logins:saved'),
    save: (site: string, username: string, password: string) =>
      ipcRenderer.invoke('logins:save', site, username, password),
    remove: (site: string) => ipcRenderer.invoke('logins:remove', site)
  },
  artifacts: {
    stage: (html: string) => ipcRenderer.invoke('artifacts:stage', html),
    pdf: (html: string, name: string, pageSize: 'A4' | 'Letter') =>
      ipcRenderer.invoke('artifacts:pdf', html, name, pageSize),
    png: (html: string, name: string) => ipcRenderer.invoke('artifacts:png', html, name),
    save: (name: string, base64: string) => ipcRenderer.invoke('artifacts:save', name, base64)
  },
  remote: {
    status: () => ipcRenderer.invoke('remote:status'),
    switchOn: () => ipcRenderer.invoke('remote:switchOn'),
    switchOff: () => ipcRenderer.invoke('remote:switchOff'),
    pair: () => ipcRenderer.invoke('remote:pair'),
    answerPairing: (pairingId: string, accept: boolean) =>
      ipcRenderer.invoke('remote:answerPairing', pairingId, accept),
    remove: (publicKey: string) => ipcRenderer.invoke('remote:remove', publicKey),
    revokeAll: () => ipcRenderer.invoke('remote:revokeAll'),
    setInbox: (folder: string | null) => ipcRenderer.invoke('remote:setInbox', folder),
    setScheduleResults: (on: boolean) => ipcRenderer.invoke('remote:setScheduleResults', on),
    secondFactor: (next?: string[]) => ipcRenderer.invoke('remote:secondFactor', next),
    onChange: (listener: (view: unknown) => void) => {
      ipcRenderer.on('remote:changed', (_event, view) => listener(view))
    }
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    switchOn: () => ipcRenderer.invoke('sync:switchOn'),
    switchOff: () => ipcRenderer.invoke('sync:switchOff'),
    allow: (id: string) => ipcRenderer.invoke('sync:allow', id),
    refuse: (id: string) => ipcRenderer.invoke('sync:refuse', id),
    remove: (id: string) => ipcRenderer.invoke('sync:remove', id),
    confirm: (accept: boolean) => ipcRenderer.invoke('sync:confirm', accept),
    onChange: (listener: (view: unknown) => void) => {
      ipcRenderer.on('sync:changed', (_event, view) => listener(view))
    }
  },
  slack: {
    status: () => ipcRenderer.invoke('slack:status'),
    connect: (app: string, bot: string) => ipcRenderer.invoke('slack:connect', app, bot),
    disconnect: () => ipcRenderer.invoke('slack:disconnect'),
    link: () => ipcRenderer.invoke('slack:link'),
    unlink: () => ipcRenderer.invoke('slack:unlink'),
    onChange: (listener: (view: unknown) => void) => {
      ipcRenderer.on('slack:changed', (_event, view) => listener(view))
    }
  },
  telegram: {
    status: () => ipcRenderer.invoke('telegram:status'),
    connect: (token: string) => ipcRenderer.invoke('telegram:connect', token),
    disconnect: () => ipcRenderer.invoke('telegram:disconnect'),
    link: () => ipcRenderer.invoke('telegram:link'),
    unlink: () => ipcRenderer.invoke('telegram:unlink'),
    onChange: (listener: (view: unknown) => void) => {
      ipcRenderer.on('telegram:changed', (_event, view) => listener(view))
    }
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
