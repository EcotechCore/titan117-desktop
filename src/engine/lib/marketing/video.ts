/**
 * The promo video engine (features 5.1, 15.9; decisions §62): a video is a
 * short list of scenes as plain data (a title, points, a screenshot, a quote,
 * an outro), drawn frame by frame on a canvas in the laptop's own Edge or
 * Chrome and encoded there with the browser's own H.264 and AAC encoders
 * (WebCodecs). Our MP4 writer puts the file together.
 *
 * Nothing is downloaded and nothing leaves the laptop: the page that draws
 * is our own, opened in a fresh profile with every network request refused.
 * No FFmpeg, Revideo or Motion Canvas is shipped (their renderers bring an
 * FFmpeg build with GPL parts; decisions §62). The voiceover is the
 * operating system's own voice (decisions §43.10).
 */
import type { Browser } from 'playwright-core'

import { parseColour, toHex, MarketingError, launchLocalBrowser } from './brand'
import { writeMp4, type Mp4Sample } from './mp4'

export const VIDEO_FORMATS = {
  landscape: { width: 1920, height: 1080, label: '16:9, for YouTube, LinkedIn, X and Facebook' },
  portrait: { width: 1080, height: 1920, label: '9:16, for TikTok, Reels and Stories' },
  square: { width: 1080, height: 1080, label: '1:1, for feeds' }
} as const
export type VideoFormat = keyof typeof VIDEO_FORMATS

export const FPS = 30
export const AUDIO_RATE = 48_000
export const MAX_SCENES = 24
export const MAX_SECONDS = 180
const MIN_SCENE = 2
const MAX_SCENE = 30
/** Silence before a scene's voice starts and after it ends. */
const VOICE_LEAD = 0.35
const VOICE_TAIL = 0.5

export type Scene =
  | { kind: 'title'; heading: string; text: string; seconds: number; say: string }
  | { kind: 'points'; heading: string; points: string[]; seconds: number; say: string }
  | {
      kind: 'image'
      /** A picture inside the allowed folders (PNG, JPEG or WebP). */
      image: string
      heading: string
      text: string
      frame: 'browser' | 'phone' | 'none'
      seconds: number
      say: string
    }
  | { kind: 'quote'; text: string; by: string; seconds: number; say: string }
  | { kind: 'outro'; heading: string; text: string; url: string; seconds: number; say: string }
  | {
      /**
       * A video clip (15.15): one made with video_create, or the user's own
       * footage, inside the allowed folders. It fills the frame; its own sound
       * isn't used (the voiceover is).
       */
      kind: 'clip'
      video: string
      /** Where in the clip to start, in seconds. */
      from: number
      heading: string
      text: string
      seconds: number
      say: string
    }

export interface VideoLook {
  /** `#rrggbb`. */
  primary: string
  accent: string
  /** A font's name, or empty for the system's. */
  font: string
  /** The company's name, shown small when there is no logo. */
  name: string
  /** A logo inside the allowed folders, or empty. */
  logo: string
}

export interface VideoSpec {
  title: string
  format: VideoFormat
  scenes: Scene[]
  /** Read each scene's "say" aloud with the system voice. */
  voiceover: boolean
  /** Show what is said as captions (most people watch without sound). */
  captions: boolean
  look: VideoLook
}

const SCENE_KINDS = ['title', 'points', 'image', 'clip', 'quote', 'outro']
const DEFAULT_SECONDS: Record<Scene['kind'], number> = {
  title: 4,
  points: 6,
  image: 5,
  quote: 5,
  outro: 4,
  clip: 5
}
const HEX = /^#[0-9a-fA-F]{6}$/
const IMAGE_FILE = /\.(png|jpe?g|webp)$/i
/** What Edge and Chrome can play: MP4 (H.264) and WebM. */
export const CLIP_FILE = /\.(mp4|m4v|webm)$/i
const LOGO_FILE = /\.(png|jpe?g|webp|svg)$/i

function line(value: unknown, max: number): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, max)
    : ''
}

/** Check a video an agent described; returns it cleaned, or throws saying what's wrong. */
export function checkVideo(input: unknown, brand: Partial<VideoLook> = {}): VideoSpec {
  const value = (input ?? {}) as Record<string, unknown>
  const format = (value.format ?? 'landscape') as VideoFormat
  if (!(format in VIDEO_FORMATS))
    throw new MarketingError(
      `A video's format is one of: ${Object.keys(VIDEO_FORMATS).join(', ')}.`
    )
  const raw = Array.isArray(value.scenes) ? value.scenes : []
  if (!raw.length || raw.length > MAX_SCENES)
    throw new MarketingError(`A video has 1 to ${MAX_SCENES} scenes.`)
  const scenes = raw.map((item, i): Scene => {
    const s = (item ?? {}) as Record<string, unknown>
    const fail = (why: string): never => {
      throw new MarketingError(`Scene ${i + 1}: ${why}`)
    }
    if (!SCENE_KINDS.includes(String(s.kind))) fail(`its kind is one of ${SCENE_KINDS.join(', ')}.`)
    const kind = s.kind as Scene['kind']
    const asked = typeof s.seconds === 'number' && Number.isFinite(s.seconds) ? s.seconds : 0
    const seconds = Math.min(MAX_SCENE, Math.max(MIN_SCENE, asked || DEFAULT_SECONDS[kind]))
    const say = line(s.say, 600)
    switch (kind) {
      case 'title': {
        const heading = line(s.heading, 90)
        if (!heading) fail('a title needs a heading.')
        return { kind, heading, text: line(s.text, 200), seconds, say }
      }
      case 'points': {
        const points = (Array.isArray(s.points) ? s.points : [])
          .map((p) => line(p, 110))
          .filter(Boolean)
          .slice(0, 5)
        if (!points.length) fail('give one to five points.')
        return { kind, heading: line(s.heading, 80), points, seconds, say }
      }
      case 'image': {
        const image = line(s.image, 500)
        if (!IMAGE_FILE.test(image))
          fail('give a PNG, JPEG or WebP picture in the allowed folders.')
        const frame = ['browser', 'phone', 'none'].includes(String(s.frame))
          ? (s.frame as 'browser' | 'phone' | 'none')
          : 'browser'
        return {
          kind,
          image,
          heading: line(s.heading, 80),
          text: line(s.text, 160),
          frame,
          seconds,
          say
        }
      }
      case 'clip': {
        const video = line(s.video, 500)
        if (!CLIP_FILE.test(video)) fail('give an MP4 or WebM video in the allowed folders.')
        const from = typeof s.from === 'number' && Number.isFinite(s.from) ? Math.max(0, s.from) : 0
        return {
          kind,
          video,
          from: Math.min(from, 3600),
          heading: line(s.heading, 80),
          text: line(s.text, 160),
          seconds,
          say
        }
      }
      case 'quote': {
        const text = line(s.text, 260)
        if (!text) fail('a quote needs its text.')
        return { kind, text, by: line(s.by, 80), seconds, say }
      }
      default: {
        const heading = line(s.heading, 90)
        if (!heading) fail('an outro needs a heading (the call to action).')
        return {
          kind: 'outro',
          heading,
          text: line(s.text, 160),
          url: line(s.url, 120),
          seconds,
          say
        }
      }
    }
  })
  const look = (value.look ?? {}) as Record<string, unknown>
  const colour = (given: unknown, fallback: string | undefined, last: string): string =>
    typeof given === 'string' && HEX.test(given)
      ? given.toLowerCase()
      : fallback && HEX.test(fallback)
        ? fallback.toLowerCase()
        : last
  const logo = line(look.logo ?? brand.logo, 500)
  const spec: VideoSpec = {
    title: line(value.title, 80) || 'Promo video',
    format,
    scenes,
    voiceover: value.voiceover === true,
    captions: value.captions !== false,
    look: {
      primary: colour(look.primary, brand.primary, '#ff6347'),
      accent: colour(look.accent, brand.accent, '#1f2937'),
      font: line(look.font ?? brand.font, 60).replace(/[^A-Za-z0-9 _-]/g, ''),
      name: line(look.name ?? brand.name, 60),
      logo: LOGO_FILE.test(logo) ? logo : ''
    }
  }
  const total = spec.scenes.reduce((sum, s) => sum + s.seconds, 0)
  if (total > MAX_SECONDS)
    throw new MarketingError(
      `That is ${Math.round(total)} seconds; a video is at most ${MAX_SECONDS}.`
    )
  return spec
}

export interface TimedScene {
  scene: Scene
  start: number
  seconds: number
  /** When its voice starts, and how long it speaks; null when it says nothing. */
  voice: { at: number; seconds: number } | null
}

/**
 * When each scene starts. A scene lasts as long as asked, or longer when its
 * voiceover needs the time.
 */
export function timeline(spec: VideoSpec, voiceSeconds: (number | null)[]): TimedScene[] {
  let at = 0
  const timed = spec.scenes.map((scene, i): TimedScene => {
    const spoken = voiceSeconds[i] ?? null
    const seconds =
      spoken === null
        ? scene.seconds
        : Math.min(MAX_SCENE + 30, Math.max(scene.seconds, VOICE_LEAD + spoken + VOICE_TAIL))
    // Whole frames, so scenes never drift from the picture.
    const rounded = Math.round(seconds * FPS) / FPS
    const entry: TimedScene = {
      scene,
      start: at,
      seconds: rounded,
      voice: spoken === null ? null : { at: at + VOICE_LEAD, seconds: spoken }
    }
    at += rounded
    return entry
  })
  if (at > MAX_SECONDS + 60)
    throw new MarketingError(
      `With its voiceover the video would be ${Math.round(at)} seconds. Shorten what is said.`
    )
  return timed
}

/** One sound track for the whole video: each scene's voice where its scene starts. */
export function mixVoice(
  timed: TimedScene[],
  voices: (Float32Array | null)[],
  rate = AUDIO_RATE
): Float32Array {
  const end = timed.length ? timed[timed.length - 1].start + timed[timed.length - 1].seconds : 0
  const track = new Float32Array(Math.ceil(end * rate))
  timed.forEach((t, i) => {
    const voice = voices[i]
    if (!voice || !t.voice) return
    const offset = Math.round(t.voice.at * rate)
    track.set(voice.subarray(0, Math.max(0, track.length - offset)), offset)
  })
  return track
}

/** What is said, cut into short captions spread over the time it is spoken. */
export function captionsFor(
  say: string,
  from: number,
  seconds: number
): { text: string; from: number; to: number }[] {
  const words = say.split(/\s+/).filter(Boolean)
  if (!words.length || seconds <= 0) return []
  const chunks: string[] = []
  let current: string[] = []
  for (const word of words) {
    current.push(word)
    const length = current.join(' ').length
    if (length >= 38 || (/[.!?;:]$/.test(word) && length >= 14)) {
      chunks.push(current.join(' '))
      current = []
    }
  }
  if (current.length) chunks.push(current.join(' '))
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  let at = from
  return chunks.map((text) => {
    const length = (text.length / total) * seconds
    const caption = { text, from: at, to: at + length }
    at += length
    return caption
  })
}

/** White or near-black, whichever reads better on a colour. */
export function textOn(hex: string): string {
  const c = parseColour(hex) ?? { r: 0, g: 0, b: 0 }
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
  return lum > 0.6 ? '#14161a' : '#ffffff'
}

/** A colour moved towards another: `amount` 0 keeps it, 1 gives the other. */
export function mix(hex: string, other: string, amount: number): string {
  const a = parseColour(hex) ?? { r: 0, g: 0, b: 0 }
  const b = parseColour(other) ?? { r: 0, g: 0, b: 0 }
  const m = (x: number, y: number): number => Math.round(x + (y - x) * amount)
  return toHex({ r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b) })
}

// ---------------------------------------------------------------- the page

interface PageScene {
  kind: Scene['kind']
  start: number
  seconds: number
  heading: string
  text: string
  points: string[]
  by: string
  url: string
  frame: 'browser' | 'phone' | 'none'
  /** An index into the job's images, or -1. */
  image: number
  /** An index into the job's clips, or -1, and where in it to start. */
  clip: number
  clipFrom: number
  captions: { text: string; from: number; to: number }[]
}

interface PageJob {
  width: number
  height: number
  fps: number
  seconds: number
  bitrate: number
  scenes: PageScene[]
  images: string[]
  /** Video clips as data URLs. */
  clips: string[]
  /** A data URL, or empty. */
  logo: string
  name: string
  font: string
  colours: { primary: string; onPrimary: string; dark: string; light: string; accent: string }
  /** 16-bit mono samples as base64, or empty for a silent video. */
  audio: string
  audioRate: number
}

interface PageOut {
  kind: 'video' | 'audio'
  samples: { d: string; k: boolean }[]
}

interface PageResult {
  error: string | null
  frames: number
  videoDescription: string
  audioDescription: string
  audioChannels: number
}

/**
 * Runs in the page: draws every frame and encodes it. Self-contained (it is
 * sent to the browser as text), and it talks to no one but `__titanOut`.
 */
async function renderInPage(job: PageJob): Promise<PageResult> {
  const out = (window as unknown as { __titanOut(batch: PageOut): Promise<void> }).__titanOut
  const result: PageResult = {
    error: null,
    frames: 0,
    videoDescription: '',
    audioDescription: '',
    audioChannels: 2
  }
  const toBase64 = (bytes: Uint8Array): string => {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  }
  const bytesOf = (source: AllowSharedBufferSource): Uint8Array =>
    ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : new Uint8Array(source)
  const fromBase64 = (text: string): Uint8Array => {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  try {
    const W = job.width
    const H = job.height
    const u = Math.min(W, H) / 100
    const wide = W > H
    const tall = H > W
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { alpha: false })!
    const family = `${job.font ? `"${job.font}", ` : ''}"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
    const font = (size: number, weight: number): string =>
      `${weight} ${Math.round(size)}px ${family}`
    const clamp = (x: number): number => Math.max(0, Math.min(1, x))
    const ease = (x: number): number => 1 - Math.pow(1 - clamp(x), 3)

    const load = async (src: string): Promise<HTMLImageElement | null> => {
      if (!src) return null
      const img = new Image()
      img.src = src
      try {
        await img.decode()
        return img
      } catch {
        return null
      }
    }
    const images = await Promise.all(job.images.map(load))
    const logo = await load(job.logo)
    // Clips play from memory (a blob), so every frame can be found by seeking.
    const clips = await Promise.all(
      job.clips.map(async (src) => {
        const video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'
        video.src = URL.createObjectURL(await (await fetch(src)).blob())
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve()
          video.onerror = () =>
            reject(new Error('A clip couldn’t be played (MP4 with H.264, or WebM).'))
        })
        return video
      })
    )
    /** Put a clip at the right moment before the frame is drawn. */
    const seekClip = async (scene: PageScene, t: number): Promise<void> => {
      const video = clips[scene.clip]
      if (!video) return
      const length = video.duration || 1
      const at = (scene.clipFrom + Math.max(0, t)) % length
      if (Math.abs(video.currentTime - at) < 0.5 / job.fps) return
      await new Promise<void>((resolve) => {
        const done = (): void => resolve()
        video.addEventListener('seeked', done, { once: true })
        setTimeout(done, 2000)
        video.currentTime = at
      })
    }
    const sizeOf = (img: HTMLImageElement): { w: number; h: number } => ({
      w: img.naturalWidth || 300,
      h: img.naturalHeight || 150
    })

    const wrap = (text: string, maxWidth: number): string[] => {
      const lines: string[] = []
      let current = ''
      for (const word of text.split(' ')) {
        const next = current ? `${current} ${word}` : word
        if (current && ctx.measureText(next).width > maxWidth) {
          lines.push(current)
          current = word
        } else current = next
      }
      if (current) lines.push(current)
      return lines
    }
    /** The largest size at which the text fits in the lines allowed. */
    const fit = (
      text: string,
      maxWidth: number,
      maxLines: number,
      size: number,
      min: number,
      weight: number
    ): { size: number; lines: string[] } => {
      for (let s = size; s >= min; s -= Math.max(1, size / 24)) {
        ctx.font = font(s, weight)
        const lines = wrap(text, maxWidth)
        if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth))
          return { size: s, lines }
      }
      ctx.font = font(min, weight)
      return { size: min, lines: wrap(text, maxWidth).slice(0, maxLines) }
    }
    const rounded = (x: number, y: number, w: number, h: number, r: number): void => {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, r)
    }
    /** Lines of text from `y` down, sliding up into place as `shown` goes 0 to 1. */
    const block = (
      lines: string[],
      x: number,
      y: number,
      size: number,
      weight: number,
      colour: string,
      shown: number,
      align: CanvasTextAlign = 'left'
    ): number => {
      ctx.save()
      ctx.globalAlpha *= ease(shown)
      ctx.font = font(size, weight)
      ctx.fillStyle = colour
      ctx.textAlign = align
      ctx.textBaseline = 'top'
      const shift = (1 - ease(shown)) * 3 * u
      lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * 1.22 + shift))
      ctx.restore()
      return y + lines.length * size * 1.22
    }

    const c = job.colours
    type Theme = { bg: string; fg: string; sub: string; mark: string; glow: string }
    const themes: Record<'dark' | 'light' | 'brand', Theme> = {
      dark: {
        bg: c.dark,
        fg: '#ffffff',
        sub: 'rgba(255,255,255,0.74)',
        mark: c.primary,
        glow: c.primary
      },
      light: { bg: c.light, fg: '#14161a', sub: '#4b5563', mark: c.primary, glow: c.primary },
      brand: {
        bg: c.primary,
        fg: c.onPrimary,
        sub: c.onPrimary === '#ffffff' ? 'rgba(255,255,255,0.82)' : 'rgba(20,22,26,0.74)',
        mark: c.onPrimary,
        glow: c.onPrimary
      }
    }
    const themeOf = (scene: PageScene, index: number): Theme =>
      scene.kind === 'title' || scene.kind === 'outro'
        ? themes.dark
        : scene.kind === 'quote'
          ? themes.brand
          : index % 2
            ? themes.light
            : themes.dark

    const margin = (wide ? 9 : 7) * u
    const inner = W - margin * 2

    const background = (theme: Theme, t: number): void => {
      ctx.globalAlpha = 1
      ctx.fillStyle = theme.bg
      ctx.fillRect(0, 0, W, H)
      // A soft light that drifts slowly, so a still scene is never frozen.
      const gx = W * (0.78 + 0.05 * Math.sin(t * 0.35))
      const gy = H * (0.18 + 0.05 * Math.cos(t * 0.3))
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.7)
      glow.addColorStop(0, theme.glow)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = theme === themes.brand ? 0.12 : 0.2
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)
      ctx.globalAlpha = 1
    }

    const corner = (theme: Theme): void => {
      const h = 5 * u
      if (logo) {
        const s = sizeOf(logo)
        const w = Math.min((s.w / s.h) * h, 30 * u)
        ctx.globalAlpha = 0.95
        ctx.drawImage(logo, margin, margin * 0.6, w, h)
        ctx.globalAlpha = 1
      } else if (job.name) {
        ctx.font = font(2.6 * u, 700)
        ctx.fillStyle = theme.sub
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(job.name, margin, margin * 0.7)
      }
    }

    const picture = (
      scene: PageScene,
      t: number,
      top: number,
      bottom: number,
      shown: number
    ): void => {
      const img = images[scene.image]
      if (!img) return
      const s = sizeOf(img)
      const phone = scene.frame === 'phone'
      const bar = scene.frame === 'browser' ? 4.2 * u : 0
      const pad = phone ? 1.6 * u : 0
      const availW = inner
      const availH = bottom - top
      // The frame keeps a shape that suits it; the picture fills it from its top.
      const shape = phone ? 9 / 19 : Math.max(Math.min(s.w / s.h, 2.2), tall ? 0.7 : 1.3)
      let w = availW
      let h = (w - pad * 2) / shape + bar + pad * 2
      if (h > availH) {
        h = availH
        w = (h - bar - pad * 2) * shape + pad * 2
      }
      const x = (W - w) / 2
      const y = top + (availH - h) / 2 + (1 - ease(shown)) * 6 * u
      const radius = (phone ? 5 : 1.8) * u
      ctx.save()
      ctx.globalAlpha *= ease(shown)
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 6 * u
      ctx.shadowOffsetY = 2 * u
      ctx.fillStyle = phone ? '#111318' : '#ffffff'
      rounded(x, y, w, h, radius)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      if (bar) {
        ctx.fillStyle = '#eceef1'
        rounded(x, y, w, bar + radius, radius)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(x, y + bar, w, radius)
        ;['#ff5f57', '#febc2e', '#28c840'].forEach((dot, i) => {
          ctx.fillStyle = dot
          ctx.beginPath()
          ctx.arc(x + 2.6 * u + i * 2.2 * u, y + bar / 2, 0.7 * u, 0, Math.PI * 2)
          ctx.fill()
        })
      }
      const ix = x + pad
      const iy = y + bar + pad
      const iw = w - pad * 2
      const ih = h - bar - pad * 2
      rounded(ix, iy, iw, ih, phone ? radius - pad : 0)
      ctx.clip()
      if (!phone && bar) {
        ctx.beginPath()
        ctx.roundRect(ix, iy, iw, ih, [0, 0, radius, radius])
        ctx.clip()
      }
      // A slow push in, and a slow look down a page that is longer than its frame.
      const zoom = 1 + 0.045 * clamp(t / Math.max(scene.seconds, 1))
      const scale = (iw / s.w) * zoom
      const drawnH = s.h * scale
      const extra = Math.max(0, drawnH - ih)
      const scroll = Math.min(extra, ih * 0.5) * ease((t - 0.8) / Math.max(scene.seconds - 1.6, 1))
      ctx.drawImage(img, ix - (s.w * scale - iw) / 2, iy - scroll, s.w * scale, drawnH)
      ctx.restore()
    }

    const drawScene = (scene: PageScene, index: number, t: number, last: boolean): void => {
      const theme = themeOf(scene, index)
      background(theme, scene.start + t)
      const leaving = last ? 1 : clamp((scene.seconds - t) / 0.3)
      ctx.globalAlpha = leaving
      const top = margin + 7 * u
      // Captions get their own band, so they never cover a picture or a point.
      const bottom = H - margin - 4 * u - (scene.captions.length ? (tall ? 14 : 9) * u : 0)
      if (scene.kind !== 'outro') corner(theme)

      if (scene.kind === 'title') {
        const head = fit(scene.heading, inner, tall ? 5 : 3, (wide ? 11 : 10) * u, 5 * u, 800)
        const sub = scene.text ? fit(scene.text, inner * 0.9, 4, 4.2 * u, 3 * u, 400) : null
        const height =
          head.lines.length * head.size * 1.22 +
          (sub ? sub.lines.length * sub.size * 1.22 + 3 * u : 0)
        let y = (H - height) / 2
        ctx.fillStyle = theme.mark
        ctx.fillRect(margin, y - 4 * u, 14 * u * ease(t / 0.7), 1 * u)
        y = block(head.lines, margin, y, head.size, 800, theme.fg, t / 0.7)
        if (sub) block(sub.lines, margin, y + 3 * u, sub.size, 400, theme.sub, (t - 0.3) / 0.7)
      } else if (scene.kind === 'points') {
        // Measured first, so the heading and its points sit in the middle together.
        const head = scene.heading
          ? fit(scene.heading, inner, 2, (tall ? 7.4 : 6.4) * u, 4 * u, 800)
          : null
        const headH = head ? head.lines.length * head.size * 1.22 + 5 * u : 0
        const room = bottom - top - headH
        let size = (tall ? 5.6 : 4.8) * u
        let rows: string[][] = []
        for (; size >= 2.8 * u; size -= 0.2 * u) {
          ctx.font = font(size, 500)
          rows = scene.points.map((point) => wrap(point, inner - 5 * u).slice(0, 3))
          const needed = rows.reduce(
            (sum, lines) => sum + lines.length * size * 1.22 + size * 0.9,
            0
          )
          if (needed <= room) break
        }
        const pointsH = rows.reduce(
          (sum, lines) => sum + lines.length * size * 1.22 + size * 0.9,
          0
        )
        let y = Math.max(top, (H - headH - pointsH) / 2)
        if (head) y = block(head.lines, margin, y, head.size, 800, theme.fg, t / 0.6) + 5 * u
        const step = Math.min(0.9, Math.max(0.3, (scene.seconds - 1.6) / scene.points.length))
        rows.forEach((lines, i) => {
          const shown = (t - 0.5 - i * step) / 0.5
          ctx.save()
          ctx.globalAlpha *= ease(shown)
          ctx.fillStyle = theme.mark
          rounded(margin, y + size * 0.38, 1.6 * u, 1.6 * u, 0.4 * u)
          ctx.fill()
          ctx.restore()
          y = block(lines, margin + 5 * u, y, size, 500, theme.fg, shown) + size * 0.9
        })
      } else if (scene.kind === 'clip') {
        const video = clips[scene.clip]
        if (video) {
          // Fill the frame (cover), with a slow push-in.
          const vw = video.videoWidth || W
          const vh = video.videoHeight || H
          const scale =
            Math.max(W / vw, H / vh) * (1 + 0.03 * clamp(t / Math.max(scene.seconds, 1)))
          ctx.drawImage(video, (W - vw * scale) / 2, (H - vh * scale) / 2, vw * scale, vh * scale)
        }
        if (scene.heading || scene.text) {
          // A dark band at the bottom keeps the words readable over any picture.
          const band = ctx.createLinearGradient(0, H * 0.5, 0, H)
          band.addColorStop(0, 'rgba(0,0,0,0)')
          band.addColorStop(1, 'rgba(0,0,0,0.72)')
          ctx.fillStyle = band
          ctx.fillRect(0, H * 0.5, W, H * 0.5)
          const head = scene.heading ? fit(scene.heading, inner, 2, 6.4 * u, 3.6 * u, 800) : null
          const sub = scene.text ? fit(scene.text, inner, 2, 3.6 * u, 2.6 * u, 400) : null
          const height =
            (head ? head.lines.length * head.size * 1.22 : 0) +
            (sub ? sub.lines.length * sub.size * 1.22 + 1.5 * u : 0)
          let y = H - margin - (tall ? 16 : 9) * u - height - (scene.captions.length ? 8 * u : 0)
          if (head) y = block(head.lines, margin, y, head.size, 800, '#ffffff', t / 0.6)
          if (sub)
            block(
              sub.lines,
              margin,
              y + 1.5 * u,
              sub.size,
              400,
              'rgba(255,255,255,0.86)',
              (t - 0.2) / 0.6
            )
        }
      } else if (scene.kind === 'image') {
        let y = top
        if (scene.heading) {
          const head = fit(scene.heading, inner, 2, 5.6 * u, 3.6 * u, 800)
          y = block(head.lines, W / 2, y, head.size, 800, theme.fg, t / 0.6, 'center') + 1.5 * u
        }
        if (scene.text) {
          const sub = fit(scene.text, inner * 0.9, 2, 3.4 * u, 2.6 * u, 400)
          y =
            block(sub.lines, W / 2, y, sub.size, 400, theme.sub, (t - 0.2) / 0.6, 'center') +
            1.5 * u
        }
        picture(scene, t, y + 2 * u, bottom, (t - 0.25) / 0.8)
      } else if (scene.kind === 'quote') {
        const quote = fit(scene.text, inner * 0.92, tall ? 9 : 5, 6.4 * u, 3.6 * u, 600)
        const height = quote.lines.length * quote.size * 1.22 + (scene.by ? 7 * u : 0)
        let y = (H - height) / 2
        ctx.save()
        ctx.globalAlpha *= 0.28 * ease(t / 0.6)
        ctx.font = font(26 * u, 800)
        ctx.fillStyle = theme.mark
        ctx.textBaseline = 'top'
        ctx.textAlign = 'left'
        ctx.fillText('“', margin - 1.5 * u, y - 15 * u)
        ctx.restore()
        y = block(quote.lines, margin, y, quote.size, 600, theme.fg, t / 0.7)
        if (scene.by)
          block([`— ${scene.by}`], margin, y + 3 * u, 3.4 * u, 500, theme.sub, (t - 0.4) / 0.6)
      } else {
        const head = fit(scene.heading, inner, tall ? 4 : 2, 8.4 * u, 4.4 * u, 800)
        const sub = scene.text ? fit(scene.text, inner * 0.9, 3, 4 * u, 3 * u, 400) : null
        const logoH = logo ? 16 * u : 0
        const height =
          (logo ? logoH + 6 * u : 0) +
          head.lines.length * head.size * 1.22 +
          (sub ? sub.lines.length * sub.size * 1.22 + 2.5 * u : 0) +
          (scene.url ? 11 * u : 0)
        let y = (H - height) / 2
        if (logo) {
          const s = sizeOf(logo)
          const w = Math.min((s.w / s.h) * logoH, inner * 0.7)
          const h = (w / s.w) * s.h
          const pop = 0.9 + 0.1 * ease(t / 0.6)
          ctx.save()
          ctx.globalAlpha *= ease(t / 0.5)
          ctx.drawImage(logo, W / 2 - (w * pop) / 2, y + (logoH - h * pop) / 2, w * pop, h * pop)
          ctx.restore()
          y += logoH + 6 * u
        }
        y = block(head.lines, W / 2, y, head.size, 800, theme.fg, (t - 0.2) / 0.6, 'center')
        if (sub)
          y = block(
            sub.lines,
            W / 2,
            y + 2.5 * u,
            sub.size,
            400,
            theme.sub,
            (t - 0.4) / 0.6,
            'center'
          )
        if (scene.url) {
          const shown = ease((t - 0.7) / 0.5)
          ctx.save()
          ctx.globalAlpha *= shown
          ctx.font = font(3.6 * u, 700)
          const w = ctx.measureText(scene.url).width + 8 * u
          ctx.fillStyle = c.primary
          rounded(W / 2 - w / 2, y + 4 * u, w, 7 * u, 3.5 * u)
          ctx.fill()
          ctx.fillStyle = c.onPrimary
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(scene.url, W / 2, y + 7.6 * u)
          ctx.restore()
        }
      }
      ctx.globalAlpha = 1

      // Captions: what is being said, for people watching without sound.
      const now = scene.start + t
      const caption = scene.captions.find((cap) => now >= cap.from && now < cap.to)
      if (caption) {
        const cap = fit(caption.text, inner, 2, 3.5 * u, 2.6 * u, 600)
        const lineH = cap.size * 1.3
        const boxH = cap.lines.length * lineH + 2.4 * u
        ctx.font = font(cap.size, 600)
        const boxW = Math.max(...cap.lines.map((l) => ctx.measureText(l).width)) + 5 * u
        const by = H - (tall ? 16 : 9) * u - boxH
        ctx.fillStyle = 'rgba(10,12,16,0.72)'
        rounded(W / 2 - boxW / 2, by, boxW, boxH, 1.6 * u)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        cap.lines.forEach((l, i) => ctx.fillText(l, W / 2, by + 1.2 * u + i * lineH))
      }

      // How far along the video is.
      ctx.fillStyle = theme === themes.brand ? c.onPrimary : c.primary
      ctx.globalAlpha = 0.9
      ctx.fillRect(0, H - 0.7 * u, W * clamp(now / job.seconds), 0.7 * u)
      ctx.globalAlpha = 1
    }

    // ------------------------------------------------------------ encoding
    const pending: PageOut = { kind: 'video', samples: [] }
    let pendingBytes = 0
    let failure: string | null = null
    let lastStamp = -1
    const send = async (batch: PageOut): Promise<void> => {
      if (!batch.samples.length) return
      const samples = batch.samples
      batch.samples = []
      await out({ kind: batch.kind, samples })
    }

    const config: VideoEncoderConfig = {
      codec: 'avc1.640028',
      width: W,
      height: H,
      bitrate: job.bitrate,
      framerate: job.fps,
      latencyMode: 'quality',
      avc: { format: 'avc' },
      hardwareAcceleration: 'prefer-software'
    }
    if (!(await VideoEncoder.isConfigSupported(config)).supported) {
      config.hardwareAcceleration = 'no-preference'
      if (!(await VideoEncoder.isConfigSupported(config)).supported)
        throw new Error('This browser can’t encode H.264 video.')
    }
    const encoder = new VideoEncoder({
      output(chunk, meta) {
        // Frames must come out in the order they are shown (no B-frames).
        if (chunk.timestamp <= lastStamp) failure = 'The encoder reordered frames.'
        lastStamp = chunk.timestamp
        const description = meta?.decoderConfig?.description
        if (description && !result.videoDescription)
          result.videoDescription = toBase64(bytesOf(description))
        const bytes = new Uint8Array(chunk.byteLength)
        chunk.copyTo(bytes)
        pending.samples.push({ d: toBase64(bytes), k: chunk.type === 'key' })
        pendingBytes += bytes.length
      },
      error(error) {
        failure = error.message
      }
    })
    encoder.configure(config)

    const total = Math.round(job.seconds * job.fps)
    let sceneIndex = 0
    for (let f = 0; f < total; f++) {
      if (failure) throw new Error(failure)
      const now = f / job.fps
      while (
        sceneIndex < job.scenes.length - 1 &&
        now >= job.scenes[sceneIndex].start + job.scenes[sceneIndex].seconds - 1e-6
      )
        sceneIndex++
      const scene = job.scenes[sceneIndex]
      if (scene.kind === 'clip') await seekClip(scene, now - scene.start)
      drawScene(scene, sceneIndex, now - scene.start, sceneIndex === job.scenes.length - 1)
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((f * 1e6) / job.fps),
        duration: Math.round(1e6 / job.fps)
      })
      encoder.encode(frame, { keyFrame: f % (job.fps * 2) === 0 })
      frame.close()
      if (encoder.encodeQueueSize > 6)
        await new Promise<void>((resolve) =>
          encoder.addEventListener('dequeue', () => resolve(), { once: true })
        )
      if (pendingBytes > 1_500_000) {
        pendingBytes = 0
        await send(pending)
      }
    }
    await encoder.flush()
    encoder.close()
    if (failure) throw new Error(failure)
    await send(pending)
    result.frames = total

    if (job.audio) {
      const raw = fromBase64(job.audio)
      const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2))
      const audioOut: PageOut = { kind: 'audio', samples: [] }
      let audioFailure: string | null = null
      const audio = new AudioEncoder({
        output(chunk, meta) {
          const description = meta?.decoderConfig?.description
          if (description && !result.audioDescription)
            result.audioDescription = toBase64(bytesOf(description))
          const bytes = new Uint8Array(chunk.byteLength)
          chunk.copyTo(bytes)
          audioOut.samples.push({ d: toBase64(bytes), k: true })
        },
        error(error) {
          audioFailure = error.message
        }
      })
      const audioConfig: AudioEncoderConfig = {
        codec: 'mp4a.40.2',
        sampleRate: job.audioRate,
        numberOfChannels: 2,
        bitrate: 128_000
      }
      if (!(await AudioEncoder.isConfigSupported(audioConfig)).supported)
        throw new Error('This browser can’t encode AAC sound.')
      audio.configure(audioConfig)
      const BLOCK = 1024 * 16
      for (let at = 0; at < pcm.length; at += BLOCK) {
        const n = Math.min(BLOCK, pcm.length - at)
        // The voice is one channel; it goes to both sides.
        const data = new Float32Array(n * 2)
        for (let i = 0; i < n; i++) data[i] = data[n + i] = pcm[at + i] / 32768
        const block = new AudioData({
          format: 'f32-planar',
          sampleRate: job.audioRate,
          numberOfFrames: n,
          numberOfChannels: 2,
          timestamp: Math.round((at * 1e6) / job.audioRate),
          data
        })
        audio.encode(block)
        block.close()
        if (audio.encodeQueueSize > 8)
          await new Promise<void>((resolve) =>
            audio.addEventListener('dequeue', () => resolve(), { once: true })
          )
      }
      await audio.flush()
      audio.close()
      if (audioFailure) throw new Error(audioFailure)
      await send(audioOut)
    }
  } catch (error) {
    result.error = String((error as Error)?.message ?? error).slice(0, 300)
  }
  return result
}

// ---------------------------------------------------------------- rendering

export interface VideoAssets {
  /** Each picture a scene names, as a data URL; a missing one throws before this. */
  images: Map<string, string>
  /** Each clip a scene names, as a data URL. */
  clips?: Map<string, string>
  /** The logo as a data URL, or empty. */
  logo: string
  /** The whole voice track at `AUDIO_RATE`, or null for a silent video. */
  voice: Float32Array | null
  timed: TimedScene[]
}

export interface RenderedVideo {
  mp4: Buffer
  seconds: number
  width: number
  height: number
  sound: boolean
}

export interface RenderDeps {
  signal?: AbortSignal
  /** Tests pass a fake; the default launches the laptop's Edge or Chrome. */
  launch?: () => Promise<Browser>
}

const PAGE_URL = 'https://video.titan117.invalid/'
const PAGE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Titan117 video</title></head><body></body></html>'

function pcm16(samples: Float32Array): string {
  const out = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++)
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2)
  return out.toString('base64')
}

/** What the page is asked to draw: the timed scenes with their pictures and captions. */
export function pageJob(spec: VideoSpec, assets: VideoAssets): PageJob {
  const size = VIDEO_FORMATS[spec.format]
  const last = assets.timed[assets.timed.length - 1]
  const order = [...assets.images.keys()]
  const clipOrder = [...(assets.clips?.keys() ?? [])]
  return {
    width: size.width,
    height: size.height,
    fps: FPS,
    seconds: last.start + last.seconds,
    bitrate: 6_000_000,
    scenes: assets.timed.map(({ scene, start, seconds, voice }): PageScene => ({
      kind: scene.kind,
      start,
      seconds,
      heading: 'heading' in scene ? scene.heading : '',
      text: 'text' in scene ? scene.text : '',
      points: scene.kind === 'points' ? scene.points : [],
      by: scene.kind === 'quote' ? scene.by : '',
      url: scene.kind === 'outro' ? scene.url : '',
      frame: scene.kind === 'image' ? scene.frame : 'none',
      image: scene.kind === 'image' ? order.indexOf(scene.image) : -1,
      clip: scene.kind === 'clip' ? clipOrder.indexOf(scene.video) : -1,
      clipFrom: scene.kind === 'clip' ? scene.from : 0,
      captions:
        spec.captions && spec.voiceover && voice && scene.say
          ? captionsFor(scene.say, voice.at, voice.seconds)
          : []
    })),
    images: order.map((path) => assets.images.get(path)!),
    clips: clipOrder.map((path) => assets.clips!.get(path)!),
    logo: assets.logo,
    name: spec.look.name,
    font: spec.look.font,
    colours: {
      primary: spec.look.primary,
      onPrimary: textOn(spec.look.primary),
      dark: mix(spec.look.primary, '#0b0d12', 0.9),
      light: mix(spec.look.primary, '#f8f8f6', 0.96),
      accent: spec.look.accent
    },
    audio: assets.voice ? pcm16(assets.voice) : '',
    audioRate: AUDIO_RATE
  }
}

/** Draw and encode the video in the laptop's browser, and put the MP4 together. */
export async function renderVideo(
  spec: VideoSpec,
  assets: VideoAssets,
  deps: RenderDeps = {}
): Promise<RenderedVideo> {
  const job = pageJob(spec, assets)
  const browser = await (deps.launch ?? launchLocalBrowser)()
  const video: Mp4Sample[] = []
  const audio: Mp4Sample[] = []
  const stop = (): void => void browser.close().catch(() => undefined)
  deps.signal?.addEventListener('abort', stop, { once: true })
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
    // Our own page and nothing else: every request to the network is refused.
    await context.route('**/*', (route) =>
      route.request().url() === PAGE_URL
        ? route.fulfill({ contentType: 'text/html', body: PAGE_HTML })
        : route.abort('blockedbyclient')
    )
    const page = await context.newPage()
    await page.exposeFunction('__titanOut', (batch: PageOut) => {
      const target = batch.kind === 'audio' ? audio : video
      for (const sample of batch.samples)
        target.push({ data: Buffer.from(sample.d, 'base64'), key: sample.k })
    })
    await page.goto(PAGE_URL)
    const result = await page.evaluate(renderInPage, job)
    if (deps.signal?.aborted) throw new MarketingError('The video was stopped.')
    if (result.error) throw new MarketingError(`The video couldn’t be made: ${result.error}`)
    const mp4 = writeMp4(
      {
        width: job.width,
        height: job.height,
        fps: job.fps,
        description: Buffer.from(result.videoDescription, 'base64'),
        samples: video
      },
      audio.length && result.audioDescription
        ? {
            sampleRate: job.audioRate,
            channels: result.audioChannels,
            description: Buffer.from(result.audioDescription, 'base64'),
            samples: audio
          }
        : null
    )
    return {
      mp4,
      seconds: job.seconds,
      width: job.width,
      height: job.height,
      sound: audio.length > 0
    }
  } catch (error) {
    if (deps.signal?.aborted) throw new MarketingError('The video was stopped.')
    throw error
  } finally {
    deps.signal?.removeEventListener('abort', stop)
    await browser.close().catch(() => undefined)
  }
}
