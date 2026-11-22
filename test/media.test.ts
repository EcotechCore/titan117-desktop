// Images and video through OpenRouter (feature 2.7, decisions §59.10):
// the media client against a fake OpenRouter (or our credits proxy), and the
// image tool through the real engine: it asks, saves the file, counts the cost.
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import type { Engine } from '../src/engine/lib/engine'
import { createMediaService, extensionFor, MediaError } from '../src/engine/lib/media'
import { call, MODEL, scripted, tempFolder, testEngine, until } from './helpers'

// A tiny PNG's first bytes, made here (not a key or a secret).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

interface Seen {
  url: string
  method: string
  auth: string | null
  body: Record<string, unknown> | null
}

function fakeProvider(options: { videoStates?: string[]; imageStatus?: number } = {}): {
  fetch: typeof fetch
  seen: Seen[]
} {
  const seen: Seen[] = []
  const states = [...(options.videoStates ?? ['in_progress', 'completed'])]
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    seen.push({
      url,
      method: init?.method ?? 'GET',
      auth: headers.Authorization ?? null,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    })
    if (url.includes('/models?output_modalities=image'))
      return Response.json({
        data: [
          { id: 'acme/painter', name: 'Acme Painter' },
          { id: 'google/gemini-9-image', name: 'Gemini Image' }
        ]
      })
    if (url.includes('/models?output_modalities=video'))
      return Response.json({ data: [{ id: 'google/veo-9', name: 'Veo 9' }] })
    if (url.endsWith('/images')) {
      if (options.imageStatus)
        return Response.json({ error: { message: 'nope' } }, { status: options.imageStatus })
      return Response.json({
        data: [{ b64_json: PNG.toString('base64'), media_type: 'image/png' }],
        usage: { cost: 0.04 }
      })
    }
    if (url.endsWith('/videos'))
      return Response.json({ id: 'job_1', status: 'pending' }, { status: 202 })
    if (url.endsWith('/videos/job_1')) {
      const status = states.shift() ?? 'completed'
      return Response.json({
        id: 'job_1',
        status,
        ...(status === 'completed' ? { usage: { cost: 0.5 } } : {}),
        ...(status === 'failed' ? { error: 'content policy' } : {})
      })
    }
    if (url.includes('/videos/job_1/content'))
      return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
        headers: { 'content-type': 'video/mp4' }
      })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { fetch: fake, seen }
}

const signal = new AbortController().signal
const noSleep = async (): Promise<void> => undefined

describe('the media client', () => {
  it('makes an image through the credits proxy with the device token, and reads its cost', async () => {
    const p = fakeProvider()
    const media = createMediaService({
      fetch: p.fetch,
      access: () => ({ base: 'https://titan117.test/api/v1', key: 'device-token', via: 'credits' })
    })
    expect(await media.pick('image')).toBe('google/gemini-9-image')
    const image = await media.image({
      model: 'google/gemini-9-image',
      prompt: 'a cake',
      format: 'png',
      signal
    })
    expect(image).toMatchObject({ mediaType: 'image/png', costUsd: 0.04, via: 'credits' })
    expect(image.bytes.equals(PNG)).toBe(true)
    const sent = p.seen.find((s) => s.url.endsWith('/images'))!
    expect(sent.url).toBe('https://titan117.test/api/v1/images')
    expect(sent.auth).toBe('Bearer device-token')
    expect(sent.body).toMatchObject({
      model: 'google/gemini-9-image',
      response_format: 'b64_json',
      output_format: 'png'
    })
    // The model list is public: no key goes with it.
    expect(p.seen.find((s) => s.url.includes('/models'))!.auth).toBeNull()
  })

  it('refuses a model that does not make images, and says when there is no cloud', async () => {
    const p = fakeProvider()
    const media = createMediaService({
      fetch: p.fetch,
      access: () => null
    })
    await expect(media.pick('image', 'acme/chat-only')).rejects.toThrow(/doesn't make images/)
    await expect(media.image({ model: 'acme/painter', prompt: 'x', signal })).rejects.toThrow(
      /sign in to use your credits/
    )
  })

  it('follows a video job to the end, then downloads it', async () => {
    const p = fakeProvider({ videoStates: ['pending', 'in_progress', 'completed'] })
    const progress: string[] = []
    const media = createMediaService({
      fetch: p.fetch,
      access: () => ({ base: 'https://openrouter.ai/api/v1', key: 'own-key', via: 'own' }),
      sleep: noSleep
    })
    const video = await media.video({
      model: 'google/veo-9',
      prompt: 'a bakery at dawn',
      seconds: 4,
      signal,
      onProgress: (s) => progress.push(s)
    })
    expect(progress).toEqual(['pending', 'in_progress', 'completed'])
    expect(video).toMatchObject({ mediaType: 'video/mp4', costUsd: 0.5, via: 'own' })
    expect(p.seen.find((s) => s.url.endsWith('/videos'))!.body).toMatchObject({ duration: 4 })
    expect(p.seen.at(-1)!.url).toContain('/videos/job_1/content?index=0')
  })

  it('stops on a failed job and on a refused call', async () => {
    const failed = createMediaService({
      fetch: fakeProvider({ videoStates: ['failed'] }).fetch,
      access: () => ({ base: 'https://openrouter.ai/api/v1', key: 'k', via: 'dev' }),
      sleep: noSleep
    })
    await expect(failed.video({ model: 'google/veo-9', prompt: 'x', signal })).rejects.toThrow(
      /failed: content policy/
    )
    const broke = createMediaService({
      fetch: fakeProvider({ imageStatus: 402 }).fetch,
      access: () => ({ base: 'https://titan117.test/api/v1', key: 'k', via: 'credits' })
    })
    await expect(
      broke.image({ model: 'acme/painter', prompt: 'x', signal })
    ).rejects.toBeInstanceOf(MediaError)
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('video/webm')).toBe('webm')
  })
})

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

describe('image_create in a task', () => {
  it('asks, saves the image in the allowed folder, and counts its cost', async () => {
    const folder = tempFolder()
    const provider = fakeProvider()
    const or = scripted([
      {
        toolCalls: [
          {
            name: 'image_create',
            input: { prompt: 'a chocolate cake on a wooden table', path: 'cake' }
          }
        ]
      },
      { text: 'Saved.' }
    ])
    const both = (async (input: RequestInfo | URL, init?: RequestInit) =>
      /\/(images|videos)|output_modalities/.test(String(input))
        ? provider.fetch(input, init)
        : or.fetch(input, init)) as typeof fetch
    engine = await testEngine({ fetch: both, folder })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'make a cake picture',
      model: MODEL
    })
    const approval = await until(
      () => engine!.parts.store.listApprovals({ taskId: body.task.id, status: 'pending' })[0]
    )
    expect(approval).toMatchObject({ tool: 'image_create', canAlways: true })
    expect(approval.summary).toMatch(/costs credits/)
    // Nothing made before the yes.
    expect(provider.seen.some((s) => s.url.endsWith('/images'))).toBe(false)
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
    await until(() => !engine!.parts.runtime.isRunning(body.task.id))
    expect(readFileSync(join(folder, 'cake.png')).equals(PNG)).toBe(true)
    const done = (await call(engine, 'GET', `/v1/tasks/${body.task.id}`)).body
    expect(done.task.costUsd).toBeGreaterThanOrEqual(0.04)
    expect(
      done.activity.find(
        (a: { tool: string; kind: string }) => a.tool === 'image_create' && a.kind === 'tool'
      ).summary
    ).toMatch(/Made an image with google\/gemini-9-image: cake\.png/)
    // The chosen models are a setting.
    const media = await call(engine, 'PUT', '/v1/media', { image: 'acme/painter', video: null })
    expect(media.body).toMatchObject({ image: 'acme/painter', video: null })
    expect((await call(engine, 'PUT', '/v1/media', { image: 'not a model' })).status).toBe(400)
    expect(existsSync(join(folder, 'images'))).toBe(false)
  })
})
