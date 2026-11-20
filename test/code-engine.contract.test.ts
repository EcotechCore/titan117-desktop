/**
 * Contract tests against the real, pinned OpenCode program (decisions §12,
 * §53): run on every OpenCode upgrade. They download OpenCode and ripgrep
 * once (about 80 MB, checked against their hashes) into `.cache/components`.
 *
 *   OPENCODE_CONTRACT=1 pnpm test:opencode
 *
 * A fake model drives OpenCode; a recording proxy proves that OpenCode
 * itself never reaches the internet.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { EngineAsk } from '../src/engine/lib/code/assess'
import { startModelBridge, type BridgeTask, type ModelBridge } from '../src/engine/lib/code/bridge'
import { createComponents } from '../src/engine/lib/code/components'
import { createOpencodeEngine, type CodingEngine } from '../src/engine/lib/code/opencode'
import type { ToolCall } from '../src/shared/protocol'

const enabled = process.env.OPENCODE_CONTRACT === '1'

describe.runIf(enabled)('OpenCode contract (the real program)', () => {
  let bridge: ModelBridge
  let engine: CodingEngine
  let proxy: Server
  const outside: string[] = []
  /** Stands in for the user's real home folder. */
  const fakeHome = mkdtempSync(join(tmpdir(), 't117-oc-userhome-'))

  beforeAll(async () => {
    const components = createComponents({ dir: join(process.cwd(), '.cache', 'components') })
    const programs = await components.ensure((note) => console.log(note))
    // Every request OpenCode tries to make to the internet lands here and fails.
    proxy = createServer((req, res) => {
      outside.push(`${req.method} ${req.url}`)
      res.writeHead(403).end()
    })
    proxy.on('connect', (req, socket) => {
      outside.push(`CONNECT ${req.url}`)
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
    bridge = await startModelBridge()
    const home = mkdtempSync(join(tmpdir(), 't117-oc-home-'))
    engine = createOpencodeEngine({
      programs: async () => programs,
      bridge,
      home,
      scratch: join(home, 'tmp'),
      onError: (e) => console.error(e),
      testEnv: {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost'
      }
    })
  }, 600_000)

  afterAll(async () => {
    await engine?.shutdown()
    await bridge?.stop()
    proxy?.close()
  })

  /** A model that plays a script: each step returns the next tool call, then a final answer. */
  function scripted(calls: ToolCall[], final: string): BridgeTask['step'] {
    let i = 0
    return async ({ onText }) => {
      const call = calls[i++]
      if (call)
        return {
          text: '',
          toolCalls: [call],
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }
        }
      onText(final)
      return { text: final, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } }
    }
  }

  it('asks before a command, runs it once allowed, refuses an edit we deny, and reports changed files', async () => {
    const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 't117-oc-repo-')))
    const asks: EngineAsk[] = []
    const result = await engine.run({
      taskId: 'contract-1',
      repo,
      agent: 'build',
      prompt: 'Make hello.txt, then notes.md',
      signal: new AbortController().signal,
      step: scripted(
        [
          {
            id: 'call_1',
            name: 'bash',
            input: { command: 'echo hi > hello.txt', description: 'Write hello.txt' }
          },
          {
            id: 'call_2',
            name: 'write',
            input: { filePath: join(repo, 'notes.md'), content: 'notes' }
          }
        ],
        'Done.'
      ),
      async decide(ask) {
        asks.push(ask)
        return ask.permission === 'bash'
          ? { allowed: true }
          : { allowed: false, why: 'denied in the test' }
      }
    })
    expect(asks.map((a) => a.permission)).toEqual(['bash', 'edit'])
    expect(asks[0].metadata.command).toBe('echo hi > hello.txt')
    expect(existsSync(join(repo, 'hello.txt'))).toBe(true)
    expect(existsSync(join(repo, 'notes.md'))).toBe(false)
    expect(result.status).toBe('done')
    expect(result.text).toContain('Done.')
    expect(outside).toEqual([])
  }, 180_000)

  it('ignores `.opencode` settings in the repo and in the user’s home that would widen its permissions', async () => {
    const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 't117-oc-repo-')))
    const widen = JSON.stringify({
      permission: { bash: 'allow', edit: 'allow', webfetch: 'allow' }
    })
    mkdirSync(join(repo, '.opencode'))
    writeFileSync(join(repo, '.opencode', 'opencode.json'), widen)
    writeFileSync(join(repo, 'opencode.json'), widen)
    mkdirSync(join(fakeHome, '.opencode'), { recursive: true })
    writeFileSync(join(fakeHome, '.opencode', 'opencode.json'), widen)
    const asks: string[] = []
    await engine.run({
      taskId: 'contract-3',
      repo,
      agent: 'build',
      prompt: 'Make a file',
      signal: new AbortController().signal,
      step: scripted(
        [{ id: 'call_1', name: 'bash', input: { command: 'echo x > x.txt', description: 'x' } }],
        'Done.'
      ),
      async decide(ask) {
        asks.push(ask.permission)
        return { allowed: false, why: 'test' }
      }
    })
    expect(asks).toEqual(['bash'])
    expect(existsSync(join(repo, 'x.txt'))).toBe(false)
    expect(outside).toEqual([])
  }, 180_000)

  it('hides its server password and the bridge token from the commands it runs', async () => {
    const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 't117-oc-repo-')))
    const script =
      "require('fs').writeFileSync('env.json', JSON.stringify(Object.keys(process.env).filter(k => /^opencode_/i.test(k) && process.env[k])))"
    const result = await engine.run({
      taskId: 'contract-4',
      repo,
      agent: 'build',
      prompt: 'List the environment',
      signal: new AbortController().signal,
      step: scripted(
        [
          {
            id: 'call_1',
            name: 'bash',
            input: { command: `node -e "${script}"`, description: 'env' }
          }
        ],
        'Done.'
      ),
      decide: async () => ({ allowed: true })
    })
    expect(result.status).toBe('done')
    expect(JSON.parse(readFileSync(join(repo, 'env.json'), 'utf8'))).toEqual([])
    expect(outside).toEqual([])
  }, 180_000)

  it('keeps the session for a follow-up in the same task', async () => {
    const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 't117-oc-repo-')))
    const base = {
      taskId: 'contract-2',
      repo,
      agent: 'build' as const,
      signal: new AbortController().signal,
      decide: async () => ({ allowed: true })
    }
    const first = await engine.run({ ...base, prompt: 'Say one', step: scripted([], 'One.') })
    let sawEarlier = false
    const second = await engine.run({
      ...base,
      prompt: 'Say two',
      step: async ({ messages, onText }) => {
        sawEarlier = messages.some((m) => m.role === 'user' && m.text.includes('Say one'))
        onText('Two.')
        return {
          text: 'Two.',
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }
        }
      }
    })
    expect(first.text).toContain('One.')
    expect(second.text).toContain('Two.')
    expect(sawEarlier).toBe(true)
    expect(outside).toEqual([])
  }, 180_000)
})
