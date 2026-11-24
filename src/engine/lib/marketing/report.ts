/**
 * Campaign reports (feature 15.11; decisions §62): what was planned and
 * posted, on which platform and for which campaign, and what it brought, as
 * a document and a spreadsheet artifact (PDF, Word or Excel like any other).
 *
 * V1 reads no platform's numbers (no platform API, decisions §24): views,
 * likes, comments, shares and clicks are what the user typed in from the
 * platform's own screen. Clicks on the company's site show up in its own
 * analytics under the post's tracked link (`utm_campaign`), which we add.
 */
import { PLATFORM_INFO, RESULT_KEYS, dueAt, trackedLink, type Post } from './posts'

/** Keep a post's words out of the table syntax. */
function cell(text: string | number): string {
  return String(text).replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
}

function sum(posts: Post[], key: (typeof RESULT_KEYS)[number]): number {
  return posts.reduce((total, p) => total + (p.results[key] ?? 0), 0)
}

function hasResults(post: Post): boolean {
  return RESULT_KEYS.some((k) => post.results[k] !== undefined)
}

function countLine(posts: Post[]): string {
  const n = (status: Post['status']): number => posts.filter((p) => p.status === status).length
  return `${posts.length} planned: ${n('posted')} posted, ${n('ready')} ready, ${n('draft')} drafts, ${n('skipped')} skipped`
}

function resultCells(posts: Post[]): string {
  return RESULT_KEYS.map((k) =>
    posts.some((p) => p.results[k] !== undefined) ? sum(posts, k) : '–'
  ).join(' | ')
}

function groups(posts: Post[], key: (post: Post) => string): [string, Post[]][] {
  const map = new Map<string, Post[]>()
  for (const post of posts) map.set(key(post), [...(map.get(key(post)) ?? []), post])
  return [...map].sort((a, b) => b[1].length - a[1].length)
}

/** The report as a Markdown document. `period` is how the user named it ("December 2026"). */
export function campaignReport(posts: Post[], period: string, now = Date.now()): string {
  const posted = posts.filter((p) => p.status === 'posted')
  const late = posts.filter((p) => p.status === 'ready' && dueAt(p) < now)
  const measured = posted.filter(hasResults)
  const header = `| ${RESULT_KEYS.map((k) => k[0].toUpperCase() + k.slice(1)).join(' | ')} |`
  const rule = `|${RESULT_KEYS.map(() => '---:').join('|')}|`
  const lines = [
    `# Campaign report: ${period}`,
    '',
    `Made by Titan117's Marketing agent from the content calendar. ${countLine(posts)}.`,
    ''
  ]
  if (late.length)
    lines.push(
      `**${late.length} post(s) were due and are not marked as posted.** Post them, or mark them posted or skipped on the Marketing screen.`,
      ''
    )
  lines.push(
    '## By platform',
    '',
    `| Platform | Planned | Posted ${header}`,
    `|---|---:|---:${rule}`
  )
  for (const [platform, group] of groups(posts, (p) => PLATFORM_INFO[p.platform].label))
    lines.push(
      `| ${platform} | ${group.length} | ${group.filter((p) => p.status === 'posted').length} | ${resultCells(group)} |`
    )
  const campaigns = groups(posts, (p) => p.campaign || '(no campaign)')
  if (campaigns.length > 1 || campaigns[0]?.[0] !== '(no campaign)') {
    lines.push(
      '',
      '## By campaign',
      '',
      `| Campaign | Planned | Posted ${header}`,
      `|---|---:|---:${rule}`
    )
    for (const [campaign, group] of campaigns)
      lines.push(
        `| ${cell(campaign)} | ${group.length} | ${group.filter((p) => p.status === 'posted').length} | ${resultCells(group)} |`
      )
  }
  lines.push('', '## What it brought', '')
  if (!measured.length)
    lines.push(
      posted.length
        ? 'No results are typed in yet. On the Marketing screen, open a posted post and enter what the platform shows (views, likes, comments, shares, clicks).'
        : 'Nothing is marked as posted in this period yet.'
    )
  else {
    lines.push(
      `Results are typed in for ${measured.length} of ${posted.length} posted post(s), from each platform's own numbers.`,
      '',
      `| Post | Platform | Day ${header}`,
      `|---|---|---${rule}`
    )
    const score = (p: Post): number =>
      (p.results.clicks ?? 0) * 5 +
      (p.results.comments ?? 0) * 3 +
      (p.results.shares ?? 0) * 3 +
      (p.results.likes ?? 0)
    for (const post of [...measured].sort((a, b) => score(b) - score(a)).slice(0, 10))
      lines.push(
        `| ${cell(post.text).slice(0, 70)} | ${PLATFORM_INFO[post.platform].label} | ${post.date} | ${RESULT_KEYS.map((k) => post.results[k] ?? '–').join(' | ')} |`
      )
  }
  const linked = posts.filter((p) => p.link)
  if (linked.length)
    lines.push(
      '',
      '## Visits to your site',
      '',
      `${linked.length} post(s) carry a link. Each opens with a tracked address (\`utm_source\` is the platform, \`utm_campaign\` the campaign), so your site's own analytics show which post and campaign brought each visit, sign-up or order. Titan117 reads no platform's numbers itself.`
    )
  return lines.join('\n') + '\n'
}

/** Every post as a row, for a spreadsheet artifact. */
export function campaignSheet(posts: Post[]): string {
  return JSON.stringify({
    columns: [
      'Date',
      'Time',
      'Platform',
      'Campaign',
      'Status',
      'Text',
      'Link',
      ...RESULT_KEYS.map((k) => k[0].toUpperCase() + k.slice(1))
    ],
    rows: posts.map((post) => [
      post.date,
      post.time,
      PLATFORM_INFO[post.platform].label,
      post.campaign,
      post.status,
      post.text,
      trackedLink(post),
      ...RESULT_KEYS.map((k) => post.results[k] ?? '')
    ])
  })
}
