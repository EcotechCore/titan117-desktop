import {
  app,
  shell,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess
} from 'electron'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Account, type AccountView } from './lib/account'
import { Keys } from './lib/keys'
import {
  APP_ORIGIN,
  APP_SCHEME,
  isAllowedNavigation,
  isSafeExternalUrl,
  windowWebPreferences
} from './window'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererDir = join(__dirname, '../renderer')

// In production the window's page is served from our own scheme, so it has a
// real origin the local API can check (guardrails §6).
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
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
let restarts = 0

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
const PRODUCTION = { webUrl: 'https://titan117.com', apiUrl: null as string | null }

function accountConfig(): { webUrl: string | null; apiUrl: string | null } {
  if (!is.dev) return PRODUCTION
  return {
    webUrl: process.env['TITAN117_WEB_URL'] || null,
    apiUrl: process.env['TITAN117_API_URL'] || null
  }
}

let account: Account | null = null
let keys: Keys | null = null

function keychain(): { encrypt(text: string): Buffer; decrypt(data: Buffer): string } | null {
  return safeStorage.isEncryptionAvailable()
    ? {
        encrypt: (text) => safeStorage.encryptString(text),
        decrypt: (data) => safeStorage.decryptString(data)
      }
    : null
}

/** The user's own API keys go to the engine only (features 2.9, 11.5). */
function pushKeys(): void {
  if (keys) engine?.postMessage({ type: 'keys', keys: keys.all() })
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
      }
    })
    child.once('exit', () => reject(new Error('The engine stopped before it was ready.')))
  })
  connection.catch(() => undefined)

  child.once('exit', () => {
    if (engine === child) engine = null
    if (quitting) return
    // The engine crashed: start it again (a few times), and tell the window.
    if (restarts++ < 3) {
      startEngine()
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('engine:restarted')
    }
  })
}

function dirnameOfInstall(): string {
  return join(app.getPath('exe'), '..')
}

/** Only the app's own page may use the bridge. */
function fromOurPage(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  return isAllowedNavigation(url, devServerUrl)
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

  ipcMain.handle('folders:remove', async (event, path: unknown) => {
    if (!fromOurPage(event) || typeof path !== 'string') throw new Error('Refused.')
    engine?.postMessage({ type: 'removeFolder', path })
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
    const file = normalize(join(rendererDir, decodeURIComponent(pathname)))
    if (host !== 'app' || !file.startsWith(rendererDir + sep))
      return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // F12 opens DevTools in development; reload shortcuts are ignored in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  loadDevelopmentEnv()
  registerBridge()
  startAccount()
  startEngine()
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
