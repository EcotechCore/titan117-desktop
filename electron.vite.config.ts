import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The window's content security policy is strict (guardrails §6). Vite's dev
 * server injects styles inline and talks to the page over a websocket, so in
 * `dev` only, those two are allowed. Production builds keep index.html as is.
 */
function devCsp(): Plugin {
  return {
    name: 'titan117-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws://localhost:*")
    }
  }
}

export default defineConfig({
  main: {},
  // Bundled, so the sandboxed preload needs nothing but `electron` at run time.
  preload: {
    build: {
      externalizeDeps: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), devCsp()]
  }
})
