/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { seo } from './seo.ts'
import { titan117Dev } from './titan117-dev.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), seo(), titan117Dev()],
  test: { environment: 'node' }
})
