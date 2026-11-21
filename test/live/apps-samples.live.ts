// Phase 8's check with a real model: five sample web apps, each made and
// built by Titan through the real engine (plan, approval, code, install,
// typecheck, build, tests, three browsers, fixes, a version). The harness
// plays the user and approves what is asked; the checks read each app's own
// test report and git history, not what the model says. Publishing is the
// last part of the check and needs the owner's Cloudflare token.
//
//   pnpm eval:samples                       (Claude Haiku 5.5 by default)
//   TITAN_EVAL_MODEL=qwen/qwen3-coder pnpm eval:samples
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startEngine, type Engine } from '../../src/engine/lib/engine'
import { createBrowserHost } from '../../src/engine/lib/browser'
import { tempFolder } from '../helpers'

const MODEL_ID = process.env.TITAN_EVAL_MODEL ?? 'anthropic/claude-haiku-5.5'
const MODEL = `openrouter:${MODEL_ID}`
const components =
  process.env.TITAN117_LIVE_COMPONENTS ?? join(tmpdir(), 'titan117-live-components')

function devKey(): string | null {
  try {
    const env = readFileSync(join(__dirname, '../../.env'), 'utf8')
    return /^OPENROUTER_API_KEY=(.+)$/m.exec(env)?.[1]?.trim() || null
  } catch {
    return process.env.OPENROUTER_API_KEY ?? null
  }
}

export const SAMPLES = [
  {
    name: 'Cluj Bakery',
    kind: 'restaurant',
    description: 'Fresh bread every morning in Cluj, baked with local flour since 1998.',
    request:
      'A one-page site: a welcome, opening hours (Monday to Saturday 7:00–19:00, closed Sunday), three breads with prices in lei (sourdough 18, rye 15, brioche 22) and the address Strada Memorandumului 10, Cluj-Napoca.'
  },
  {
    name: 'Ana Plumbing',
    kind: 'services',
    description: 'Same-day plumbing repairs in Cluj-Napoca: leaks, boilers and bathrooms.',
    request:
      'Home, services and contact pages. Services: leak repair from 150 lei, boiler service 250 lei, bathroom fitting by quote. Phone 0740 000 000, email ana@example.com. A short list of three frequent questions.'
  },
  {
    name: 'Atelier Lemn',
    kind: 'shop',
    description: 'Handmade wooden furniture and kitchen boards from Maramureș.',
    request:
      'A catalogue: home, products and contact pages. Six products with name, price in lei and one line each (oak board 120, walnut board 160, stool 450, shelf 380, bench 900, coat rack 300). Orders by phone 0740 111 111.'
  },
  {
    name: 'Ioana Pop Photography',
    kind: 'portfolio',
    description: 'Wedding and family photographer in Brașov.',
    request:
      'Home, work and about pages. Work shows six projects as cards with a title and one line (no real photos: a coloured placeholder box with alt text). About: ten years of experience. Contact by email ioana@example.com.'
  },
  {
    name: 'Tax Day 2027',
    kind: 'landing',
    description: 'A free one-day workshop on Romanian e-invoicing for small companies.',
    request:
      'A landing page for a workshop on 15 March 2027 in Cluj: headline, three benefits, the programme in three steps (morning, lunch, afternoon), four questions and answers, and a "Register by email" button linking to mailto:events@example.com.'
  }
] as const

const key = devKey()
let engine: Engine
let root: string
const report: string[] = [`# Five sample web apps with ${MODEL_ID}`, '']
const results: {
  name: string
  passed: boolean
  versions: number
  steps: number
  costUsd: number
  minutes: number
}[] = []

describe.runIf(key)('five sample web apps with a real model', () => {
  beforeAll(async () => {
    // Versions need a git name and email: a throwaway home gives them (USERPROFILE stays, for Edge).
    const home = tempFolder('titan117-home-')
    writeFileSync(
      join(home, '.gitconfig'),
      '[user]\n\tname = Eval User\n\temail = eval@example.com\n'
    )
    process.env.HOME = home
    root = tempFolder('titan117-samples-')
    const dataDir = tempFolder('titan117-samples-data-')
    // Node.js and the test browsers, downloaded once for the live checks.
    mkdirSync(components, { recursive: true })
    symlinkSync(components, join(dataDir, 'components'), 'junction')
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
    engine.addFolder(root)
  })

  afterAll(async () => {
    report.push(
      '',
      '## Summary',
      '',
      '| App | Checks | Versions | Steps | Cost | Minutes |',
      '|---|---|---|---|---|---|'
    )
    for (const r of results)
      report.push(
        `| ${r.name} | ${r.passed ? 'pass' : 'FAIL'} | ${r.versions} | ${r.steps} | $${r.costUsd.toFixed(3)} | ${r.minutes.toFixed(1)} |`
      )
    const out = join(tempFolder('titan117-samples-report-'), 'report.md')
    writeFileSync(out, report.join('\n'))
    console.log(report.join('\n'))
    console.log(`Report: ${out}`)
    await engine?.close()
  })

  for (const sample of SAMPLES)
    it(
      `${sample.name} (${sample.kind}) builds and passes its checks`,
      async () => {
        const started = Date.now()
        const asked: string[] = []
        const created = engine.parts.runtime.start(
          `Make a new web app called "${sample.name}" in the folder ${root}, with the description "${sample.description}" (app_create, kind "${sample.kind}"). ` +
            `Then build it with the app builder (app_build): ${sample.request}`,
          MODEL
        )
        const end = Date.now() + 15 * 60_000
        while (engine.parts.runtime.isRunning(created.id) && Date.now() < end) {
          for (const approval of engine.parts.store.listApprovals({
            taskId: created.id,
            status: 'pending'
          })) {
            asked.push(`${approval.tool}: ${approval.summary.slice(0, 140)}`)
            engine.parts.permissions.answer(approval.id, 'approve', 'window')
          }
          await new Promise((r) => setTimeout(r, 200))
        }
        if (engine.parts.runtime.isRunning(created.id)) engine.parts.runtime.cancel(created.id)
        await engine.parts.runtime.settled(created.id)
        const task = engine.parts.store.getTask(created.id)!
        const folder = readdirSync(root)
          .map((d) => join(root, d))
          .find(
            (d) =>
              existsSync(join(d, '.titan117', 'app.json')) &&
              readFileSync(join(d, 'site.config.json'), 'utf8').includes(sample.name)
          )
        expect(folder, 'the app folder').toBeTruthy()
        const reports = join(folder!, '.titan117', 'reports')
        const latest = existsSync(reports) ? readdirSync(reports).sort().reverse()[0] : undefined
        const result = latest
          ? JSON.parse(readFileSync(join(reports, latest, 'report.json'), 'utf8'))
          : null
        const versions = execFileSync('git', ['log', '--format=%s'], { cwd: folder! })
          .toString()
          .trim()
          .split('\n')
        const passed = !!result?.passed
        results.push({
          name: sample.name,
          passed,
          versions: versions.length,
          steps: task.steps,
          costUsd: task.costUsd,
          minutes: (Date.now() - started) / 60_000
        })
        report.push(
          `## ${sample.name} (${sample.kind})`,
          '',
          `Task: ${task.status}, ${task.steps} steps, $${task.costUsd.toFixed(4)}. Checks: ${passed ? 'pass' : 'fail'}.`,
          '',
          'Asked:',
          ...asked.map((a) => `- ${a}`),
          '',
          'Versions:',
          ...versions.map((v) => `- ${v}`),
          '',
          '```',
          String(result?.summary ?? 'no report').slice(0, 2000),
          '```',
          ''
        )
        expect(passed).toBe(true)
        expect(versions.length).toBeGreaterThanOrEqual(2)
      },
      16 * 60_000
    )
})
