import {
  app,
  shell,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  net,
  Notification,
  powerSaveBlocker,
  protocol,
  safeStorage,
  session,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess
} from 'electron'
import { join, normalize, sep } from 'path'
import { allowedFolder, findEditors, openInEditor } from './lib/editors'
import { GitHubSignIn } from './lib/github'
import {
  SANDBOX_HOST,
  Staged,
  isLocalPreviewNavigation,
  isSandboxUrl,
  safeName,
  writeChosenFile
} from './lib/export'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Account, type AccountView } from './lib/account'
import { startUpdates, type UpdateState } from './lib/updates'
import { isSidebarNavigation, sidebarAppOf, sidebarResponse } from './lib/sidebar-files'
import { Keys } from './lib/keys'
import { ConnectorSecrets } from './lib/connector-secrets'
import { SiteLogins } from './lib/site-logins'
import { startRemote, type RemoteHooks } from './lib/remote-ipc'
import {
  APP_ORIGIN,
  APP_SCHEME,
  allowPermission,
  isAllowedNavigation,
  isSafeExternalUrl,
  printWebPreferences,
  windowWebPreferences
} from './window'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererDir = join(__dirname, '../renderer')

// In production the window's page is served from our own scheme, so it has a
// real origin the local API can check (guardrails §6).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    // CORS: a sidebar app's frame is sandboxed (an opaque origin) and loads its own module scripts.
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

// App crashes are caught and kept on the laptop (feature 19.1). Nothing is
// sent anywhere: error reports the user reviews first arrive in phase 5.
crashReporter.start({ uploadToServer: false })

// ---------------------------------------------------------------- the engine

interface Connection {
  url: string
  token: string
}

let engine: UtilityProcess | null = null
let connection: Promise<Connection> | null = null
let quitting = false
let remoteHooks: RemoteHooks | null = null
let restarts = 0
/** The exit code of an engine that stopped unexpectedly, until the next one has heard it. */
let crashed: number | null = null

/**
 * From source only: the repo's local .env (a development OpenRouter key and
 * the development web app and Convex addresses). A packaged app never reads it.
 */
function loadDevelopmentEnv(): void {
  if (!is.dev) return
  try {
    process.loadEnvFile(join(app.getAppPath(), '.env'))
  } catch {
    // No .env: cloud models need a sign-in, local models work.
  }
}

function developmentKey(): string {
  return is.dev ? (process.env['OPENROUTER_API_KEY'] ?? '') : ''
}

// ---------------------------------------------------------------- the account

/**
 * Where the app signs in (decisions §39). From source, the local .env names
 * the development web app and Convex deployment; a packaged build uses the
 * production addresses, set before the first external testers (phase 18).
 */
const PRODUCTION = {
  webUrl: 'https://titan117.com',
  apiUrl: null as string | null,
  // Where signed releases are published (feature 1.10); set with code signing (decisions §50).
  updateUrl: null as string | null,
  // Our GitHub App, "Titan117 by EcotechCore" (decisions §25, §55; registered 21 Nov 2026).
  // The client ID isn't a secret: the device flow needs no secret at all.
  githubClientId: 'Iv23liPxzFyagnONr6mT' as string | null,
  githubAppUrl: 'https://github.com/apps/titan117-by-ecotechcore'
}

/** The GitHub App's client ID: the same app in development, unless `.env` names another. */
function githubClientId(): string | null {
  return (is.dev && process.env['TITAN117_GITHUB_CLIENT_ID']) || PRODUCTION.githubClientId
}

function accountConfig(): { webUrl: string | null; apiUrl: string | null } {
  if (!is.dev) return PRODUCTION
  return {
    webUrl: process.env['TITAN117_WEB_URL'] || null,
    apiUrl: process.env['TITAN117_API_URL'] || null
  }
}

let account: Account | null = null
let keys: Keys | null = null
let connectorSecrets: ConnectorSecrets | null = null
let siteLogins: SiteLogins | null = null
let github: GitHubSignIn | null = null

function keychain(): { encrypt(text: string): Buffer; decrypt(data: Buffer): string } | null {
  return safeStorage.isEncryptionAvailable()
    ? {
        encrypt: (text) => safeStorage.encryptString(text),
        decrypt: (data) => safeStorage.decryptString(data)
      }
    : null
}

/** The GitHub sign-in's current access token goes to the engine only (decisions §25). */
async function pushGitHub(): Promise<void> {
  if (!github) return
  engine?.postMessage({ type: 'github', token: await github.token() })
}

/** The user's own API keys go to the engine only (features 2.9, 11.5). */
function pushKeys(): void {
  if (keys) engine?.postMessage({ type: 'keys', keys: keys.all() })
  // Connector tokens too (feature 3.6): to the engine only.
  if (connectorSecrets)
    engine?.postMessage({ type: 'connectorSecrets', secrets: connectorSecrets.all() })
  // Saved site logins for recordings (8.5): to the engine only.
  if (siteLogins) engine?.postMessage({ type: 'logins', logins: siteLogins.all() })
}
/** How often a running app asks for a fresh lease, so an ended plan locks soon after (decisions §17). */
const RENEW_EVERY_MS = 30 * 60 * 1000
/** Also when the window comes back into focus, at most this often. */
const RENEW_ON_FOCUS_MS = 5 * 60 * 1000
let lastRenew = 0

function renewLease(): void {
  lastRenew = Date.now()
  void account?.refresh()
}

const LOCK_TEXT: Record<string, string> = {
  signedOut: 'Sign in to keep using Titan117.',
  noPlan: 'Choose a plan on your account page to keep using Titan117.',
  expired: 'Connect to the internet to keep using Titan117.'
}

/** What the window sees. From source with no account set up, nothing locks (development only). */
function accountView(): AccountView & { enforced: boolean } {
  const view = account!.status()
  const enforced = view.configured || !is.dev
  return { ...view, locked: enforced && view.locked, enforced }
}

/** Tells the engine and the window where things stand. */
function pushAccount(): void {
  if (!account) return
  const view = accountView()
  const { webUrl } = accountConfig()
  const token = account.deviceToken()
  engine?.postMessage({
    type: 'account',
    account: {
      token,
      proxyUrl: token && webUrl ? new URL('/api/v1', webUrl).toString() : null,
      locked: view.locked,
      reason: view.locked && view.reason ? LOCK_TEXT[view.reason] : null
    }
  })
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('account:changed', view)
}

function startAccount(): void {
  const config = accountConfig()
  account = new Account({
    dataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    webUrl: config.webUrl,
    apiUrl: config.apiUrl,
    openExternal: (url) => shell.openExternal(url),
    keychain: keychain(),
    onChange: () => pushAccount()
  })
  keys = new Keys(app.getPath('userData'), keychain())
  connectorSecrets = new ConnectorSecrets(app.getPath('userData'), keychain())
  siteLogins = new SiteLogins(app.getPath('userData'), keychain())
  github = new GitHubSignIn(app.getPath('userData'), keychain(), githubClientId(), fetch, () => {
    void pushGitHub()
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('github:changed')
  })
  // The access token lasts 8 hours: refresh well before, and keep the engine's copy current.
  setInterval(() => void pushGitHub(), 30 * 60_000).unref()
  renewLease()
  setInterval(renewLease, RENEW_EVERY_MS)
  // The lease can run out while the app is open: look again every minute.
  let last = ''
  setInterval(() => {
    const now = JSON.stringify(accountView())
    if (now !== last) pushAccount()
    last = now
  }, 60_000)
}

function startEngine(): void {
  const child = utilityProcess.fork(join(__dirname, 'engine.js'), [], {
    serviceName: 'Titan117 engine',
    env: {
      ...process.env,
      OPENROUTER_API_KEY: developmentKey(),
      TITAN117_DATA_DIR: app.getPath('userData'),
      TITAN117_APP_DIR: is.dev ? join(app.getAppPath(), 'out') : dirnameOfInstall(),
      TITAN117_VERSION: app.getVersion(),
      TITAN117_ORIGINS: JSON.stringify([devServerUrl ? new URL(devServerUrl).origin : APP_ORIGIN])
    }
  })
  engine = child
  connection = new Promise<Connection>((resolve, reject) => {
    child.once('message', (message: { type: string; port: number; token: string }) => {
      if (message.type === 'ready') {
        resolve({ url: `http://127.0.0.1:${message.port}`, token: message.token })
        // A new or restarted engine starts locked until it hears where the account stands.
        pushAccount()
        pushKeys()
        void pushGitHub()
        // The engine before this one crashed: the new one keeps it as an error to report (19.1).
        if (crashed !== null) {
          child.postMessage({ type: 'crashed', code: crashed })
          crashed = null
        }
      }
    })
    child.once('exit', () => reject(new Error('The engine stopped before it was ready.')))
  })
  connection.catch(() => undefined)
  // The engine is back online (1.24): renew the lease now rather than in up to 30 minutes.
  child.on(
    'message',
    (message: {
      type?: string
      running?: number
      note?: { title: string; body: string; taskId: string }
    }) => {
      if (message?.type === 'online') renewLease()
      else if (message?.type === 'busy') keepAwake((message.running ?? 0) > 0)
      else if (message?.type === 'notify' && message.note) {
        notify(message.note)
        remoteHooks?.notice(message.note)
      }
    }
  )

  child.once('exit', (code) => {
    if (engine === child) engine = null
    if (quitting) return
    crashed = code
    // The engine crashed: start it again (a few times), and tell the window.
    if (restarts++ < 3) {
      startEngine()
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('engine:restarted')
    }
  })
}

// ---------------------------------------------------------------- awake and notifications

let awakeBlocker: number | null = null

/** While a task runs the laptop doesn't go to sleep on its own (1.5); the screen still may. */
function keepAwake(busy: boolean): void {
  if (busy && awakeBlocker === null) awakeBlocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!busy && awakeBlocker !== null) {
    powerSaveBlocker.stop(awakeBlocker)
    awakeBlocker = null
  }
}

/** Remote alerts (decisions §64.8): quiet, shown even when the window is in front. */
function quietNotice(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title: title.slice(0, 80), body: body.slice(0, 200), silent: true }).show()
}

/** Done, failed, paused or needs approval (1.9): only when the window isn't in front. */
function notify(note: { title: string; body: string; taskId: string }): void {
  const [window] = BrowserWindow.getAllWindows()
  if (window?.isFocused() || !Notification.isSupported()) return
  const shown = new Notification({
    title: note.title.slice(0, 80),
    body: note.body.slice(0, 200),
    silent: false
  })
  shown.on('click', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send('task:open', note.taskId)
  })
  shown.show()
}

function dirnameOfInstall(): string {
  return join(app.getPath('exe'), '..')
}

/** Only the app's own page may use the bridge. */
function fromOurPage(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  return isAllowedNavigation(url, devServerUrl)
}

// ---------------------------------------------------------------- artifacts

const staged = new Staged()

/** Prints a page in a hidden window with no network and no Node (decisions §44). */
async function printPage<T>(html: string, work: (window: BrowserWindow) => Promise<T>): Promise<T> {
  const id = staged.put(html)
  const ses = session.fromPartition('artifact-print')
  if (!ses.protocol.isProtocolHandled(APP_SCHEME))
    ses.protocol.handle(APP_SCHEME, (request) => {
      const url = new URL(request.url)
      return url.host === SANDBOX_HOST
        ? staged.respond(url.pathname)
        : new Response(null, { status: 404 })
    })
  // Nothing an artifact asks for leaves the laptop.
  ses.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !/^(titan117:|data:|blob:|about:)/.test(details.url) })
  )
  ses.setPermissionRequestHandler((_c, _p, callback) => callback(false))
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1300,
    webPreferences: printWebPreferences(ses)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    await window.loadURL(`${APP_SCHEME}://${SANDBOX_HOST}/${id}`)
    // Charts and diagrams are drawn by then; give scripts in small tools a moment.
    await new Promise((r) => setTimeout(r, 400))
    return await work(window)
  } finally {
    window.destroy()
  }
}

async function saveAs(
  event: IpcMainInvokeEvent,
  name: string,
  data: Buffer
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender)
  const options = {
    title: 'Save',
    defaultPath: join(app.getPath('documents'), name),
    buttonLabel: 'Save'
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  await writeChosenFile(result.filePath, data)
  return result.filePath
}

// ---------------------------------------------------------------- updates

let updates: ReturnType<typeof startUpdates> | null = null

function registerUpdates(): void {
  updates = startUpdates({
    packaged: app.isPackaged,
    url: is.dev ? process.env['TITAN117_UPDATE_URL'] || null : PRODUCTION.updateUrl,
    onChange: (state: UpdateState) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('update:state', state)
    }
  })
  ipcMain.handle('update:state', (event) => {
    if (!fromOurPage(event)) throw new Error('Refused.')
    return updates?.state() ?? { state: 'off', why: 'Not started.' }
  })
  // Only when the user presses it; the window asks first if a task is running.
  ipcMain.handle('update:install', (event) => {
    if (!fromOurPage(event)) throw new Error('Refused.')
    updates?.install()
    return true
  })
}

function registerArtifacts(): void {
  // The window hands over a page to show in its sandboxed frame.
  ipcMain.handle('artifacts:stage', async (event, html: unknown) => {
    if (!fromOurPage(event)) throw new Error('Refused.')
    return `${APP_SCHEME}://${SANDBOX_HOST}/${staged.put(html)}`
  })

  ipcMain.handle(
    'artifacts:pdf',
    async (event, html: unknown, name: unknown, pageSize: unknown) => {
      if (!fromOurPage(event) || typeof html !== 'string') throw new Error('Refused.')
      const pdf = await printPage(html, (window) =>
        window.webContents.printToPDF({
          pageSize: pageSize === 'Letter' ? 'Letter' : 'A4',
          printBackground: true
        })
      )
      return saveAs(event, safeName(name, 'Artifact.pdf'), pdf)
    }
  )

  ipcMain.handle('artifacts:png', async (event, html: unknown, name: unknown) => {
    if (!fromOurPage(event) || typeof html !== 'string') throw new Error('Refused.')
    const png = await printPage(html, async (window) => {
      const height = Number(
        await window.webContents.executeJavaScript(
          'Math.min(12000, document.documentElement.scrollHeight)',
          true
        )
      )
      window.setContentSize(1000, Math.max(300, height || 1300))
      await new Promise((r) => setTimeout(r, 150))
      return (await window.webContents.capturePage()).toPNG()
    })
    return saveAs(event, safeName(name, 'Artifact.png'), png)
  })

  // A file the engine converted (Word, Excel, PowerPoint, Markdown, ...).
  ipcMain.handle('artifacts:save', async (event, name: unknown, base64: unknown) => {
    if (!fromOurPage(event) || typeof base64 !== 'string') throw new Error('Refused.')
    return saveAs(event, safeName(name, 'Artifact'), Buffer.from(base64, 'base64'))
  })
}

function registerBridge(): void {
  ipcMain.handle('engine:connection', async (event) => {
    if (!fromOurPage(event)) throw new Error('Refused.')
    if (!connection) throw new Error('The engine is not running.')
    return connection
  })

  // The allowed folders change only here, through a dialog the user answers:
  // the local API has no route for it, so no page or agent can widen access.
  ipcMain.handle('folders:add', async (event) => {
    if (!fromOurPage(event)) throw new Error('Refused.')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a folder Titan may work in',
      buttonLabel: 'Allow this folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return false
    engine?.postMessage({ type: 'addFolder', path: result.filePaths[0] })
    return true
  })

  ipcMain.handle('account:status', async (event) => {
    if (!fromOurPage(event) || !account) throw new Error('Refused.')
    return accountView()
  })

  ipcMain.handle('account:signIn', async (event) => {
    if (!fromOurPage(event) || !account) throw new Error('Refused.')
    await account.signIn()
    return accountView()
  })

  ipcMain.handle('account:cancelSignIn', async (event) => {
    if (!fromOurPage(event) || !account) throw new Error('Refused.')
    account.cancelSignIn()
    return true
  })

  ipcMain.handle('account:refresh', async (event) => {
    if (!fromOurPage(event) || !account) throw new Error('Refused.')
    await account.refresh()
    return accountView()
  })

  ipcMain.handle('account:signOut', async (event) => {
    if (!fromOurPage(event) || !account) throw new Error('Refused.')
    account.signOut()
    return accountView()
  })

  // Our own account page in the system browser; nothing else can be opened this way.
  ipcMain.handle('account:openPage', async (event) => {
    if (!fromOurPage(event)) throw new Error('Refused.')
    const { webUrl } = accountConfig()
    if (webUrl) await shell.openExternal(new URL('/account', webUrl).toString())
    return true
  })

  // Keys go in from the window and never come back out: only which ones are saved.
  ipcMain.handle('keys:saved', async (event) => {
    if (!fromOurPage(event) || !keys) throw new Error('Refused.')
    return keys.saved()
  })

  ipcMain.handle('keys:save', async (event, provider: unknown, key: unknown) => {
    if (!fromOurPage(event) || !keys) throw new Error('Refused.')
    const result = await keys.save(provider, key)
    if (result.ok) pushKeys()
    return result
  })

  ipcMain.handle('keys:remove', async (event, provider: unknown) => {
    if (!fromOurPage(event) || !keys) throw new Error('Refused.')
    const removed = keys.remove(provider)
    pushKeys()
    return removed
  })

  // Connector secrets go in from the window and never come back out.
  ipcMain.handle('connectors:setSecrets', async (event, id: unknown, secrets: unknown) => {
    if (!fromOurPage(event) || !connectorSecrets) throw new Error('Refused.')
    const result = connectorSecrets.set(id, secrets)
    if (result.ok) pushKeys()
    return result
  })

  ipcMain.handle('connectors:removeSecrets', async (event, id: unknown) => {
    if (!fromOurPage(event) || !connectorSecrets) throw new Error('Refused.')
    connectorSecrets.remove(id)
    pushKeys()
    return true
  })

  // Site logins for recordings go in from the window; a password never comes back out.
  ipcMain.handle('logins:saved', async (event) => {
    if (!fromOurPage(event) || !siteLogins) throw new Error('Refused.')
    return siteLogins.saved()
  })

  ipcMain.handle(
    'logins:save',
    async (event, site: unknown, username: unknown, password: unknown) => {
      if (!fromOurPage(event) || !siteLogins) throw new Error('Refused.')
      const result = siteLogins.set(site, username, password)
      if (result.ok) pushKeys()
      return result
    }
  )

  ipcMain.handle('logins:remove', async (event, site: unknown) => {
    if (!fromOurPage(event) || !siteLogins) throw new Error('Refused.')
    const removed = siteLogins.remove(site)
    pushKeys()
    return removed
  })

  ipcMain.handle('folders:remove', async (event, path: unknown) => {
    if (!fromOurPage(event) || typeof path !== 'string') throw new Error('Refused.')
    engine?.postMessage({ type: 'removeFolder', path })
    return true
  })

  // Sign in with GitHub (decisions §25, §55): GitHub's own page, our app's device flow.
  ipcMain.handle('github:status', async (event) => {
    if (!fromOurPage(event) || !github) throw new Error('Refused.')
    if (github.status().signedIn) await github.checkRepositories()
    return github.status()
  })
  ipcMain.handle('github:signIn', async (event) => {
    if (!fromOurPage(event) || !github) throw new Error('Refused.')
    const code = await github.start()
    await shell.openExternal(code.verificationUri)
    return github.status()
  })
  ipcMain.handle('github:cancel', (event) => {
    if (!fromOurPage(event) || !github) throw new Error('Refused.')
    github.cancel()
    return github.status()
  })
  // Choosing the repositories Titan may use happens on GitHub's own page for the app.
  ipcMain.handle('github:install', async (event) => {
    if (!fromOurPage(event)) throw new Error('Refused.')
    await shell.openExternal(`${PRODUCTION.githubAppUrl}/installations/new`)
    return true
  })
  ipcMain.handle('github:signOut', (event) => {
    if (!fromOurPage(event) || !github) throw new Error('Refused.')
    github.signOut()
    return github.status()
  })

  // Open a project in the user's editor (13.12): only folders the user allowed.
  ipcMain.handle('code:editors', async (event) => {
    if (!fromOurPage(event)) throw new Error('Refused.')
    return (await findEditors()).map(({ id, name }) => ({ id, name }))
  })

  // A post's media, shown in its folder so the user can attach it (15.4): only inside the allowed folders.
  ipcMain.handle('files:reveal', async (event, path: unknown) => {
    if (!fromOurPage(event) || typeof path !== 'string') throw new Error('Refused.')
    if (!connection) throw new Error('The engine is not running.')
    const { url, token } = await connection
    const state = (await (
      await fetch(`${url}/v1/state`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as { folders?: string[] }
    const real = allowedFolder(path, state.folders ?? [])
    if (!real) throw new Error('That file isn’t in a folder you allowed.')
    shell.showItemInFolder(real)
    return true
  })

  ipcMain.handle('code:open', async (event, folder: unknown, editorId: unknown) => {
    if (!fromOurPage(event) || typeof folder !== 'string' || typeof editorId !== 'string')
      throw new Error('Refused.')
    if (!connection) throw new Error('The engine is not running.')
    const { url, token } = await connection
    const state = (await (
      await fetch(`${url}/v1/state`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as { folders?: string[] }
    const real = allowedFolder(folder, state.folders ?? [])
    if (!real) throw new Error('That folder isn’t one you allowed.')
    const editor = (await findEditors()).find((e) => e.id === editorId)
    if (editor) openInEditor(editor, real)
    else await shell.openPath(real)
    return true
  })
}

// ---------------------------------------------------------------- the window

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Titan117',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: windowWebPreferences(join(__dirname, '../preload/index.js'))
  })

  mainWindow.on('focus', () => {
    if (Date.now() - lastRenew > RENEW_ON_FOCUS_MS) renewLease()
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // New windows are never opened; https links go to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // The window never navigates away from the app's own page.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, devServerUrl)) event.preventDefault()
  })

  // An artifact's frame stays on its sandbox page; its links open in the system browser.
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return
    // An app's live preview on this laptop (6.1) stays in its frame too.
    if (isLocalPreviewNavigation(event.url, event.frame?.url ?? '', APP_SCHEME)) return
    // A sidebar app (6.2) stays on its own address.
    if (isSidebarNavigation(event.url, event.frame?.url ?? '')) return
    if (!isSandboxUrl(event.url, APP_SCHEME)) {
      event.preventDefault()
      if (isSafeExternalUrl(event.url)) void shell.openExternal(event.url)
    }
  })

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/index.html`)
  }
}

// One engine per laptop: a second launch only brings the first window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
  app.whenReady().then(start)
}

function start(): void {
  electronApp.setAppUserModelId('com.ecotechcore.titan117')

  // The app's own files, and nothing outside the renderer folder.
  protocol.handle(APP_SCHEME, (request) => {
    const { host, pathname } = new URL(request.url)
    // Artifacts, in their sandbox (decisions §44).
    if (host === SANDBOX_HOST) return staged.respond(pathname)
    // Sidebar apps' checked builds, from the engine's data folder (decisions §58).
    const sidebarApp = sidebarAppOf(host)
    if (sidebarApp)
      return sidebarResponse(join(app.getPath('userData'), 'sidebar-apps'), sidebarApp, pathname)
    const file = normalize(join(rendererDir, decodeURIComponent(pathname)))
    if (host !== 'app' || !file.startsWith(rendererDir + sep))
      return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // F12 opens DevTools in development; reload shortcuts are ignored in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // The microphone for voice input, for our own page only; every other permission is refused.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(
      allowPermission(
        permission,
        {
          mediaTypes: (details as { mediaTypes?: string[] }).mediaTypes,
          requestingUrl: details.requestingUrl
        },
        devServerUrl
      )
    )
  )
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin, details) =>
      allowPermission(
        permission,
        {
          mediaTypes: (details as { mediaType?: string }).mediaType
            ? [(details as { mediaType?: string }).mediaType as string]
            : ['audio'],
          requestingUrl: details.requestingUrl ?? requestingOrigin
        },
        devServerUrl
      )
  )

  loadDevelopmentEnv()
  registerBridge()
  registerArtifacts()
  registerUpdates()
  startAccount()
  startEngine()
  // Remote control and chat channels (decisions §64): off until the user switches them on.
  remoteHooks = startRemote({
    dataDir: app.getPath('userData'),
    keychain: keychain(),
    engine: () => connection ?? Promise.reject(new Error('The engine is not running.')),
    apiUrl: () => accountConfig().apiUrl,
    webUrl: () => accountConfig().webUrl,
    deviceToken: () => account?.deviceToken() ?? null,
    deviceId: () => account?.deviceIdentifier() ?? null,
    openExternal: (url) => shell.openExternal(url),
    notify: quietNotice,
    fromOurPage
  })
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('before-quit', () => {
  quitting = true
  engine?.postMessage({ type: 'shutdown' })
})

// The engine will keep running from the tray (architecture §3); until then,
// closing the last window quits, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
