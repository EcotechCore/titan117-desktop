/**
 * The QA run (feature 5.2, decisions §60): a site's pages in the laptop's
 * own Edge or Chrome, headless, in a fresh profile with no sign-ins, at a
 * phone and a desktop size. For each page: errors in the console and on the
 * page, requests that failed, accessibility with axe-core (MPL 2.0, shipped
 * unchanged), and lab speed (Core Web Vitals measured in the page itself).
 *
 * Every request the page makes passes the task's network policy, like the
 * browser tool. Saved tests replay here too, without a model (5.2).
 */
import { createRequire } from 'node:module'
import type { Browser, Page } from 'playwright-core'

import { findBrowserChannel } from '../browser'
import { PermissionError } from '../folders'
import type { TaskNet } from '../web'

export const QA_SIZES = [
  { id: 'phone', width: 390, height: 844 },
  { id: 'desktop', width: 1440, height: 900 }
] as const
export const MAX_QA_PAGES = 20

export interface AxeIssue {
  id: string
  impact: string
  help: string
  helpUrl: string
  nodes: number
  example: string
}

export interface Vitals {
  /** Largest Contentful Paint, ms. */
  lcp: number | null
  /** Cumulative Layout Shift. */
  cls: number
  /** Total Blocking Time from long tasks, ms (a lab stand-in for INP). */
  tbt: number
  fcp: number | null
  ttfb: number | null
  loadMs: number
  requests: number
  /** Bytes over the network (0 where a server hides them). */
  transferKb: number
}

export interface QaPage {
  url: string
  size: (typeof QA_SIZES)[number]['id']
  status: number | null
  title: string
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
  axe: AxeIssue[]
  vitals: Vitals | null
  /** Wider than the screen: a sideways scroll. */
  overflow: boolean
  screenshot: Buffer | null
  error: string | null
}

/** Google's "good" limits for Core Web Vitals (web.dev). */
export const GOOD = { lcp: 2500, cls: 0.1, tbt: 200 } as const

/** One step of a saved test (5.2): plain actions a person would do. */
export type TestStep =
  | { action: 'goto'; url: string }
  | { action: 'click'; text: string; role?: 'button' | 'link' | 'tab' | 'checkbox' | 'menuitem' }
  | { action: 'fill'; label: string; value: string }
  | { action: 'press'; key: string }
  | { action: 'expect_text'; text: string }
  | { action: 'expect_url'; contains: string }
  | { action: 'expect_title'; contains: string }

export interface SavedTest {
  name: string
  url: string
  steps: TestStep[]
}

export interface TestRun {
  name: string
  passed: boolean
  /** The step that failed (1-based) and why. */
  failedStep: number | null
  error: string | null
  ms: number
}

const STEP_ACTIONS = ['goto', 'click', 'fill', 'press', 'expect_text', 'expect_url', 'expect_title']
const KEYS = /^(Enter|Tab|Escape|ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Space|Backspace)$/

/** Check a test the model wrote; returns it cleaned or throws. */
export function checkTest(input: unknown): SavedTest {
  const value = (input ?? {}) as Partial<SavedTest>
  const name = String(value.name ?? '').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(name))
    throw new PermissionError('Name the test in small letters with dashes, like contact-form.')
  let url: URL
  try {
    url = new URL(String(value.url ?? ''))
  } catch {
    throw new PermissionError('A test starts at a web address.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new PermissionError('A test starts at a web address.')
  const steps = Array.isArray(value.steps) ? value.steps : []
  if (!steps.length || steps.length > 50) throw new PermissionError('A test has 1 to 50 steps.')
  const clean: TestStep[] = steps.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    const text = (k: string): string => String(s[k] ?? '').slice(0, 300)
    if (!STEP_ACTIONS.includes(String(s.action)))
      throw new PermissionError(`Step ${i + 1}: the action is one of ${STEP_ACTIONS.join(', ')}.`)
    switch (s.action) {
      case 'goto':
        new URL(text('url'), url)
        return { action: 'goto', url: new URL(text('url'), url).toString() }
      case 'click':
        if (!text('text')) throw new PermissionError(`Step ${i + 1}: say what to click.`)
        return {
          action: 'click',
          text: text('text'),
          ...(['button', 'link', 'tab', 'checkbox', 'menuitem'].includes(String(s.role))
            ? { role: s.role as 'button' }
            : {})
        }
      case 'fill':
        if (!text('label')) throw new PermissionError(`Step ${i + 1}: name the field's label.`)
        return { action: 'fill', label: text('label'), value: text('value') }
      case 'press':
        if (!KEYS.test(text('key'))) throw new PermissionError(`Step ${i + 1}: an ordinary key.`)
        return { action: 'press', key: text('key') }
      case 'expect_text':
        return { action: 'expect_text', text: text('text') }
      case 'expect_url':
        return { action: 'expect_url', contains: text('contains') }
      default:
        return { action: 'expect_title', contains: text('contains') }
    }
  })
  return { name, url: url.toString(), steps: clean }
}

/** The same test as a Playwright test file, for running in a project with `npx playwright test`. */
export function playwrightSpec(test: SavedTest): string {
  const q = (s: string): string => JSON.stringify(s)
  const lines = [
    "import { test, expect } from '@playwright/test'",
    '',
    `// Written by Titan117's QA tester. Runs without AI.`,
    `test(${q(test.name)}, async ({ page }) => {`,
    `  await page.goto(${q(test.url)})`
  ]
  for (const step of test.steps) {
    if (step.action === 'goto') lines.push(`  await page.goto(${q(step.url)})`)
    if (step.action === 'click')
      lines.push(
        step.role
          ? `  await page.getByRole(${q(step.role)}, { name: ${q(step.text)} }).first().click()`
          : `  await page.getByText(${q(step.text)}).first().click()`
      )
    if (step.action === 'fill')
      lines.push(`  await page.getByLabel(${q(step.label)}).first().fill(${q(step.value)})`)
    if (step.action === 'press') lines.push(`  await page.keyboard.press(${q(step.key)})`)
    if (step.action === 'expect_text')
      lines.push(`  await expect(page.getByText(${q(step.text)}).first()).toBeVisible()`)
    if (step.action === 'expect_url')
      lines.push(`  await expect(page).toHaveURL(new RegExp(${q(escape(step.contains))}))`)
    if (step.action === 'expect_title')
      lines.push(`  await expect(page).toHaveTitle(new RegExp(${q(escape(step.contains))}))`)
  }
  lines.push('})', '')
  return lines.join('\n')
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Runs before any page script: collects paint, layout shifts and long tasks. */
const VITALS_INIT = `(() => {
  const v = { lcp: null, cls: 0, tbt: 0 };
  window.__titanVitals = v;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) v.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) v.tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
})();`

let axeSource: string | null = null
function axe(): string {
  if (!axeSource)
    axeSource = (createRequire(import.meta.url)('axe-core') as { source: string }).source
  return axeSource
}

export interface QaDeps {
  net: TaskNet
  signal?: AbortSignal
  /** Tests pass a fake; the default launches the laptop's Edge or Chrome. */
  launch?: () => Promise<Browser>
}

async function launchLocal(): Promise<Browser> {
  const channel = findBrowserChannel()
  if (!channel)
    throw new PermissionError(
      'No Edge or Chrome was found on this laptop. Install one of them to run QA checks.'
    )
  const { chromium } = await import('playwright-core')
  return chromium.launch({ channel, headless: true })
}

/** Open each page at each size and record what a tester would. */
export async function runQa(
  urls: string[],
  options: { screenshots?: boolean; sizes?: (typeof QA_SIZES)[number]['id'][] },
  deps: QaDeps
): Promise<QaPage[]> {
  const list = [...new Set(urls)].slice(0, MAX_QA_PAGES)
  for (const url of list) await deps.net.check(url, null, 'navigate')
  const browser = await (deps.launch ?? launchLocal)()
  const results: QaPage[] = []
  try {
    for (const size of QA_SIZES.filter((s) => !options.sizes || options.sizes.includes(s.id))) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height }
      })
      await gate(context, deps.net)
      await context.addInitScript(VITALS_INIT)
      for (const url of list) {
        if (deps.signal?.aborted) break
        const page = await context.newPage()
        results.push(await checkPage(page, url, size.id, !!options.screenshots))
        await page.close().catch(() => undefined)
      }
      await context.close().catch(() => undefined)
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  return results
}

async function gate(
  context: import('playwright-core').BrowserContext,
  net: TaskNet
): Promise<void> {
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

async function checkPage(
  page: Page,
  url: string,
  size: QaPage['size'],
  screenshot: boolean
): Promise<QaPage> {
  const result: QaPage = {
    url,
    size,
    status: null,
    title: '',
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    axe: [],
    vitals: null,
    overflow: false,
    screenshot: null,
    error: null
  }
  page.on('console', (m) => {
    if (m.type() === 'error' && result.consoleErrors.length < 20)
      result.consoleErrors.push(m.text().slice(0, 300))
  })
  page.on('pageerror', (e) => {
    if (result.pageErrors.length < 20) result.pageErrors.push(String(e.message).slice(0, 300))
  })
  page.on('requestfailed', (r) => {
    if (result.failedRequests.length < 30)
      result.failedRequests.push(`${r.url().slice(0, 200)} (${r.failure()?.errorText ?? 'failed'})`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && result.failedRequests.length < 30)
      result.failedRequests.push(`${r.url().slice(0, 200)} (${r.status()})`)
  })
  const started = Date.now()
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
    result.status = response?.status() ?? null
    await page.waitForTimeout(1500)
    result.title = (await page.title()).slice(0, 200)
    result.vitals = await page.evaluate((loadMs) => {
      const w = window as unknown as {
        __titanVitals?: { lcp: number | null; cls: number; tbt: number }
      }
      const v = w.__titanVitals ?? { lcp: null, cls: 0, tbt: 0 }
      const nav = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      const bytes = resources.reduce((s, r) => s + (r.transferSize || 0), nav?.transferSize ?? 0)
      return {
        lcp: v.lcp === null ? null : Math.round(v.lcp),
        cls: Math.round(v.cls * 1000) / 1000,
        tbt: Math.round(v.tbt),
        fcp: fcp ? Math.round(fcp.startTime) : null,
        ttfb: nav ? Math.round(nav.responseStart) : null,
        loadMs,
        requests: resources.length + 1,
        transferKb: Math.round(bytes / 1024)
      }
    }, Date.now() - started)
    result.overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2
    )
    // axe-core runs in the page through the debugging protocol (no script tag, so the site's CSP is untouched).
    await page.evaluate(axe())
    result.axe = await page.evaluate(async () => {
      const a = (
        window as unknown as {
          axe: {
            run(
              c: unknown,
              o: unknown
            ): Promise<{
              violations: {
                id: string
                impact: string | null
                help: string
                helpUrl: string
                nodes: { target: unknown[] }[]
              }[]
            }>
          }
        }
      ).axe
      const out = await a.run(document, { resultTypes: ['violations'] })
      return out.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? 'minor',
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
        example: String(v.nodes[0]?.target?.[0] ?? '').slice(0, 120)
      }))
    })
    if (screenshot)
      result.screenshot = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 20_000 })
  } catch (error) {
    result.error = String((error as Error).message ?? error)
      .split('\n')[0]
      .slice(0, 300)
  }
  return result
}

/** Replay saved tests without a model (5.2). */
export async function runTests(tests: SavedTest[], deps: QaDeps): Promise<TestRun[]> {
  for (const t of tests) await deps.net.check(t.url, null, 'navigate')
  const browser = await (deps.launch ?? launchLocal)()
  const runs: TestRun[] = []
  try {
    for (const test of tests) {
      if (deps.signal?.aborted) break
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
      await gate(context, deps.net)
      const page = await context.newPage()
      page.setDefaultTimeout(10_000)
      const started = Date.now()
      let failedStep: number | null = null
      let error: string | null = null
      try {
        failedStep = 0
        await page.goto(test.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        for (const [i, step] of test.steps.entries()) {
          failedStep = i + 1
          await runStep(page, step)
        }
        failedStep = null
      } catch (e) {
        error = String((e as Error).message ?? e)
          .split('\n')[0]
          .slice(0, 300)
      }
      runs.push({
        name: test.name,
        passed: failedStep === null,
        failedStep,
        error,
        ms: Date.now() - started
      })
      await context.close().catch(() => undefined)
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  return runs
}

async function runStep(page: Page, step: TestStep): Promise<void> {
  switch (step.action) {
    case 'goto':
      await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return
    case 'click': {
      const target = step.role
        ? page.getByRole(step.role, { name: step.text })
        : page.getByText(step.text)
      await target.first().click()
      await page.waitForLoadState('domcontentloaded').catch(() => undefined)
      return
    }
    case 'fill':
      await page.getByLabel(step.label).first().fill(step.value)
      return
    case 'press':
      await page.keyboard.press(step.key)
      return
    case 'expect_text':
      await page.getByText(step.text).first().waitFor({ state: 'visible' })
      return
    case 'expect_url': {
      const end = Date.now() + 10_000
      while (!page.url().includes(step.contains)) {
        if (Date.now() > end)
          throw new Error(`The address is ${page.url()}, not one with "${step.contains}".`)
        await page.waitForTimeout(200)
      }
      return
    }
    case 'expect_title': {
      const title = await page.title()
      if (!title.includes(step.contains)) throw new Error(`The title is "${title}".`)
    }
  }
}
