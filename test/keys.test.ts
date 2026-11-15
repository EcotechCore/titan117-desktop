// The user's own API keys (features 2.9, 11.5): kept by the shell in the
// keychain, checked once with the provider, and used by the engine to call
// OpenRouter, Anthropic, OpenAI and Google directly, never through us.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createAnthropic, toAnthropic } from '../src/engine/lib/anthropic'
import type { Engine } from '../src/engine/lib/engine'
import { engineFetch } from '../src/engine/lib/net'
import { listDirectModels } from '../src/engine/lib/openrouter'
import { Keys } from '../src/main/lib/keys'
import type { TurnRequest } from '../src/engine/models/types'
import type { ChatMessage, TaskDetail } from '../src/shared/protocol'
import { call, scripted, tempFolder, testEngine, until } from './helpers'

const ANTHROPIC_KEY = 'sk-ant-test-' + 'k'.repeat(30)
const OPENAI_KEY = 'sk-openai-test-' + 'o'.repeat(30)

/** A fake Anthropic Messages API stream: text, then optionally a tool call. */
function anthropicStream(
  opts: { text?: string; tool?: { name: string; input: object }; stop?: string } = {}
): Response {
  const events: object[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 1 }
      }
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' }
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'sig-abc' }
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: (opts.text ?? 'Hello').slice(0, 2) }
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: (opts.text ?? 'Hello').slice(2) }
    },
    { type: 'content_block_stop', index: 1 }
  ]
  if (opts.tool) {
    const json = JSON.stringify(opts.tool.input)
    events.push(
      {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 'toolu_1', name: opts.tool.name, input: {} }
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: json.slice(0, 4) }
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: json.slice(4) }
      },
      { type: 'content_block_stop', index: 2 }
    )
  }
  events.push(
    {
      type: 'message_delta',
      delta: {
        stop_reason: opts.stop ?? (opts.tool ? 'tool_use' : 'end_turn'),
        stop_sequence: null
      },
      usage: { output_tokens: 20 }
    },
    { type: 'message_stop' }
  )
  const body = events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

interface FakeAnthropic {
  fetch: typeof fetch
  requests: { url: string; headers: Headers; body: Record<string, unknown> }[]
}

function fakeAnthropic(responses: (() => Response)[]): FakeAnthropic {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  let i = 0
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // The SDK may pass a Request; read it the same way either way.
    const req = new Request(input, init)
    requests.push({
      url: req.url,
      headers: req.headers,
      body: JSON.parse((await req.text()) || '{}')
    })
    return responses[Math.min(i++, responses.length - 1)]()
  }) as typeof fetch
  return { fetch: fake, requests }
}

const turn = (messages: ChatMessage[] = [{ role: 'user', text: 'hi' }]): TurnRequest => ({
  model: 'claude-test',
  system: 'You are Titan.',
  messages,
  tools: [
    {
      name: 'list_folder',
      description: 'List a folder',
      params: {
        type: 'object' as const,
        properties: { path: { type: 'string' as const, description: 'Folder' } },
        required: ['path']
      }
    }
  ],
  signal: new AbortController().signal,
  onText: () => undefined
})

describe('Claude with your own Anthropic key', () => {
  it('streams text, returns tool calls, and keeps the turn (thinking included) for next time', async () => {
    const fake = fakeAnthropic([
      () =>
        anthropicStream({
          text: 'Hello there',
          tool: { name: 'list_folder', input: { path: '.' } }
        })
    ])
    const provider = createAnthropic({ fetch: engineFetch(fake.fetch), key: () => ANTHROPIC_KEY })
    const seen: string[] = []
    const result = await provider.turn({ ...turn(), onText: (t) => seen.push(t) })

    expect(seen.join('')).toBe('Hello there')
    expect(result.text).toBe('Hello there')
    expect(result.toolCalls).toEqual([{ id: 'toolu_1', name: 'list_folder', input: { path: '.' } }])
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 20, costUsd: 0 })
    expect(result.via).toBe('via your Anthropic key')
    expect((result.raw!.content as { type: string }[]).map((b) => b.type)).toEqual([
      'thinking',
      'text',
      'tool_use'
    ])

    const req = fake.requests[0]
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    // The SDK sends the key in a header (authorization in SDK 1.x); never in the URL or body.
    const sent = [req.headers.get('x-api-key'), req.headers.get('authorization')].join(' ')
    expect(sent).toContain(ANTHROPIC_KEY)
    expect(req.url).not.toContain(ANTHROPIC_KEY)
    expect(JSON.stringify(req.body)).not.toContain(ANTHROPIC_KEY)
    expect(req.body).toMatchObject({ model: 'claude-test', stream: true, system: 'You are Titan.' })
    expect((req.body.tools as { eager_input_streaming?: boolean }[])[0].eager_input_streaming).toBe(
      true
    )
  })

  it('sends the previous turn back unchanged, and all tool results in one user turn', () => {
    const raw = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'tool_use', id: 't1', name: 'a', input: {} },
      { type: 'tool_use', id: 't2', name: 'b', input: {} }
    ]
    const wire = toAnthropic([
      { role: 'user', text: 'go' },
      { role: 'assistant', text: '', toolCalls: [], raw: { source: 'anthropic', content: raw } },
      { role: 'tool', callId: 't1', name: 'a', output: 'one' },
      { role: 'tool', callId: 't2', name: 'b', output: 'two', isError: true }
    ])
    expect(wire[1]).toEqual({ role: 'assistant', content: raw })
    expect(wire[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'one' },
        { type: 'tool_result', tool_use_id: 't2', content: 'two', is_error: true }
      ]
    })
  })

  it('never runs a tool call cut off by the token limit, and says so when Claude declines', async () => {
    const cut = fakeAnthropic([
      () =>
        anthropicStream({ tool: { name: 'list_folder', input: { path: '.' } }, stop: 'max_tokens' })
    ])
    await expect(
      createAnthropic({ fetch: cut.fetch, key: () => ANTHROPIC_KEY }).turn(turn())
    ).rejects.toThrow(/ran out of room/)
    const refused = fakeAnthropic([() => anthropicStream({ stop: 'refusal' })])
    await expect(
      createAnthropic({ fetch: refused.fetch, key: () => ANTHROPIC_KEY }).turn(turn())
    ).rejects.toThrow(/declined/)
  })

  it('explains a refused key without showing it', async () => {
    const bad = fakeAnthropic([
      () =>
        Response.json(
          { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
          { status: 401 }
        )
    ])
    const failure = await createAnthropic({ fetch: bad.fetch, key: () => ANTHROPIC_KEY })
      .turn(turn())
      .catch((e: Error) => e)
    expect(String(failure)).toMatch(/Anthropic refused your API key/)
    expect(String(failure)).not.toContain(ANTHROPIC_KEY)
  })

  it('asks for a key when there is none', async () => {
    await expect(createAnthropic({ fetch: fetch, key: () => null }).turn(turn())).rejects.toThrow(
      /Add your Anthropic API key/
    )
  })
})

describe('saving keys on this laptop', () => {
  const keychain = {
    encrypt: (text: string) => Buffer.from(`enc:${Buffer.from(text).toString('base64')}`),
    decrypt: (data: Buffer) => Buffer.from(data.toString().slice(4), 'base64').toString()
  }
  const provider = (status: number): typeof fetch =>
    (async () => new Response('{}', { status })) as typeof fetch

  it('checks a key with its provider first, then keeps it only in the keychain', async () => {
    const dir = tempFolder()
    const keys = new Keys(dir, keychain, provider(200))
    expect(await keys.save('openai', OPENAI_KEY)).toEqual({ ok: true })
    expect(keys.saved()).toEqual({
      openrouter: false,
      anthropic: false,
      openai: true,
      google: false
    })
    expect(keys.all()).toEqual({ openai: OPENAI_KEY })
    expect(readFileSync(join(dir, 'keys', 'openai.bin'), 'utf8')).not.toContain(OPENAI_KEY)

    keys.remove('openai')
    expect(keys.saved().openai).toBe(false)
  })

  it('refuses a key the provider rejects, something that isn’t a key, and an unknown provider', async () => {
    const keys = new Keys(tempFolder(), keychain, provider(401))
    expect(await keys.save('openai', OPENAI_KEY)).toMatchObject({
      ok: false,
      problem: /didn’t accept/
    })
    expect(await keys.save('openai', 'short')).toMatchObject({ ok: false })
    expect(await keys.save('openai', 'has spaces in it but is long enough to pass')).toMatchObject({
      ok: false
    })
    expect(await keys.save('mistral', OPENAI_KEY)).toMatchObject({ ok: false })
    expect(keys.saved().openai).toBe(false)
  })

  it('says so when offline instead of saving an unchecked key', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const keys = new Keys(tempFolder(), keychain, offline)
    expect(await keys.save('openai', OPENAI_KEY)).toMatchObject({
      ok: false,
      problem: /Couldn’t reach/
    })
  })

  it('without a keychain, nothing is saved', async () => {
    const keys = new Keys(tempFolder(), null, provider(200))
    expect(await keys.save('openai', OPENAI_KEY)).toMatchObject({
      ok: false,
      problem: /no keychain/
    })
  })
})

describe('the engine with your own keys', () => {
  let engine: Engine | null = null
  afterEach(async () => {
    await engine?.close()
    engine = null
  })

  async function finished(taskId: string): Promise<TaskDetail> {
    await until(() => !engine!.parts.runtime.isRunning(taskId))
    return (await call(engine!, 'GET', `/v1/tasks/${taskId}`)).body
  }

  it('sends an OpenAI model straight to OpenAI with your key, asking for token counts', async () => {
    const or = scripted([{ text: 'from OpenAI' }])
    engine = await testEngine({ openRouterKey: null, fetch: or.fetch })
    engine.setKeys({ openai: OPENAI_KEY })
    const state = (await call(engine, 'GET', '/v1/state')).body
    expect(state.ownKeys).toEqual({
      openrouter: false,
      anthropic: false,
      openai: true,
      google: false
    })

    const estimate = (
      await call(engine, 'POST', '/v1/estimate', { model: 'openai:gpt-test', messages: [] })
    ).body
    expect(estimate.label).toBe('Billed to your OpenAI key')

    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'hi',
      model: 'openai:gpt-test'
    })
    const done = await finished(body.task.id)
    expect(done.task.status).toBe('done')
    expect(or.requests[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(or.requests[0].headers.Authorization).toBe(`Bearer ${OPENAI_KEY}`)
    expect(or.requests[0].body).toMatchObject({
      model: 'gpt-test',
      stream_options: { include_usage: true }
    })
    expect(JSON.stringify(done)).not.toContain(OPENAI_KEY)
    expect(done.activity.find((a) => a.kind === 'model')?.summary).toMatch(/· via your OpenAI key$/)
  })

  it('your own OpenRouter key goes straight to OpenRouter, not through the credits proxy', async () => {
    const or = scripted([{ text: 'direct' }])
    engine = await testEngine({ openRouterKey: null, fetch: or.fetch })
    engine.setAccount({
      token: 't117d_' + 'e'.repeat(43),
      proxyUrl: 'http://localhost:3100/api/v1',
      locked: false,
      reason: null
    })
    engine.setKeys({ openrouter: 'sk-or-v1-' + 'r'.repeat(40) })
    expect((await call(engine, 'GET', '/v1/state')).body.cloudVia).toBe('own')
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'hi',
      model: 'openrouter:test/model'
    })
    const done = await finished(body.task.id)
    expect(or.requests[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(done.activity.find((a) => a.kind === 'model')?.summary).toMatch(
      /· via your OpenRouter key$/
    )
  })

  it('a model for a key you haven’t added says what to do', async () => {
    engine = await testEngine({ openRouterKey: null, fetch: scripted([{ text: 'x' }]).fetch })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'hi',
      model: 'google:gemini-test'
    })
    expect((await finished(body.task.id)).task.note).toMatch(/Add your Google API key/)
  })
})

describe('model lists for your own keys', () => {
  it('keeps chat models and drops the rest', async () => {
    const list = (ids: string[]): typeof fetch =>
      (async () => Response.json({ data: ids.map((id) => ({ id })) })) as typeof fetch
    const openai = await listDirectModels(
      list(['gpt-test', 'text-embedding-3', 'whisper-1', 'gpt-test-tts', 'o4-mini']),
      'openai',
      OPENAI_KEY
    )
    expect(openai.map((m) => m.id)).toEqual(['openai:gpt-test', 'openai:o4-mini'])
    const google = await listDirectModels(
      list(['models/gemini-test', 'models/embedding-001']),
      'google',
      'g-key'
    )
    expect(google.map((m) => m.id)).toEqual(['google:gemini-test'])
  })
})
