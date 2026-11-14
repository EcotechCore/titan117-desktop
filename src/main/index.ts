import {
  app,
  shell,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  net,
  protocol,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess
} from 'electron'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
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

function developmentKey(): string {
  // Phase 1 only: a development OpenRouter key from the repo's local .env.
  // Packaged apps never read it; keys move to the keychain in phase 2.
  if (!is.dev) return ''
  try {
    process.loadEnvFile(join(app.getAppPath(), '.env'))
  } catch {
    // No .env: cloud models stay off, local models work.
  }
  return process.env['OPENROUTER_API_KEY'] ?? ''
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
      if (message.type === 'ready')
        resolve({ url: `http://127.0.0.1:${message.port}`, token: message.token })
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

  registerBridge()
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
