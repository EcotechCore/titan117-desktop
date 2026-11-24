/**
 * Ad drafts (feature 15.13; decisions §28, §62): Google search ads and Meta
 * feed ads written and checked against each platform's limits, handed over
 * as a document to read and files to import. The user launches them and sets
 * the budget in the platform's own tools; nothing here touches an ad
 * account, so no developer token or app review is needed.
 *
 * Google: a file for Google Ads Editor's own import (Account > Import), with
 * every campaign, ad and keyword **paused**. Column names and limits are from
 * Google's help pages, read on 24 Nov 2026 (`external-services.md`).
 * Meta: Meta's bulk import columns could not be read on Meta's own pages, so
 * Meta ads come as a plain sheet to copy into Ads Manager.
 */
import { MarketingError } from './brand'

/** Google's responsive search ads (support.google.com/google-ads/answer/7684791). */
export const GOOGLE = {
  minHeadlines: 3,
  maxHeadlines: 15,
  headlineChars: 30,
  minDescriptions: 2,
  maxDescriptions: 4,
  descriptionChars: 90,
  pathChars: 15,
  maxKeywords: 50
} as const

/** Meta's feed picture ads: what its ads guide recommends, not hard limits. */
export const META = { primaryText: 150, headline: 27 } as const

export const MATCH_TYPES = ['broad', 'phrase', 'exact'] as const
export type MatchType = (typeof MATCH_TYPES)[number]
export const META_BUTTONS = [
  'Learn more',
  'Shop now',
  'Sign up',
  'Book now',
  'Contact us',
  'Get offer',
  'Order now',
  'Subscribe',
  'Get quote',
  'Download'
] as const

export interface GoogleAd {
  campaign: string
  adGroup: string
  finalUrl: string
  headlines: string[]
  descriptions: string[]
  paths: string[]
  keywords: { text: string; match: MatchType }[]
}

export interface MetaAd {
  name: string
  primaryText: string
  headline: string
  description: string
  button: string
  link: string
  /** A picture inside the allowed folders, or empty. */
  image: string
  audience: string
}

export interface AdDrafts {
  title: string
  google: GoogleAd[]
  meta: MetaAd[]
  /** Advice for the user: budget and who to show the ads to. They decide. */
  notes: string
}

function line(value: unknown, max: number): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, max)
    : ''
}

function webLink(value: unknown, what: string): string {
  const text = line(value, 500)
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('not web')
    return url.toString()
  } catch {
    throw new MarketingError(
      `${what}: give the page the ad opens, like https://your-site.com/offer.`
    )
  }
}

/** Google counts double-width characters (Chinese, Japanese, Korean) as 2. */
export function googleChars(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    n +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xff60)
        ? 2
        : 1
  }
  return n
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Check drafts an agent wrote; returns them cleaned, or throws saying exactly what is too long or missing. */
export function checkAds(input: unknown): AdDrafts {
  const value = (input ?? {}) as Record<string, unknown>
  const google = list(value.google).map((raw, i): GoogleAd => {
    const g = (raw ?? {}) as Record<string, unknown>
    const where = `Google ad ${i + 1}`
    const campaign = line(g.campaign, 120)
    const adGroup = line(g.ad_group ?? g.adGroup, 120)
    if (!campaign || !adGroup) throw new MarketingError(`${where}: name its campaign and ad group.`)
    const texts = (items: unknown, max: number, what: string): string[] => {
      const out = [
        ...new Set(
          list(items)
            .map((t) => line(t, 300))
            .filter(Boolean)
        )
      ]
      for (const t of out)
        if (googleChars(t) > max)
          throw new MarketingError(
            `${where}: the ${what} "${t}" is ${googleChars(t)} characters; Google takes ${max}.`
          )
      return out
    }
    const headlines = texts(g.headlines, GOOGLE.headlineChars, 'headline')
    const descriptions = texts(g.descriptions, GOOGLE.descriptionChars, 'description')
    if (headlines.length < GOOGLE.minHeadlines || headlines.length > GOOGLE.maxHeadlines)
      throw new MarketingError(
        `${where}: give ${GOOGLE.minHeadlines} to ${GOOGLE.maxHeadlines} different headlines (it has ${headlines.length}).`
      )
    if (
      descriptions.length < GOOGLE.minDescriptions ||
      descriptions.length > GOOGLE.maxDescriptions
    )
      throw new MarketingError(
        `${where}: give ${GOOGLE.minDescriptions} to ${GOOGLE.maxDescriptions} different descriptions (it has ${descriptions.length}).`
      )
    const paths = texts(g.paths, GOOGLE.pathChars, 'path')
      .map((p) => p.replace(/[\s/]+/g, '-'))
      .slice(0, 2)
    const keywords = list(g.keywords)
      .map((raw) => {
        const k = (typeof raw === 'string' ? { text: raw } : (raw ?? {})) as Record<string, unknown>
        // The words only: match-type marks and anything a spreadsheet could run are dropped.
        const text = line(k.text, 80)
          .replace(/["[\]+=@]/g, '')
          .trim()
        const match = MATCH_TYPES.includes(k.match as MatchType) ? (k.match as MatchType) : 'phrase'
        return { text, match }
      })
      .filter((k) => k.text)
      .slice(0, GOOGLE.maxKeywords)
    if (!keywords.length)
      throw new MarketingError(`${where}: give the keywords it should show for.`)
    return {
      campaign,
      adGroup,
      finalUrl: webLink(g.final_url ?? g.finalUrl, where),
      headlines,
      descriptions,
      paths,
      keywords
    }
  })
  const meta = list(value.meta).map((raw, i): MetaAd => {
    const m = (raw ?? {}) as Record<string, unknown>
    const where = `Meta ad ${i + 1}`
    const primaryText = line(m.primary_text ?? m.primaryText, 2000)
    const headline = line(m.headline, 255)
    if (!primaryText || !headline)
      throw new MarketingError(`${where}: it needs its text and a headline.`)
    const button = META_BUTTONS.find((b) => b.toLowerCase() === line(m.button, 40).toLowerCase())
    const image = line(m.image, 500)
    if (image && !/\.(png|jpe?g)$/i.test(image))
      throw new MarketingError(`${where}: the picture is a PNG or JPEG in the allowed folders.`)
    return {
      name: line(m.name, 120) || `Ad ${i + 1}`,
      primaryText,
      headline,
      description: line(m.description, 255),
      button: button ?? 'Learn more',
      link: webLink(m.link, where),
      image,
      audience: line(m.audience, 400)
    }
  })
  if (!google.length && !meta.length)
    throw new MarketingError('Give at least one Google or Meta ad.')
  if (google.length > 30 || meta.length > 30)
    throw new MarketingError('Draft at most 30 ads per platform at a time.')
  return {
    title: line(value.title, 80) || 'Ad drafts',
    google,
    meta,
    notes: line(value.notes, 1500)
  }
}

/** What reads longer than Meta recommends: shown to the user, never a refusal. */
export function metaWarnings(ad: MetaAd): string[] {
  const out: string[] = []
  if ([...ad.primaryText].length > META.primaryText)
    out.push(
      `the text is ${[...ad.primaryText].length} characters; Meta recommends up to ${META.primaryText}, and cuts the rest behind "See more"`
    )
  if ([...ad.headline].length > META.headline)
    out.push(
      `the headline is ${[...ad.headline].length} characters; Meta recommends ${META.headline}`
    )
  if (!ad.image) out.push('it has no picture yet')
  return out
}

function tsvCell(value: string): string {
  // One line, no tabs, and nothing a spreadsheet would run as a formula.
  const clean = value.replace(/[\t\r\n]+/g, ' ')
  return /^[=+\-@]/.test(clean) ? `'${clean}` : clean
}

const MATCH_LABEL: Record<MatchType, string> = { broad: 'Broad', phrase: 'Phrase', exact: 'Exact' }

/**
 * The file for Google Ads Editor's import (tab-separated text, which Editor
 * reads; it doesn't read Excel files). One row per campaign, ad and keyword,
 * all **Paused**: nothing can spend until the user enables it and sets a budget.
 */
export function googleEditorFile(ads: GoogleAd[]): string {
  const headlines = Array.from({ length: GOOGLE.maxHeadlines }, (_, i) => `Headline ${i + 1}`)
  const descriptions = Array.from(
    { length: GOOGLE.maxDescriptions },
    (_, i) => `Description ${i + 1}`
  )
  const columns = [
    'Campaign',
    'Campaign status',
    'Ad group',
    'Ad group status',
    'Status',
    'Ad type',
    ...headlines,
    ...descriptions,
    'Path 1',
    'Path 2',
    'Final URL',
    'Keyword',
    'Type'
  ]
  const rows: Record<string, string>[] = []
  const seenCampaigns = new Set<string>()
  const seenGroups = new Set<string>()
  for (const ad of ads) {
    if (!seenCampaigns.has(ad.campaign)) {
      seenCampaigns.add(ad.campaign)
      rows.push({ Campaign: ad.campaign, 'Campaign status': 'Paused' })
    }
    const group = `${ad.campaign}\u0000${ad.adGroup}`
    if (!seenGroups.has(group)) {
      seenGroups.add(group)
      rows.push({ Campaign: ad.campaign, 'Ad group': ad.adGroup, 'Ad group status': 'Paused' })
    }
    rows.push({
      Campaign: ad.campaign,
      'Ad group': ad.adGroup,
      Status: 'Paused',
      'Ad type': 'Responsive search ad',
      ...Object.fromEntries(ad.headlines.map((h, i) => [`Headline ${i + 1}`, h])),
      ...Object.fromEntries(ad.descriptions.map((d, i) => [`Description ${i + 1}`, d])),
      'Path 1': ad.paths[0] ?? '',
      'Path 2': ad.paths[1] ?? '',
      'Final URL': ad.finalUrl
    })
    for (const keyword of ad.keywords)
      rows.push({
        Campaign: ad.campaign,
        'Ad group': ad.adGroup,
        Status: 'Paused',
        Keyword: keyword.text,
        Type: MATCH_LABEL[keyword.match]
      })
  }
  return (
    [columns, ...rows.map((row) => columns.map((c) => tsvCell(row[c] ?? '')))]
      .map((r) => r.join('\t'))
      .join('\r\n') + '\r\n'
  )
}

/** Meta's ads as a spreadsheet artifact, one row per ad, to copy into Ads Manager. */
export function metaSheet(ads: MetaAd[]): string {
  return JSON.stringify({
    columns: [
      'Ad name',
      'Primary text',
      'Headline',
      'Description',
      'Button',
      'Link',
      'Picture',
      'Audience'
    ],
    rows: ads.map((a) => [
      a.name,
      a.primaryText,
      a.headline,
      a.description,
      a.button,
      a.link,
      a.image,
      a.audience
    ])
  })
}

/** Everything in one document for the user to read before they launch anything. */
export function adsDocument(drafts: AdDrafts, files: { google: string | null }): string {
  const lines = [
    `# ${drafts.title}`,
    '',
    'Drafts by Titan117’s Marketing agent. **Nothing is running and nothing was sent to an ad account.** You import or copy them, choose the budget and press the platform’s own button to launch.',
    ''
  ]
  if (drafts.notes) lines.push('## Budget and audience (advice; you decide)', '', drafts.notes, '')
  if (drafts.google.length) {
    lines.push('## Google search ads', '')
    if (files.google)
      lines.push(
        `**To import:** open Google Ads Editor, choose **Account > Import > From file**, pick \`${files.google}\`, check the columns it shows, and post the changes. Every campaign, ad and keyword arrives **paused**; set a budget and enable them when you are ready.`,
        ''
      )
    for (const ad of drafts.google) {
      lines.push(
        `### ${ad.campaign} › ${ad.adGroup}`,
        '',
        `Opens: ${ad.finalUrl}${ad.paths.length ? ` (shown as …/${ad.paths.join('/')})` : ''}`,
        '',
        '**Headlines** (Google mixes them, up to three at a time):',
        ''
      )
      for (const h of ad.headlines)
        lines.push(`- ${h} _(${googleChars(h)}/${GOOGLE.headlineChars})_`)
      lines.push('', '**Descriptions:**', '')
      for (const d of ad.descriptions)
        lines.push(`- ${d} _(${googleChars(d)}/${GOOGLE.descriptionChars})_`)
      lines.push(
        '',
        `**Keywords:** ${ad.keywords.map((k) => `${k.text} (${k.match})`).join(', ')}`,
        ''
      )
    }
  }
  if (drafts.meta.length) {
    lines.push(
      '## Meta ads (Facebook and Instagram)',
      '',
      '**To use:** in Meta Ads Manager choose **Create**, pick your objective, audience and budget, and copy each ad’s text, headline, button and picture from here (the spreadsheet has them one per row).',
      ''
    )
    for (const ad of drafts.meta) {
      lines.push(`### ${ad.name}`, '', ad.primaryText, '', `- **Headline:** ${ad.headline}`)
      if (ad.description) lines.push(`- **Description:** ${ad.description}`)
      lines.push(`- **Button:** ${ad.button}`, `- **Opens:** ${ad.link}`)
      if (ad.image) lines.push(`- **Picture:** \`${ad.image}\``)
      if (ad.audience) lines.push(`- **Who to show it to (advice):** ${ad.audience}`)
      for (const w of metaWarnings(ad)) lines.push(`- _Note: ${w}._`)
      lines.push('')
    }
  }
  return lines.join('\n')
}
