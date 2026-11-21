/**
 * Testing an app in three browser engines at three screen sizes (6.20,
 * 6.21, 6.29; decisions §56). Chromium is the laptop's own Edge or Chrome
 * (nothing to download); Firefox and WebKit are Playwright's own builds,
 * downloaded once from Microsoft's CDN by Playwright itself into our data
 * folder, run unchanged as separate programs. The page under test may
 * reach only its own preview on 127.0.0.1: anything else it asks for is
 * blocked and listed in the report, so nothing leaves the laptop.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Browser, BrowserType } from 'playwright-core'

import { findBrowserChannel } from '../browser'

export type EngineName = 'chromium' | 'firefox' | 'webkit'

export const SIZES = [
  { id: 'phone', label: 'Phone', width: 390, height: 844 },
  { id: 'tablet', label: 'Tablet', width: 820, height: 1180 },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 }
] as const

export type SizeId = (typeof SIZES)[number]['id']

/**
 * A mobile app's web preview (6.3, decisions §57): phone sizes first, an
 * Android-sized phone, a tablet, and the phone in dark mode, in Chromium
 * (like Android's browser engine) and WebKit (like the iPhone's).
 */
export const SMALL_PHONE = {
  id: 'phone-small',
  label: 'Small phone',
  width: 360,
  height: 780
} as const
export const MOBILE_ENGINES: EngineName[] = ['chromium', 'webkit']

/** What a run checks: a website (SEO, three engines) or a mobile app's web preview. */
export type TestProfile = 'web' | 'mobile'

export interface ShotResult {
  engine: EngineName
  size: SizeId | 'desktop-dark' | 'phone-slow' | 'desktop-language' | 'phone-small' | 'phone-dark'
  /** File name inside the report folder. */
  screenshot: string | null
  consoleErrors: string[]
  pageErrors: string[]
  /** Requests the page made that failed or were blocked (outside the preview). */
  failedRequests: string[]
  /** The page is wider than the screen (a sideways scroll on phones). */
  overflow: boolean
  /** Over the limit on a slow network (phone-slow only). */
  slow?: boolean
  loadMs: number
}

/** Each request's extra wait on the slow-network run, and what counts as too slow (6.21). */
export const SLOW_DELAY_MS = 300
export const SLOW_LIMIT_MS = 8_000
/** The other language a site is opened in (6.21): the browser asks for Romanian. */
export const OTHER_LOCALE = 'ro-RO'

export interface SeoFinding {
  ok: boolean
  check: string
  detail: string
}

export interface BrowserReport {
  engines: { engine: EngineName; ran: boolean; note?: string }[]
  shots: ShotResult[]
  seo: SeoFinding[]
}

/** Playwright's cache folder for the two downloaded engines. */
export function setBrowsersFolder(dir: string): void {
  mkdirSync(dir, { recursive: true })
  // Read by playwright-core when it looks for its browsers; set before it's first loaded.
  process.env.PLAYWRIGHT_BROWSERS_PATH = dir
}

function installed(dir: string, engine: 'firefox' | 'webkit'): boolean {
  if (!existsSync(dir)) return false
  return readdirSync(dir).some(
    (entry) =>
      entry.startsWith(`${engine}-`) && existsSync(join(dir, entry, 'INSTALLATION_COMPLETE'))
  )
}

/** playwright-core's own command line, outside the app archive when packaged. */
function playwrightCli(): string {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve('playwright-core/package.json')
  return join(dirname(pkg), 'cli.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

export interface BrowserTests {
  status(): Record<'firefox' | 'webkit', boolean>
  ensure(onProgress?: (note: string) => void): Promise<void>
  run(
    url: string,
    outDir: string,
    options?: {
      engines?: EngineName[]
      signal?: AbortSignal
      profile?: TestProfile
      /** How long a page may take to load (a mobile app's first bundle is slower). */
      loadTimeoutMs?: number
    }
  ): Promise<BrowserReport>
}

export function createBrowserTests(deps: {
  /** `<data>/components/browsers` */
  dir: string
  /** Edge or Chrome on this laptop (tests pass null to skip it). */
  channel?: 'msedge' | 'chrome' | null
}): BrowserTests {
  setBrowsersFolder(deps.dir)
  let installing: Promise<void> | null = null

  function status(): Record<'firefox' | 'webkit', boolean> {
    return { firefox: installed(deps.dir, 'firefox'), webkit: installed(deps.dir, 'webkit') }
  }

  /** Download Firefox and WebKit through Playwright, once (about 250 MB, 530 MB on disk). */
  function ensure(onProgress?: (note: string) => void): Promise<void> {
    const now = status()
    if (now.firefox && now.webkit) return Promise.resolve()
    installing ??= new Promise<void>((resolve, reject) => {
      onProgress?.('Downloading Firefox and WebKit for testing (about 250 MB), once…')
      const child = spawn(
        process.execPath,
        [playwrightCli(), 'install', ...(['firefox', 'webkit'] as const).filter((e) => !now[e])],
        {
          env: {
            ...Object.fromEntries(
              // Playwright's own download host only: one named in the environment is never used.
              Object.entries(process.env).filter(([k]) => !/^PLAYWRIGHT_.*DOWNLOAD_HOST$/.test(k))
            ),
            ELECTRON_RUN_AS_NODE: '1',
            PLAYWRIGHT_BROWSERS_PATH: deps.dir
          },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      let log = ''
      child.stdout.on('data', (c: Buffer) => (log = (log + c.toString()).slice(-4000)))
      child.stderr.on('data', (c: Buffer) => (log = (log + c.toString()).slice(-4000)))
      child.on('error', reject)
      child.on('close', (code) => {
        const after = status()
        if (code === 0 && after.firefox && after.webkit) resolve()
        else
          reject(
            new Error(
              `Couldn't download the test browsers. ${/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/.test(log) ? 'No internet connection.' : log.trim().split('\n').slice(-3).join(' ')}`
            )
          )
      })
    }).finally(() => {
      installing = null
    })
    return installing
  }

  async function launch(engine: EngineName): Promise<Browser> {
    const pw = await import('playwright-core')
    const type: BrowserType = pw[engine]
    if (engine === 'chromium') {
      const channel = deps.channel === undefined ? findBrowserChannel() : deps.channel
      if (!channel) throw new Error('No Edge or Chrome on this laptop.')
      return type.launch({ channel, headless: true })
    }
    return type.launch({ headless: true })
  }

  async function seoChecks(page: import('playwright-core').Page): Promise<SeoFinding[]> {
    const facts = await page.evaluate(() => {
      const meta = (name: string): string =>
        document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() ?? ''
      const og = (name: string): string =>
        document.querySelector(`meta[property="${name}"]`)?.getAttribute('content')?.trim() ?? ''
      return {
        title: document.title.trim(),
        description: meta('description'),
        lang: document.documentElement.getAttribute('lang') ?? '',
        viewport: meta('viewport'),
        h1: document.querySelectorAll('h1').length,
        imagesWithoutAlt: [...document.querySelectorAll('img')].filter(
          (i) => !i.hasAttribute('alt')
        ).length,
        ogTitle: og('og:title'),
        structured: document.querySelectorAll('script[type="application/ld+json"]').length,
        // At least one stylesheet with rules: an unstyled page is a broken page.
        styled: [...document.styleSheets].some((sheet) => {
          try {
            return sheet.cssRules.length > 0
          } catch {
            return true
          }
        }),
        unlabeled: [...document.querySelectorAll('input, select, textarea')].filter((el) => {
          const id = el.getAttribute('id')
          const type = el.getAttribute('type')
          if (type === 'hidden' || type === 'submit' || type === 'button') return false
          return !(
            el.getAttribute('aria-label') ||
            el.getAttribute('aria-labelledby') ||
            el.closest('label') ||
            (id && document.querySelector(`label[for="${id}"]`))
          )
        }).length
      }
    })
    const findings: SeoFinding[] = [
      {
        check: 'Styles load',
        ok: facts.styled,
        detail: facts.styled ? 'The page is styled.' : 'No styles were applied to the page.'
      },
      {
        check: 'Title',
        ok: facts.title.length > 0 && facts.title.length <= 60,
        detail: facts.title
          ? `"${facts.title}" (${facts.title.length} characters${facts.title.length > 60 ? ', over 60: search results cut it' : ''})`
          : 'The page has no title.'
      },
      {
        check: 'Description',
        ok: facts.description.length >= 50 && facts.description.length <= 160,
        detail: facts.description
          ? `${facts.description.length} characters (50–160 is best)`
          : 'No meta description.'
      },
      { check: 'Language', ok: !!facts.lang, detail: facts.lang || 'No lang on <html>.' },
      {
        check: 'Phone layout',
        ok: /width=device-width/.test(facts.viewport),
        detail: facts.viewport || 'No viewport meta tag.'
      },
      {
        check: 'One main heading',
        ok: facts.h1 === 1,
        detail: `${facts.h1} <h1> on the page`
      },
      {
        check: 'Image descriptions',
        ok: facts.imagesWithoutAlt === 0,
        detail: facts.imagesWithoutAlt
          ? `${facts.imagesWithoutAlt} image(s) without alt text`
          : 'Every image has alt text.'
      },
      {
        check: 'Link previews',
        ok: !!facts.ogTitle,
        detail: facts.ogTitle ? 'Open Graph tags present.' : 'No Open Graph tags.'
      },
      {
        check: 'Structured data',
        ok: facts.structured > 0,
        detail: facts.structured ? 'schema.org data present.' : 'No structured data.'
      },
      {
        check: 'Form labels',
        ok: facts.unlabeled === 0,
        detail: facts.unlabeled ? `${facts.unlabeled} field(s) without a label` : 'Fine.'
      }
    ]
    return findings
  }

  /** A mobile app's screen checks (6.25, the start): it shows something, and its buttons and images are named for screen readers. */
  async function mobileChecks(page: import('playwright-core').Page): Promise<SeoFinding[]> {
    const facts = await page.evaluate(() => {
      const named = (el: Element): boolean =>
        !!(
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          (el.textContent ?? '').trim()
        )
      const small = [...document.querySelectorAll('[role="button"], button, a[href]')].filter(
        (el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)
        }
      ).length
      return {
        text: (document.body.innerText ?? '').trim().length,
        unnamedButtons: [...document.querySelectorAll('[role="button"], button')].filter(
          (el) => !named(el)
        ).length,
        unnamedImages: [...document.querySelectorAll('img, [role="img"]')].filter(
          (el) => !(el.getAttribute('alt') || el.getAttribute('aria-label'))
        ).length,
        small
      }
    })
    return [
      {
        check: 'Shows something',
        ok: facts.text > 0,
        detail: facts.text
          ? 'The screen has content.'
          : 'The screen is empty: the app may have crashed.'
      },
      {
        check: 'Button names',
        ok: facts.unnamedButtons === 0,
        detail: facts.unnamedButtons
          ? `${facts.unnamedButtons} button(s) without a name (accessibilityLabel)`
          : 'Every button has a name.'
      },
      {
        check: 'Image descriptions',
        ok: facts.unnamedImages === 0,
        detail: facts.unnamedImages
          ? `${facts.unnamedImages} image(s) without accessibilityLabel`
          : 'Every image is described.'
      },
      {
        check: 'Tap targets',
        ok: facts.small === 0,
        detail: facts.small
          ? `${facts.small} button(s) or link(s) smaller than 44×44`
          : 'Buttons and links are big enough to tap.'
      }
    ]
  }

  /** Open the preview in each engine at each size; screenshots go into `outDir`. */
  async function run(
    url: string,
    outDir: string,
    options: {
      engines?: EngineName[]
      signal?: AbortSignal
      profile?: TestProfile
      loadTimeoutMs?: number
    } = {}
  ): Promise<BrowserReport> {
    mkdirSync(outDir, { recursive: true })
    const mobile = options.profile === 'mobile'
    const origin = new URL(url).origin
    const report: BrowserReport = { engines: [], shots: [], seo: [] }
    const engines =
      options.engines ?? (mobile ? MOBILE_ENGINES : (['chromium', 'firefox', 'webkit'] as const))
    for (const engine of engines) {
      if (options.signal?.aborted) break
      let browser: Browser
      try {
        browser = await launch(engine)
      } catch (error) {
        report.engines.push({
          engine,
          ran: false,
          note: error instanceof Error ? error.message.split('\n')[0] : String(error)
        })
        continue
      }
      report.engines.push({ engine, ran: true })
      try {
        type Variant = {
          size: ShotResult['size']
          viewport: { width: number; height: number }
          dark: boolean
          slow?: boolean
          locale?: string
        }
        const variants: Variant[] = mobile
          ? [
              { size: 'phone', viewport: SIZES[0], dark: false },
              { size: 'phone-small', viewport: SMALL_PHONE, dark: false },
              { size: 'tablet', viewport: SIZES[1], dark: false },
              { size: 'phone-dark', viewport: SIZES[0], dark: true }
            ]
          : [
              ...SIZES.map((s) => ({ size: s.id as ShotResult['size'], viewport: s, dark: false })),
              { size: 'desktop-dark', viewport: SIZES[2], dark: true }
            ]
        // Conditions (6.21), in the first engine that runs: a slow network and another language.
        if (engine === report.engines.find((e) => e.ran)?.engine)
          variants.push(
            { size: 'phone-slow', viewport: SIZES[0], dark: false, slow: true },
            ...(mobile
              ? []
              : [
                  {
                    size: 'desktop-language' as const,
                    viewport: SIZES[2],
                    dark: false,
                    locale: OTHER_LOCALE
                  }
                ])
          )
        for (const variant of variants) {
          if (options.signal?.aborted) break
          const context = await browser.newContext({
            viewport: { width: variant.viewport.width, height: variant.viewport.height },
            ...(mobile ? { isMobile: engine === 'chromium', hasTouch: true } : {}),
            colorScheme: variant.dark ? 'dark' : 'light',
            serviceWorkers: 'block',
            ...(variant.locale
              ? { locale: variant.locale, extraHTTPHeaders: { 'Accept-Language': variant.locale } }
              : {})
          })
          const shot: ShotResult = {
            engine,
            size: variant.size,
            screenshot: null,
            consoleErrors: [],
            pageErrors: [],
            failedRequests: [],
            overflow: false,
            loadMs: 0
          }
          // Only the app's own preview is reachable.
          await context.route('**/*', async (route) => {
            const target = route.request().url()
            if (target.startsWith(origin) || /^(data|blob):/.test(target)) {
              if (variant.slow) await new Promise((r) => setTimeout(r, SLOW_DELAY_MS))
              return route.continue()
            }
            shot.failedRequests.push(`Blocked (outside the preview): ${target.slice(0, 200)}`)
            return route.abort('blockedbyclient')
          })
          const page = await context.newPage()
          page.on('console', (m) => {
            if (m.type() === 'error' && shot.consoleErrors.length < 20)
              shot.consoleErrors.push(m.text().slice(0, 500))
          })
          page.on('pageerror', (e) => {
            if (shot.pageErrors.length < 20) shot.pageErrors.push(e.message.slice(0, 500))
          })
          page.on('response', (r) => {
            if (r.status() >= 400 && shot.failedRequests.length < 20)
              shot.failedRequests.push(`${r.status()} ${r.url().slice(0, 200)}`)
          })
          const started = Date.now()
          try {
            await page.goto(url, { waitUntil: 'load', timeout: options.loadTimeoutMs ?? 30_000 })
            await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)
            shot.loadMs = Date.now() - started
            if (variant.slow) shot.slow = shot.loadMs > SLOW_LIMIT_MS
            shot.overflow = await page.evaluate(
              () => document.documentElement.scrollWidth > window.innerWidth + 1
            )
            const file = `${engine}-${variant.size}.png`
            await page.screenshot({ path: join(outDir, file), fullPage: false })
            shot.screenshot = file
            if (
              !mobile &&
              engine === report.engines.find((e) => e.ran)?.engine &&
              variant.size === 'desktop'
            )
              report.seo = await seoChecks(page)
            if (
              mobile &&
              engine === report.engines.find((e) => e.ran)?.engine &&
              variant.size === 'phone'
            )
              report.seo = await mobileChecks(page)
          } catch (error) {
            shot.pageErrors.push(
              `Didn't load: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
            )
          }
          report.shots.push(shot)
          await context.close()
        }
      } finally {
        await browser.close().catch(() => undefined)
      }
    }
    // Works without the internet: nothing outside the preview was asked for (6.21).
    if (report.shots.length) {
      const outside = report.shots.flatMap((s) =>
        s.failedRequests.filter((r) => r.startsWith('Blocked'))
      ).length
      report.seo.push({
        check: 'Works offline',
        ok: outside === 0,
        detail: outside
          ? `${outside} request(s) to other websites: the page needs the internet.`
          : 'Nothing comes from other websites.'
      })
    }
    writeFileSync(join(outDir, 'browsers.json'), JSON.stringify(report, null, 2))
    return report
  }

  return { status, ensure, run }
}
