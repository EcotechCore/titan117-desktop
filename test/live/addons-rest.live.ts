// The rest of phase 16 with a real model (decisions §66.21–66.23): Titan sets
// up a real open-source project after downloading it (nothing runs without
// the user's OK), and Titan writes a tool add-on into a folder and installs
// it from there. The harness plays the user: it approves downloads, file
// writes and the install card, and denies every command.
//
//   pnpm eval:addons-rest                  (Claude Haiku 5.5 by default)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { startEngine, type Engine } from '../../src/engine/lib/engine'
import { call, tempFolder, until } from '../helpers'

const MODEL = `openrouter:${process.env.TITAN_EVAL_MODEL ?? 'anthropic/claude-haiku-5.5'}`
/** A small real project (MIT, about 80 KB) to set up. */
const PROJECT = process.env.TITAN_PROJECT ?? 'sindresorhus/slugify'

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

describe.skipIf(!key)('phase 16, the rest, with a real model', () => {
  let engine: Engine
  let allowed: string

  beforeAll(async () => {
    const dataDir = tempFolder('titan117-addons-rest-')
    allowed = tempFolder('titan117-work-')
    engine = await startEngine({
      dataDir,
      appVersion: '0.0.0-live',
      coreDirs: [dataDir],
      allowedOrigins: ['titan117://app'],
      openRouterKey: key,
      locked: false,
      loadLlama: async () => {
        throw new Error('No local model here.')
      },
      probeLlama: async () => ({ ok: true, gpu: null, vramBytes: 0, gpuName: null }),
      embedder: null
    })
    engine.addFolder(allowed)
    await call(engine, 'PUT', '/v1/settings', { defaultModel: MODEL })
  })

  afterAll(async () => {
    await engine?.close()
    writeFileSync(join(__dirname, 'results', 'addons-rest.txt'), report.join('\n') + '\n')
  })

  async function task(
    text: string,
    answer: (tool: string, summary: string) => 'approve' | 'deny'
  ): Promise<string> {
    const { body } = await call(engine, 'POST', '/v1/tasks', { text, model: MODEL })
    const taskId: string = body.task.id
    for (;;) {
      const next = await until(() => {
        const t = engine.parts.store.getTask(taskId)!
        if (t.status !== 'running' && t.status !== 'waiting') return 'finished'
        return engine.parts.store.listApprovals({ taskId, status: 'pending' })[0] ?? null
      }, 240_000)
      if (next === 'finished') break
      const a = answer(next.tool, next.summary)
      report.push(`Card (${next.tool}, ${a}): ${next.summary.replace(/\s+/g, ' ').slice(0, 400)}`)
      await call(engine, 'POST', `/v1/approvals/${next.id}`, { answer: a })
    }
    return taskId
  }

  const lastAnswer = (taskId: string): string => {
    const m = engine.parts.store
      .listMessages(taskId)
      .map((x) => x.message)
      .reverse()
      .find((x) => x.role === 'assistant' && x.text.trim())
    return m && m.role === 'assistant' ? m.text : ''
  }

  it('Titan downloads a real project, runs nothing, and proposes the setup steps', async () => {
    const folder = join(allowed, 'slugify')
    const t = await task(
      `Set up the open-source project ${PROJECT} from GitHub for me in the folder ${folder}. Tell me the steps before running anything.`,
      (tool) => (tool === 'project_download' ? 'approve' : 'deny')
    )
    const tools = engine.parts.store
      .listActivity(t)
      .filter((a) => a.kind === 'tool')
      .map((a) => a.tool)
    expect(tools).toContain('project_download')
    expect(existsSync(join(folder, 'package.json'))).toBe(true)
    expect(existsSync(join(folder, 'node_modules'))).toBe(false)
    const answer = lastAnswer(t)
    expect(answer).toMatch(/npm|install|test/i)
    report.push(`Setup answer: ${answer.replace(/\s+/g, ' ').slice(0, 500)}`)
    report.push(`Cost $${engine.parts.store.getTask(t)!.costUsd.toFixed(4)}`)
  })

  it('Titan writes a tool add-on into a folder and installs it from there after the card', async () => {
    const folder = join(allowed, 'vat-tool')
    const t = await task(
      `Make me a tool add-on that adds Romanian VAT (21%) to a net amount and rounds to 2 decimals. Write its titan.json and tool.js into the folder ${folder}, then install it from that folder.`,
      (tool) => (['write_file', 'addons_install_folder'].includes(tool) ? 'approve' : 'deny')
    )
    const { body } = await call(engine, 'GET', '/v1/addons')
    const tool = (body.addons as { type: string; name: string; repo: string | null }[]).find(
      (a) => a.type === 'tool'
    )
    expect(tool, lastAnswer(t)).toBeTruthy()
    expect(tool!.repo).toBeNull()
    report.push(
      `Installed from a folder: ${tool!.name}; cost $${engine.parts.store.getTask(t)!.costUsd.toFixed(4)}`
    )
    const used = await task('What is 100 lei net with VAT? Use the add-on tool.', () => 'approve')
    const out = engine.parts.store
      .listMessages(used)
      .map((x) => x.message)
      .filter((m) => m.role === 'tool' && m.name.startsWith('addon_'))
      .map((m) => (m.role === 'tool' ? m.output : ''))
      .join(' ')
    expect(out).toMatch(/121/)
    report.push(`Tool said: ${out.replace(/\s+/g, ' ').slice(0, 200)}`)
  })
})
