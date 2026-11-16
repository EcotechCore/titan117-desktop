/**
 * The browser (feature 3.10): Playwright driving the laptop's own Edge or
 * Chrome (nothing downloaded), with its own profile in the app's data folder
 * so sites the user signs into stay signed in. Every request the browser
 * makes passes the task's network policy (security.md A3): a page the task
 * opens is a navigation; what the page loads by itself is a resource, allowed
 * unless it carries private content (the hidden-image trick).
 *
 * Never (decisions §29, guardrails §5): stealth, fake fingerprints, hidden
 * automation flags or CAPTCHA solving. A CAPTCHA hands over to the user.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'

import { PermissionError } from './folders'
import type { TaskNet } from './web'

export interface PageView {
  url: string
  title: string
  /** The page's visible text, shortened. */
  text: string
  /** Things to click or fill, each with a ref for click and type. */
  controls: string
  /** Set when the page shows a CAPTCHA: the user must take over. */
  captcha: boolean
}

export interface BrowserAccess {
  open(url: string): Promise<PageView>
  view(): Promise<PageView>
  /** The visible label of a control, for the final-step check before clicking. */
  label(ref: string): Promise<string>
  click(ref: string): Promise<PageView>
  type(ref: string, text: string, submit: boolean): Promise<PageView>
  select(ref: string, value: string): Promise<PageView>
  back(): Promise<PageView>
  /** Click a control that downloads a file, and hand the file over (decisions §50). */
  download(ref: string): Promise<{ name: string; data: Buffer; url: string }>
}

/** A download bigger than this is stopped (decisions §50). */
export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024

export interface BrowserHost {
  /** The browser for one task, sharing the one profile. */
  forTask(taskId: string, net: TaskNet): BrowserAccess
  /** Close a task's pages (the task ended). */
  release(taskId: string): Promise<void>
  close(): Promise<void>
}

const TEXT_LIMIT = 15_000
const CONTROL_LIMIT = 150

/** Edge or Chrome on this laptop, in that order on Windows; Chrome first elsewhere. */
export function findBrowserChannel(platform = process.platform): 'msedge' | 'chrome' | null {
  const candidates: Record<string, { channel: 'msedge' | 'chrome'; paths: string[] }[]> = {
    win32: [
      {
        channel: 'msedge',
        paths: [
          join(
            process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
            'Microsoft\\Edge\\Application\\msedge.exe'
          ),
          join(
            process.env.ProgramFiles ?? 'C:\\Program Files',
            'Microsoft\\Edge\\Application\\msedge.exe'
          )
        ]
      },
      {
        channel: 'chrome',
        paths: [
          join(
            process.env.ProgramFiles ?? 'C:\\Program Files',
            'Google\\Chrome\\Application\\chrome.exe'
          ),
          join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe')
        ]
      }
    ],
    darwin: [
      { channel: 'chrome', paths: ['/Applications/Google Chrome.app'] },
      { channel: 'msedge', paths: ['/Applications/Microsoft Edge.app'] }
    ],
    linux: [
      { channel: 'chrome', paths: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome'] },
      { channel: 'msedge', paths: ['/opt/microsoft/msedge/msedge'] }
    ]
  }
  for (const { channel, paths } of candidates[platform] ?? [])
    if (paths.some((p) => p && existsSync(p))) return channel
  return null
}

/** Runs in the page: numbers the controls and returns the page as text. */
function readPage(limits: { text: number; controls: number }): {
  title: string
  text: string
  controls: string
  captcha: boolean
} {
  const selector =
    'a[href], button, input, select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [contenteditable=true]'
  const lines: string[] = []
  let n = 0
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      style.visibility === 'hidden' ||
      style.display === 'none'
    )
      continue
    if ((el as HTMLInputElement).type === 'hidden') continue
    n += 1
    el.setAttribute('data-titan-ref', String(n))
    const tag = el.tagName.toLowerCase()
    const role =
      el.getAttribute('role') ??
      (tag === 'a'
        ? 'link'
        : tag === 'input'
          ? `input ${(el as HTMLInputElement).type || 'text'}`
          : tag)
    const name = (
      el.getAttribute('aria-label') ??
      el.getAttribute('placeholder') ??
      el.innerText ??
      el.getAttribute('title') ??
      el.getAttribute('name') ??
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    const value =
      tag === 'input' || tag === 'textarea' || tag === 'select'
        ? ` = "${String((el as HTMLInputElement).value ?? '').slice(0, 40)}"`
        : ''
    if (lines.length < limits.controls) lines.push(`[${n}] ${role} "${name}"${value}`)
  }
  const captcha = !!document.querySelector(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, .cf-turnstile'
  )
  return {
    title: document.title,
    text: (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, limits.text),
    controls: lines.join('\n'),
    captcha
  }
}

export function createBrowserHost(options: {
  profileDir: string
  headless: boolean
  channel?: 'msedge' | 'chrome' | null
}): BrowserHost {
  let context: Promise<BrowserContext> | null = null
  const pages = new Map<string, Page>()
  const nets = new Map<string, TaskNet>()

  async function launch(): Promise<BrowserContext> {
    const channel = options.channel === undefined ? findBrowserChannel() : options.channel
    if (!channel)
      throw new PermissionError(
        'No Edge or Chrome was found on this laptop. Install one of them to let Titan use the browser.'
      )
    const { chromium } = await import('playwright-core')
    const ctx = await chromium.launchPersistentContext(options.profileDir, {
      channel,
      headless: options.headless,
      acceptDownloads: false,
      viewport: { width: 1280, height: 860 }
    })
    ctx.on('close', () => {
      context = null
      pages.clear()
    })
    // One gate for every request from every page: the owning task's network policy.
    await ctx.route('**/*', async (route) => {
      const request = route.request()
      const page = request.frame().page()
      const taskId = [...pages.entries()].find(([, p]) => p === page)?.[0]
      const net = taskId ? nets.get(taskId) : undefined
      const url = request.url()
      if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
      if (!net) return route.abort('blockedbyclient')
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
    return ctx
  }

  async function pageFor(taskId: string): Promise<Page> {
    const existing = pages.get(taskId)
    if (existing && !existing.isClosed()) return existing
    context ??= launch().catch((error) => {
      context = null
      throw error
    })
    const ctx = await context
    const page =
      ctx.pages().find((p) => ![...pages.values()].includes(p) && p.url() === 'about:blank') ??
      (await ctx.newPage())
    pages.set(taskId, page)
    return page
  }

  async function view(page: Page): Promise<PageView> {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
    const read = await page.evaluate(readPage, { text: TEXT_LIMIT, controls: CONTROL_LIMIT })
    return { url: page.url(), ...read }
  }

  function locator(page: Page, ref: string): ReturnType<Page['locator']> {
    if (!/^\d{1,5}$/.test(ref))
      throw new PermissionError('Use a control number from the page view.')
    return page.locator(`[data-titan-ref="${ref}"]`).first()
  }

  async function settle(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
    await page.waitForTimeout(400)
  }

  return {
    forTask(taskId, net) {
      nets.set(taskId, net)
      return {
        async open(url) {
          // Checked here too, so a refused site never even starts loading.
          await net.check(url, null, 'navigate')
          const page = await pageFor(taskId)
          await page
            .goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
            .catch((error: Error) => {
              if (/ERR_BLOCKED_BY_CLIENT/.test(error.message))
                throw new PermissionError("That page was blocked by the task's network policy.")
              throw error
            })
          await settle(page)
          return view(page)
        },
        async view() {
          return view(await pageFor(taskId))
        },
        async label(ref) {
          const page = await pageFor(taskId)
          const target = locator(page, ref)
          const text = await target
            .evaluate((el: HTMLElement) =>
              [
                el.innerText,
                el.getAttribute('aria-label'),
                (el as HTMLInputElement).value,
                el.getAttribute('title')
              ]
                .filter(Boolean)
                .join(' ')
            )
            .catch(() => '')
          return text.replace(/\s+/g, ' ').trim()
        },
        async click(ref) {
          const page = await pageFor(taskId)
          await locator(page, ref).click({ timeout: 10_000 })
          await settle(page)
          return view(page)
        },
        async type(ref, text, submit) {
          const page = await pageFor(taskId)
          // What goes into a form field may not carry private content either.
          await net.check(page.url(), text, 'resource')
          const target = locator(page, ref)
          await target.fill(text, { timeout: 10_000 })
          if (submit) await target.press('Enter')
          await settle(page)
          return view(page)
        },
        async select(ref, value) {
          const page = await pageFor(taskId)
          await locator(page, ref).selectOption(value, { timeout: 10_000 })
          await settle(page)
          return view(page)
        },
        async back() {
          const page = await pageFor(taskId)
          await page.goBack({ timeout: 15_000 }).catch(() => undefined)
          await settle(page)
          return view(page)
        },
        async download(ref) {
          const page = await pageFor(taskId)
          const [file] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            locator(page, ref).click({ timeout: 10_000 })
          ])
          // The file's own address is checked like any request the task makes.
          await net.check(file.url(), null, 'resource')
          const stream = await file.createReadStream()
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of stream) {
            size += (chunk as Buffer).length
            if (size > MAX_DOWNLOAD_BYTES) {
              stream.destroy()
              await file.cancel().catch(() => undefined)
              throw new PermissionError('That file is larger than 200 MB, so it was not downloaded.')
            }
            chunks.push(chunk as Buffer)
          }
          await file.delete().catch(() => undefined)
          return { name: file.suggestedFilename(), data: Buffer.concat(chunks), url: file.url() }
        }
      }
    },
    async release(taskId) {
      nets.delete(taskId)
      const page = pages.get(taskId)
      pages.delete(taskId)
      await page?.close().catch(() => undefined)
    },
    async close() {
      const ctx = context
      context = null
      pages.clear()
      nets.clear()
      if (ctx) await (await ctx).close().catch(() => undefined)
    }
  }
}
