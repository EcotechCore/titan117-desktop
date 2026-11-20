// Phase 7 with a real model: Titan hands a sample repo with real bugs to the
// coding engine (OpenCode, through code_task), which fixes them so the tests
// pass. The harness plays the user and approves what is asked; the checks
// run the tests themselves and look at git, not at what the model says.
//
//   pnpm eval:code                        (Claude Haiku 5.5 by default)
//   TITAN_EVAL_MODEL=openai/gpt-6-luna pnpm eval:code
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { delimiter, join } from 'path'

import { startEngine, type Engine } from '../../src/engine/lib/engine'
import { createBrowserHost } from '../../src/engine/lib/browser'
import { tempFolder } from '../helpers'

const MODEL = `openrouter:${process.env.TITAN_EVAL_MODEL ?? 'anthropic/claude-haiku-5.5'}`

function devKey(): string | null {
  try {
    const env = readFileSync(join(__dirname, '../../.env'), 'utf8')
    return /^OPENROUTER_API_KEY=(.+)$/m.exec(env)?.[1]?.trim() || null
  } catch {
    return process.env.OPENROUTER_API_KEY ?? null
  }
}

const TESTS = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cartTotal, slugify, isWorkingDay } from '../src/shop.js'

test('cart total counts quantities and rounds to cents', () => {
  assert.equal(cartTotal([{ price: 12.5, qty: 2 }, { price: 0.1, qty: 3 }]), 25.3)
})
test('slugify makes lower-case words joined by single dashes', () => {
  assert.equal(slugify('  Miere de Salcâm  BIO '), 'miere-de-salcam-bio')
})
test('weekends are not working days', () => {
  assert.equal(isWorkingDay(new Date('2026-11-21')), false) // Saturday
  assert.equal(isWorkingDay(new Date('2026-11-22')), false) // Sunday
  assert.equal(isWorkingDay(new Date('2026-11-23')), true) // Monday
})
`

// Three real bugs: quantity ignored and no rounding; accents and repeated
// spaces kept; Sunday counted as a working day.
const SOURCE = `export function cartTotal(items) {
  let total = 0
  for (const item of items) total += item.price
  return total
}

export function slugify(text) {
  return text.trim().toLowerCase().replace(/ /g, '-')
}

export function isWorkingDay(date) {
  return date.getDay() !== 6
}
`

const key = devKey()
let engine: Engine
let repo: string
let remote: string
const report: string[] = []

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

function testsPass(): boolean {
  return spawnSync(process.execPath, ['--test'], { cwd: repo, encoding: 'utf8' }).status === 0
}

describe.runIf(key)('the code builder with a real model', () => {
  beforeAll(async () => {
    repo = tempFolder('titan117-code-repo-')
    mkdirSync(join(repo, 'src'))
    mkdirSync(join(repo, 'test'))
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'shop', type: 'module' }, null, 2)
    )
    writeFileSync(join(repo, 'src', 'shop.js'), SOURCE)
    writeFileSync(join(repo, 'test', 'shop.test.js'), TESTS)
    git('init', '-q', '-b', 'main')
    git('-c', 'user.name=Eval', '-c', 'user.email=eval@example.com', 'add', '.')
    git('-c', 'user.name=Eval', '-c', 'user.email=eval@example.com', 'commit', '-qm', 'Start')
    expect(testsPass()).toBe(false)
    // "GitHub" for this run: a made-up GitHub address to read, a local bare repository to push to.
    remote = tempFolder('titan117-code-remote-')
    execFileSync('git', ['init', '-q', '--bare'], { cwd: remote })
    git('remote', 'add', 'origin', 'https://github.com/titan117-eval/shop.git')
    git('config', 'remote.origin.pushurl', remote)
    git('config', 'user.name', 'Eval User')
    git('config', 'user.email', 'eval@example.com')
    // GitHub's CLI stays out of this run, so nothing reaches GitHub: the pull request comes as a link.
    process.env.PATH = (process.env.PATH ?? '')
      .split(delimiter)
      .filter((d) => !/github cli/i.test(d))
      .join(delimiter)

    const dataDir = tempFolder('titan117-code-data-')
    engine = await startEngine({
      dataDir,
      appVersion: '0.0.0-eval',
      coreDirs: [dataDir],
      allowedOrigins: ['titan117://app'],
      openRouterKey: key,
      locked: false,
      browser: createBrowserHost({ profileDir: join(dataDir, 'browser-profile'), headless: true }),
      loadLlama: async () => {
        throw new Error('No local model in the eval.')
      },
      probeLlama: async () => ({ ok: true, gpu: null, vramBytes: 0, gpuName: null })
    })
    engine.addFolder(repo)
  })

  afterAll(async () => {
    const out = join(tempFolder('titan117-code-report-'), 'report.md')
    writeFileSync(out, report.join('\n'))
    console.log(`Report: ${out}`)
    await engine?.close()
  })

  it('fixes the bugs so the tests pass, without touching the tests', async () => {
    const asked: string[] = []
    const created = engine.parts.runtime.start(
      `The project in ${repo} has failing tests (run them with \`node --test\`). ` +
        'Use the coding engine to fix the bugs in src/ so all tests pass. Don’t change the tests. ' +
        'Then put the fix on a new branch, commit it, push it, and open a pull request.',
      MODEL
    )
    const end = Date.now() + 9 * 60_000
    while (engine.parts.runtime.isRunning(created.id) && Date.now() < end) {
      for (const approval of engine.parts.store.listApprovals({
        taskId: created.id,
        status: 'pending'
      })) {
        asked.push(`${approval.tool}: ${approval.summary}`)
        engine.parts.permissions.answer(approval.id, 'approve', 'window')
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    if (engine.parts.runtime.isRunning(created.id)) engine.parts.runtime.cancel(created.id)
    await engine.parts.runtime.settled(created.id)
    const task = engine.parts.store.getTask(created.id)!
    const activity = engine.parts.store.listActivity(created.id)
    const changed = git('status', '--porcelain')
    report.push(
      `# Code builder eval with ${MODEL}`,
      '',
      `Status: ${task.status}, ${task.steps} steps, $${task.costUsd.toFixed(4)}`,
      '',
      '## Asked',
      ...asked.map((a) => `- ${a}`),
      '',
      '## Activity',
      ...activity.map((a) => `- ${a.kind} ${a.tool ?? ''}: ${a.summary}`),
      '',
      '## git status',
      '```',
      changed,
      '```',
      '',
      '## Diff',
      '```diff',
      git('diff'),
      '```'
    )
    console.log(report.join('\n'))
    expect(activity.some((a) => a.tool === 'code_task')).toBe(true)
    expect(testsPass()).toBe(true)
    const pushed = execFileSync('git', ['branch', '--format=%(refname:short)'], {
      cwd: remote,
      encoding: 'utf8'
    })
      .split('\n')
      .filter(Boolean)
    report.push('', '## Pushed branches', ...pushed.map((b) => `- ${b}`))
    console.log(report.slice(-3).join('\n'))
    expect(changed).toBe('')
    expect(pushed.length).toBe(1)
    const branch = pushed[0]
    expect(branch).not.toBe('main')
    const files = execFileSync('git', ['diff', '--name-only', `main...${branch}`], {
      cwd: repo,
      encoding: 'utf8'
    })
    expect(files.trim()).toBe('src/shop.js')
    const body = execFileSync('git', ['log', '-1', '--format=%B', branch], {
      cwd: repo,
      encoding: 'utf8'
    })
    expect(body).toContain('Co-authored-by: Titan117')
    const final = engine.parts.store
      .listMessages(created.id)
      .map((m) => (m.message.role === 'assistant' ? m.message.text : ''))
      .join('\n')
    expect(final).toContain('https://github.com/titan117-eval/shop/compare/')
  }, 600_000)
})
