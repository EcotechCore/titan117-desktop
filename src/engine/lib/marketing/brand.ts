/**
 * The brand kit (feature 15.1; decisions §62): who the company is and how it
 * looks and talks, kept on the laptop and used by every marketing agent, the
 * app builder (6.8) and the promo video.
 *
 * It is the app builder's kit (two colours, a font style, a tone, a logo)
 * plus what marketing needs: the name, a tagline, the website, what the
 * company sells and to whom. `readSite` proposes one from the company's own
 * website, read in the laptop's Edge or Chrome in a fresh profile with every
 * request through the task's network policy; the user or an agent then saves
 * what is right.
 */
import type { Browser, BrowserContext } from 'playwright-core'

import { cleanBrand, type BrandKit } from '../apps/starters'
import { findBrowserChannel } from '../browser'
import { PermissionError } from '../folders'
import type { TaskNet } from '../web'

export class MarketingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketingError'
  }
}

export interface MarketingBrand extends BrandKit {
  /** The company or product name. */
  name: string
  /** One line under the name. */
  tagline: string
  /** The company's own site, `https://…`, or empty. */
  website: string
  /** What the company does, in two or three sentences. */
  description: string
  /** Who it sells to. */
  audience: string
  /** What it sells: up to 12 short names. */
  products: string[]
  /** The typeface the site's headings use, by name (shown in videos when the laptop has it). */
  headingFont: string
  updatedAt: number
}

export const MAX_PRODUCTS = 12

function line(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/** A web address a company could have, or empty. */
export function cleanWebsite(value: unknown): string {
  const text = line(value, 300)
  if (!text) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    if (!url.hostname.includes('.')) return ''
    url.hash = ''
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return ''
  }
}

/** A brand kit with every field checked; anything odd is dropped or falls back to the default. */
export function cleanMarketingBrand(input: unknown, now = Date.now()): MarketingBrand {
  const value = (input ?? {}) as Partial<Record<keyof MarketingBrand, unknown>>
  const products = Array.isArray(value.products)
    ? value.products
    : typeof value.products === 'string'
      ? value.products.split(/[,\n]/)
      : []
  return {
    ...cleanBrand(value),
    name: line(value.name, 80),
    tagline: line(value.tagline, 160),
    website: cleanWebsite(value.website),
    description: line(value.description, 600),
    audience: line(value.audience, 300),
    products: [...new Set(products.map((p) => line(p, 60)).filter(Boolean))].slice(0, MAX_PRODUCTS),
    // A font's name only: letters, numbers, spaces and dashes, so it is safe in a stylesheet.
    headingFont: line(value.headingFont, 60).replace(/[^A-Za-z0-9 _-]/g, ''),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now
  }
}

/** Whether there is anything in the kit beyond the defaults. */
export function hasBrand(brand: MarketingBrand | null): brand is MarketingBrand {
  return !!brand && !!(brand.name || brand.website || brand.description || brand.tone)
}

/** The kit as a few lines for an agent or for memory. */
export function describeBrand(brand: MarketingBrand): string {
  return [
    brand.name ? `Name: ${brand.name}` : '',
    brand.tagline ? `Tagline: ${brand.tagline}` : '',
    brand.website ? `Website: ${brand.website}` : '',
    brand.description ? `What it does: ${brand.description}` : '',
    brand.audience ? `Audience: ${brand.audience}` : '',
    brand.products.length ? `Products and services: ${brand.products.join(', ')}` : '',
    brand.tone ? `Tone of voice: ${brand.tone}` : '',
    `Colours: main ${brand.primary}, second ${brand.accent}`,
    brand.headingFont ? `Heading font: ${brand.headingFont}` : '',
    brand.logo ? `Logo file: ${brand.logo}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------- colours

export interface ColourSample {
  /** As the browser computes it: `rgb(…)` or `rgba(…)`. */
  color: string
  /** How much it should count: the area it covers, more for buttons. */
  weight: number
  kind: 'button' | 'link' | 'heading' | 'background' | 'theme'
}

export function parseColour(text: string): { r: number; g: number; b: number; a: number } | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(text.trim())
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const short = /^#([0-9a-f]{3})$/i.exec(text.trim())
  if (short) {
    const [r, g, b] = [...short[1]].map((c) => parseInt(c + c, 16))
    return { r, g, b, a: 1 }
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(
    text.trim()
  )
  if (!m) return null
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a }
}

export function toHex(c: { r: number; g: number; b: number }): string {
  return `#${[c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
}

function saturation(c: { r: number; g: number; b: number }): number {
  const max = Math.max(c.r, c.g, c.b)
  const min = Math.min(c.r, c.g, c.b)
  return max === 0 ? 0 : (max - min) / max
}

function distance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number }
): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
}

/**
 * The brand's two colours from what a page shows: the most used colourful
 * one (buttons count most), and the next that is clearly different. Greys,
 * white and black are never a brand colour; null when the page has none.
 */
export function pickColours(samples: ColourSample[]): {
  primary: string | null
  accent: string | null
} {
  const KIND = { theme: 3, button: 4, link: 1.5, heading: 1, background: 0.6 } as const
  const groups: { colour: { r: number; g: number; b: number }; score: number }[] = []
  for (const sample of samples) {
    const c = parseColour(sample.color)
    if (!c || c.a < 0.5 || saturation(c) < 0.25 || Math.max(c.r, c.g, c.b) < 40) continue
    const score = Math.max(1, sample.weight) * KIND[sample.kind]
    const near = groups.find((g) => distance(g.colour, c) < 36)
    if (near) near.score += score
    else groups.push({ colour: c, score })
  }
  groups.sort((a, b) => b.score - a.score)
  const primary = groups[0]?.colour ?? null
  const accent = primary
    ? (groups.slice(1).find((g) => distance(g.colour, primary) > 120)?.colour ?? null)
    : null
  return { primary: primary ? toHex(primary) : null, accent: accent ? toHex(accent) : null }
}

/** The first family in a CSS font list, without quotes; empty for generic or system fonts. */
export function fontName(family: string): string {
  const first = (family.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '')
  if (
    /^(system-ui|ui-sans-serif|ui-serif|ui-monospace|sans-serif|serif|monospace|-apple-system|BlinkMacSystemFont|inherit|initial)$/i.test(
      first
    )
  )
    return ''
  return first.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 60)
}

// ---------------------------------------------------------------- reading a site

export interface SiteShot {
  url: string
  size: 'desktop' | 'phone'
  /** PNG. */
  image: Buffer
}

export interface SiteBrand {
  url: string
  name: string
  tagline: string
  description: string
  lang: string
  primary: string | null
  accent: string | null
  headingFont: string
  /** The page's main headings and first paragraphs, as data for the agent. */
  headings: string[]
  paragraphs: string[]
  logo: { bytes: Buffer; mediaType: string; ext: string } | null
  shots: SiteShot[]
  /** Pages that could not be opened, with why. */
  problems: string[]
}

export interface SiteReadDeps {
  net: TaskNet
  signal?: AbortSignal
  /** Tests pass a fake; the default launches the laptop's Edge or Chrome. */
  launch?: () => Promise<Browser>
}

export const MAX_SHOT_PAGES = 6
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const LOGO_MEDIA: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}
const MAX_LOGO_BYTES = 2_000_000

export async function launchLocalBrowser(): Promise<Browser> {
  const channel = findBrowserChannel()
  if (!channel)
    throw new PermissionError(
      'No Edge or Chrome was found on this laptop. Install one of them to read a site’s look or make a video.'
    )
  const { chromium } = await import('playwright-core')
  return chromium.launch({ channel, headless: true })
}

async function gate(context: BrowserContext, net: TaskNet): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = request.url()
    if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
    const page = request.frame().page()
    const kind =
      request.isNavigationRequest() && request.frame() === page.mainFrame()
        ? 'navigate'
        : 'resource'
    try {
      await net.check(url, request.postData(), kind)
      await route.continue()
    } catch {
      await route.abort('blockedbyclient')
    }
  })
}

interface PageFacts {
  title: string
  siteName: string
  description: string
  lang: string
  themeColor: string
  headingFont: string
  headings: string[]
  paragraphs: string[]
  samples: ColourSample[]
  logoUrl: string
}

/** Runs in the page: what it says about itself and the colours it shows. */
function collectFacts(): PageFacts {
  const meta = (selector: string): string =>
    (document.querySelector(selector)?.getAttribute('content') ?? '').trim()
  const visible = (el: Element): DOMRect | null => {
    const rect = el.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4 || rect.bottom < 0 || rect.top > 4000) return null
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || +style.opacity < 0.1)
      return null
    return rect
  }
  const samples: ColourSample[] = []
  const push = (color: string, weight: number, kind: ColourSample['kind']): void => {
    if (color && samples.length < 600) samples.push({ color, weight, kind })
  }
  for (const el of Array.from(
    document.querySelectorAll('button, [role="button"], a, input[type="submit"]')
  ).slice(0, 400)) {
    const rect = visible(el)
    if (!rect) continue
    const style = getComputedStyle(el)
    const area = Math.min(rect.width * rect.height, 40_000)
    const filled =
      style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent'
    if (filled) push(style.backgroundColor, area, 'button')
    else if (el.tagName === 'A') push(style.color, Math.min(area, 4000), 'link')
  }
  for (const el of Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 60)) {
    const rect = visible(el)
    if (rect)
      push(getComputedStyle(el).color, Math.min(rect.width * rect.height, 20_000), 'heading')
  }
  for (const el of Array.from(
    document.querySelectorAll('header, nav, section, footer, main > div, body > div')
  ).slice(0, 200)) {
    const rect = visible(el)
    if (rect)
      push(
        getComputedStyle(el).backgroundColor,
        Math.min(rect.width * rect.height, 200_000) / 10,
        'background'
      )
  }
  const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter((el) => visible(el))
    .map((el) => text(el).slice(0, 160))
    .filter((t) => t.length > 2)
    .slice(0, 20)
  const paragraphs = Array.from(document.querySelectorAll('main p, article p, section p, p'))
    .filter((el) => visible(el))
    .map((el) => text(el).slice(0, 400))
    .filter((t) => t.length > 40)
    .slice(0, 12)
  const h1 = document.querySelector('h1, h2')
  // The logo: an image in the header that says "logo", else the site's largest icon.
  const logoImage = Array.from(
    document.querySelectorAll('header img, nav img, a[href="/"] img, img')
  ).find((el) => {
    const img = el as HTMLImageElement
    const hint = `${img.alt} ${img.className} ${img.id} ${img.src}`.toLowerCase()
    return hint.includes('logo') && !!visible(img) && !!img.currentSrc
  }) as HTMLImageElement | undefined
  const icons = Array.from(
    document.querySelectorAll('link[rel~="apple-touch-icon"], link[rel~="icon"]')
  ) as HTMLLinkElement[]
  const sizeOf = (l: HTMLLinkElement): number =>
    parseInt((l.getAttribute('sizes') ?? '0').split('x')[0], 10) || 0
  icons.sort((a, b) => sizeOf(b) - sizeOf(a))
  return {
    title: document.title.trim().slice(0, 200),
    siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'),
    description: (
      meta('meta[name="description"]') || meta('meta[property="og:description"]')
    ).slice(0, 600),
    lang: (document.documentElement.lang || '').slice(0, 12),
    themeColor: meta('meta[name="theme-color"]'),
    headingFont: h1 ? getComputedStyle(h1).fontFamily : '',
    headings,
    paragraphs,
    samples,
    logoUrl: logoImage?.currentSrc || icons[0]?.href || ''
  }
}

/** "Acme: fast invoices | Home" → "Acme". */
export function nameFromTitle(title: string, host: string): string {
  const parts = title
    .split(/\s[|\-–—·:]\s|\s*\|\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
  const stem = host
    .replace(/^www\./, '')
    .split('.')[0]
    .toLowerCase()
  const match = parts.find((p) =>
    p
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .includes(stem)
  )
  if (match && match.length <= 40) return match
  const shortest = [...parts].sort((a, b) => a.length - b.length)[0]
  if (shortest && shortest.length <= 40) return shortest
  return stem ? stem[0].toUpperCase() + stem.slice(1) : ''
}

/**
 * Read a company's site for its brand: name, description, colours, heading
 * font and logo from the first page, and a screenshot of each page asked for
 * at a desktop and a phone size (the promo video uses them).
 */
export async function readSite(
  urls: string[],
  options: { screenshots?: boolean },
  deps: SiteReadDeps
): Promise<SiteBrand> {
  const list = [...new Set(urls)].slice(0, MAX_SHOT_PAGES)
  if (!list.length) throw new MarketingError('Give the site’s address.')
  for (const url of list) await deps.net.check(url, null, 'navigate')
  const browser = await (deps.launch ?? launchLocalBrowser)()
  const first = new URL(list[0])
  const result: SiteBrand = {
    url: list[0],
    name: '',
    tagline: '',
    description: '',
    lang: '',
    primary: null,
    accent: null,
    headingFont: '',
    headings: [],
    paragraphs: [],
    logo: null,
    shots: [],
    problems: []
  }
  try {
    for (const size of ['desktop', 'phone'] as const) {
      if (size === 'phone' && options.screenshots === false) break
      const context = await browser.newContext({
        viewport: size === 'desktop' ? DESKTOP : PHONE,
        ...(size === 'phone' ? { isMobile: true, deviceScaleFactor: 2 } : {})
      })
      await gate(context, deps.net)
      for (const url of list) {
        if (deps.signal?.aborted) break
        const page = await context.newPage()
        try {
          const response = await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
          if (response && response.status() >= 400)
            throw new Error(`the site answered ${response.status()}`)
          await page.waitForTimeout(1200)
          if (size === 'desktop' && url === list[0]) {
            const facts = await page.evaluate(collectFacts)
            const colours = pickColours([
              ...(facts.themeColor
                ? [{ color: facts.themeColor, weight: 30_000, kind: 'theme' as const }]
                : []),
              ...facts.samples
            ])
            result.name = (facts.siteName || nameFromTitle(facts.title, first.hostname)).slice(
              0,
              80
            )
            result.description = facts.description
            result.tagline = (facts.headings[0] ?? '').slice(0, 160)
            result.lang = facts.lang
            result.primary = colours.primary
            result.accent = colours.accent
            result.headingFont = fontName(facts.headingFont)
            result.headings = facts.headings
            result.paragraphs = facts.paragraphs
            if (facts.logoUrl) result.logo = await fetchLogo(context, facts.logoUrl, deps.net)
          }
          if (options.screenshots !== false)
            result.shots.push({
              url,
              size,
              image: await page.screenshot({ type: 'png', animations: 'disabled' })
            })
        } catch (error) {
          if (size === 'desktop')
            result.problems.push(`${url}: ${(error as Error).message.split('\n')[0].slice(0, 160)}`)
        } finally {
          await page.close().catch(() => undefined)
        }
      }
      await context.close().catch(() => undefined)
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  if (result.problems.length === list.length)
    throw new MarketingError(`The site couldn’t be opened. ${result.problems[0]}`)
  return result
}

/**
 * The logo's bytes. A context's own requests don't pass its routes, so the
 * address is checked against the network policy here, and redirects aren't
 * followed. Null when it isn't an image we keep.
 */
async function fetchLogo(
  context: BrowserContext,
  url: string,
  net: TaskNet
): Promise<SiteBrand['logo']> {
  try {
    if (url.startsWith('data:')) {
      const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(url)
      const ext = m ? LOGO_MEDIA[m[1].toLowerCase()] : undefined
      if (!m || !ext) return null
      const bytes = Buffer.from(m[2], 'base64')
      return bytes.length <= MAX_LOGO_BYTES ? { bytes, mediaType: m[1].toLowerCase(), ext } : null
    }
    await net.check(url, null, 'resource')
    const response = await context.request.get(url, { timeout: 20_000, maxRedirects: 0 })
    if (!response.ok()) return null
    const mediaType = (response.headers()['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const ext = LOGO_MEDIA[mediaType]
    const bytes = await response.body()
    if (!ext || bytes.length > MAX_LOGO_BYTES || bytes.length < 64) return null
    return { bytes, mediaType, ext }
  } catch {
    return null
  }
}
