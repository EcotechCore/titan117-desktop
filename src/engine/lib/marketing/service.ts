/**
 * Marketing (phase 14; decisions §62): the brand kit, the content calendar
 * with its "Time to post" reminders, and the promo video. Everything is on
 * the laptop; nothing here posts, sends or publishes anywhere.
 *
 * Reminders run while the app is open, like schedules (8.1): every 30
 * seconds it looks for ready posts whose time has come, and each is
 * announced once. One that came due while the laptop was off is announced
 * when the app opens again, unless its day passed long ago.
 */
import { extname } from 'node:path'

import { getMeta, setMeta, type Db } from '../db'
import type { MemoryStore } from '../../memory'
import { readWav, resample } from '../speech'
import {
  MarketingError,
  cleanMarketingBrand,
  describeBrand,
  hasBrand,
  readSite,
  type MarketingBrand,
  type SiteBrand,
  type SiteReadDeps
} from './brand'
import { createPostStore, type Post, type PostStore } from './posts'
import { createMailer, type Mailer } from './mailer'
import type { MailProviderId, Sequence } from './mail'
import {
  AUDIO_RATE,
  mixVoice,
  renderVideo,
  timeline,
  type RenderDeps,
  type RenderedVideo,
  type VideoSpec
} from './video'

export const REMIND_TICK_MS = 30_000
/** How the brand kit's memory is told apart from the user's own. */
export const BRAND_MEMORY_SOURCE = 'the brand kit'
const MAX_IMAGE_BYTES = 20_000_000
const MAX_CLIP_BYTES = 40_000_000
const MAX_CLIPS_BYTES = 120_000_000
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

export interface MadeVideo extends RenderedVideo {
  /** How many scenes were read aloud. */
  voiced: number
}

export interface MarketingService {
  brand: {
    get(): MarketingBrand | null
    /** Checked and saved; what isn't given keeps its last value. */
    save(input: unknown): MarketingBrand
  }
  posts: PostStore
  /** Newsletters and sequences through the user's own email provider (15.5, 15.6). */
  mail: Mailer
  /** A published site's visits (15.10), read with the user's own Cloudflare token. */
  visits(site: string, days: number): Promise<import('../apps/cloudflare').SiteVisits>
  readSite(
    urls: string[],
    options: { screenshots?: boolean },
    deps: SiteReadDeps
  ): Promise<SiteBrand>
  /**
   * Make a video. `load` reads a picture by the path the scene gave: the
   * caller decides what may be read (a tool reads through its file access).
   */
  video(
    spec: VideoSpec,
    load: (path: string) => Promise<Buffer>,
    deps?: { signal?: AbortSignal }
  ): Promise<MadeVideo>
  start(): void
  stop(): void
  /** Look for posts that are due now (also called when the app unlocks). */
  tick(): void
}

export function createMarketing(deps: {
  db: Db
  /** The system voice, for voiceovers; null where there is none. */
  speech?: { synthesize(text: string): Promise<Buffer> } | null
  /** Shared memory: the kit is kept there too, so every agent knows the company (15.1). */
  memory?: MemoryStore
  /** Why nothing may run now (the app is locked), or null. */
  locked?: () => string | null
  onChange?: () => void
  /** Posts whose time has come: the window and a notification say so. */
  onRemind?: (posts: Post[]) => void
  onError?: (error: unknown, context: Record<string, unknown>) => void
  now?: () => number
  launch?: RenderDeps['launch']
  /** The user's own email provider keys; without them nothing can be sent. */
  mailKeys?: () => Partial<Record<MailProviderId, string>>
  /** The network for the email provider's API; none means sending is refused. */
  mailFetch?: typeof fetch
  resolveTxt?: (name: string) => Promise<string[][]>
  onSequence?: (sequence: Sequence, note: string, failed: boolean) => void
  mailPollMs?: number
  /** A published site's visits, from the user's own Cloudflare account (15.10). */
  visits?: (site: string, days: number) => Promise<import('../apps/cloudflare').SiteVisits>
}): MarketingService {
  const { db } = deps
  const changed = deps.onChange ?? (() => undefined)
  const posts = createPostStore({ db, onChange: changed, now: deps.now })
  let timer: ReturnType<typeof setInterval> | null = null
  const mail = createMailer({
    db,
    brand: () => getBrand(),
    keys: deps.mailKeys ?? (() => ({})),
    fetch:
      deps.mailFetch ??
      (async () => {
        throw new MarketingError('Sending email isn’t available here.')
      }),
    resolveTxt:
      deps.resolveTxt ??
      (async () => {
        throw Object.assign(new Error('no DNS'), { code: 'ESERVFAIL' })
      }),
    locked: deps.locked,
    onChange: changed,
    onSequence: deps.onSequence,
    onError: deps.onError,
    now: deps.now,
    pollMs: deps.mailPollMs
  })

  function getBrand(): MarketingBrand | null {
    const saved = getMeta<unknown>(db, 'brandKit', null)
    return saved ? cleanMarketingBrand(saved) : null
  }

  /** The kit as one shared memory, replaced on every save. */
  function remember(brand: MarketingBrand): void {
    const memory = deps.memory
    if (!memory) return
    try {
      const existing = memory
        .list({ scopes: ['shared'], limit: 500 })
        .find((m) => m.source === BRAND_MEMORY_SOURCE)
      if (!hasBrand(brand)) {
        if (existing) memory.remove(existing.id)
        return
      }
      const text = `Our company's brand kit.\n${describeBrand(brand)}`.slice(0, 1900)
      if (existing) memory.update(existing.id, { text })
      else memory.add({ scope: 'shared', kind: 'profile', text, source: BRAND_MEMORY_SOURCE })
    } catch (error) {
      deps.onError?.(error, { what: 'brand memory' })
    }
  }

  async function dataUrl(path: string, load: (path: string) => Promise<Buffer>): Promise<string> {
    const type = IMAGE_TYPES[extname(path).toLowerCase()]
    if (!type) throw new MarketingError(`"${path}" isn't a picture this video can show.`)
    const bytes = await load(path)
    if (bytes.length > MAX_IMAGE_BYTES)
      throw new MarketingError(`"${path}" is too large for a video (20 MB at most).`)
    return `data:${type};base64,${bytes.toString('base64')}`
  }

  const service: MarketingService = {
    brand: {
      get: getBrand,
      save(input) {
        const before = getBrand()
        const next = cleanMarketingBrand({
          ...(before ?? {}),
          ...((input ?? {}) as object),
          updatedAt: (deps.now ?? Date.now)()
        })
        setMeta(db, 'brandKit', next)
        remember(next)
        changed()
        return next
      }
    },

    posts,
    mail,

    visits(site, days) {
      if (!deps.visits) throw new MarketingError('Reading visits isn’t available here.')
      return deps.visits(site, days)
    },

    readSite: (urls, options, readDeps) =>
      readSite(urls, options, { ...readDeps, launch: readDeps.launch ?? deps.launch }),

    async video(spec, load, options = {}) {
      const images = new Map<string, string>()
      const clips = new Map<string, string>()
      let clipBytes = 0
      for (const scene of spec.scenes) {
        if (scene.kind === 'image' && !images.has(scene.image))
          images.set(scene.image, await dataUrl(scene.image, load))
        if (scene.kind === 'clip' && !clips.has(scene.video)) {
          const bytes = await load(scene.video)
          clipBytes += bytes.length
          if (bytes.length > MAX_CLIP_BYTES || clipBytes > MAX_CLIPS_BYTES)
            throw new MarketingError(
              `"${scene.video}" is too large for a video here (40 MB a clip, 120 MB in all).`
            )
          const type = /\.webm$/i.test(scene.video) ? 'video/webm' : 'video/mp4'
          clips.set(scene.video, `data:${type};base64,${bytes.toString('base64')}`)
        }
      }
      // A logo that can't be read is left out; a scene's own picture must be there.
      const logo = spec.look.logo ? await dataUrl(spec.look.logo, load).catch(() => '') : ''

      const voices: (Float32Array | null)[] = spec.scenes.map(() => null)
      if (spec.voiceover && spec.scenes.some((s) => s.say)) {
        const speech = deps.speech
        if (!speech) throw new MarketingError('There is no voice on this laptop for a voiceover.')
        for (const [i, scene] of spec.scenes.entries()) {
          if (!scene.say) continue
          if (options.signal?.aborted) throw new MarketingError('The video was stopped.')
          const wav = readWav(await speech.synthesize(scene.say))
          voices[i] = resample(wav.samples, wav.rate, AUDIO_RATE)
        }
      }
      const timed = timeline(
        spec,
        voices.map((v) => (v ? v.length / AUDIO_RATE : null))
      )
      const voiced = voices.filter(Boolean).length
      const video = await renderVideo(
        spec,
        { images, clips, logo, voice: voiced ? mixVoice(timed, voices) : null, timed },
        { signal: options.signal, launch: deps.launch }
      )
      return { ...video, voiced }
    },

    tick() {
      if (deps.locked?.()) return
      try {
        const due = posts.takeDue()
        if (due.length) deps.onRemind?.(due)
      } catch (error) {
        deps.onError?.(error, { what: 'post reminders' })
      }
      // Sequences mail new subscribers by themselves, at most once an hour.
      void mail.runSequences()
    },

    start() {
      if (timer) return
      timer = setInterval(() => service.tick(), REMIND_TICK_MS)
      timer.unref?.()
      queueMicrotask(() => service.tick())
    },

    stop() {
      if (timer) clearInterval(timer)
      timer = null
    }
  }
  return service
}
