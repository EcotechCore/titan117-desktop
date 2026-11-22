/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tauri shows this app in its own window; the same page runs in a browser for Titan117's preview and tests.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri's own dev window expects port 1420 (tauri.conf.json); Titan117's preview picks its own port.
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2022', outDir: 'dist' },
  test: { environment: 'node' }
})
