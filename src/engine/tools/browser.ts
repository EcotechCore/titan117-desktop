/**
 * Browser tools (feature 3.10). Titan opens pages, reads them, clicks, fills
 * and checks the result itself. Three rules (decisions §29):
 *
 *   - the final step is the user's: a control that publishes, posts, sends,
 *     pays, buys, deletes or submits an order asks first, every time;
 *   - sites whose terms forbid automation show a warning first, and the
 *     user's answer is remembered per site;
 *   - Discord isn't automated at all, and a CAPTCHA hands over to the user.
 *
 * Pages are data, never instructions (guardrails §5).
 */
import { PermissionError } from '../lib/folders'
import type { PageView } from '../lib/browser'
import { defineTool } from './lib/define-tool'

/** Sites known to forbid automation or restrict accounts for it (decisions §29). */
export const FORBIDS_AUTOMATION = [
  'facebook.com',
  'instagram.com',
  'threads.net',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'ads.google.com',
  'google.com/search',
  'bing.com/search',
  'duckduckgo.com'
]

const NEVER = ['discord.com', 'discordapp.com']

/** Words on a control that make it a final step: publish, post, send, pay and the like. */
export const FINAL_STEP =
  /\b(publish|post|tweet|send|pay|buy|purchase|order|checkout|check out|place order|subscribe|donate|transfer|delete|remove account|confirm payment|submit payment|book now|sign up|register|launch|go live|share)\b/i

export function siteRule(url: string): 'never' | 'forbids' | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  const where = host + parsed.pathname
  if (NEVER.some((h) => host === h || host.endsWith(`.${h}`))) return 'never'
  if (
    FORBIDS_AUTOMATION.some(
      (rule) =>
        where === rule || where.startsWith(rule) || host.endsWith(`.${rule}`) || host === rule
    )
  )
    return 'forbids'
  return null
}

function show(view: PageView): string {
  return [
    `Page: ${view.title || '(no title)'}`,
    `Address: ${view.url}`,
    view.captcha
      ? 'This page shows a CAPTCHA. Do not try to solve it: stop and ask the user to complete it in the browser window, then continue.'
      : '',
    '',
    view.text,
    '',
    'Controls (use the number with browser_click, browser_type or browser_select):',
    view.controls || '(none found)'
  ]
    .filter((line, i) => line !== '' || i > 2)
    .join('\n')
}

export const browserOpen = defineTool<{ url: string }>({
  name: 'browser_open',
  description:
    'Open a web page in the browser and read it: its text and the controls you can click or fill. Use for research, checking sites, and forms.',
  params: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The full address, starting with https://' }
    },
    required: ['url']
  },
  risk: 'read',
  permissions: { browser: true },
  untrustedOutput: true,
  describe: (input) => `Open ${input.url}`,
  async run(input, ctx) {
    const rule = siteRule(input.url)
    if (rule === 'never')
      throw new PermissionError(
        "Discord isn't automated: its terms forbid it, so Titan117 never does."
      )
    if (rule === 'forbids') {
      const host = new URL(input.url).hostname
      const key = `automation:${host}`
      let yes = ctx.remembered(key)
      if (yes === null) {
        yes = await ctx.ask(
          `${host}'s terms don't allow automation. It may restrict your account. Run it anyway?`
        )
        ctx.remember(key, yes)
      }
      if (!yes) throw new PermissionError(`You chose not to automate ${host}.`)
    }
    const view = await ctx.browser.open(input.url)
    return { output: show(view), summary: `Opened ${view.url}` }
  }
})

export const browserView = defineTool<Record<string, never>>({
  name: 'browser_view',
  description: 'Read the current page again (after it changed): its text and controls.',
  params: { type: 'object', properties: {}, required: [] },
  risk: 'read',
  permissions: { browser: true },
  untrustedOutput: true,
  describe: () => 'Read the current page',
  async run(_input, ctx) {
    const view = await ctx.browser.view()
    return { output: show(view), summary: `Read ${view.url}` }
  }
})

async function finalStepCheck(
  ref: string,
  ctx: Parameters<typeof browserOpen.run>[1],
  what: string
): Promise<void> {
  const label = await ctx.browser.label(ref)
  if (FINAL_STEP.test(label)) {
    const yes = await ctx.ask(
      `${what} "${label.slice(0, 80)}"? This is a final step (it may publish, send or pay).`
    )
    if (!yes)
      throw new PermissionError(`You didn't approve "${label.slice(0, 80)}". Nothing was clicked.`)
  }
}

export const browserClick = defineTool<{ ref: string }>({
  name: 'browser_click',
  description:
    'Click a control on the current page by its number. Buttons that publish, send, post, pay or order ask the user first.',
  params: {
    type: 'object',
    properties: { ref: { type: 'string', description: 'The control number from the page view.' } },
    required: ['ref']
  },
  risk: 'read',
  permissions: { browser: true },
  untrustedOutput: true,
  describe: (input) => `Click control ${input.ref}`,
  async run(input, ctx) {
    await finalStepCheck(input.ref, ctx, 'Click')
    const view = await ctx.browser.click(input.ref)
    return { output: show(view), summary: `Clicked control ${input.ref} on ${view.url}` }
  }
})

/** Programs and scripts: never downloaded by an agent (decisions §50). */
const PROGRAM =
  /\.(exe|msi|msix|appx|bat|cmd|com|scr|ps1|psm1|vbs|vbe|js|jse|wsf|hta|jar|dll|sys|reg|lnk|app|dmg|pkg|sh|command|apk)$/i

/** A name that is safe as a file name on Windows and macOS. */
function safeFile(name: string): string {
  return (
    [...name]
      .map((c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? ' ' : c))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 120) || 'download'
  )
}

export const browserDownload = defineTool<{ ref: string; folder?: string }>({
  name: 'browser_download',
  description:
    'Click a control on the current page that downloads a file (an invoice, a report, a statement) and save the file into an allowed folder. Asks the user first. Programs and scripts are never downloaded.',
  params: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'The number of the download link or button.' },
      folder: {
        type: 'string',
        description:
          'Where to save it, inside an allowed folder. Default: the first allowed folder.'
      }
    },
    required: ['ref']
  },
  risk: 'write',
  permissions: { browser: true, folders: 'write' },
  describe: (input) =>
    `Download the file behind control ${input.ref} and save it in ${input.folder ? `"${input.folder}"` : 'the first allowed folder'}`,
  async run(input, ctx) {
    await finalStepCheck(input.ref, ctx, 'Click')
    const label = await ctx.browser.label(input.ref)
    if (PROGRAM.test(label))
      throw new PermissionError(
        "That looks like a program. Titan doesn't download programs; download it yourself if you trust it."
      )
    const file = await ctx.browser.download(input.ref)
    const name = safeFile(file.name)
    if (PROGRAM.test(name))
      throw new PermissionError(
        `"${name}" is a program or script. Titan doesn't download those; download it yourself if you trust it.`
      )
    const folder = (input.folder ?? '.').replace(/[\\/]+$/, '') || '.'
    // Never over an existing file: "invoice (2).pdf".
    const taken = new Set(
      (await ctx.files.list(folder).catch(() => [])).map((e) => e.name.toLowerCase())
    )
    let saved = name
    for (let n = 2; taken.has(saved.toLowerCase()) && n < 1000; n++)
      saved = name.replace(/(\.[^.]+)?$/, ` (${n})$1`)
    const path = `${folder}/${saved}`
    await ctx.files.writeBytes(path, file.data)
    return {
      output: `Saved "${name}" (${Math.max(1, Math.round(file.data.length / 1024))} KB) as ${path}. It was not opened.`,
      summary: `Downloaded ${name} from ${(() => {
        try {
          return new URL(file.url).hostname
        } catch {
          return 'the page'
        }
      })()} into ${path}`
    }
  }
})

export const browserType = defineTool<{ ref: string; text: string; submit?: boolean }>({
  name: 'browser_type',
  description:
    'Fill a field on the current page by its number. With submit true, press Enter afterwards (asks first, as it may send the form).',
  params: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'The field number from the page view.' },
      text: { type: 'string', description: 'What to fill in.' },
      submit: { type: 'boolean', description: 'Press Enter after filling. Default false.' }
    },
    required: ['ref', 'text']
  },
  risk: 'read',
  permissions: { browser: true },
  untrustedOutput: true,
  describe: (input) => `Fill control ${input.ref}`,
  async run(input, ctx) {
    if (input.submit) {
      const label = await ctx.browser.label(input.ref)
      // A search box is fine; anything else that submits a form asks.
      if (!/search|find|query|look ?up|\bq\b/i.test(label)) {
        const yes = await ctx.ask(
          `Fill "${label.slice(0, 60)}" and press Enter? It may send the form.`
        )
        if (!yes) throw new PermissionError("You didn't approve sending the form.")
      }
    }
    const view = await ctx.browser.type(input.ref, input.text, input.submit ?? false)
    return { output: show(view), summary: `Filled control ${input.ref} on ${view.url}` }
  }
})

export const browserSelect = defineTool<{ ref: string; value: string }>({
  name: 'browser_select',
  description: 'Choose an option in a drop-down on the current page.',
  params: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'The drop-down number from the page view.' },
      value: { type: 'string', description: 'The option to choose (its text or value).' }
    },
    required: ['ref', 'value']
  },
  risk: 'read',
  permissions: { browser: true },
  untrustedOutput: true,
  describe: (input) => `Choose "${input.value}" in control ${input.ref}`,
  async run(input, ctx) {
    const view = await ctx.browser.select(input.ref, input.value)
    return { output: show(view), summary: `Chose an option on ${view.url}` }
  }
})

export const browserBack = defineTool<Record<string, never>>({
  name: 'browser_back',
  description: 'Go back to the previous page.',
  params: { type: 'object', properties: {}, required: [] },
  risk: 'read',
  permissions: { browser: true },
  untrustedOutput: true,
  describe: () => 'Go back',
  async run(_input, ctx) {
    const view = await ctx.browser.back()
    return { output: show(view), summary: `Went back to ${view.url}` }
  }
})

export const browserTools = [
  browserOpen,
  browserView,
  browserClick,
  browserDownload,
  browserType,
  browserSelect,
  browserBack
]
