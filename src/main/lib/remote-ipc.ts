/**
 * Wires remote control and the chat channels into the shell (decisions §64):
 * the engine client they use, and what the window may ask. Bot tokens go in
 * from the window and never come back out.
 */
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { hostname } from 'node:os'

import { Remote } from './remote'
import { RemoteCommands, type EngineCall } from './remote-commands'
import { Telegram } from './telegram'

export interface RemoteWiring {
  dataDir: string
  keychain: { encrypt(text: string): Buffer; decrypt(data: Buffer): string } | null
  engine(): Promise<{ url: string; token: string }>
  apiUrl(): string | null
  webUrl(): string | null
  deviceToken(): string | null
  deviceId(): string | null
  openExternal(url: string): Promise<void>
  /** A quiet notification on the laptop, even with the window in front. */
  notify(title: string, body: string): void
  fromOurPage(event: IpcMainInvokeEvent): boolean
}

export function startRemote(w: RemoteWiring): { remote: Remote; telegram: Telegram } {
  const engine: EngineCall = async <T>(method: 'GET' | 'POST', path: string, body?: unknown) => {
    const { url, token } = await w.engine()
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const data = (await res.json().catch(() => null)) as { message?: string } | null
    if (!res.ok) throw new Error(data?.message ?? 'The laptop couldn’t do that.')
    return data as T
  }

  const send = (channel: string, value: unknown): void => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, value)
  }

  let remote: Remote | null = null
  let telegram: Telegram | null = null
  const commands = new RemoteCommands({
    engine,
    inboxFolder: () => remote?.inboxFolder() ?? null,
    notify: w.notify,
    alertOthers: (text, except) => {
      remote?.broadcast({ type: 'alert', text }, except)
    }
  })
  remote = new Remote({
    dataDir: w.dataDir,
    laptopName: hostname().slice(0, 60) || 'Laptop',
    keychain: w.keychain,
    apiUrl: w.apiUrl,
    webUrl: w.webUrl,
    deviceToken: w.deviceToken,
    deviceId: w.deviceId,
    openExternal: w.openExternal,
    commands,
    notify: w.notify,
    onRevokedAll: () => telegram?.unlink(),
    onChange: (view) => send('remote:changed', view)
  })
  telegram = new Telegram({
    dataDir: w.dataDir,
    keychain: w.keychain,
    commands,
    remoteOn: () => remote?.view().confirmed === true,
    onChange: (view) => send('telegram:changed', view)
  })
  void remote.start()
  telegram.start()

  const guard = (event: IpcMainInvokeEvent): void => {
    if (!w.fromOurPage(event)) throw new Error('Refused.')
  }
  const r = remote
  const t = telegram
  ipcMain.handle('remote:status', (e) => (guard(e), r.view()))
  ipcMain.handle('remote:switchOn', async (e) => (guard(e), await r.switchOn(), r.view()))
  ipcMain.handle('remote:switchOff', (e) => (guard(e), r.switchOff(), r.view()))
  ipcMain.handle('remote:pair', (e) => (guard(e), r.startPairing(), r.view()))
  ipcMain.handle('remote:answerPairing', (e, id: unknown, accept: unknown) => {
    guard(e)
    if (typeof id === 'string') r.answerPairing(id, accept === true)
    return r.view()
  })
  ipcMain.handle('remote:remove', (e, key: unknown) => {
    guard(e)
    if (typeof key === 'string') r.removeDevice(key)
    return r.view()
  })
  ipcMain.handle('remote:revokeAll', (e) => (guard(e), r.revokeAllDevices(), r.view()))
  ipcMain.handle('remote:setInbox', (e, folder: unknown) => {
    guard(e)
    r.setInboxFolder(typeof folder === 'string' && folder ? folder : null)
    return r.view()
  })
  ipcMain.handle('telegram:status', (e) => (guard(e), t.view()))
  ipcMain.handle(
    'telegram:connect',
    async (e, token: unknown) => (guard(e), await t.connect(token))
  )
  ipcMain.handle('telegram:disconnect', (e) => (guard(e), t.disconnect(), t.view()))
  ipcMain.handle('telegram:link', (e) => (guard(e), t.startLink(), t.view()))
  ipcMain.handle('telegram:unlink', (e) => (guard(e), t.unlink(), t.view()))
  return { remote, telegram }
}
