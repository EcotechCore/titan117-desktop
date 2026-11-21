import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

// The engine guardrail (guardrails §4): files, shell, network, workers and the
// browser are reached only through tools defined with `defineTool`, whose
// building blocks live in src/engine/lib and src/engine/tools/lib.
const systemModules = [
  'child_process',
  'fs',
  'fs/promises',
  'net',
  'http',
  'https',
  'http2',
  'tls',
  'dgram',
  'worker_threads',
  'cluster'
]
const systemAccess = {
  paths: [...systemModules, ...systemModules.map((m) => `node:${m}`)].map((name) => ({
    name,
    message:
      'System access goes through the permission layer: write a tool with defineTool (guardrails §4). Only src/engine/lib and src/engine/tools/lib may import this.'
  })),
  patterns: [
    {
      group: [
        'playwright',
        'playwright/*',
        'playwright-core',
        'playwright-core/*',
        '@playwright/test'
      ],
      message: 'The browser is a tool: use it through defineTool (guardrails §4).'
    }
  ]
}

// The desktop never imports from the web app or the backend (guardrails §6).
// It talks to Convex only through @titan117/shared and the Convex client.
const webImports = {
  patterns: [
    {
      group: [
        '@titan117/web',
        '@titan117/web/*',
        '@titan117/backend',
        '@titan117/backend/*',
        '**/titan117-web/**',
        'convex/server'
      ],
      message: 'The desktop never imports from titan117-web (guardrails §6). Use @titan117/shared.'
    }
  ]
}

export default defineConfig(
  // mockup/ is the design reference (design.md 0.2), not app code.
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      'mockup/**',
      // Starting files for apps the builder makes: their own project, checked by their own scripts.
      'src/engine/lib/apps/templates/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        // Not 'detect': eslint-plugin-react's detection calls an API ESLint 10 removed.
        version: '19.3'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    files: ['src/**/*.{ts,tsx,js,mjs}'],
    // src/main/lib: the shell's own sign-in listener and account files
    // (decisions §39). No agent code runs in the main process.
    ignores: ['src/engine/lib/**', 'src/engine/tools/lib/**', 'src/main/lib/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: systemAccess.paths,
          patterns: [...systemAccess.patterns, ...webImports.patterns]
        }
      ]
    }
  },
  {
    files: ['src/engine/lib/**', 'src/engine/tools/lib/**', 'src/main/lib/**'],
    rules: {
      'no-restricted-imports': ['error', webImports]
    }
  },
  // Plain Node scripts (licence and build checks) are not typed.
  {
    files: ['scripts/**/*.mjs'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  },
  eslintConfigPrettier
)
