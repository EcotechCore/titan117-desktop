// Phase 7's check (roadmap): "The code builder fixes a set of real issues in a
// sample repo and opens a pull request". Against a real GitHub repository the
// user owns, with GitHub's CLI signed in on the laptop; costs a few cents.
//
//   TITAN_PR_REPO=owner/repo pnpm eval:pr      (Claude Haiku 5.5 by default)
//
// The harness plays the user: it pastes the repository's open issues into the
// request and approves what Titan asks. The checks look at GitHub and at the
// code on the pull request's branch, not at what the model says. The pull
// request is left open for the user to review.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { startEngine, type Engine } from '../../src/engine/lib/engine'
import { createBrowserHost } from '../../src/engine/lib/browser'
import { tempFolder } from '../helpers'

const MODEL = `openrouter:${process.env.TITAN_EVAL_MODEL ?? 'anthropic/claude-haiku-5.5'}`
const REPO = process.env.TITAN_PR_REPO ?? ''

function devKey(): string | null {
  try {
    const env = readFileSync(join(__dirname, '../../.env'), 'utf8')
    return /^OPENROUTER_API_KEY=(.+)$/m.exec(env)?.[1]?.trim() || null
  } catch {
    return process.env.OPENROUTER_API_KEY ?? null
  }
}

const key = devKey()
let engine: Engine
let clone: string
const report: string[] = []

function gh(...args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8' })
}
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: clone, encoding: 'utf8' })
}

/** Each issue's own example, run against the code on a branch. */
const ACCEPTANCE = `
import assert from 'node:assert/strict'
const m = await import(process.argv[2])
assert.equal(m.cartTotal([{ price: 12.5, qty: 2 }, { price: 0.1, qty: 3 }]), 25.3)
assert.deepEqual(m.invoice([{ price: 25.3, qty: 1 }]), { net: 25.3, vat: 5.31, gross: 30.61 })
assert.equal(m.slugify('  Miere de Salcâm  BIO '), 'miere-de-salcam-bio')
assert.equal(m.slugify('Țară și munte'), 'tara-si-munte')
assert.equal(m.isWorkingDay(new Date(2026, 10, 22)), false)
assert.equal(m.isWorkingDay(new Date(2026, 10, 21)), false)
assert.equal(m.isWorkingDay(new Date(2026, 10, 23)), true)
console.log('acceptance ok')
`

describe.runIf(key && REPO)('phase 7 check: fix real issues and open a pull request', () => {
  beforeAll(async () => {
    clone = join(tempFolder('titan117-pr-'), 'repo')
    execFileSync('gh', ['repo', 'clone', REPO, clone])
    const dataDir = tempFolder('titan117-pr-data-')
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
    engine.addFolder(clone)
  })

  afterAll(async () => {
    const out = join(tempFolder('titan117-pr-report-'), 'report.md')
    writeFileSync(out, report.join('\n'))
    console.log(report.join('\n'))
    console.log(`Report: ${out}`)
    await engine?.close()
  })

  it(
    'fixes the open issues and opens a pull request that closes them',
    async () => {
      const issues = JSON.parse(
        gh('issue', 'list', '-R', REPO, '--state', 'open', '--json', 'number,title,body')
      ) as { number: number; title: string; body: string }[]
      expect(issues.length).toBeGreaterThan(0)
      const asked: string[] = []
      const created = engine.parts.runtime.start(
        [
          `The project in ${clone} is the GitHub repository ${REPO}. Its open issues:`,
          ...issues.map((i) => `\n#${i.number} ${i.title}\n${i.body}`),
          '',
          'Fix all of them with the coding engine, add a test for each, and run the tests.',
          'Then put the work on a new branch, commit it, push it, and open a pull request whose',
          'description says what changed and has a "Fixes #N" line for each issue.'
        ].join('\n'),
        MODEL
      )
      const end = Date.now() + 15 * 60_000
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
      const branch = git('branch', '--show-current').trim()
      report.push(
        `# Phase 7 check with ${MODEL} on ${REPO}`,
        '',
        `Status: ${task.status}, ${task.steps} steps, $${task.costUsd.toFixed(4)}; branch ${branch}`,
        '',
        '## Asked',
        ...asked.map((a) => `- ${a}`),
        '',
        '## Activity',
        ...activity
          .filter((a) => a.kind !== 'model')
          .map((a) => `- ${a.kind} ${a.tool ?? ''}: ${a.summary}`)
      )

      // A pull request exists on GitHub from that branch, as the user, and closes every issue.
      const prs = JSON.parse(
        gh(
          'pr',
          'list',
          '-R',
          REPO,
          '--head',
          branch,
          '--state',
          'open',
          '--json',
          'number,url,body,author'
        )
      ) as { number: number; url: string; body: string; author: { login: string } }[]
      report.push(
        '',
        '## Pull request',
        prs[0] ? `${prs[0].url} by ${prs[0].author.login}` : 'none'
      )
      expect(branch).not.toBe('main')
      expect(prs.length).toBe(1)
      for (const issue of issues)
        expect(prs[0].body).toMatch(new RegExp(`(Fixes|Closes|Resolves) #${issue.number}\\b`, 'i'))

      // The branch on GitHub: tests pass, every issue's example works, the commit says Titan117 helped.
      git('fetch', '-q', 'origin', branch)
      expect(git('status', '--porcelain').trim()).toBe('')
      const tests = spawnSync(process.execPath, ['--test'], { cwd: clone, encoding: 'utf8' })
      report.push(
        '',
        '## Tests',
        '```',
        tests.stdout
          .split('\n')
          .filter((l) => /^ℹ (tests|pass|fail)/.test(l))
          .join('\n'),
        '```'
      )
      expect(tests.status).toBe(0)
      const check = join(tempFolder('titan117-pr-check-'), 'acceptance.mjs')
      writeFileSync(check, ACCEPTANCE)
      const accept = spawnSync(
        process.execPath,
        [check, `file:///${join(clone, 'src', 'shop.js').replace(/\\/g, '/')}`],
        {
          encoding: 'utf8'
        }
      )
      report.push('', '## Acceptance', accept.stdout + accept.stderr)
      expect(accept.status).toBe(0)
      expect(git('log', `origin/main..origin/${branch}`, '--format=%B')).toContain(
        'Co-authored-by: Titan117'
      )
      const changed = git('diff', '--name-only', `origin/main...origin/${branch}`)
        .trim()
        .split('\n')
      report.push('', '## Files changed', ...changed.map((f) => `- ${f}`))
      expect(changed).toContain('src/shop.js')
    },
    20 * 60_000
  )
})
