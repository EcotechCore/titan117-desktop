/**
 * The recorder (features 5.6, 8.2-8.5; decisions §61): what the user does in
 * the browser becomes a list of plain steps, saved as a file in the app's
 * data folder (out of every agent's file tools' reach). A recording replays
 * without AI, in the same browser, so sites the user signed into stay
 * signed in.
 *
 * - A password is never recorded: the step says "the saved login for this
 *   site", and the value comes from the OS keychain at replay (8.5).
 * - An element is remembered several ways (role and name, label, text, CSS);
 *   replay tries them in that order (ideas from Playwright's recorder and
 *   Puppeteer Replay's alternative selectors, both Apache 2.0; our own code).
 * - The final step stays the user's: the caller is asked before every click,
 *   and decides which ones need the user's OK (decisions §29).
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'

import { AutomationError } from './schedule'

export const MAX_STEPS = 200
export const MAX_RECORDINGS = 100
const NAME = /^[a-z0-9][a-z0-9-]{0,59}$/
const VARIABLE = /^[a-z][a-z0-9_]{0,39}$/
const KEYS = /^(Enter|Tab|Escape|ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Space|Backspace)$/
const ROLES = [
  'button',
  'link',
  'tab',
  'checkbox',
  'radio',
  'menuitem',
  'textbox',
  'combobox',
  'option',
  'switch'
] as const
type Role = (typeof ROLES)[number]

/** How an element is found again: tried in this order. */
export interface Target {
  role?: Role
  /** The accessible name that goes with the role. */
  name?: string
  /** A form field's label. */
  label?: string
  text?: string
  css?: string
}

export type Step =
  | { action: 'goto'; url: string }
  | { action: 'click'; target: Target }
  /** `value` may hold variables, written {{name}} (in fill, select and goto). */
  | { action: 'fill'; target: Target; value: string }
  /** The saved login for `site`, from the keychain; never a value in the file. */
  | { action: 'fill_login'; target: Target; field: 'username' | 'password'; site: string }
  | { action: 'select'; target: Target; value: string }
  | { action: 'press'; key: string }
  | { action: 'wait_text'; text: string }
  /** Hand over to the user (a 2FA code, a CAPTCHA), then carry on. */
  | { action: 'pause'; note: string }

export interface Variable {
  name: string
  label: string
  default: string
}

export interface Recording {
  /** The file name: small letters and dashes. */
  name: string
  title: string
  url: string
  variables: Variable[]
  steps: Step[]
  source: string
  updatedAt: number
}

/** What the page script reports while the user records. */
export interface RecordedEvent {
  kind: 'click' | 'fill' | 'select' | 'press'
  target: Target
  value?: string
  key?: string
  /** A password field: the value was never read. */
  secret?: boolean
  /** A field that looks like the username next to a password. */
  username?: boolean
  url: string
  at: number
}

export interface RunResult {
  name: string
  passed: boolean
  /** How many steps ran to the end. */
  done: number
  /** The step that failed (1-based) and why. */
  failedStep: number | null
  error: string | null
  /** Where the browser was when it stopped. */
  url: string
  title: string
  ms: number
}

export interface ReplayHooks {
  values?: Record<string, string>
  /** The saved login for a site, or null. */
  login(site: string): { username: string; password: string } | null
  /** Before every click or submit: throws when the user doesn't allow it. */
  beforeClick(label: string): Promise<void>
  /** Hand over to the user; resolves when they say to go on, throws when not. */
  pause(note: string): Promise<void>
  /** What is about to be typed into the page at `url`: throws when it may not leave. */
  beforeType?(url: string, text: string): Promise<void>
  onStep?(index: number, text: string): void
  signal?: AbortSignal
}

function str(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function checkTarget(raw: unknown, step: number, fallback: Record<string, unknown>): Target {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const role = ROLES.find((r) => r === (t.role ?? fallback.role))
  const target: Target = {
    ...(role ? { role } : {}),
    ...(str(t.name, 200) ? { name: str(t.name, 200) } : {}),
    ...(str(t.label ?? fallback.label, 200) ? { label: str(t.label ?? fallback.label, 200) } : {}),
    ...(str(t.text ?? fallback.text, 200) ? { text: str(t.text ?? fallback.text, 200) } : {}),
    ...(str(t.css, 300) ? { css: str(t.css, 300) } : {})
  }
  // The simple form a model writes: {"action":"click","text":"Save","role":"button"}.
  if (target.role && !target.name && target.text) target.name = target.text
  if (!target.name && !target.label && !target.text && !target.css)
    throw new AutomationError(`Step ${step}: say which element (its text, label or role and name).`)
  return target
}

/** Check a recording from the recorder, the window or a model; returns it cleaned or throws. */
export function checkRecording(input: unknown, source: string): Recording {
  const value = (input ?? {}) as Record<string, unknown>
  const name = String(value.name ?? '').trim()
  if (!NAME.test(name))
    throw new AutomationError(
      'Name the recording in small letters with dashes, like monthly-report.'
    )
  let url: URL
  try {
    url = new URL(String(value.url ?? ''))
  } catch {
    throw new AutomationError('A recording starts at a web address.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new AutomationError('A recording starts at a web address.')
  const rawSteps = Array.isArray(value.steps) ? value.steps : []
  if (!rawSteps.length || rawSteps.length > MAX_STEPS)
    throw new AutomationError(`A recording has 1 to ${MAX_STEPS} steps.`)
  const steps: Step[] = rawSteps.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    const n = i + 1
    switch (s.action) {
      case 'goto': {
        const to = String(s.url ?? '').slice(0, 2000)
        try {
          // Variables may stand in an address; it must still be one.
          const parsed = new URL(to.replace(/\{\{[a-z0-9_]+\}\}/g, 'x'), url)
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('no')
        } catch {
          throw new AutomationError(`Step ${n}: that is not a web address.`)
        }
        return { action: 'goto', url: /^https?:\/\//i.test(to) ? to : new URL(to, url).toString() }
      }
      case 'click':
        return { action: 'click', target: checkTarget(s.target, n, s) }
      case 'fill':
        return {
          action: 'fill',
          target: checkTarget(s.target, n, s),
          value: String(s.value ?? '').slice(0, 5000)
        }
      case 'fill_login': {
        const site = str(s.site, 200).toLowerCase() || url.hostname
        if (!/^[a-z0-9.-]+$/.test(site))
          throw new AutomationError(`Step ${n}: the site is a host name, like portal.example.com.`)
        return {
          action: 'fill_login',
          target: checkTarget(s.target, n, s),
          field: s.field === 'username' ? 'username' : 'password',
          site
        }
      }
      case 'select':
        return {
          action: 'select',
          target: checkTarget(s.target, n, s),
          value: String(s.value ?? '').slice(0, 500)
        }
      case 'press':
        if (!KEYS.test(String(s.key)))
          throw new AutomationError(`Step ${n}: an ordinary key, like Enter or Tab.`)
        return { action: 'press', key: String(s.key) }
      case 'wait_text':
      case 'expect_text':
        if (!str(s.text, 300)) throw new AutomationError(`Step ${n}: say which text to wait for.`)
        return { action: 'wait_text', text: str(s.text, 300) }
      case 'pause':
        return {
          action: 'pause',
          note: str(s.note, 300) || 'Finish this step yourself in the browser window.'
        }
      default:
        throw new AutomationError(
          `Step ${n}: the action is one of goto, click, fill, fill_login, select, press, wait_text, pause.`
        )
    }
  })
  const variables: Variable[] = (Array.isArray(value.variables) ? value.variables : [])
    .slice(0, 20)
    .map((raw) => {
      const v = (raw ?? {}) as Record<string, unknown>
      const vName = String(v.name ?? '').trim()
      if (!VARIABLE.test(vName))
        throw new AutomationError('A variable is named in small letters, like invoice_number.')
      return {
        name: vName,
        label: str(v.label, 80) || vName,
        default: String(v.default ?? '').slice(0, 1000)
      }
    })
  const known = new Set(variables.map((v) => v.name))
  for (const step of steps) {
    const text =
      step.action === 'fill' || step.action === 'select'
        ? step.value
        : step.action === 'goto'
          ? step.url
          : ''
    for (const [, used] of text.matchAll(/\{\{([a-z0-9_]+)\}\}/g))
      if (!known.has(used))
        throw new AutomationError(`The steps use {{${used}}}, which isn't in the variables.`)
  }
  return {
    name,
    title: str(value.title, 120) || name,
    url: url.toString(),
    variables,
    steps,
    source: str(source, 200) || 'you',
    updatedAt: Date.now()
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Turn what the page reported into steps: the last value of a field counts once. */
export function stepsFromEvents(events: RecordedEvent[], startUrl: string): Step[] {
  const steps: Step[] = []
  const same = (a: Target, b: Target): boolean => JSON.stringify(a) === JSON.stringify(b)
  for (const e of events) {
    const last = steps[steps.length - 1]
    if (e.kind === 'click') {
      steps.push({ action: 'click', target: e.target })
    } else if (e.kind === 'fill') {
      const site = hostOf(e.url || startUrl)
      const step: Step =
        e.secret && site
          ? { action: 'fill_login', target: e.target, field: 'password', site }
          : { action: 'fill', target: e.target, value: e.value ?? '' }
      // Typing into the same field again replaces the earlier step.
      if (
        last &&
        (last.action === 'fill' || last.action === 'fill_login') &&
        same(last.target, e.target)
      )
        steps[steps.length - 1] = step
      else steps.push(step)
    } else if (e.kind === 'select') {
      steps.push({ action: 'select', target: e.target, value: e.value ?? '' })
    } else if (e.kind === 'press' && e.key && KEYS.test(e.key)) {
      steps.push({ action: 'press', key: e.key })
    }
    if (steps.length >= MAX_STEPS) break
  }
  // A click on a field that is then filled says nothing new.
  return steps.filter((step, i) => {
    const next = steps[i + 1]
    return !(
      step.action === 'click' &&
      next &&
      (next.action === 'fill' || next.action === 'fill_login' || next.action === 'select') &&
      same(step.target, next.target)
    )
  })
}

/** One step in plain words, for the list, the approval card and the model. */
export function describeStep(step: Step): string {
  const what = (t: Target): string =>
    t.name
      ? `${t.role ?? 'element'} "${t.name}"`
      : t.label
        ? `the field "${t.label}"`
        : t.text
          ? `"${t.text}"`
          : (t.css ?? 'an element')
  switch (step.action) {
    case 'goto':
      return `Open ${step.url}`
    case 'click':
      return `Click ${what(step.target)}`
    case 'fill':
      return `Fill ${what(step.target)} with "${step.value.slice(0, 80)}"`
    case 'fill_login':
      return `Fill ${what(step.target)} with the saved ${step.field} for ${step.site}`
    case 'select':
      return `Choose "${step.value}" in ${what(step.target)}`
    case 'press':
      return `Press ${step.key}`
    case 'wait_text':
      return `Wait for the text "${step.text}"`
    case 'pause':
      return `Pause for you: ${step.note}`
  }
}

/**
 * Runs in the page while the user records: reports clicks, what was typed,
 * choices and Enter. It never reads a password field's value.
 */
export function captureScript(): void {
  const w = window as unknown as {
    __titanRecord?: (event: unknown) => void
    __titanRecording?: boolean
  }
  if (w.__titanRecording || window.top !== window) return
  w.__titanRecording = true
  const clean = (s: string | null | undefined, max = 120): string =>
    (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const roleOf = (el: Element): string | undefined => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'a' && el.hasAttribute('href')) return 'link'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      return 'textbox'
    }
    return undefined
  }
  const labelOf = (el: Element): string => {
    const aria = el.getAttribute('aria-label')
    if (aria) return clean(aria)
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const text = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
      if (clean(text)) return clean(text)
    }
    const id = el.getAttribute('id')
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`)
      if (label) return clean(label.textContent)
    }
    const wrap = el.closest('label')
    if (wrap) return clean(wrap.textContent)
    return clean(el.getAttribute('placeholder'))
  }
  const cssOf = (el: Element): string => {
    const stable = (v: string | null): v is string => !!v && v.length < 60 && !/\d{4,}/.test(v)
    const id = el.getAttribute('id')
    if (stable(id) && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1)
      return `#${CSS.escape(id)}`
    for (const attr of ['data-testid', 'data-test', 'name']) {
      const v = el.getAttribute(attr)
      const sel = `${el.tagName.toLowerCase()}[${attr}="${(v ?? '').replace(/"/g, '\\"')}"]`
      if (stable(v) && document.querySelectorAll(sel).length === 1) return sel
    }
    const parts: string[] = []
    let node: Element | null = el
    for (let depth = 0; node && node !== document.body && depth < 5; depth++) {
      const tag = node.tagName.toLowerCase()
      const parent: Element | null = node.parentElement
      const same = parent
        ? Array.from(parent.children).filter((c) => c.tagName === node!.tagName)
        : []
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag)
      node = parent
    }
    return parts.join(' > ')
  }
  const targetOf = (el: Element): Record<string, string> => {
    const role = roleOf(el)
    const field = ['textbox', 'combobox', 'checkbox', 'radio'].includes(role ?? '')
    const label = field ? labelOf(el) : ''
    const text = field
      ? ''
      : clean(
          el.getAttribute('aria-label') ||
            (el as HTMLElement).innerText ||
            (el as HTMLInputElement).value ||
            el.getAttribute('title'),
          80
        )
    const out: Record<string, string> = {}
    if (role) out.role = role
    if (field ? label : text) out.name = field ? label : text
    if (label) out.label = label
    if (text) out.text = text
    out.css = cssOf(el)
    return out
  }
  const send = (event: Record<string, unknown>): void => {
    try {
      w.__titanRecord?.({ ...event, url: location.href, at: Date.now() })
    } catch {
      // Recording stopped.
    }
  }
  const CLICKABLE =
    'a[href], button, summary, input[type=button], input[type=submit], input[type=checkbox], input[type=radio], [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=menuitem], [role=option], [role=switch]'
  const sent = new WeakMap<Element, string>()
  const reportFill = (el: HTMLInputElement | HTMLTextAreaElement): void => {
    const secret = (el as HTMLInputElement).type === 'password'
    const value = secret ? '' : el.value
    if (!secret && sent.get(el) === value) return
    sent.set(el, value)
    const form = el.closest('form')
    send({
      kind: 'fill',
      target: targetOf(el),
      ...(secret ? { secret: true } : { value }),
      ...(!secret && !!form?.querySelector('input[type=password]') ? { username: true } : {})
    })
  }
  document.addEventListener(
    'click',
    (event) => {
      const el = (event.target as Element | null)?.closest?.(CLICKABLE)
      if (el) send({ kind: 'click', target: targetOf(el) })
    },
    true
  )
  document.addEventListener(
    'change',
    (event) => {
      const el = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
      if (!el || !el.tagName) return
      const tag = el.tagName.toLowerCase()
      if (tag === 'select') {
        const select = el as HTMLSelectElement
        send({
          kind: 'select',
          target: targetOf(el),
          value: clean(select.selectedOptions[0]?.textContent) || select.value
        })
      } else if (tag === 'textarea') reportFill(el as HTMLTextAreaElement)
      else if (tag === 'input') {
        const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
        if (!['checkbox', 'radio', 'button', 'submit', 'file', 'hidden'].includes(type))
          reportFill(el as HTMLInputElement)
      }
    },
    true
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter') return
      const el = event.target as HTMLInputElement | null
      if (!el || el.tagName?.toLowerCase() !== 'input') return
      // What was typed so far counts before the Enter.
      reportFill(el)
      send({ kind: 'press', key: 'Enter', target: targetOf(el) })
    },
    true
  )
}

function fillVariables(text: string, recording: Recording, values: Record<string, string>): string {
  return text.replace(/\{\{([a-z0-9_]+)\}\}/g, (_, name: string) => {
    const variable = recording.variables.find((v) => v.name === name)
    const value = values[name] ?? variable?.default ?? ''
    if (!value) throw new AutomationError(`Give a value for "${variable?.label ?? name}".`)
    return value
  })
}

/** Find the element again: role and name, then label, text and CSS; the first that is on the page. */
async function find(page: Page, target: Target, timeoutMs: number): Promise<Locator> {
  const candidates: Locator[] = []
  if (target.role && target.name)
    candidates.push(page.getByRole(target.role, { name: target.name }))
  if (target.label) candidates.push(page.getByLabel(target.label))
  if (target.text) candidates.push(page.getByText(target.text))
  if (target.css) candidates.push(page.locator(target.css))
  const end = Date.now() + timeoutMs
  for (;;) {
    for (const candidate of candidates) {
      const first = candidate.first()
      if (
        (await candidate.count().catch(() => 0)) > 0 &&
        (await first.isVisible().catch(() => false))
      )
        return first
    }
    if (Date.now() > end)
      throw new Error(
        `Couldn't find ${target.name ?? target.label ?? target.text ?? target.css} on the page.`
      )
    await page.waitForTimeout(250)
  }
}

async function labelOf(locator: Locator): Promise<string> {
  return (
    await locator
      .evaluate((el: HTMLElement) =>
        [
          el.innerText,
          el.getAttribute('aria-label'),
          (el as HTMLInputElement).type === 'password' ? '' : (el as HTMLInputElement).value,
          el.getAttribute('title')
        ]
          .filter(Boolean)
          .join(' ')
      )
      .catch(() => '')
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/** Replay a recording on a page, without a model. */
export async function replayOn(
  page: Page,
  recording: Recording,
  hooks: ReplayHooks,
  options: { stepTimeoutMs?: number } = {}
): Promise<RunResult> {
  const timeout = options.stepTimeoutMs ?? 10_000
  const values = hooks.values ?? {}
  const started = Date.now()
  let done = 0
  let failedStep: number | null = null
  let error: string | null = null
  const settle = async (): Promise<void> => {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  try {
    failedStep = 0
    await page.goto(recording.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await settle()
    for (const [i, step] of recording.steps.entries()) {
      if (hooks.signal?.aborted) throw new Error('Stopped.')
      failedStep = i + 1
      hooks.onStep?.(i + 1, describeStep(step))
      switch (step.action) {
        case 'goto':
          await page.goto(fillVariables(step.url, recording, values), {
            waitUntil: 'domcontentloaded',
            timeout: 30_000
          })
          await settle()
          break
        case 'click': {
          const el = await find(page, step.target, timeout)
          await hooks.beforeClick(await labelOf(el))
          await el.click({ timeout })
          await settle()
          break
        }
        case 'fill': {
          const el = await find(page, step.target, timeout)
          const text = fillVariables(step.value, recording, values)
          await hooks.beforeType?.(page.url(), text)
          await el.fill(text, { timeout })
          break
        }
        case 'fill_login': {
          // Only on the site the login is for: a look-alike page gets nothing.
          const host = new URL(page.url()).hostname.toLowerCase()
          if (host !== step.site && !host.endsWith(`.${step.site}`))
            throw new Error(
              `This page is on ${host}, not ${step.site}: the saved login was not filled in.`
            )
          const login = hooks.login(step.site)
          if (!login)
            throw new Error(
              `There is no saved login for ${step.site}. Add it under Automations, Saved logins.`
            )
          const el = await find(page, step.target, timeout)
          await el.fill(step.field === 'username' ? login.username : login.password, { timeout })
          break
        }
        case 'select': {
          const el = await find(page, step.target, timeout)
          const choice = fillVariables(step.value, recording, values)
          // By its text first, then by its value; a short wait each, so a wrong one fails soon.
          await el
            .selectOption({ label: choice }, { timeout: 2500 })
            .catch(() => el.selectOption(choice, { timeout: 2500 }))
            .catch(() => {
              throw new Error(`"${choice}" isn't one of the choices in this list.`)
            })
          break
        }
        case 'press': {
          if (step.key === 'Enter') {
            // Enter in a form sends it: the form's own button says what that does.
            const label = await page
              .evaluate(() => {
                const form = (document.activeElement as HTMLElement | null)?.closest?.('form')
                const button = form?.querySelector<HTMLElement>(
                  '[type=submit], button:not([type=button])'
                )
                return button ? button.innerText || (button as HTMLInputElement).value || '' : ''
              })
              .catch(() => '')
            await hooks.beforeClick(String(label).replace(/\s+/g, ' ').trim().slice(0, 200))
          }
          await page.keyboard.press(step.key)
          await settle()
          break
        }
        case 'wait_text':
          await page.getByText(step.text).first().waitFor({ state: 'visible', timeout })
          break
        case 'pause':
          await hooks.pause(step.note)
          await settle()
          break
      }
      done = i + 1
    }
    failedStep = null
  } catch (e) {
    if ((e as Error).name === 'PermissionError') throw e
    error = String((e as Error).message ?? e)
      .split('\n')[0]
      .slice(0, 300)
  }
  return {
    name: recording.name,
    passed: failedStep === null,
    done,
    failedStep,
    error,
    url: page.url(),
    title: (await page.title().catch(() => '')).slice(0, 200),
    ms: Date.now() - started
  }
}

export interface RecordingStore {
  list(): Recording[]
  get(name: string): Recording | null
  save(recording: Recording): Recording
  remove(name: string): void
}

export function createRecordingStore(deps: {
  /** Null keeps the files in memory (tests). */
  dir: string | null
  onChange?: () => void
}): RecordingStore {
  const { dir } = deps
  const memory = new Map<string, string>()
  const changed = deps.onChange ?? (() => undefined)

  const store: RecordingStore = {
    list() {
      const entries: [string, string][] = dir
        ? (() => {
            try {
              return readdirSync(dir)
                .filter((f) => f.endsWith('.json'))
                .map((f): [string, string] => [f.slice(0, -5), readFileSync(join(dir, f), 'utf8')])
            } catch {
              return []
            }
          })()
        : [...memory.entries()]
      const found: Recording[] = []
      for (const [name, text] of entries) {
        try {
          const raw = JSON.parse(text) as Record<string, unknown>
          const recording = checkRecording(raw, String(raw.source ?? 'you'))
          if (recording.name === name)
            found.push({ ...recording, updatedAt: Number(raw.updatedAt) || 0 })
        } catch {
          // A broken file is skipped; the user sees it missing.
        }
      }
      return found.sort((a, b) => a.name.localeCompare(b.name))
    },

    get(name) {
      const key = String(name ?? '')
        .trim()
        .toLowerCase()
      return store.list().find((r) => r.name === key) ?? null
    },

    save(recording) {
      if (!store.get(recording.name) && store.list().length >= MAX_RECORDINGS)
        throw new AutomationError(
          `There are already ${MAX_RECORDINGS} recordings. Remove one first.`
        )
      const saved = { ...recording, updatedAt: Date.now() }
      const text = `${JSON.stringify(saved, null, 2)}\n`
      if (dir) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${saved.name}.json`), text, 'utf8')
      } else memory.set(saved.name, text)
      changed()
      return saved
    },

    remove(name) {
      const recording = store.get(name)
      if (!recording) throw new AutomationError('There is no such recording.')
      if (dir) rmSync(join(dir, `${recording.name}.json`), { force: true })
      else memory.delete(recording.name)
      changed()
    }
  }
  return store
}
