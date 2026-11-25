/**
 * Wires remote control and the chat channels into the shell (decisions §64):
 * the engine client they use, and what the window may ask. Bot tokens go in
 * from the window and never come back out.
 */
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { hostname } from 'node:os'

import { Remote } from './remote'
import { RemoteCommands, type EngineCall } from './remote-commands'
import { Slack } from './slack'
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

export interface RemoteHooks {
  remote: Remote
  telegram: Telegram
  slack: Slack
  /** An engine notification (1.9): a schedule's result also goes to the phone and the chat (decisions §61.5). */
  notice(note: { title: string; body: string; taskId: string }): void
}

export function startRemote(w: RemoteWiring): RemoteHooks {
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
  let slack: Slack | null = null
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
    onRevokedAll: () => {
      telegram?.unlink()
      slack?.unlink()
    },
    onChange: (view) => send('remote:changed', view)
  })
  telegram = new Telegram({
    dataDir: w.dataDir,
    keychain: w.keychain,
    commands,
    remoteOn: () => remote?.view().confirmed === true,
    onChange: (view) => send('telegram:changed', view)
  })
  slack = new Slack({
    dataDir: w.dataDir,
    keychain: w.keychain,
    commands,
    remoteOn: () => remote?.view().confirmed === true,
    onChange: (view) => send('slack:changed', view)
  })
  void remote.start()
  slack.start()
  telegram.start()

  const guard = (event: IpcMainInvokeEvent): void => {
    if (!w.fromOurPage(event)) throw new Error('Refused.')
  }
  const r = remote
  const t = telegram
  const sl = slack
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
  ipcMain.handle('slack:status', (e) => (guard(e), sl.view()))
  ipcMain.handle(
    'slack:connect',
    async (e, app: unknown, bot: unknown) => (guard(e), await sl.connect(app, bot))
  )
  ipcMain.handle('slack:disconnect', (e) => (guard(e), sl.disconnect(), sl.view()))
  ipcMain.handle('slack:link', (e) => (guard(e), sl.startLink(), sl.view()))
  ipcMain.handle('slack:unlink', (e) => (guard(e), sl.unlink(), sl.view()))
  ipcMain.handle('telegram:status', (e) => (guard(e), t.view()))
  ipcMain.handle(
    'telegram:connect',
    async (e, token: unknown) => (guard(e), await t.connect(token))
  )
  ipcMain.handle('telegram:disconnect', (e) => (guard(e), t.disconnect(), t.view()))
  ipcMain.handle('telegram:link', (e) => (guard(e), t.startLink(), t.view()))
  ipcMain.handle('telegram:unlink', (e) => (guard(e), t.unlink(), t.view()))
  const notice = (note: { title: string; body: string; taskId: string }): void => {
    if (!r.view().confirmed) return
    // "Time to post" (15.4): the phone gets the post for its share sheet; the chat, a reminder.
    if (note.taskId === 'view:marketing' && note.title.startsWith('Time to post')) {
      void commands
        .shareable()
        .then((posts) => {
          for (const p of posts)
            r.broadcast(
              {
                type: 'share',
                postId: p.id,
                platform: p.platform,
                text: p.text,
                files: p.files,
                left: p.left
              },
              undefined,
              true
            )
          if (posts.length) {
            t.announce(`${note.title}. Open Titan117 on your phone to share it.`)
            sl.announce(`${note.title}. Open Titan117 on your phone to share it.`)
          }
        })
        .catch(() => undefined)
      return
    }
    if (!r.view().scheduleResults) return
    if (!/ finished$|^A task failed$/.test(note.title) || note.taskId.startsWith('view:')) return
    void commands
      .scheduleOf(note.taskId)
      .then((schedule) => {
        if (!schedule) return
        const text = `${schedule}: ${note.title}
${note.body}`.slice(0, 1000)
        r.broadcast({ type: 'alert', text })
        t.announce(text)
        sl.announce(text)
      })
      .catch(() => undefined)
  }
  ipcMain.handle('remote:setScheduleResults', (e, on: unknown) => {
    guard(e)
    r.setScheduleResults(on === true)
    return r.view()
  })
  return { remote, telegram, slack, notice }
}
