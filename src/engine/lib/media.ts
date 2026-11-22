/**
 * Images and video through OpenRouter (feature 2.7, decisions §59.10): the
 * same three routes as models, our credits proxy with the device token, the
 * user's own OpenRouter key, or the development key.
 *
 * OpenRouter's pages, read 22 Nov 2026 (external-services.md):
 * - Images: `POST /images` answers `data[].b64_json` with `media_type` and
 *   `usage.cost`; failed or cancelled generations aren't billed.
 * - Video is asynchronous: `POST /videos` answers a job id; `GET /videos/{id}`
 *   says pending, in_progress, completed, failed, cancelled or expired (poll
 *   every 10–30 seconds); `GET /videos/{id}/content` gives the video with the
 *   key; `usage.cost` is on the finished job. Through our proxy the job is
 *   charged when it ends, and only its owner may follow it.
 * - Models: `GET /models?output_modalities=image` (or `video`).
 */
import { OPENROUTER_BASE, type CloudAccess } from './openrouter'
import type { Fetch } from './net'

export type MediaKind = 'image' | 'video'

export interface MediaModel {
  id: string
  name: string
}

export interface MediaResult {
  bytes: Buffer
  mediaType: string
  costUsd: number
  via: CloudAccess['via']
  model: string
}

export class MediaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaError'
  }
}

/** Image and video models we try first when none is chosen (the user can pick any in Models). */
const PREFERRED: Record<MediaKind, RegExp[]> = {
  image: [/^google\/.*image/, /nano-banana/, /^openai\/gpt-.*image/, /^black-forest-labs\//],
  video: [/^google\/veo/, /^bytedance/, /^alibaba\/wan/, /^minimax\//]
}

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_VIDEO_BYTES = 500 * 1024 * 1024
const ENDED = new Set(['completed', 'failed', 'cancelled', 'expired'])

export const VIDEO_POLL_MS = 15_000
export const VIDEO_MAX_MS = 20 * 60_000

async function refusal(response: Response, via: CloudAccess['via']): Promise<MediaError> {
  let detail = ''
  try {
    detail = ((await response.json()) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    // No readable body.
  }
  if (via === 'credits' && response.status === 401)
    return new MediaError('Your sign-in has ended. Sign in again to use cloud models.')
  if (response.status === 402)
    return new MediaError(
      via === 'credits'
        ? 'No credits left, or no active plan. Top up on your account page.'
        : 'The OpenRouter account has no credit left.'
    )
  if (response.status === 429) return new MediaError('Too many calls at once. Try again shortly.')
  return new MediaError(
    `The image or video provider answered ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}.`
  )
}

function viaLabel(via: CloudAccess['via']): string {
  return via === 'credits'
    ? 'via credits'
    : via === 'own'
      ? 'via your OpenRouter key'
      : 'via the development key'
}

export { viaLabel as mediaVia }

export interface MediaService {
  models(kind: MediaKind): Promise<MediaModel[]>
  /** The model to use: the one asked for, the one chosen in settings, or a sensible one from the list. */
  pick(kind: MediaKind, asked?: string | null): Promise<string>
  image(input: {
    model: string
    prompt: string
    aspectRatio?: string
    /** png, jpeg or webp, when the user named a file type. */
    format?: 'png' | 'jpeg' | 'webp'
    signal: AbortSignal
  }): Promise<MediaResult>
  video(input: {
    model: string
    prompt: string
    seconds?: number
    aspectRatio?: string
    signal: AbortSignal
    onProgress?(status: string, progress: number | null): void
  }): Promise<MediaResult>
}

export function createMediaService(deps: {
  fetch: Fetch
  access(): CloudAccess | null
  /** Models the user chose for images and video, if any. */
  chosen?(kind: MediaKind): string | null
  sleep?(ms: number, signal: AbortSignal): Promise<void>
  now?(): number
}): MediaService {
  const now = deps.now ?? Date.now
  const sleep =
    deps.sleep ??
    ((ms, signal) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            reject(new MediaError('Stopped.'))
          },
          { once: true }
        )
      }))
  const cache = new Map<MediaKind, { at: number; models: MediaModel[] }>()

  function need(): CloudAccess {
    const access = deps.access()
    if (!access)
      throw new MediaError(
        'Images and video need the cloud: sign in to use your credits, or add your OpenRouter key in Models.'
      )
    return access
  }

  const headers = (access: CloudAccess, json = true): Record<string, string> => ({
    Authorization: `Bearer ${access.key}`,
    'X-Title': 'Titan117',
    ...(json ? { 'Content-Type': 'application/json' } : {})
  })

  async function readCapped(response: Response, max: number): Promise<Buffer> {
    const length = Number(response.headers.get('content-length') ?? '0')
    if (length > max) throw new MediaError('That file is too big to keep.')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > max) throw new MediaError('That file is too big to keep.')
    return bytes
  }

  const service: MediaService = {
    async models(kind) {
      const hit = cache.get(kind)
      if (hit && now() - hit.at < 60 * 60_000) return hit.models
      // OpenRouter's model list is public; no key goes with it.
      const response = await deps.fetch(`${OPENROUTER_BASE}/models?output_modalities=${kind}`)
      if (!response.ok) throw await refusal(response, 'dev')
      const body = (await response.json()) as { data?: { id: string; name?: string }[] }
      const models = (body.data ?? [])
        .filter((m) => typeof m.id === 'string')
        .map((m) => ({ id: m.id, name: m.name ?? m.id }))
      cache.set(kind, { at: now(), models })
      return models
    },

    async pick(kind, asked) {
      const wanted = (asked ?? '').replace(/^openrouter:/, '').trim() || deps.chosen?.(kind) || ''
      const list = await service.models(kind).catch(() => [] as MediaModel[])
      if (wanted) {
        if (list.length && !list.some((m) => m.id === wanted))
          throw new MediaError(
            `${wanted} doesn't make ${kind === 'image' ? 'images' : 'video'}. Some that do: ${list
              .slice(0, 6)
              .map((m) => m.id)
              .join(', ')}.`
          )
        return wanted
      }
      for (const pattern of PREFERRED[kind]) {
        const found = list.find((m) => pattern.test(m.id))
        if (found) return found.id
      }
      if (list[0]) return list[0].id
      throw new MediaError(`No ${kind} model is available right now.`)
    },

    async image({ model, prompt, aspectRatio, format, signal }) {
      const access = need()
      const response = await deps.fetch(`${access.base}/images`, {
        method: 'POST',
        signal,
        headers: headers(access),
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          response_format: 'b64_json',
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
          ...(format ? { output_format: format } : {})
        })
      })
      if (!response.ok) throw await refusal(response, access.via)
      const body = (await response.json()) as {
        data?: { b64_json?: string; media_type?: string }[]
        usage?: { cost?: number }
      }
      const first = body.data?.find((d) => typeof d.b64_json === 'string')
      if (!first?.b64_json) throw new MediaError('The provider sent no image back.')
      const bytes = Buffer.from(first.b64_json, 'base64')
      if (bytes.length > MAX_IMAGE_BYTES) throw new MediaError('That image is too big to keep.')
      return {
        bytes,
        mediaType: first.media_type ?? 'image/png',
        costUsd: typeof body.usage?.cost === 'number' ? body.usage.cost : 0,
        via: access.via,
        model
      }
    },

    async video({ model, prompt, seconds, aspectRatio, signal, onProgress }) {
      const access = need()
      const started = await deps.fetch(`${access.base}/videos`, {
        method: 'POST',
        signal,
        headers: headers(access),
        body: JSON.stringify({
          model,
          prompt,
          ...(seconds ? { duration: seconds } : {}),
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {})
        })
      })
      if (!started.ok) throw await refusal(started, access.via)
      const job = (await started.json()) as { id?: string }
      if (typeof job.id !== 'string' || !/^[0-9A-Za-z_-]{1,128}$/.test(job.id))
        throw new MediaError('The provider sent no job back.')
      const id = job.id
      const until = now() + VIDEO_MAX_MS
      let cost = 0
      for (;;) {
        await sleep(VIDEO_POLL_MS, signal)
        const poll = await deps.fetch(`${access.base}/videos/${id}`, {
          signal,
          headers: headers(access, false)
        })
        if (!poll.ok) throw await refusal(poll, access.via)
        const state = (await poll.json()) as {
          status?: string
          progress?: number | null
          error?: unknown
          usage?: { cost?: number | null }
          cost?: number | null
        }
        const status = state.status ?? 'pending'
        onProgress?.(status, typeof state.progress === 'number' ? state.progress : null)
        const c = state.usage?.cost ?? state.cost
        if (typeof c === 'number') cost = c
        if (status === 'completed') break
        if (ENDED.has(status))
          throw new MediaError(
            `The video ${status}${typeof state.error === 'string' ? `: ${state.error.slice(0, 200)}` : ''}.`
          )
        if (now() > until)
          throw new MediaError(
            'The video took longer than 20 minutes. It may still finish at the provider.'
          )
      }
      const content = await deps.fetch(`${access.base}/videos/${id}/content?index=0`, {
        signal,
        headers: headers(access, false)
      })
      if (!content.ok) throw await refusal(content, access.via)
      return {
        bytes: await readCapped(content, MAX_VIDEO_BYTES),
        mediaType: content.headers.get('content-type') ?? 'video/mp4',
        costUsd: cost,
        via: access.via,
        model
      }
    }
  }
  return service
}

/** A file extension for what came back. */
export function extensionFor(mediaType: string): string {
  const type = mediaType.split(';')[0].trim().toLowerCase()
  return (
    {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov'
    }[type] ?? (type.startsWith('video/') ? 'mp4' : 'png')
  )
}
