// The window has no direct system access (guardrails §6). If someone weakens
// a setting, this fails.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  isAllowedNavigation,
  isSafeExternalUrl,
  printWebPreferences,
  windowWebPreferences
} from '../src/main/window'

describe('window settings', () => {
  const prefs = windowWebPreferences('/app/preload.js')

  it('isolates the page from Electron and Node', () => {
    expect(prefs).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    })
  })

  it('is what the main process actually uses', () => {
    const main = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    expect(main).toMatch(/webPreferences:\s*windowWebPreferences\(/)
    expect(main).not.toMatch(/nodeIntegration|sandbox:\s*false|contextIsolation:\s*false/)
  })

  it('has a strict content security policy in the page', () => {
    const html = readFileSync(join(__dirname, '../src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"\s*content="([^"]+)"/)?.[1] ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    // The only thing the page may connect to is the engine's local API.
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:*")
    expect(csp).not.toMatch(/connect-src[^;]*https?:\/\/(?!127\.0\.0\.1)/)
  })
})

describe('links and navigation', () => {
  it.each([
    ['https://titan117.com', true],
    ['http://titan117.com', false],
    ['file:///C:/Windows/System32/calc.exe', false],
    ['smb://evil/share', false],
    ['javascript:alert(1)', false],
    ['not a url', false]
  ])('external %s → %s', (url, ok) => {
    expect(isSafeExternalUrl(url)).toBe(ok)
  })

  it('stays on the app page in production', () => {
    expect(isAllowedNavigation('titan117://app/index.html')).toBe(true)
    expect(isAllowedNavigation('titan117://evil/index.html')).toBe(false)
    expect(isAllowedNavigation('file:///app/out/renderer/index.html')).toBe(false)
    expect(isAllowedNavigation('https://evil.example')).toBe(false)
  })

  it('stays on the dev server in development', () => {
    expect(isAllowedNavigation('http://localhost:5173/x', 'http://localhost:5173')).toBe(true)
    expect(isAllowedNavigation('http://localhost:9999/', 'http://localhost:5173')).toBe(false)
  })
})

describe('browser permissions (feature 3.14)', () => {
  it('allow only the microphone, only for our own page', async () => {
    const { allowPermission } = await import('../src/main/window')
    const page = 'titan117://app/index.html'
    expect(allowPermission('media', { mediaTypes: ['audio'], requestingUrl: page })).toBe(true)
    expect(allowPermission('media', { mediaTypes: ['video'], requestingUrl: page })).toBe(false)
    expect(allowPermission('media', { mediaTypes: ['audio', 'video'], requestingUrl: page })).toBe(
      false
    )
    expect(allowPermission('media', { mediaTypes: [], requestingUrl: page })).toBe(false)
    expect(
      allowPermission('media', { mediaTypes: ['audio'], requestingUrl: 'https://evil.example/' })
    ).toBe(false)
    for (const other of ['geolocation', 'notifications', 'display-capture', 'clipboard-read'])
      expect(allowPermission(other, { requestingUrl: page })).toBe(false)
  })

  it('the main process installs the handlers', () => {
    const main = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    expect(main).toMatch(/setPermissionRequestHandler\([\s\S]*allowPermission/)
    expect(main).toMatch(/setPermissionCheckHandler\([\s\S]*allowPermission/)
  })
})

describe('artifacts in the window (decisions §44)', () => {
  it('prints in a sandboxed window with no preload and no Node', () => {
    const prefs = printWebPreferences({} as never)
    expect(prefs).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true
    })
    expect(prefs.preload).toBeUndefined()
    const main = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    expect(main).toMatch(/webPreferences:\s*printWebPreferences\(/)
    // Every request the print window makes outside the sandbox is cancelled.
    expect(main).toMatch(/cancel: !\/\^\(titan117:\|data:\|blob:\|about:\)\//)
  })

  it('lets the page frame only the artifact sandbox', () => {
    const html = readFileSync(join(__dirname, '../src/renderer/index.html'), 'utf8')
    expect(html).toMatch(/frame-src titan117:\/\/sandbox;/)
    expect(html).toMatch(/default-src 'none'/)
  })
})
