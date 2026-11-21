/**
 * The user's own coding tools (13.14; decisions §20, §55): Claude Code's
 * permission prompts become our approvals; tools that are missing, signed
 * out or turned off fall back to our engine; sign-in is read only from the
 * tool's own exit code.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { promptOf, startApprovalServer } from '../src/engine/lib/code/approval-mcp'
import {
  claudeAsk,
  createOwnTools,
  readClaudeStream,
  type Runner
} from '../src/engine/lib/code/own-tools'
import { tempFolder } from './helpers'

async function rpc(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('the approval endpoint Claude Code calls', () => {
  it('speaks enough MCP for Claude Code and answers with our decision', async () => {
    const server = await startApprovalServer()
    try {
      const seen: string[] = []
      const token = server.open(async (p) => {
        seen.push(`${p.tool}:${JSON.stringify(p.input)}`)
        return p.tool === 'Bash' ? { allowed: false, why: 'denied' } : { allowed: true }
      })
      const init = await (
        await rpc(server.url, token, {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18' }
        })
      ).json()
      expect(init.result.capabilities.tools).toBeDefined()
      expect(
        (await rpc(server.url, token, { jsonrpc: '2.0', method: 'notifications/initialized' }))
          .status
      ).toBe(202)
      const list = await (
        await rpc(server.url, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
      ).json()
      expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['approve'])

      const call = (
        tool: string,
        input: unknown
      ): Promise<{ result: { content: { type: string; text: string }[] } }> =>
        rpc(server.url, token, {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'approve', arguments: { tool_name: tool, input, tool_use_id: 'x' } }
        }).then((r) => r.json())
      const allow = await call('Edit', { file_path: 'a.js' })
      expect(allow.result.content).toHaveLength(1)
      expect(JSON.parse(allow.result.content[0].text)).toEqual({
        behavior: 'allow',
        updatedInput: { file_path: 'a.js' }
      })
      const deny = JSON.parse((await call('Bash', { command: 'rm -rf /' })).result.content[0].text)
      expect(deny.behavior).toBe('deny')
      expect(deny.message).toContain('denied')
      expect(seen).toHaveLength(2)

      // No token, a wrong token, a web page: refused.
      expect(
        (await rpc(server.url, 'wrong', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status
      ).toBe(401)
      const fromPage = await fetch(server.url, {
        method: 'POST',
        headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}` },
        body: '{}'
      })
      expect(fromPage.status).toBe(403)
      server.close(token)
      expect(
        (await rpc(server.url, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status
      ).toBe(401)
    } finally {
      await server.stop()
    }
  })

  it('reads both spellings of the call arguments', () => {
    expect(promptOf({ tool_name: 'Read', input: { a: 1 } })).toEqual({
      tool: 'Read',
      input: { a: 1 }
    })
    expect(promptOf({ toolName: 'Read', tool_input: { a: 1 } })).toEqual({
      tool: 'Read',
      input: { a: 1 }
    })
  })
})

describe('Claude Code’s prompts as our asks', () => {
  const repo = 'C:\\repo'
  it('maps commands, edits, reads and web tools', () => {
    expect(claudeAsk({ tool: 'Bash', input: { command: 'npm test' } }, repo)).toMatchObject({
      ask: { permission: 'bash', metadata: { command: 'npm test' } }
    })
    const edit = claudeAsk(
      { tool: 'Edit', input: { file_path: 'a.js', old_string: 'x', new_string: 'y' } },
      repo
    )
    expect(edit).toMatchObject({
      ask: { permission: 'edit', patterns: ['a.js'], metadata: { diff: '-x\n+y' } }
    })
    expect(
      claudeAsk({ tool: 'Write', input: { file_path: 'b.js', content: 'z' } }, repo)
    ).toMatchObject({
      ask: { permission: 'edit', metadata: { diff: '+z' } }
    })
    expect(claudeAsk({ tool: 'Read', input: { file_path: 'src/a.js' } }, repo)).toHaveProperty(
      'read'
    )
    expect(claudeAsk({ tool: 'TodoWrite', input: {} }, repo)).toEqual({ direct: { allowed: true } })
    expect(
      claudeAsk({ tool: 'WebFetch', input: { url: 'https://x.example' } }, repo)
    ).toMatchObject({
      ask: { permission: 'webfetch' }
    })
    expect(claudeAsk({ tool: 'mcp__other__thing', input: {} }, repo)).toMatchObject({
      ask: { permission: 'mcp__other__thing' }
    })
  })

  it('reads the answer and cost from stream-json', () => {
    const out = readClaudeStream([
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Working"}]}}',
      'not json',
      '{"type":"result","result":"Fixed it.","total_cost_usd":0.12,"is_error":false}'
    ])
    expect(out).toEqual({ text: 'Fixed it.', error: null, costUsd: 0.12 })
    expect(
      readClaudeStream(['{"type":"result","result":"Not logged in","is_error":true}']).error
    ).toBe('Not logged in')
  })
})

/** A fake PATH: which programs exist, and what they do when run. */
function fakeRunner(
  programs: Record<string, string>,
  behave: (
    program: string,
    args: string[],
    options: Parameters<Runner>[2]
  ) => Promise<{ code: number; stdout?: string }>
): Runner {
  return async (program, args, options) => {
    if (program === 'where.exe' || program === 'which') {
      const found = programs[args[0]]
      return found
        ? { code: 0, stdout: `${found}\n`, stderr: '' }
        : { code: 1, stdout: '', stderr: '' }
    }
    const r = await behave(program, args, options)
    return { code: r.code, stdout: r.stdout ?? '', stderr: '' }
  }
}

describe('running the user’s own tools', () => {
  function tools(runner: Runner, enabled: string[] = []): ReturnType<typeof createOwnTools> {
    return createOwnTools({
      approvals: undefined as never,
      scratch: tempFolder('t117-own-'),
      enabled: (id) => enabled.includes(id),
      changes: async () => new Map(),
      run: runner
    })
  }
  const base = {
    repo: tempFolder('t117-own-repo-'),
    prompt: 'Fix it',
    mode: 'build' as const,
    signal: new AbortController().signal,
    decide: async () => ({ allowed: true }),
    readAllowed: async () => true,
    approveJob: async () => ({ allowed: true })
  }

  it('reports what is installed and signed in, from exit codes only', async () => {
    const runner = fakeRunner(
      { claude: 'C:\\bin\\claude.exe', codex: 'C:\\bin\\codex.exe' },
      async (program) => ({
        code: program.includes('claude') ? 0 : 1,
        stdout: '{"email":"someone@example.com"}'
      })
    )
    const status = await tools(runner).status()
    const by = Object.fromEntries(status.map((s) => [s.id, s]))
    expect(by['claude-code']).toMatchObject({
      installed: true,
      signedIn: true,
      enabled: true,
      experimental: false
    })
    expect(by.codex).toMatchObject({
      installed: true,
      signedIn: false,
      enabled: false,
      experimental: true
    })
    expect(by.cursor).toMatchObject({ installed: false })
    expect(JSON.stringify(status)).not.toContain('someone@example.com')
  })

  it('doesn’t run a tool Titan117 switched off from its cloud (kill switch)', async () => {
    const own = createOwnTools({
      approvals: undefined as never,
      scratch: tempFolder('t117-own-'),
      enabled: () => true,
      killed: (id) => id === 'claude-code',
      changes: async () => new Map(),
      run: fakeRunner({ claude: 'C:\\bin\\claude.exe' }, async () => ({ code: 0 }))
    })
    expect((await own.status()).find((t) => t.id === 'claude-code')).toMatchObject({
      killed: true,
      enabled: false
    })
    const result = await own.run({ ...base, tool: 'claude-code' })
    expect(result.usedTool).toBe(false)
    expect(result.note).toMatch(/switched off/)
  })

  it('falls back when a tool is missing, signed out or turned off', async () => {
    const missing = await tools(fakeRunner({}, async () => ({ code: 0 }))).run({
      ...base,
      tool: 'claude-code'
    })
    expect(missing).toMatchObject({ usedTool: false })
    expect(missing.note).toMatch(/isn’t installed/)
    const out = await tools(
      fakeRunner({ claude: 'C:\\bin\\claude.exe' }, async () => ({ code: 1 }))
    ).run({ ...base, tool: 'claude-code' })
    expect(out.note).toMatch(/claude auth login/)
    const off = await tools(
      fakeRunner({ grok: 'C:\\bin\\grok.exe' }, async () => ({ code: 0 }))
    ).run({ ...base, tool: 'grok' })
    expect(off.note).toMatch(/experimental and turned off/)
  })

  it('runs Claude Code with its asks sent to our approval endpoint, and the request on stdin', async () => {
    const server = await startApprovalServer()
    const asked: string[] = []
    try {
      const runner = fakeRunner(
        { claude: 'C:\\bin\\claude.exe' },
        async (_program, args, options) => {
          if (args[0] === 'auth') return { code: 0 }
          // Behave like Claude Code: read the MCP config, ask before running a command.
          expect(args).toContain('--permission-prompt-tool')
          expect(args).toContain('mcp__titan117__approve')
          expect(args.join(' ')).not.toContain('Fix it')
          expect(options.stdin).toBe('Fix it')
          const config = JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'))
          const { url, headers } = config.mcpServers.titan117
          const reply = await (
            await fetch(url, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                  name: 'approve',
                  arguments: { tool_name: 'Bash', input: { command: 'npm test' } }
                }
              })
            })
          ).json()
          const verdict = JSON.parse(reply.result.content[0].text).behavior
          return {
            code: 0,
            stdout: `{"type":"result","result":"command ${verdict}","is_error":false}\n`
          }
        }
      )
      const own = createOwnTools({
        approvals: server,
        scratch: tempFolder('t117-own-'),
        enabled: () => false,
        changes: async () => new Map(),
        run: runner
      })
      const result = await own.run({
        ...base,
        tool: 'claude-code',
        decide: async (ask) => {
          asked.push(`${ask.permission}:${String(ask.metadata.command)}`)
          return { allowed: false, why: 'you said no' }
        }
      })
      expect(asked).toEqual(['bash:npm test'])
      expect(result).toMatchObject({ usedTool: true, status: 'done', text: 'command deny' })
    } finally {
      await server.stop()
    }
  })

  it('asks once before an experimental tool runs, and doesn’t run it when refused', async () => {
    let ran = false
    const runner = fakeRunner({ codex: 'C:\\bin\\codex.exe' }, async (_p, args) => {
      if (args[0] === 'login') return { code: 0 }
      ran = true
      return { code: 0, stdout: 'done' }
    })
    const refused = await tools(runner, ['codex']).run({
      ...base,
      tool: 'codex',
      approveJob: async () => ({ allowed: false, why: 'no' })
    })
    expect(refused).toMatchObject({ usedTool: true, status: 'stopped' })
    expect(ran).toBe(false)
    const approved = await tools(runner, ['codex']).run({ ...base, tool: 'codex' })
    expect(approved).toMatchObject({ usedTool: true, status: 'done', text: 'done' })
    expect(ran).toBe(true)
  })
})
