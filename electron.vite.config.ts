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
  // Two bundles: the shell (index) and the engine process it starts (engine).
  main: {
    build: {
      // OpenCode's SDK is ESM only: bundled into the engine, since the main bundle loads
      // its other dependencies with require (decisions §53).
      externalizeDeps: { exclude: ['@opencode-ai/sdk'] },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          engine: resolve('src/engine/main.ts')
        }
      }
    }
  },
  // Bundled, so the sandboxed preload needs nothing but `electron` at run time.
  preload: {
    build: {
      externalizeDeps: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // Mermaid's optional ELK layout is EPL-2.0 or GPL-3.0: replaced by a stub, never shipped (decisions §44).
        'elkjs/lib/elk.bundled.js': resolve('src/renderer/src/stubs/elk.ts')
      }
    },
    plugins: [react(), devCsp()]
  }
})
