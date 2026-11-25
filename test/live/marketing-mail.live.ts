// Phase 14, newsletters and sequences with a real model (15.5, 15.6;
// decisions §63). No email provider account here, so everything up to
// sending is checked: the list, people added with their consent, a
// newsletter draft and a welcome sequence; a test send is refused because
// sending isn't set up, and nothing reaches a provider.
//
//   pnpm vitest run -c vitest.live.config.mts test/live/marketing-mail.live.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { startEngine, type Engine } from '../../src/engine/lib/engine'
import { call, tempFolder } from '../helpers'

const MODEL = `openrouter:${process.env.TITAN_EVAL_MODEL ?? 'anthropic/claude-haiku-5.5'}`

function devKey(): string | null {
  try {
    const env = readFileSync(join(__dirname, '../../.env'), 'utf8')
    return /^OPENROUTER_API_KEY=(.+)$/m.exec(env)?.[1]?.trim() || null
  } catch {
    return process.env.OPENROUTER_API_KEY ?? null
  }
}

const key = devKey()
const report: string[] = []
let engine: Engine
let folder: string
const providerCalls: string[] = []

async function runAndApprove(agent: string, text: string, ms: number): Promise<string> {
  const { body } = await call(engine, 'POST', '/v1/tasks', { text, model: MODEL, agent })
  const taskId: string = body.task.id
  const end = Date.now() + ms
  for (;;) {
    for (const a of engine.parts.store.listApprovals({ taskId, status: 'pending' })) {
      report.push(`  ${agent} asked (${a.tool}): ${a.summary.replace(/\s+/g, ' ').slice(0, 240)}`)
      await call(engine, 'POST', `/v1/approvals/${a.id}`, { answer: 'approve' })
    }
    const task = engine.parts.store.getTask(taskId)!
    if (task.status !== 'running' && task.status !== 'waiting') break
    if (Date.now() > end) throw new Error(`${agent} did not finish in time.`)
    await new Promise((r) => setTimeout(r, 300))
  }
  const task = engine.parts.store.getTask(taskId)!
  const last = engine.parts.store
    .listMessages(taskId)
    .map((m) => m.message)
    .filter((m) => m.role === 'assistant')
    .at(-1)
  report.push(
    `${agent}: ${task.status}, $${task.costUsd.toFixed(4)}; said: ${last && last.role === 'assistant' ? last.text.replace(/\s+/g, ' ').slice(0, 600) : ''}`
  )
  return taskId
}

describe.skipIf(!key)('phase 14: newsletters and sequences, up to sending', () => {
  beforeAll(async () => {
    const dataDir = tempFolder('titan117-mail-')
    folder = tempFolder('titan117-mail-files-')
    writeFileSync(
      join(folder, 'signups.csv'),
      'Name,Email\nAna Pop,ana@example.com\nRadu Ionescu,radu@example.com\nIoana,ioana@example.com\n'
    )
    engine = await startEngine({
      dataDir,
      appVersion: '0.0.0-live',
      coreDirs: [dataDir],
      allowedOrigins: ['titan117://app'],
      openRouterKey: key!,
      locked: false,
      loadLlama: async () => {
        throw new Error('No local model here.')
      },
      probeLlama: async () => ({ ok: true, gpu: null, vramBytes: 0, gpuName: null }),
      embedder: null,
      // Any request to an email provider is noted and refused: none should happen.
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (/brevo|postmark/.test(url)) {
          providerCalls.push(url)
          return new Response('{}', { status: 500 })
        }
        return fetch(input, init)
      }) as typeof fetch
    })
    engine.addFolder(folder)
    await call(engine, 'PUT', '/v1/settings', { defaultModel: MODEL })
    engine.parts.marketing.brand.save({
      name: 'Brutăria Ana',
      tone: 'warm and plain',
      description:
        'A family bakery in Cluj: sourdough, rye and pastries baked by hand every morning.',
      website: 'https://bakery.example/'
    })
  })

  afterAll(async () => {
    await engine?.close()
    const text = `Phase 14 newsletters live check, ${new Date().toISOString().slice(0, 10)}, ${MODEL}\n\n${report.join('\n')}\n`
    mkdirSync(join(__dirname, 'results'), { recursive: true })
    writeFileSync(
      join(__dirname, 'results', `marketing-mail-${new Date().toISOString().slice(0, 10)}.md`),
      text
    )
    console.log(`\n${text}`)
  })

  it('makes a list, adds people with their consent, writes a newsletter and a welcome sequence', async () => {
    await runAndApprove(
      'Marketing agent',
      `Set up our newsletter. Make a list called "Monthly news" for monthly news and offers from the bakery. Add the people in ${join(folder, 'signups.csv')}: they signed up through the form on our website in November 2026. Then write our December newsletter about Christmas orders (order by 22 December, collect from 7:00), and a welcome sequence of three short emails (day 0, 3 and 7). Then send me a test of the newsletter. Decide the wording yourself; don't ask me questions.`,
      600_000
    )
    const mail = engine.parts.marketing.mail.state()
    const list = mail.lists.find((l) => l.name === 'Monthly news')
    report.push(
      `Lists: ${mail.lists.map((l) => `${l.name} (${l.subscribed} subscribed)`).join(', ')}`
    )
    expect(list?.subscribed).toBe(3)
    const people = engine.parts.marketing.mail.store.subscribers(list!.id)
    report.push(`Consent recorded: "${people[0].consent}"`)
    expect(people.every((p) => /form|website|site/i.test(p.consent))).toBe(true)
    const letter = mail.newsletters[0]
    report.push(
      `Newsletter: "${letter?.subject}" (${letter?.status}); ${letter?.body.replace(/\s+/g, ' ').slice(0, 300)}`
    )
    expect(letter?.status).toBe('draft')
    expect(letter?.body).toMatch(/22/)
    const sequence = mail.sequences[0]
    report.push(
      `Sequence: "${sequence?.name}": ${sequence?.steps.map((s) => `day ${s.day} "${s.subject}"`).join('; ')}`
    )
    expect(sequence?.steps.map((s) => s.day)).toEqual([0, 3, 7])
    // Sending isn't set up: nothing was tested or sent, and no provider was called.
    expect(letter?.testedAt).toBeNull()
    expect(providerCalls).toEqual([])
    const preview = engine.parts.marketing.mail.preview(letter!.id)
    expect(preview.html).toContain('Brutăria Ana')
    mkdirSync(join(__dirname, 'results'), { recursive: true })
    writeFileSync(join(__dirname, 'results', 'newsletter-preview.html'), preview.html)
  }, 700_000)
})
