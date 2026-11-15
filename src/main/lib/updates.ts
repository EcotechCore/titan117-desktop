/**
 * Auto-update (feature 1.10, decisions §50). Off until two things exist: an
 * update address (`updateUrl`) and a code signing certificate. electron-updater
 * checks that a downloaded Windows update is signed by the same publisher as
 * the running app, so an unsigned or foreign update is never installed.
 *
 * When on: a check at start and every 6 hours; the update downloads in the
 * background and installs when the app quits, or at once if the user presses
 * "Restart to update". Nothing restarts by itself while a task runs.
 */
import { autoUpdater } from 'electron-updater'

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export type UpdateState =
  | { state: 'off'; why: string }
  | { state: 'idle' | 'checking' | 'downloading' }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export function startUpdates(options: {
  packaged: boolean
  /** Where releases are published (a generic update server), or null. */
  url: string | null
  onChange(state: UpdateState): void
}): { install(): void; state(): UpdateState } {
  let current: UpdateState = { state: 'off', why: 'Updates are not set up yet.' }
  const set = (next: UpdateState): void => {
    current = next
    options.onChange(next)
  }
  if (!options.packaged) {
    set({ state: 'off', why: 'Running from source.' })
    return { install: () => undefined, state: () => current }
  }
  if (!options.url || !/^https:\/\//.test(options.url)) {
    set({ state: 'off', why: 'No update address yet.' })
    return { install: () => undefined, state: () => current }
  }

  autoUpdater.setFeedURL({ provider: 'generic', url: options.url })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ state: 'idle' }))
  autoUpdater.on('update-available', () => set({ state: 'downloading' }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (error) =>
    set({
      state: 'error',
      message: error instanceof Error ? error.message.slice(0, 200) : 'Update failed.'
    })
  )
  const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined)
  check()
  setInterval(check, CHECK_EVERY_MS).unref?.()

  return {
    install() {
      if (current.state === 'ready') autoUpdater.quitAndInstall()
    },
    state: () => current
  }
}
