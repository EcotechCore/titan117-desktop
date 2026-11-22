/**
 * Reports the QA tester and the SEO agent hand over (5.2, 5.8): Markdown
 * documents and spreadsheets made as artifacts, so they open beside the chat
 * and download as PDF, Word or Excel like any artifact (17.24).
 */
import type { Issue, Severity, SiteAudit } from './audit'
import { GOOD, type QaPage, type TestRun } from './qa'
import type { SpeedResult, VisibilityAnswer } from './service'

const ORDER: Severity[] = ['high', 'medium', 'low']
const LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' }

/** Keep page text out of the table syntax. */
function cell(text: string | number): string {
  return String(text).replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
}

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 16).replace('T', ' ')
}

export function auditReport(
  audit: SiteAudit,
  diff: { fixed: Issue[]; added: Issue[]; scoreBefore: number; at: number } | null
): string {
  const host = new URL(audit.site).hostname
  const count = (s: Severity): number => audit.issues.filter((i) => i.severity === s).length
  const lines = [
    `# SEO audit: ${host}`,
    '',
    `Checked ${day(audit.at)} (UTC) by Titan117's SEO agent. ${audit.pages.length} address(es) read from ${audit.start}${audit.limited ? ' (stopped at the page limit; more pages exist)' : ''}.`,
    '',
    `**Score: ${audit.score} / 100.** ${count('high')} high, ${count('medium')} medium and ${count('low')} low issue(s).`,
    ''
  ]
  if (diff) {
    lines.push(
      `## Since the last audit (${day(diff.at)})`,
      '',
      `Score ${diff.scoreBefore} → ${audit.score}. Fixed: ${diff.fixed.length}. New: ${diff.added.length}.`,
      ''
    )
    for (const i of diff.added.slice(0, 15)) lines.push(`- New: **${i.check}** on ${i.url}`)
    for (const i of diff.fixed.slice(0, 15)) lines.push(`- Fixed: ${i.check} on ${i.url}`)
    lines.push('')
  }
  lines.push(
    '## The site',
    '',
    `- robots.txt: ${audit.robotsTxt ? 'yes' : 'no'}`,
    `- Sitemap: ${audit.sitemap ? `${audit.sitemap.url} (${audit.sitemap.urls} addresses)` : 'none found'}`,
    `- llms.txt (for AI assistants): ${audit.llmsTxt ? 'yes' : 'no'}`,
    `- What the pages are about: ${audit.topics.join(', ') || '(no headings found)'}`,
    ''
  )
  for (const severity of ORDER) {
    const group = audit.issues.filter((i) => i.severity === severity)
    if (!group.length) continue
    lines.push(`## ${LABEL[severity]} priority`, '')
    const byCheck = new Map<string, Issue[]>()
    for (const i of group) byCheck.set(i.check, [...(byCheck.get(i.check) ?? []), i])
    lines.push('| Check | Pages | Example | Detail |', '|---|---|---|---|')
    for (const [check, items] of byCheck)
      lines.push(
        `| ${cell(check)} | ${items.length} | ${cell(items[0].url)} | ${cell(items[0].detail)} |`
      )
    lines.push('')
  }
  lines.push('## Pages', '', '| Address | Status | Title | Words | ms |', '|---|---|---|---|---|')
  for (const p of audit.pages.slice(0, 60))
    lines.push(
      `| ${cell(p.url)} | ${p.redirectedTo ? `${p.status} → ${cell(p.redirectedTo)}` : p.status || 'failed'} | ${cell(p.title.slice(0, 60))} | ${p.words} | ${p.ms} |`
    )
  if (audit.pages.length > 60)
    lines.push('', `…and ${audit.pages.length - 60} more in the spreadsheet.`)
  if (audit.skipped.length) {
    lines.push('', '## Not read', '')
    for (const s of audit.skipped.slice(0, 20)) lines.push(`- ${s.url}: ${s.why}`)
  }
  lines.push(
    '',
    '---',
    '',
    'Free checks only: our own crawler, read politely and as robots.txt allows. Rankings and search data come from Google Search Console once it is connected.'
  )
  return lines.join('\n')
}

export function issuesSheet(audit: SiteAudit): string {
  return JSON.stringify({
    columns: ['Priority', 'Check', 'Address', 'Detail'],
    rows: ORDER.flatMap((s) =>
      audit.issues.filter((i) => i.severity === s).map((i) => [LABEL[s], i.check, i.url, i.detail])
    )
  })
}

function grade(value: number | null, good: number): string {
  if (value === null) return '–'
  return value <= good
    ? `${value} ✓`
    : value <= good * 1.6
      ? `${value} (needs work)`
      : `${value} (poor)`
}

/** A run of saved tests on its own (5.2): which passed, and where the others stopped. */
export function testRunReport(folder: string, tests: TestRun[]): string {
  const passed = tests.filter((t) => t.passed).length
  const lines = [
    `# Test run: ${folder}`,
    '',
    `Run ${day(Date.now())} (UTC) by Titan117's QA tester in the laptop's own browser, without AI.`,
    '',
    `**${passed} of ${tests.length} test(s) passed.**`,
    '',
    '| Test | Result | Time | Why |',
    '|---|---|---|---|'
  ]
  for (const t of tests)
    lines.push(
      `| ${cell(t.name)} | ${t.passed ? 'passed' : `failed at step ${t.failedStep}`} | ${(t.ms / 1000).toFixed(1)} s | ${cell(t.error ?? '')} |`
    )
  if (passed < tests.length)
    lines.push(
      '',
      'A test that fails because the site changed on purpose is fixed only with your OK.'
    )
  return lines.join('\n')
}

export function qaReport(site: string, pages: QaPage[], tests: TestRun[] = []): string {
  const host = (() => {
    try {
      return new URL(site).hostname
    } catch {
      return site
    }
  })()
  const problems = pages.filter(
    (p) =>
      p.error ||
      p.pageErrors.length ||
      p.consoleErrors.length ||
      p.failedRequests.length ||
      p.overflow ||
      (p.status ?? 0) >= 400
  )
  const axeAll = new Map<
    string,
    {
      help: string
      impact: string
      helpUrl: string
      pages: Set<string>
      nodes: number
      example: string
    }
  >()
  for (const p of pages)
    for (const a of p.axe) {
      const hit = axeAll.get(a.id) ?? {
        help: a.help,
        impact: a.impact,
        helpUrl: a.helpUrl,
        pages: new Set(),
        nodes: 0,
        example: a.example
      }
      hit.pages.add(p.url)
      hit.nodes += a.nodes
      axeAll.set(a.id, hit)
    }
  const impactRank: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 }
  const lines = [
    `# QA report: ${host}`,
    '',
    `Checked ${day(Date.now())} (UTC) by Titan117's QA tester in the laptop's own browser, at phone (390×844) and desktop (1440×900) sizes. ${new Set(pages.map((p) => p.url)).size} page(s).`,
    '',
    `**${problems.length} page view(s) with errors, ${axeAll.size} kind(s) of accessibility problem${tests.length ? `, ${tests.filter((t) => t.passed).length} of ${tests.length} test(s) passed` : ''}.**`,
    ''
  ]
  if (tests.length) {
    lines.push(
      '## Saved tests (run without AI)',
      '',
      '| Test | Result | Time | Why |',
      '|---|---|---|---|'
    )
    for (const t of tests)
      lines.push(
        `| ${cell(t.name)} | ${t.passed ? 'passed' : `failed at step ${t.failedStep}`} | ${(t.ms / 1000).toFixed(1)} s | ${cell(t.error ?? '')} |`
      )
    lines.push('')
  }
  lines.push('## Errors', '')
  if (!problems.length)
    lines.push('No page errors, console errors, failed requests or sideways scrolling.', '')
  for (const p of problems) {
    lines.push(`### ${p.url} (${p.size})`, '')
    if (p.error) lines.push(`- Did not finish loading: ${p.error}`)
    if ((p.status ?? 0) >= 400) lines.push(`- The page answered ${p.status}.`)
    for (const e of p.pageErrors.slice(0, 5)) lines.push(`- Script error: \`${cell(e)}\``)
    for (const e of p.consoleErrors.slice(0, 5)) lines.push(`- Console: \`${cell(e)}\``)
    for (const e of p.failedRequests.slice(0, 8)) lines.push(`- Failed request: ${cell(e)}`)
    if (p.overflow) lines.push('- The page is wider than the screen (sideways scroll).')
    lines.push('')
  }
  lines.push('## Accessibility (axe-core)', '')
  if (!axeAll.size)
    lines.push(
      'No problems axe-core can detect automatically. A person should still try the site with a keyboard and a screen reader.',
      ''
    )
  else {
    lines.push(
      '| Impact | Problem | Pages | Elements | Example | How to fix |',
      '|---|---|---|---|---|---|'
    )
    for (const [, a] of [...axeAll.entries()].sort(
      (x, y) => (impactRank[x[1].impact] ?? 9) - (impactRank[y[1].impact] ?? 9)
    ))
      lines.push(
        `| ${a.impact} | ${cell(a.help)} | ${a.pages.size} | ${a.nodes} | \`${cell(a.example)}\` | ${a.helpUrl} |`
      )
    lines.push('')
  }
  lines.push(
    '## Speed (lab, measured in the page)',
    '',
    `Good is LCP under ${GOOD.lcp} ms, CLS under ${GOOD.cls}, blocking time under ${GOOD.tbt} ms.`,
    '',
    '| Page | Size | LCP ms | CLS | Blocking ms | Load ms | Requests | KB |',
    '|---|---|---|---|---|---|---|---|'
  )
  for (const p of pages)
    if (p.vitals)
      lines.push(
        `| ${cell(p.url)} | ${p.size} | ${grade(p.vitals.lcp, GOOD.lcp)} | ${p.vitals.cls <= GOOD.cls ? `${p.vitals.cls} ✓` : `${p.vitals.cls} (poor)`} | ${grade(p.vitals.tbt, GOOD.tbt)} | ${p.vitals.loadMs} | ${p.vitals.requests} | ${p.vitals.transferKb} |`
      )
  lines.push(
    '',
    '---',
    '',
    'Lab numbers vary with the laptop and the network; real visitors’ numbers come from Google’s PageSpeed Insights (seo_speed).'
  )
  return lines.join('\n')
}

export function qaSheet(pages: QaPage[]): string {
  const rows: (string | number | null)[][] = []
  for (const p of pages) {
    for (const a of p.axe) rows.push([p.url, p.size, 'Accessibility', a.impact, a.help, a.nodes])
    for (const e of p.pageErrors) rows.push([p.url, p.size, 'Script error', 'serious', e, 1])
    for (const e of p.consoleErrors) rows.push([p.url, p.size, 'Console error', 'moderate', e, 1])
    for (const e of p.failedRequests) rows.push([p.url, p.size, 'Failed request', 'moderate', e, 1])
    if (p.overflow) rows.push([p.url, p.size, 'Layout', 'moderate', 'Wider than the screen', 1])
    if (p.error) rows.push([p.url, p.size, 'Load', 'serious', p.error, 1])
  }
  return JSON.stringify({ columns: ['Address', 'Size', 'Kind', 'Impact', 'Detail', 'Count'], rows })
}

export function speedText(r: SpeedResult): string {
  const lines = [`PageSpeed Insights (${r.strategy}) for ${r.url}`, '']
  lines.push(
    `Scores: ${
      Object.entries(r.scores)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || 'none returned'
    }`
  )
  if (Object.keys(r.lab).length)
    lines.push(
      `Lab: ${Object.entries(r.lab)
        .map(([k, v]) => `${k} ${v}`)
        .join('; ')}`
    )
  if (r.field.length)
    lines.push(
      `Real visitors (Chrome UX Report, 28 days): ${r.fieldOverall ?? ''}; ${r.field.map((f) => `${f.metric} p75 ${f.p75} (${f.category})`).join('; ')}`
    )
  else lines.push('Real visitors: Google has too little data for this page.')
  if (r.opportunities.length) {
    lines.push('Biggest savings:')
    for (const o of r.opportunities) lines.push(`- ${o.title}: ${o.saving}`)
  }
  return lines.join('\n')
}

export function visibilityReport(
  brand: string,
  domain: string,
  answers: VisibilityAnswer[]
): string {
  const ok = answers.filter((a) => !a.error)
  const mentioned = ok.filter((a) => a.mentioned).length
  const others = new Map<string, number>()
  for (const a of ok) for (const s of a.sources) others.set(s, (others.get(s) ?? 0) + 1)
  const lines = [
    `# AI search visibility: ${brand}`,
    '',
    `Checked ${day(Date.now())} (UTC) through the models' own web search on OpenRouter (never the chat websites). ${ok.length} answer(s).`,
    '',
    `**Mentioned in ${mentioned} of ${ok.length}; ${domain} cited in ${ok.filter((a) => a.cited).length}.**`,
    '',
    '| Question | Model | Mentioned | Cited | What it said |',
    '|---|---|---|---|---|'
  ]
  for (const a of answers)
    lines.push(
      `| ${cell(a.question)} | ${cell(a.model)} | ${a.error ? 'error' : a.mentioned ? 'yes' : 'no'} | ${a.cited ? 'yes' : 'no'} | ${cell(a.error ?? a.excerpt.slice(0, 220))} |`
    )
  if (others.size) {
    lines.push('', '## Sites the models cited instead', '')
    for (const [host, n] of [...others.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12))
      lines.push(`- ${host} (${n})`)
  }
  lines.push(
    '',
    '---',
    '',
    'Answers change from day to day; re-check monthly. An /llms.txt file, clear About and FAQ pages, and being cited by the sites above help.'
  )
  return lines.join('\n')
}
