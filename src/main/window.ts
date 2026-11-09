/**
 * The window's security settings (guardrails §6): the window has no direct
 * system access. test/window.test.ts reads these, so a change that weakens
 * them fails CI.
 */
import type { WebPreferences } from 'electron'

export function windowWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    spellcheck: true
  }
}

/**
 * Links the window may hand to the system browser: https only, so a page
 * can't make the app open `file:`, `smb:` or custom protocol links.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Where the window itself may navigate: only the app's own page (the dev
 * server in development). Everything else is refused; external links go
 * to the system browser instead.
 */
export function isAllowedNavigation(url: string, devServerUrl?: string): boolean {
  try {
    const target = new URL(url)
    if (devServerUrl) return target.origin === new URL(devServerUrl).origin
    return target.protocol === 'file:'
  } catch {
    return false
  }
}
