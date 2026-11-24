// Phase 14, live: the promo video engine in the laptop's real Edge or Chrome.
// A video is drawn and encoded there, our MP4 writer puts it together, and
// the same browser then plays the file back (so it is a real, playable MP4).
// Run with `pnpm eval:marketing`. No model and no network are used.
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { tmpdir } from 'os'

import { openDb } from '../../src/engine/lib/db'
import { launchLocalBrowser, readSite } from '../../src/engine/lib/marketing/brand'
import { createMarketing } from '../../src/engine/lib/marketing/service'
import { createSpeechEngine } from '../../src/engine/lib/speech'
import type { TaskNet } from '../../src/engine/lib/web'
import {
  AUDIO_RATE,
  checkVideo,
  mixVoice,
  renderVideo,
  timeline,
  type VideoFormat
} from '../../src/engine/lib/marketing/video'

const OUT = join(__dirname, 'results', 'video')

/** A picture to show: a plain SVG page turned into a PNG by the browser. */
async function samplePicture(): Promise<string> {
  const browser = await launchLocalBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.setContent(
      '<body style="margin:0;font-family:Segoe UI,sans-serif;background:#fff"><header style="padding:28px 48px;font-weight:800;font-size:28px;color:#0f766e">Northwind Bakery</header><main style="padding:80px 48px"><h1 style="font-size:84px;margin:0 0 24px">Fresh bread, every morning</h1><p style="font-size:30px;color:#475569;max-width:900px">Order before 6 pm and collect warm loaves from 7 am.</p><a style="display:inline-block;margin-top:32px;background:#0f766e;color:#fff;padding:20px 36px;border-radius:12px;font-size:28px">Order now</a></main></body>'
    )
    return `data:image/png;base64,${(await page.screenshot({ type: 'png' })).toString('base64')}`
  } finally {
    await browser.close()
  }
}

/** Play the file in the browser and say what it is. */
async function probe(mp4: Buffer): Promise<{
  duration: number
  width: number
  height: number
  error: string | null
  played: number
  audioTracks: boolean
}> {
  const browser = await launchLocalBrowser()
  try {
    const context = await browser.newContext()
    await context.route('**/*', (route) =>
      route.request().url().endsWith('/video.mp4')
        ? route.fulfill({ contentType: 'video/mp4', body: mp4 })
        : route.fulfill({ contentType: 'text/html', body: '<video muted></video>' })
    )
    const page = await context.newPage()
    await page.goto('https://probe.titan117.invalid/')
    return await page.evaluate(async () => {
      const video = document.querySelector('video')!
      video.src = '/video.mp4'
      const error = await new Promise<string | null>((resolve) => {
        video.addEventListener('loadeddata', () => resolve(null), { once: true })
        video.addEventListener(
          'error',
          () => resolve(video.error?.message || `error ${video.error?.code}`),
          { once: true }
        )
        setTimeout(() => resolve('timed out'), 15000)
      })
      if (error) return { duration: 0, width: 0, height: 0, error, played: 0, audioTracks: false }
      await video.play().catch(() => undefined)
      await new Promise((r) => setTimeout(r, 1500))
      const withAudio = video as HTMLVideoElement & {
        webkitAudioDecodedByteCount?: number
        mozHasAudio?: boolean
      }
      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        error: null,
        played: video.currentTime,
        audioTracks: (withAudio.webkitAudioDecodedByteCount ?? 0) > 0
      }
    })
  } finally {
    await browser.close()
  }
}

function tone(seconds: number, hz: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * AUDIO_RATE))
  for (let i = 0; i < samples.length; i++)
    samples[i] = 0.2 * Math.sin((2 * Math.PI * hz * i) / AUDIO_RATE)
  return samples
}

describe('the promo video engine, live', () => {
  for (const format of ['landscape', 'portrait', 'square'] as VideoFormat[])
    it(`makes a ${format} video with sound that plays`, async () => {
      const picture = await samplePicture()
      const spec = checkVideo(
        {
          title: 'Northwind Bakery',
          format,
          voiceover: true,
          scenes: [
            {
              kind: 'title',
              heading: 'Fresh bread, every morning',
              text: 'Northwind Bakery, since 1987',
              seconds: 2,
              say: 'Fresh bread, every morning.'
            },
            {
              kind: 'points',
              heading: 'Why people come back',
              points: ['Baked from 4 am', 'Local flour', 'Order online, collect warm'],
              seconds: 3,
              say: 'Baked from four. Local flour. Order online.'
            },
            {
              kind: 'image',
              image: 'shots/home.png',
              heading: 'Order in a minute',
              text: 'On your phone or laptop',
              seconds: 3
            },
            {
              kind: 'quote',
              text: 'The best sourdough in town, and it is still warm when I get it.',
              by: 'Maria, a regular',
              seconds: 2
            },
            {
              kind: 'outro',
              heading: 'Order before 6 pm',
              text: 'Collect from 7 am',
              url: 'northwind.example',
              seconds: 2
            }
          ]
        },
        { primary: '#0f766e', accent: '#f59e0b', name: 'Northwind Bakery' }
      )
      const voices = [tone(1.2, 440), tone(2.0, 330), null, null, null]
      const timed = timeline(
        spec,
        voices.map((v) => (v ? v.length / AUDIO_RATE : null))
      )
      const started = Date.now()
      const video = await renderVideo(spec, {
        images: new Map([['shots/home.png', picture]]),
        logo: '',
        voice: mixVoice(timed, voices),
        timed
      })
      const ms = Date.now() - started
      mkdirSync(OUT, { recursive: true })
      writeFileSync(join(OUT, `sample-${format}.mp4`), video.mp4)
      const seen = await probe(video.mp4)
      console.log(format, { ms, bytes: video.mp4.length, seconds: video.seconds, seen })
      expect(seen.error).toBeNull()
      expect(seen.width).toBe(video.width)
      expect(seen.height).toBe(video.height)
      expect(Math.abs(seen.duration - video.seconds)).toBeLessThan(0.2)
      expect(seen.played).toBeGreaterThan(0.5)
      expect(seen.audioTracks).toBe(true)
    }, 180_000)
})

/** A public practice site that welcomes crawlers (as in phase 12's check). */
const SITE = process.env.TITAN_BRAND_URL ?? 'https://books.toscrape.com/'

describe('the brand kit, live', () => {
  it('reads a real site: its name, colours and screenshots', async () => {
    const asked: string[] = []
    const net = {
      check: async (url: string) => void asked.push(url),
      fetch
    } as unknown as TaskNet
    const site = await readSite([SITE], { screenshots: true }, { net })
    console.log({
      name: site.name,
      tagline: site.tagline,
      primary: site.primary,
      accent: site.accent,
      font: site.headingFont,
      logo: site.logo ? `${site.logo.mediaType}, ${site.logo.bytes.length} bytes` : null,
      headings: site.headings.slice(0, 4),
      shots: site.shots.map((s) => `${s.size} ${s.image.length}`),
      problems: site.problems,
      requests: asked.length
    })
    mkdirSync(OUT, { recursive: true })
    for (const shot of site.shots) writeFileSync(join(OUT, `site-${shot.size}.png`), shot.image)
    expect(site.name).toBeTruthy()
    expect(site.shots.map((s) => s.size)).toEqual(['desktop', 'phone'])
    expect(site.headings.length).toBeGreaterThan(0)
    // Every request the page made went through the network policy.
    expect(asked.length).toBeGreaterThan(1)
    expect(asked[0]).toBe(SITE)
  }, 120_000)
})

describe('a promo video with the system voice, live', () => {
  it('reads the script aloud and shows it as captions', async () => {
    const picture = await samplePicture()
    const marketing = createMarketing({
      db: openDb(':memory:'),
      speech: createSpeechEngine({
        modelsDir: join(tmpdir(), 'titan117-live-speech'),
        scratchDir: join(tmpdir(), 'titan117-live-speech')
      })
    })
    const spec = checkVideo(
      {
        title: 'Northwind Bakery',
        format: 'landscape',
        voiceover: true,
        scenes: [
          {
            kind: 'title',
            heading: 'Fresh bread, every morning',
            say: 'Fresh bread, every morning, from Northwind Bakery.'
          },
          {
            kind: 'image',
            image: 'home.png',
            heading: 'Order in a minute',
            say: 'Order before six in the evening, and collect warm loaves from seven.'
          },
          {
            kind: 'outro',
            heading: 'Order before 6 pm',
            url: 'northwind.example',
            say: 'Order today.'
          }
        ]
      },
      { primary: '#0f766e', name: 'Northwind Bakery' }
    )
    const video = await marketing.video(spec, async () =>
      Buffer.from(picture.split(',')[1], 'base64')
    )
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, 'sample-voice.mp4'), video.mp4)
    const seen = await probe(video.mp4)
    console.log({ seconds: video.seconds, voiced: video.voiced, bytes: video.mp4.length, seen })
    expect(video.voiced).toBe(3)
    expect(video.sound).toBe(true)
    expect(seen.error).toBeNull()
    expect(seen.audioTracks).toBe(true)
    // Three spoken scenes take longer than their default 13 seconds would only if the voice needs it.
    expect(video.seconds).toBeGreaterThan(8)
  }, 180_000)
})
