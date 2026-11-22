import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const stub = (name: string) => fileURLToPath(new URL(`./test-stubs/${name}`, import.meta.url))

// Tests render the app with react-native-web and react-dom/server: no phone or browser needed.
// Expo modules that need a phone or Metro get a small stand-in from test-stubs/ (add one when needed).
export default defineConfig({
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      'expo-status-bar': stub('expo-status-bar.tsx')
    },
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.json']
  },
  define: { __DEV__: 'true' },
  test: { environment: 'node' }
})
