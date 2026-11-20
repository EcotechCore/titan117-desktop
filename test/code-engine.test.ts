/**
 * Phase 7, the coding engine (decisions §53): the permission mapping, the
 * model bridge and the pinned downloads. The contract tests against the real
 * OpenCode program are in code-engine.contract.test.ts.
 */
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { assessAsk, type EngineAsk } from '../src/engine/lib/code/assess'
import { startModelBridge, toConversation, toToolSpecs } from '../src/engine/lib/code/bridge'
import { createComponents, fromTgz, matchesHash } from '../src/engine/lib/code/components'
import { editedFiles, opencodeConfig, OPENCODE_FLAGS } from '../src/engine/lib/code/opencode'
import type { FolderPolicy } from '../src/engine/lib/folders'

function repoSetup(): { repo: string; policy: FolderPolicy; outside: string } {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 't117-code-')))
  const repo = join(root, 'repo')
  const outside = join(root, 'other')
  mkdirSync(repo)
  mkdirSync(outside)
  return { repo, outside, policy: { allowed: [repo], core: [join(root, 'app-data')] } }
}

const ask = (
  permission: string,
  patterns: string[],
  metadata: Record<string, unknown> = {}
): EngineAsk => ({
  id: 'per_1',
  sessionID: 'ses_1',
  permission,
  patterns,
  metadata,
  always: []
})

describe('the coding engine’s asks, judged by our rules', () => {
  it('lets read-only commands run and asks for the rest, with "always" per program in the repo', async () => {
    const { repo, policy } = repoSetup()
    const look = await assessAsk(
      ask('bash', ['git status'], { command: 'git status' }),
      repo,
      policy
    )
    expect(look.assessment.risk).toBe('read')
    const install = await assessAsk(
      ask('bash', ['npm install'], { command: 'npm install' }),
      repo,
      policy
    )
    expect(install.assessment.risk).toBe('write')
    expect(install.assessment.standing).toMatchObject({ folder: repo, command: 'npm install' })
    expect(install.assessment.outgoing).toBe('npm install')
  })

  it('puts deleting and force-pushing on the always-ask list', async () => {
    const { repo, policy } = repoSetup()
    for (const command of ['rm -rf build', 'git push --force'])
      expect(
        (await assessAsk(ask('bash', [command], { command }), repo, policy)).assessment.alwaysAsks
      ).toBe(true)
  })

  it('allows edits inside the project and refuses them outside, in credentials or read-only folders', async () => {
    const { repo, policy, outside } = repoSetup()
    const inside = await assessAsk(ask('edit', ['src/app.ts'], { diff: '+x' }), repo, policy)
    expect(inside.assessment.refuse).toBeUndefined()
    expect(inside.assessment.risk).toBe('write')
    expect(inside.tool).toBe('code_edit')

    const away = await assessAsk(ask('edit', [join(outside, 'x.ts')]), repo, policy)
    expect(away.assessment.refuse).toMatch(/outside/)
    const secret = await assessAsk(ask('edit', ['.env']), repo, policy)
    expect(secret.assessment.refuse).toMatch(/credential/i)
    const readOnly = await assessAsk(ask('edit', ['a.md']), repo, { ...policy, readOnly: [repo] })
    expect(readOnly.assessment.refuse).toMatch(/read-only/)
  })

  it('refuses web access, folders outside the project and anything unknown', async () => {
    const { repo, policy } = repoSetup()
    for (const permission of ['webfetch', 'websearch', 'external_directory', 'something_new'])
      expect((await assessAsk(ask(permission, ['x']), repo, policy)).assessment.refuse).toBeTruthy()
  })
})

describe('OpenCode’s settings', () => {
  it('has one provider (our bridge), no web tools, no sharing, no updates, nothing outside the project', () => {
    const config = opencodeConfig('http://127.0.0.1:1/v1', 'tok', 'file:///p.mjs') as {
      provider: Record<string, { options: { baseURL: string } }>
      permission: Record<string, unknown>
      share: string
      autoupdate: boolean
      enabled_providers: string[]
      plugin: string[]
    }
    expect(config.plugin).toEqual(['file:///p.mjs'])
    expect(Object.keys(config.provider)).toEqual(['titan117'])
    expect(config.enabled_providers).toEqual(['titan117'])
    expect(config.provider.titan117.options.baseURL).toBe('http://127.0.0.1:1/v1')
    expect(config.share).toBe('disabled')
    expect(config.autoupdate).toBe(false)
    for (const p of ['webfetch', 'websearch', 'external_directory'])
      expect(config.permission[p]).toBe('deny')
    expect(config.permission.bash).toBe('ask')
    expect(config.permission.edit).toBe('ask')
    expect(OPENCODE_FLAGS.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1')
    expect(OPENCODE_FLAGS.OPENCODE_DISABLE_MODELS_FETCH).toBe('1')
  })
})

describe('the model bridge', () => {
  it('turns OpenAI messages into our conversation', () => {
    const { system, messages } = toConversation([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: [{ type: 'text', text: 'Fix it' }] },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', function: { name: 'bash', arguments: '{"command":"ls"}' } }]
      },
      { role: 'tool', tool_call_id: 'c1', content: 'a.ts' }
    ])
    expect(system).toBe('Be brief.')
    expect(messages).toEqual([
      { role: 'user', text: 'Fix it' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 'c1', name: 'bash', input: { command: 'ls' } }]
      },
      { role: 'tool', callId: 'c1', name: 'bash', output: 'a.ts' }
    ])
    expect(
      toToolSpecs([{ type: 'function', function: { name: 'read', description: 'Read' } }])[0].name
    ).toBe('read')
  })

  it('streams a step back, refuses unknown tokens, web pages and refused steps', async () => {
    const bridge = await startModelBridge()
    try {
      const token = bridge.open({
        taskId: 't1',
        signal: new AbortController().signal,
        async step({ onText }) {
          onText('Hel')
          onText('lo')
          return {
            text: 'Hello',
            toolCalls: [{ id: 'c1', name: 'bash', input: { command: 'ls' } }],
            usage: { inputTokens: 5, outputTokens: 2, costUsd: 0 }
          }
        }
      })
      const post = (auth: string, extra: Record<string, string> = {}): Promise<Response> =>
        fetch(`${bridge.url}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth}`,
            'Content-Type': 'application/json',
            ...extra
          },
          body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] })
        })
      expect((await post('wrong')).status).toBe(401)
      expect((await post(token, { Origin: 'https://evil.example' })).status).toBe(403)
      const res = await post(token)
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain('"content":"Hel"')
      expect(body).toContain('"tool_calls"')
      expect(body).toContain('"finish_reason":"tool_calls"')
      expect(body).toContain('[DONE]')

      const refused = bridge.open({
        taskId: 't2',
        signal: new AbortController().signal,
        step: async () => ({ refused: 'This task is for local models only.' })
      })
      const no = await post(refused)
      expect(no.status).toBe(400)
      expect(await no.text()).toContain('local models only')
      bridge.close(token)
      expect((await post(token)).status).toBe(401)
    } finally {
      await bridge.stop()
    }
  })
})

/** A one-file tar.gz, like an npm package. */
function tgz(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0)
  header.write('0000644\0', 100)
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124)
  header.write('0', 156)
  header.write('ustar\0', 257)
  const pad = Buffer.alloc((512 - (content.length % 512)) % 512)
  return gzipSync(Buffer.concat([header, content, pad, Buffer.alloc(1024)]))
}

describe('the pinned downloads', () => {
  it('reads one file out of a tar.gz and checks both hash kinds', () => {
    const archive = tgz('package/bin/opencode', Buffer.from('program'))
    expect(Buffer.from(fromTgz(archive, 'package/bin/opencode')!).toString()).toBe('program')
    expect(fromTgz(archive, 'package/other')).toBeNull()
    const sha512 = `sha512-${createHash('sha512').update(archive).digest('base64')}`
    const sha256 = `sha256-${createHash('sha256').update(archive).digest('hex')}`
    expect(matchesHash(archive, sha512)).toBe(true)
    expect(matchesHash(archive, sha256)).toBe(true)
    expect(matchesHash(Buffer.from('other'), sha512)).toBe(false)
    expect(matchesHash(archive, 'md5-x')).toBe(false)
  })

  it('throws a download away when it doesn’t match its fingerprint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't117-comp-'))
    const components = createComponents({
      dir,
      platform: 'win32-x64',
      fetch: (async () =>
        new Response(tgz('package/bin/opencode.exe', Buffer.from('tampered')))) as typeof fetch
    })
    await expect(components.ensure()).rejects.toThrow(/fingerprint/)
    expect(components.status().every((c) => !c.ready)).toBe(true)
  })

  it('says plainly when there’s no internet', async () => {
    const components = createComponents({
      dir: mkdtempSync(join(tmpdir(), 't117-comp-')),
      platform: 'win32-x64',
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch
    })
    await expect(components.ensure()).rejects.toThrow(/needs the internet once/)
  })
})

describe('changed files', () => {
  it('come from the edits we approved: one file with its diff, or a patch with its list', () => {
    const one = editedFiles({
      id: 'p',
      sessionID: 's',
      permission: 'edit',
      patterns: ['src\\shop.js'],
      metadata: { diff: '--- a\n+++ b\n-old\n+new\n+more\n' },
      always: []
    })
    expect(one).toEqual([{ file: 'src/shop.js', additions: 2, deletions: 1 }])
    const patch = editedFiles({
      id: 'p',
      sessionID: 's',
      permission: 'edit',
      patterns: ['a.ts', 'b.ts'],
      metadata: { files: [{ relativePath: 'a.ts', additions: 3, deletions: 0 }] },
      always: []
    })
    expect(patch).toEqual([{ file: 'a.ts', additions: 3, deletions: 0 }])
  })
})
