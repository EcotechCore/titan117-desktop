// The lint rules that enforce the engine guardrail (guardrails §4) and keep
// the desktop away from the web repo (§6) really fire. A rule that silently
// stops matching would let system access around the permission layer.
import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'
import { join } from 'path'

const eslint = new ESLint({ cwd: join(__dirname, '..') })

async function restricted(code: string, file: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath: join(__dirname, '..', file) })
  return result.messages.some((m) => m.ruleId === 'no-restricted-imports')
}

describe('engine guardrail lint', () => {
  it.each([
    "import { exec } from 'child_process'",
    "import { exec } from 'node:child_process'",
    "import { readFile } from 'fs/promises'",
    "import * as fs from 'node:fs'",
    "import http from 'http'",
    "import net from 'node:net'",
    "import { Worker } from 'worker_threads'",
    "import { chromium } from 'playwright'"
  ])('blocks `%s` in an agent', async (code) => {
    expect(await restricted(`${code}\n`, 'src/engine/agents/example.ts')).toBe(true)
  })

  it('blocks system access in the window and the shell too', async () => {
    expect(await restricted("import fs from 'fs'\n", 'src/renderer/src/example.ts')).toBe(true)
    expect(await restricted("import fs from 'fs'\n", 'src/main/example.ts')).toBe(true)
  })

  it('allows it in the permission layer building blocks', async () => {
    expect(await restricted("import fs from 'fs'\n", 'src/engine/lib/files.ts')).toBe(false)
    expect(await restricted("import fs from 'fs'\n", 'src/engine/tools/lib/shell.ts')).toBe(false)
  })
})

describe('no imports from the web repo', () => {
  it.each([
    "import x from '@titan117/backend'",
    "import x from '../../titan117-web/packages/backend/convex/schema'",
    "import { query } from 'convex/server'"
  ])('blocks `%s`', async (code) => {
    expect(await restricted(`${code}\n`, 'src/engine/agents/example.ts')).toBe(true)
    expect(await restricted(`${code}\n`, 'src/engine/lib/example.ts')).toBe(true)
  })
})
