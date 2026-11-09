// The window has no direct system access (guardrails §6). If someone weakens
// a setting, this fails.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { isAllowedNavigation, isSafeExternalUrl, windowWebPreferences } from '../src/main/window'

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
    expect(isAllowedNavigation('file:///app/out/renderer/index.html')).toBe(true)
    expect(isAllowedNavigation('https://evil.example')).toBe(false)
  })

  it('stays on the dev server in development', () => {
    expect(isAllowedNavigation('http://localhost:5173/x', 'http://localhost:5173')).toBe(true)
    expect(isAllowedNavigation('http://localhost:9999/', 'http://localhost:5173')).toBe(false)
  })
})
