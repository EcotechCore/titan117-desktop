/**
 * Site tools for the QA tester and the SEO agent (5.2, 5.8, §14; decisions
 * §60). Reading a public site the way a search engine does runs without
 * asking (politely, as robots.txt allows); anything that costs money, writes
 * files or clicks through a live site asks. Reports are artifacts, so they
 * download as PDF, Word or Excel.
 *
 * Pages and model answers are data, never instructions (guardrails §5).
 */
import { compareAudits, DEFAULT_PAGES, MAX_PAGES, type Severity } from '../lib/sites/audit'
import { checkTest, MAX_QA_PAGES, playwrightSpec, type SavedTest } from '../lib/sites/qa'
import {
  auditReport,
  issuesSheet,
  qaReport,
  testRunReport,
  qaSheet,
  speedText,
  visibilityReport
} from '../lib/sites/report'
import { MAX_QUESTIONS, siteUrl } from '../lib/sites/service'
import { PermissionError } from '../lib/folders'
import { defineTool } from './lib/define-tool'

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

export const siteAudit = defineTool<{ url: string; max_pages?: number }>({
  name: 'site_audit',
  description: `Audit a website for SEO with our own polite crawler (free): broken links and pages, redirects and loops, titles, descriptions, headings, alt text, thin pages, canonical and noindex, language versions (hreflang), structured data, Open Graph, sitemap, robots.txt, llms.txt and local business details. Respects robots.txt. Makes a report document and an issues spreadsheet (both download as PDF, Word or Excel) and compares with the last audit of the same site. Also use it on competitors' sites with a small max_pages to see their topics and structure. Up to ${MAX_PAGES} pages.`,
  params: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Where to start, usually the home page' },
      max_pages: {
        type: 'number',
        description: `Pages to read (default ${DEFAULT_PAGES}, at most ${MAX_PAGES})`
      }
    },
    required: ['url']
  },
  risk: 'read',
  permissions: { sites: true, artifacts: 'write' },
  untrustedOutput: true,
  describe: (input) => `Audit ${input.url} (up to ${input.max_pages ?? DEFAULT_PAGES} pages)`,
  async run(input, ctx) {
    const url = siteUrl(input.url)
    const audit = await ctx.sites.audit(url, input.max_pages)
    const previous = ctx.sites.history(audit.site)[0] ?? null
    const diff = previous ? compareAudits(previous, audit) : null
    ctx.sites.remember(audit)
    const host = new URL(audit.site).hostname
    const report = ctx.artifacts.create({
      kind: 'document',
      title: `SEO audit ${host}`,
      content: auditReport(audit, diff)
    })
    const sheet = ctx.artifacts.create({
      kind: 'spreadsheet',
      title: `SEO issues ${host}`,
      content: issuesSheet(audit)
    })
    const top = [...audit.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 20)
    return {
      output: [
        `Audited ${audit.pages.length} address(es) on ${host}${audit.limited ? ' (page limit reached)' : ''}. Score ${audit.score}/100, ${audit.issues.length} issue(s).`,
        diff
          ? `Since ${new Date(diff.at).toISOString().slice(0, 10)}: score ${diff.scoreBefore} → ${audit.score}, ${diff.fixed.length} fixed, ${diff.added.length} new.`
          : 'First audit of this site.',
        `Sitemap: ${audit.sitemap ? `${audit.sitemap.urls} addresses` : 'none'}; robots.txt: ${audit.robotsTxt ? 'yes' : 'no'}; llms.txt: ${audit.llmsTxt ? 'yes' : 'no'}.`,
        `Topics: ${audit.topics.join(', ')}`,
        '',
        'Top issues:',
        ...top.map((i) => `- [${i.severity}] ${i.check}: ${i.url}: ${i.detail}`),
        '',
        `Made the report "${report.title}" (id ${report.id}) and the spreadsheet "${sheet.title}" (id ${sheet.id}); both are open beside the chat and download as PDF, Word or Excel.`
      ].join('\n'),
      summary: `Audited ${host}: score ${audit.score}, ${audit.issues.length} issues`
    }
  }
})

export const qaCheck = defineTool<{
  url: string
  pages?: string[]
  max_pages?: number
  screenshots_folder?: string
}>({
  name: 'qa_check',
  description: `Test a website or app like a QA tester, in the laptop's own browser at phone and desktop sizes: script and console errors, failed requests, sideways scrolling, accessibility (axe-core) and lab speed (LCP, CLS, blocking time). Give the pages to check, or it finds up to ${MAX_QA_PAGES} by following the site's links. Makes a QA report and a spreadsheet (download as PDF, Word or Excel). Screenshots are saved only if you name a folder.`,
  params: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The site or the first page' },
      pages: {
        type: 'array',
        description: 'Exact pages to check (addresses); otherwise found from the site'
      },
      max_pages: {
        type: 'number',
        description: `How many pages to find when none are given (default 8, at most ${MAX_QA_PAGES})`
      },
      screenshots_folder: {
        type: 'string',
        description: 'A folder inside the allowed folders for screenshots (optional)'
      }
    },
    required: ['url']
  },
  risk: 'read',
  permissions: { sites: true, artifacts: 'write', folders: 'write' },
  untrustedOutput: true,
  describe: (input) => `QA check ${input.url}`,
  assess(input) {
    return input.screenshots_folder
      ? {
          risk: 'write',
          summary: `QA check ${input.url} and save screenshots in ${input.screenshots_folder}`
        }
      : { risk: 'read', summary: `QA check ${input.url}` }
  },
  async run(input, ctx) {
    const url = siteUrl(input.url)
    let pages = (input.pages ?? []).map(String).map(siteUrl)
    if (!pages.length) {
      const found = await ctx.sites.audit(
        url,
        Math.min(MAX_QA_PAGES, Math.max(1, input.max_pages ?? 8))
      )
      pages = found.pages.filter((p) => p.html && p.status === 200).map((p) => p.url)
      if (!pages.length) pages = [url]
    }
    const folder = input.screenshots_folder
    const results = await ctx.sites.qa(pages.slice(0, MAX_QA_PAGES), { screenshots: !!folder })
    const saved: string[] = []
    if (folder)
      for (const [i, r] of results.entries())
        if (r.screenshot) {
          const name = `${folder.replace(/[\\/]+$/, '')}/${String(i + 1).padStart(2, '0')}-${r.size}-${new URL(r.url).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}.jpg`
          await ctx.files.writeBytes(name, r.screenshot)
          saved.push(name)
        }
    const host = new URL(url).hostname
    const report = ctx.artifacts.create({
      kind: 'document',
      title: `QA report ${host}`,
      content: qaReport(url, results)
    })
    const sheet = ctx.artifacts.create({
      kind: 'spreadsheet',
      title: `QA findings ${host}`,
      content: qaSheet(results)
    })
    const lines = results.map((r) => {
      const v = r.vitals
      return `- ${r.url} (${r.size}): ${r.error ? `failed: ${r.error}` : `status ${r.status}, ${r.pageErrors.length} script error(s), ${r.consoleErrors.length} console error(s), ${r.failedRequests.length} failed request(s), ${r.axe.length} accessibility problem(s)${r.overflow ? ', sideways scroll' : ''}${v ? `, LCP ${v.lcp ?? '–'} ms, CLS ${v.cls}, blocking ${v.tbt} ms` : ''}`}`
    })
    const axeKinds = [
      ...new Set(results.flatMap((r) => r.axe.map((a) => `${a.impact}: ${a.help}`)))
    ].slice(0, 12)
    return {
      output: [
        `Checked ${pages.length} page(s) at phone and desktop sizes.`,
        ...lines,
        axeKinds.length
          ? `Accessibility problems: ${axeKinds.join('; ')}`
          : 'No accessibility problems axe-core can detect.',
        saved.length ? `Saved ${saved.length} screenshot(s) in ${folder}.` : '',
        `Made the report "${report.title}" (id ${report.id}) and the spreadsheet "${sheet.title}" (id ${sheet.id}); they download as PDF, Word or Excel.`
      ]
        .filter(Boolean)
        .join('\n'),
      summary: `QA checked ${pages.length} page(s) on ${host}`
    }
  }
})

export const seoSpeed = defineTool<{ url: string; strategy?: string }>({
  name: 'seo_speed',
  description:
    "Google's PageSpeed Insights for one page (free, Google runs Lighthouse): performance, accessibility, best-practice and SEO scores, lab metrics, the biggest savings, and real visitors' Core Web Vitals from the Chrome UX Report when Google has them. The page's address goes to Google.",
  params: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The page' },
      strategy: { type: 'string', description: 'Phone or desktop', enum: ['mobile', 'desktop'] }
    },
    required: ['url']
  },
  risk: 'read',
  permissions: { sites: true },
  describe: (input) => `PageSpeed Insights for ${input.url}`,
  async run(input, ctx) {
    const result = await ctx.sites.speed(
      siteUrl(input.url),
      input.strategy === 'desktop' ? 'desktop' : 'mobile'
    )
    return {
      output: speedText(result),
      summary: `PageSpeed for ${result.url}: ${Object.values(result.scores).join('/')}`
    }
  }
})

export const seoAiVisibility = defineTool<{
  brand: string
  domain: string
  questions: string[]
  models?: string[]
}>({
  name: 'seo_ai_visibility',
  description: `Check whether AI assistants mention a company (14.12): asks up to ${MAX_QUESTIONS} questions a customer would ask to models from OpenAI, Perplexity and Google, each with its own web search, through OpenRouter's API (never the chat websites), and reports whether the company is mentioned or its site cited, and which sites are cited instead. Costs credits (about a cent per answer). Makes a report.`,
  params: {
    type: 'object',
    properties: {
      brand: { type: 'string', description: 'The company or product name' },
      domain: { type: 'string', description: 'Its website, e.g. example.com' },
      questions: {
        type: 'array',
        description: `Questions customers ask, e.g. "best bakery in Cluj" (at most ${MAX_QUESTIONS})`
      },
      models: {
        type: 'array',
        description: 'Other OpenRouter model ids to ask instead (at most 3)'
      }
    },
    required: ['brand', 'domain', 'questions']
  },
  risk: 'write',
  permissions: { sites: true, artifacts: 'write' },
  untrustedOutput: true,
  describe: (input) => `Ask AI assistants about ${input.brand}`,
  assess(input) {
    const questions = (Array.isArray(input.questions) ? input.questions : [])
      .map(String)
      .slice(0, MAX_QUESTIONS)
    const models = Array.isArray(input.models) && input.models.length ? input.models.length : 3
    return {
      risk: 'write',
      summary: `Ask ${Math.min(3, models)} AI model(s) ${questions.length} question(s) about ${String(input.brand).slice(0, 60)}, with web search: ${questions.map((q) => `"${q.slice(0, 80)}"`).join(', ')}. About ${Math.min(3, models) * questions.length} answers in credits; the questions leave this laptop.`,
      outgoing: questions.join('\n')
    }
  },
  async run(input, ctx) {
    const questions = (input.questions ?? []).map(String).filter((q) => q.trim())
    if (!questions.length)
      throw new PermissionError('Give at least one question a customer would ask.')
    const answers = await ctx.sites.visibility({
      brand: String(input.brand),
      domain: String(input.domain),
      questions,
      models: (input.models ?? []).map(String)
    })
    const costUsd = answers.reduce((s, a) => s + a.costUsd, 0)
    const report = ctx.artifacts.create({
      kind: 'document',
      title: `AI visibility ${input.brand}`,
      content: visibilityReport(input.brand, input.domain, answers)
    })
    const ok = answers.filter((a) => !a.error)
    return {
      output: [
        `${ok.filter((a) => a.mentioned).length} of ${ok.length} answer(s) mention ${input.brand}; ${ok.filter((a) => a.cited).length} cite ${input.domain}.`,
        ...answers.map(
          (a) =>
            `- ${a.model} on "${a.question}": ${a.error ? `error: ${a.error}` : `${a.mentioned ? 'mentioned' : 'not mentioned'}${a.cited ? ', cited' : ''}; sources: ${a.sources.join(', ') || 'none'}`}`
        ),
        `Made the report "${report.title}" (id ${report.id}). Cost $${costUsd.toFixed(3)}.`
      ].join('\n'),
      summary: `AI visibility for ${input.brand}: ${ok.filter((a) => a.mentioned).length}/${ok.length} mention it`,
      costUsd
    }
  }
})

export const qaSaveTest = defineTool<{
  folder: string
  name: string
  url: string
  steps: unknown[]
}>({
  name: 'qa_save_test',
  description:
    'Save a browser test that then runs without AI (5.2): steps like a person does them. Steps: {"action":"goto","url"}, {"action":"click","text","role"?: button|link|tab|checkbox|menuitem}, {"action":"fill","label","value"}, {"action":"press","key"}, {"action":"expect_text","text"}, {"action":"expect_url","contains"}, {"action":"expect_title","contains"}. Writes <name>.test.json (run with qa_run_tests) and a Playwright <name>.spec.ts for developers. Also use it to fix a broken test, with the user\'s OK.',
  params: {
    type: 'object',
    properties: {
      folder: { type: 'string', description: 'A folder inside the allowed folders, e.g. qa-tests' },
      name: { type: 'string', description: 'Small letters and dashes, e.g. contact-form' },
      url: { type: 'string', description: 'Where the test starts' },
      steps: { type: 'array', description: 'The steps, in order' }
    },
    required: ['folder', 'name', 'url', 'steps']
  },
  risk: 'write',
  permissions: { sites: true, folders: 'write' },
  describe: (input) => `Save the test "${input.name}" in ${input.folder}`,
  async run(input, ctx) {
    const test = checkTest({ name: input.name, url: input.url, steps: input.steps })
    const base = `${input.folder.replace(/[\\/]+$/, '')}/${test.name}`
    await ctx.files.write(`${base}.test.json`, `${JSON.stringify(test, null, 2)}\n`)
    await ctx.files.write(`${base}.spec.ts`, playwrightSpec(test))
    return {
      output: `Saved ${base}.test.json (${test.steps.length} steps; run it with qa_run_tests) and ${base}.spec.ts (Playwright, for developers).`,
      summary: `Saved the test ${test.name}`
    }
  }
})

export const qaRunTests = defineTool<{ folder: string; names?: string[] }>({
  name: 'qa_run_tests',
  description:
    "Run saved browser tests (*.test.json in a folder) without AI, in the laptop's browser, and make a report. They click and type on the live site, so this asks first.",
  params: {
    type: 'object',
    properties: {
      folder: { type: 'string', description: 'The folder with the tests' },
      names: { type: 'array', description: 'Only these tests (by name); all of them otherwise' }
    },
    required: ['folder']
  },
  risk: 'write',
  permissions: { sites: true, folders: 'read', artifacts: 'write' },
  untrustedOutput: true,
  describe: (input) =>
    `Run the saved tests in ${input.folder}${input.names?.length ? ` (${input.names.join(', ')})` : ''}`,
  async run(input, ctx) {
    const folder = input.folder.replace(/[\\/]+$/, '')
    const wanted = new Set((input.names ?? []).map(String))
    const entries = (await ctx.files.list(folder)).filter(
      (e) =>
        e.kind === 'file' &&
        e.name.endsWith('.test.json') &&
        (!wanted.size || wanted.has(e.name.slice(0, -10)))
    )
    if (!entries.length) throw new PermissionError(`No saved tests (*.test.json) in ${folder}.`)
    const tests: SavedTest[] = []
    for (const e of entries.slice(0, 30)) {
      const { text } = await ctx.files.read(`${folder}/${e.name}`, 200_000)
      try {
        tests.push(checkTest(JSON.parse(text)))
      } catch (error) {
        throw new PermissionError(
          `${e.name} isn't a test this app can run: ${(error as Error).message}`
        )
      }
    }
    const runs = await ctx.sites.runTests(tests)
    const report = ctx.artifacts.create({
      kind: 'document',
      title: `Test run ${folder}`,
      content: testRunReport(folder, runs)
    })
    const passed = runs.filter((r) => r.passed).length
    return {
      output: [
        `${passed} of ${runs.length} test(s) passed.`,
        ...runs.map(
          (r) =>
            `- ${r.name}: ${r.passed ? 'passed' : `failed at step ${r.failedStep}: ${r.error}`} (${(r.ms / 1000).toFixed(1)} s)`
        ),
        `Report "${report.title}" (id ${report.id}).`,
        passed < runs.length
          ? 'If the site changed on purpose, propose a fixed test and save it with qa_save_test once the user agrees.'
          : ''
      ]
        .filter(Boolean)
        .join('\n'),
      summary: `Ran ${runs.length} test(s): ${passed} passed`
    }
  }
})

export const siteTools = [siteAudit, qaCheck, seoSpeed, seoAiVisibility, qaSaveTest, qaRunTests]
