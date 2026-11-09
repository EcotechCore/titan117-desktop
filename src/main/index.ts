import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { isAllowedNavigation, isSafeExternalUrl, windowWebPreferences } from './window'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
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
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.ecotechcore.titan117')

  // F12 opens DevTools in development; reload shortcuts are ignored in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// The engine will keep running from the tray (architecture §3); until then,
// closing the last window quits, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
