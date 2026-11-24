/**
 * Marketing tools (phase 14; decisions §24, §62): the brand kit (15.1), the
 * content calendar of ready-to-post posts (15.2-15.4) and the promo video
 * (5.1, 15.9).
 *
 * Nothing here posts, sends or publishes: a post is a package the user
 * publishes themselves with "Copy and open". Saving to the brand kit or the
 * calendar changes what the user sees and is reminded of, so it asks; a
 * video is drawn on the laptop for free and saved as a file, so it asks like
 * any file write. What a site says about itself is data, never instructions
 * (guardrails §5).
 */
import { describeBrand, hasBrand, MAX_SHOT_PAGES } from '../lib/marketing/brand'
import {
  MAX_BATCH,
  PLATFORMS,
  PLATFORM_INFO,
  POST_STATUSES,
  RESULT_KEYS,
  cleanResults,
  calendarCsv,
  calendarIcs,
  checkPost,
  countChars,
  fullText,
  isPlatform,
  postWarnings,
  type Post,
  type PostInput,
  type PostStatus
} from '../lib/marketing/posts'
import {
  MAX_SCENES,
  MAX_SECONDS,
  VIDEO_FORMATS,
  checkVideo,
  type VideoFormat
} from '../lib/marketing/video'
import { PermissionError } from '../lib/folders'
import {
  GOOGLE,
  META,
  META_BUTTONS,
  adsDocument,
  checkAds,
  googleEditorFile,
  metaSheet,
  metaWarnings
} from '../lib/marketing/ads'
import { campaignReport, campaignSheet } from '../lib/marketing/report'
import { defineTool } from './lib/define-tool'

function slug(text: string, fallback: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || fallback
  )
}

function webAddress(value: unknown): string {
  const text = String(value ?? '').trim()
  // Another kind of address (file:, ftp:) is never turned into a web one.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text))
    throw new PermissionError('Give the site as a web address, like https://your-site.com.')
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    throw new PermissionError('Give the site as a web address, like https://your-site.com.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new PermissionError('Give the site as a web address, like https://your-site.com.')
  return url.toString()
}

function folderOf(value: unknown, fallback: string): string {
  const text = String(value ?? '')
    .trim()
    .replace(/[\\/]+$/, '')
  return text || fallback
}

function postLine(post: Post): string {
  const info = PLATFORM_INFO[post.platform]
  const warnings = postWarnings(post)
  return [
    `- [${post.id}] ${post.date} ${post.time} · ${info.label} · ${post.status}${post.campaign ? ` · ${post.campaign}` : ''}`,
    `  ${fullText(post).replace(/\n+/g, ' ⏎ ').slice(0, 400)}`,
    post.link ? `  link: ${post.link}` : '',
    post.media.length ? `  media: ${post.media.join(', ')}` : '',
    ...warnings.map((w) => `  ! ${w}`)
  ]
    .filter(Boolean)
    .join('\n')
}

export const brandGet = defineTool<Record<string, never>>({
  name: 'brand_get',
  description:
    'Read the company’s brand kit: its name, tagline, website, what it sells and to whom, tone of voice, colours, heading font and logo. Read it before writing posts, pages or a video, so everything sounds and looks like the company.',
  params: { type: 'object', properties: {}, required: [] },
  risk: 'read',
  permissions: { marketing: 'read' },
  describe: () => 'Read the brand kit',
  async run(_input, ctx) {
    const brand = ctx.marketing.brand()
    return {
      output: hasBrand(brand)
        ? describeBrand(brand)
        : 'The brand kit is empty. Read the company’s site with brand_from_site, or ask the user for the name, what they sell and their tone of voice, then save it with brand_save.',
      summary: hasBrand(brand)
        ? `Read the brand kit of ${brand.name || 'the company'}`
        : 'The brand kit is empty'
    }
  }
})

interface FromSiteInput {
  url: string
  pages?: unknown[]
  folder?: string
}

export const brandFromSite = defineTool<FromSiteInput>({
  name: 'brand_from_site',
  description: `Read a company's own website for its brand, in the laptop's browser: its name, description, headings, the two colours it uses most, its heading font and its logo. Also saves a screenshot of each page at a desktop and a phone size, for posts and the promo video. Give "pages" (up to ${MAX_SHOT_PAGES - 1} more addresses on the same site) for more screenshots. Everything is saved in "folder" (default marketing/brand). It proposes; nothing is put in the brand kit until brand_save.`,
  params: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The site’s home page' },
      pages: { type: 'array', description: 'More pages of the same site to screenshot' },
      folder: {
        type: 'string',
        description: 'A folder inside the allowed folders for the logo and screenshots'
      }
    },
    required: ['url']
  },
  risk: 'write',
  permissions: { marketing: 'read', network: true, folders: 'write' },
  untrustedOutput: true,
  describe: (input) => `Read ${input.url} for its brand and save screenshots`,
  assess(input) {
    return {
      risk: 'write',
      summary: `Open ${String(input.url ?? '').slice(0, 200)} in the browser, read its brand, and save its logo and screenshots in ${folderOf(input.folder, 'marketing/brand')}`
    }
  },
  async run(input, ctx) {
    const home = webAddress(input.url)
    const host = new URL(home).hostname
    const more = (Array.isArray(input.pages) ? input.pages : [])
      .map((p) => webAddress(new URL(String(p), home).toString()))
      .filter((p) => new URL(p).hostname === host)
    const folder = folderOf(input.folder, 'marketing/brand')
    const site = await ctx.marketing.readSite([home, ...more].slice(0, MAX_SHOT_PAGES), {
      screenshots: true
    })
    let logo = ''
    if (site.logo) {
      logo = `${folder}/logo.${site.logo.ext}`
      await ctx.files.writeBytes(logo, site.logo.bytes)
    }
    const shots: string[] = []
    for (const shot of site.shots) {
      const name = slug(new URL(shot.url).pathname, 'home')
      const path = `${folder}/shots/${name}-${shot.size}.png`
      await ctx.files.writeBytes(path, shot.image)
      shots.push(`${path} (${shot.url}, ${shot.size})`)
    }
    return {
      output: [
        `What ${host} shows (a proposal; check it with the user, then brand_save):`,
        `name: ${site.name || '(not found)'}`,
        `website: ${home}`,
        site.tagline ? `first heading: ${site.tagline}` : '',
        site.description ? `description: ${site.description}` : '',
        site.lang ? `language: ${site.lang}` : '',
        `main colour: ${site.primary ?? '(none found; the site is black, white or grey)'}`,
        `second colour: ${site.accent ?? '(none found)'}`,
        site.headingFont ? `heading font: ${site.headingFont}` : '',
        logo ? `logo saved: ${logo}` : 'logo: none found',
        site.headings.length ? `headings:\n${site.headings.map((h) => `- ${h}`).join('\n')}` : '',
        site.paragraphs.length ? `text:\n${site.paragraphs.map((p) => `- ${p}`).join('\n')}` : '',
        shots.length ? `screenshots saved:\n${shots.map((s) => `- ${s}`).join('\n')}` : '',
        site.problems.length
          ? `could not open:\n${site.problems.map((p) => `- ${p}`).join('\n')}`
          : ''
      ]
        .filter(Boolean)
        .join('\n'),
      summary: `Read ${host}: ${site.primary ?? 'no colour'}, ${logo ? 'a logo' : 'no logo'}, ${shots.length} screenshot(s)`
    }
  }
})

interface BrandInput {
  name?: string
  tagline?: string
  website?: string
  description?: string
  audience?: string
  products?: unknown[]
  tone?: string
  primary?: string
  accent?: string
  heading_font?: string
  logo?: string
}

export const brandSave = defineTool<BrandInput>({
  name: 'brand_save',
  description:
    'Save the brand kit, or change parts of it (what you leave out stays as it is). Every marketing agent, the app builder and the promo video use it. Colours are #rrggbb. "logo" is a PNG, SVG, JPEG or WebP file inside the allowed folders. The user approves.',
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The company or product name' },
      tagline: { type: 'string', description: 'One line under the name' },
      website: { type: 'string', description: 'The company’s site' },
      description: {
        type: 'string',
        description: 'What the company does, in two or three sentences'
      },
      audience: { type: 'string', description: 'Who it sells to' },
      products: { type: 'array', description: 'What it sells: short names' },
      tone: { type: 'string', description: 'How it talks, in a few words ("warm and plain")' },
      primary: { type: 'string', description: 'The main colour, #rrggbb' },
      accent: { type: 'string', description: 'The second colour, #rrggbb' },
      heading_font: { type: 'string', description: 'The headings’ font, by name' },
      logo: { type: 'string', description: 'The logo file, inside the allowed folders' }
    },
    required: []
  },
  risk: 'write',
  permissions: { marketing: 'write', folders: 'read' },
  describe: (input) => `Save the brand kit${input.name ? ` of ${input.name}` : ''}`,
  assess(input) {
    const parts = [
      input.name ? `name "${String(input.name).slice(0, 60)}"` : '',
      input.tagline ? `tagline "${String(input.tagline).slice(0, 80)}"` : '',
      input.website ? `website ${String(input.website).slice(0, 80)}` : '',
      input.tone ? `tone "${String(input.tone).slice(0, 80)}"` : '',
      input.primary ? `main colour ${input.primary}` : '',
      input.accent ? `second colour ${input.accent}` : '',
      input.heading_font ? `font ${String(input.heading_font).slice(0, 40)}` : '',
      input.logo ? `logo ${String(input.logo).slice(0, 80)}` : '',
      input.description ? 'what the company does' : '',
      input.audience ? 'its audience' : '',
      Array.isArray(input.products) ? `${input.products.length} product(s)` : ''
    ].filter(Boolean)
    return {
      risk: 'write',
      summary: `Save to the brand kit: ${parts.join(', ') || 'nothing'}. Every marketing agent and new app will use it.`,
      ...(parts.length ? {} : { refuse: 'Say what to save in the brand kit.' })
    }
  },
  async run(input, ctx) {
    const patch: Record<string, unknown> = {}
    for (const key of ['name', 'tagline', 'website', 'description', 'audience', 'tone'] as const)
      if (input[key] !== undefined) patch[key] = input[key]
    if (input.products !== undefined) patch.products = input.products
    if (input.heading_font !== undefined) patch.headingFont = input.heading_font
    for (const key of ['primary', 'accent'] as const)
      if (input[key] !== undefined) {
        if (!/^#[0-9a-fA-F]{6}$/.test(String(input[key])))
          throw new PermissionError(`"${key}" is a colour like #0f766e.`)
        patch[key] = input[key]
      }
    if (input.logo !== undefined) {
      const logo = String(input.logo).trim()
      if (logo) {
        if (!/\.(png|svg|jpe?g|webp)$/i.test(logo))
          throw new PermissionError('The logo is a PNG, SVG, JPEG or WebP file.')
        // Read through the folder rules: it must exist inside the allowed folders.
        await ctx.files.readBytes(logo, 2_000_000)
      }
      patch.logo = logo
    }
    const brand = ctx.marketing.saveBrand(patch)
    return {
      output: `Saved the brand kit:\n${describeBrand(brand)}`,
      summary: `Saved the brand kit${brand.name ? ` of ${brand.name}` : ''}`
    }
  }
})

function countByPlatform(posts: { platform?: unknown }[]): string {
  const counts = new Map<string, number>()
  for (const post of posts)
    if (isPlatform(post.platform)) counts.set(post.platform, (counts.get(post.platform) ?? 0) + 1)
  return [...counts]
    .map(([p, n]) => `${PLATFORM_INFO[p as keyof typeof PLATFORM_INFO].label} ${n}`)
    .join(', ')
}

const LIMITS = PLATFORMS.map((p) => {
  const info = PLATFORM_INFO[p]
  return `${p} (${info.maxChars} characters with hashtags, up to ${info.maxHashtags} hashtags${info.needsMedia ? ', needs a picture or video' : ''})`
}).join('; ')

export const postSave = defineTool<{ posts: unknown[] }>({
  name: 'post_save',
  description: `Save posts to the content calendar: new ones, or changes to existing ones (give their "id"). Up to ${MAX_BATCH} at a time, so a whole month goes in one call. Each post: {"platform","date":"2026-12-03","time":"09:30","text","hashtags":["bread"],"media":["images/loaf.png"],"link","campaign","status"}. Platforms: ${LIMITS}. Write each platform's post for that platform (a LinkedIn post is not an X post). "status" is "draft" (default) or "ready": the user is reminded when a ready post is due and publishes it themselves with Copy and open. Nothing is ever posted automatically.`,
  params: {
    type: 'object',
    properties: {
      posts: { type: 'array', description: 'The posts (see the description)' }
    },
    required: ['posts']
  },
  risk: 'write',
  permissions: { marketing: 'write' },
  describe: (input) =>
    `Save ${Array.isArray(input.posts) ? input.posts.length : 0} post(s) to the content calendar`,
  assess(input) {
    const posts = (Array.isArray(input.posts) ? input.posts : []) as PostInput[]
    if (!posts.length)
      return { risk: 'write', summary: 'Save posts', refuse: 'There are no posts to save.' }
    if (posts.length > MAX_BATCH)
      return {
        risk: 'write',
        summary: 'Save posts',
        refuse: `Save at most ${MAX_BATCH} posts at a time.`
      }
    // A new post that isn't one (too long, no day) is sent back before the user is asked.
    for (const [i, post] of posts.entries()) {
      if (post?.id) continue
      try {
        checkPost(post ?? {})
      } catch (error) {
        return {
          risk: 'write',
          summary: 'Save posts',
          refuse: `Post ${i + 1}: ${(error as Error).message}`
        }
      }
    }
    const days = posts
      .map((p) => String(p?.date ?? ''))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
    const ready = posts.filter((p) => p?.status === 'ready').length
    const first = String(posts[0]?.text ?? '').slice(0, 160)
    return {
      risk: 'write',
      summary:
        `Save ${posts.length} post(s) to the content calendar (${countByPlatform(posts) || 'no platform given'})` +
        (days.length ? `, ${days[0]} to ${days[days.length - 1]}` : '') +
        (ready ? `; ${ready} marked ready, so you are reminded when they are due` : '') +
        `. Nothing is posted: you publish each one yourself. The first: "${first}"`
    }
  },
  async run(input, ctx) {
    const inputs = (Array.isArray(input.posts) ? input.posts : []) as PostInput[]
    // A post's media must be files the user can attach: inside the allowed folders.
    for (const [i, post] of inputs.entries())
      for (const media of Array.isArray(post?.media) ? post.media : post?.media ? [post.media] : [])
        await ctx.files.resolve(String(media)).catch(() => {
          throw new PermissionError(
            `Post ${i + 1}: "${String(media).slice(0, 120)}" isn't inside the allowed folders.`
          )
        })
    const saved = ctx.marketing.savePosts(inputs)
    const warnings = saved.flatMap((p) =>
      postWarnings(p).map((w) => `- ${p.date} ${PLATFORM_INFO[p.platform].label}: ${w}`)
    )
    return {
      output: [
        `Saved ${saved.length} post(s): ${countByPlatform(saved)}.`,
        saved
          .map(
            (p) =>
              `- [${p.id}] ${p.date} ${p.time} ${PLATFORM_INFO[p.platform].label} (${p.status}, ${countChars(p.platform, fullText(p))} characters)`
          )
          .join('\n'),
        warnings.length ? `Still missing:\n${[...new Set(warnings)].slice(0, 20).join('\n')}` : '',
        'The user sees them on the Marketing screen, where each has Copy and open.'
      ]
        .filter(Boolean)
        .join('\n'),
      summary: `Saved ${saved.length} post(s) to the calendar`
    }
  }
})

interface ListInput {
  month?: string
  from?: string
  to?: string
  platform?: string
  status?: string
  campaign?: string
}

export const postList = defineTool<ListInput>({
  name: 'post_list',
  description:
    'List the posts in the content calendar, with their ids. Narrow it by "month" (2026-12), "from"/"to" (days), "platform", "status" (draft, ready, posted, skipped) or "campaign".',
  params: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'A month, like 2026-12' },
      from: { type: 'string', description: 'From this day, like 2026-12-01' },
      to: { type: 'string', description: 'Up to this day' },
      platform: { type: 'string', description: 'One platform', enum: [...PLATFORMS] },
      status: { type: 'string', description: 'One status', enum: [...POST_STATUSES] },
      campaign: { type: 'string', description: 'A campaign’s name' }
    },
    required: []
  },
  risk: 'read',
  permissions: { marketing: 'read' },
  describe: (input) => `List the posts${input.month ? ` of ${input.month}` : ''}`,
  async run(input, ctx) {
    const posts = ctx.marketing.posts({
      month: input.month,
      from: input.from,
      to: input.to,
      platform: isPlatform(input.platform) ? input.platform : undefined,
      status: input.status as PostStatus | undefined,
      campaign: input.campaign
    })
    const shown = posts.slice(0, 120)
    return {
      output: posts.length
        ? `${posts.length} post(s)${posts.length > shown.length ? `, the first ${shown.length} shown` : ''}:\n${shown.map(postLine).join('\n')}`
        : 'There are no such posts in the calendar.',
      summary: `Listed ${posts.length} post(s)`
    }
  }
})

const POST_ACTIONS = ['ready', 'draft', 'posted', 'skipped', 'remove']

export const postChange = defineTool<{ ids: unknown[]; action: string }>({
  name: 'post_change',
  description:
    'Change posts in the calendar by their ids: mark them "ready" (the user is reminded when due), "draft", "posted" (the user said they published it), "skipped", or "remove" them. To change a post’s text, day or media use post_save with its id.',
  params: {
    type: 'object',
    properties: {
      ids: { type: 'array', description: 'The posts’ ids (from post_list or post_save)' },
      action: { type: 'string', description: 'What to do', enum: POST_ACTIONS }
    },
    required: ['ids', 'action']
  },
  risk: 'write',
  permissions: { marketing: 'write' },
  describe: (input) =>
    `${input.action === 'remove' ? 'Remove' : `Mark as ${input.action}`} ${Array.isArray(input.ids) ? input.ids.length : 0} post(s)`,
  assess(input) {
    const n = Array.isArray(input.ids) ? input.ids.length : 0
    if (!n || n > MAX_BATCH)
      return {
        risk: 'write',
        summary: 'Change posts',
        refuse: `Give 1 to ${MAX_BATCH} post ids.`
      }
    return {
      risk: 'write',
      summary:
        input.action === 'remove'
          ? `Remove ${n} post(s) from the content calendar`
          : `Mark ${n} post(s) in the content calendar as ${input.action}${input.action === 'ready' ? ' (you are reminded when each is due; you publish it yourself)' : ''}`
    }
  },
  async run(input, ctx) {
    const ids = input.ids.map(String)
    for (const id of ids) ctx.marketing.changePost(id, input.action as PostStatus | 'remove')
    return {
      output:
        input.action === 'remove'
          ? `Removed ${ids.length} post(s).`
          : `Marked ${ids.length} post(s) as ${input.action}.`,
      summary: `${input.action}: ${ids.length} post(s)`
    }
  }
})

export const calendarExport = defineTool<{ month?: string; folder?: string }>({
  name: 'calendar_export',
  description:
    'Export the content calendar as two files in an allowed folder: an .ics file (for any calendar app, with a reminder at each post’s time) and a .csv table (for a spreadsheet or a platform’s own scheduler). Give "month" (2026-12) or leave it out for everything not yet posted.',
  params: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'A month, like 2026-12' },
      folder: { type: 'string', description: 'Where to save (default marketing/calendar)' }
    },
    required: []
  },
  risk: 'write',
  permissions: { marketing: 'read', folders: 'write' },
  describe: (input) => `Export the content calendar${input.month ? ` of ${input.month}` : ''}`,
  async run(input, ctx) {
    const posts = input.month
      ? ctx.marketing.posts({ month: input.month })
      : ctx.marketing.posts({}).filter((p) => p.status === 'draft' || p.status === 'ready')
    if (!posts.length)
      return { output: 'There are no posts to export.', summary: 'Nothing to export' }
    const folder = folderOf(input.folder, 'marketing/calendar')
    const name = `content-calendar${input.month ? `-${input.month}` : ''}`
    await ctx.files.write(`${folder}/${name}.ics`, calendarIcs(posts))
    await ctx.files.write(`${folder}/${name}.csv`, calendarCsv(posts))
    return {
      output: `Exported ${posts.length} post(s) to ${folder}/${name}.ics and ${folder}/${name}.csv.`,
      summary: `Exported ${posts.length} post(s) as .ics and .csv`
    }
  }
})

interface VideoInput {
  title: string
  scenes: unknown[]
  formats?: unknown[]
  voiceover?: boolean
  captions?: boolean
  folder?: string
}

const FORMAT_LIST = (Object.keys(VIDEO_FORMATS) as VideoFormat[])
  .map((f) => `"${f}" (${VIDEO_FORMATS[f].label})`)
  .join(', ')

export const promoVideo = defineTool<VideoInput>({
  name: 'promo_video',
  description: [
    `Make a promo video as an MP4 file, drawn on this laptop for free (no AI video model): up to ${MAX_SCENES} scenes and ${MAX_SECONDS} seconds, in the brand kit's colours, font and logo.`,
    'Scenes, in order: {"kind":"title","heading","text"}, {"kind":"points","heading","points":[up to 5 short lines]}, {"kind":"image","image":"a PNG, JPEG or WebP in the allowed folders (a screenshot from brand_from_site, or a picture)","heading","text","frame":"browser" | "phone" | "none"}, {"kind":"quote","text","by"}, {"kind":"outro","heading":"the call to action","text","url"}.',
    'Each scene may have "seconds" (2-30) and "say": one or two short sentences read aloud by the system voice when "voiceover" is true, also shown as captions. A scene lasts as long as its voice needs.',
    `"formats": one or more of ${FORMAT_LIST}; the same scenes are laid out for each shape. Use phone screenshots with frame "phone" in portrait videos.`,
    'A good promo: a title that states the benefit, two or three scenes showing the product, three points, a quote if there is a real one, an outro with one call to action. 20 to 45 seconds. Never invent quotes, numbers or customers.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The video’s name (also its file name)' },
      scenes: { type: 'array', description: 'The scenes, in order (see the description)' },
      formats: { type: 'array', description: 'The shapes to make (default ["landscape"])' },
      voiceover: { type: 'boolean', description: 'Read each scene’s "say" aloud' },
      captions: { type: 'boolean', description: 'Show what is said as captions (default true)' },
      folder: { type: 'string', description: 'Where to save (default videos)' }
    },
    required: ['title', 'scenes']
  },
  risk: 'write',
  permissions: { marketing: 'write', folders: 'write' },
  describe: (input) => `Make the promo video "${String(input.title ?? '').slice(0, 80)}"`,
  assess(input) {
    const scenes = Array.isArray(input.scenes) ? input.scenes.length : 0
    const formats =
      Array.isArray(input.formats) && input.formats.length ? input.formats : ['landscape']
    // A video that isn't one is sent back before the user is asked.
    try {
      for (const format of formats) checkVideo({ ...input, format })
    } catch (error) {
      return { risk: 'write', summary: 'Make a promo video', refuse: (error as Error).message }
    }
    return {
      risk: 'write',
      summary: `Make the promo video "${String(input.title ?? '').slice(0, 80)}": ${scenes} scene(s), ${formats.map(String).join(', ')}${input.voiceover ? ', with a voiceover' : ''}, saved in ${folderOf(input.folder, 'videos')}. It is drawn on this laptop; nothing is sent anywhere.`
    }
  },
  async run(input, ctx) {
    const formats = [
      ...new Set(
        (Array.isArray(input.formats) && input.formats.length ? input.formats : ['landscape']).map(
          String
        )
      )
    ].slice(0, 3)
    const folder = folderOf(input.folder, 'videos')
    // Every format is checked before the first is drawn.
    const specs = formats.map((format) => ctx.marketing.checkVideo({ ...input, format }))
    const made: string[] = []
    for (const spec of specs) {
      const video = await ctx.marketing.video(spec, (path) => ctx.files.readBytes(path, 20_000_000))
      const path = `${folder}/${slug(spec.title, 'promo')}-${spec.format}.mp4`
      await ctx.files.writeBytes(path, video.mp4)
      made.push(
        `${path} (${video.width}×${video.height}, ${Math.round(video.seconds)} s, ${(video.mp4.length / 1_000_000).toFixed(1)} MB${video.sound ? `, voiceover on ${video.voiced} scene(s)` : ', no sound'})`
      )
    }
    return {
      output: `Made the video:\n${made.map((m) => `- ${m}`).join('\n')}\nThe user can open the files to watch them. To change a scene, call promo_video again with the changed scenes.`,
      summary: `Made the promo video ${slug(String(input.title), 'promo')} (${formats.join(', ')})`
    }
  }
})

export const postResults = defineTool<{ id: string; results: Record<string, unknown> }>({
  name: 'post_results',
  description:
    'Record what a posted post brought, as the user read it off the platform: {"views","likes","comments","shares","clicks"} (give only the numbers they told you). Titan117 reads no platform’s numbers itself. campaign_report sums them up.',
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The post’s id' },
      results: { type: 'object', description: 'The numbers, e.g. {"likes": 14, "clicks": 3}' }
    },
    required: ['id', 'results']
  },
  risk: 'write',
  permissions: { marketing: 'write' },
  describe: () => 'Record a post’s results',
  assess(input) {
    const given = cleanResults(input.results)
    const parts = RESULT_KEYS.flatMap((k) => (given[k] === undefined ? [] : [`${given[k]} ${k}`]))
    return {
      risk: 'write',
      summary: `Record a post’s results: ${parts.join(', ') || 'nothing'}`,
      ...(parts.length
        ? {}
        : { refuse: 'Give at least one number: views, likes, comments, shares or clicks.' })
    }
  },
  async run(input, ctx) {
    const post = ctx.marketing.setResults(String(input.id), input.results)
    return {
      output: `Recorded for the ${PLATFORM_INFO[post.platform].label} post of ${post.date}: ${RESULT_KEYS.flatMap((k) => (post.results[k] === undefined ? [] : [`${post.results[k]} ${k}`])).join(', ')}.`,
      summary: 'Recorded a post’s results'
    }
  }
})

export const campaignReportTool = defineTool<{
  month?: string
  from?: string
  to?: string
  campaign?: string
}>({
  name: 'campaign_report',
  description:
    'Make a campaign report from the content calendar: what was planned and posted per platform and campaign, what is overdue, and what it brought (the numbers the user typed in). Give "month" (2026-12) or "from"/"to" days, and optionally one "campaign". It makes a report and a spreadsheet (download as PDF, Word or Excel).',
  params: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'A month, like 2026-12' },
      from: { type: 'string', description: 'From this day' },
      to: { type: 'string', description: 'Up to this day' },
      campaign: { type: 'string', description: 'Only this campaign' }
    },
    required: []
  },
  risk: 'read',
  permissions: { marketing: 'read', artifacts: 'write' },
  describe: (input) => `Make the campaign report${input.month ? ` for ${input.month}` : ''}`,
  async run(input, ctx) {
    const posts = ctx.marketing.posts({
      month: input.month,
      from: input.from,
      to: input.to,
      campaign: input.campaign
    })
    if (!posts.length)
      return { output: 'There are no posts in that period.', summary: 'Nothing to report' }
    const range =
      input.month ?? ([input.from, input.to].filter(Boolean).join(' to ') || 'all posts')
    const period = [input.campaign, range].filter(Boolean).join(', ')
    const text = campaignReport(posts, period)
    const report = ctx.artifacts.create({
      kind: 'document',
      title: `Campaign report ${period}`,
      content: text
    })
    const sheet = ctx.artifacts.create({
      kind: 'spreadsheet',
      title: `Campaign posts ${period}`,
      content: campaignSheet(posts)
    })
    return {
      output: `${text}\nThe report is the artifact "${report.title}" and its posts the spreadsheet "${sheet.title}".`,
      summary: `Made the campaign report for ${period}: ${posts.length} post(s)`
    }
  }
})

interface AdsInput {
  title?: string
  google?: unknown[]
  meta?: unknown[]
  notes?: string
  folder?: string
}

export const adDrafts = defineTool<AdsInput>({
  name: 'ad_drafts',
  description: [
    'Write ads for the user to launch themselves; nothing touches an ad account and nothing is spent.',
    `"google": search ads, each {"campaign","ad_group","final_url","headlines":[${GOOGLE.minHeadlines}-${GOOGLE.maxHeadlines}, each up to ${GOOGLE.headlineChars} characters],"descriptions":[${GOOGLE.minDescriptions}-${GOOGLE.maxDescriptions}, each up to ${GOOGLE.descriptionChars}],"paths":[up to 2, ${GOOGLE.pathChars} characters],"keywords":[{"text","match":"broad"|"phrase"|"exact"}]}. Count the characters: one over is refused.`,
    `"meta": Facebook and Instagram ads, each {"name","primary_text" (best under ${META.primaryText} characters),"headline" (best under ${META.headline}),"description","button": one of ${META_BUTTONS.join(', ')},"link","image": a PNG or JPEG in the allowed folders,"audience": who to show it to}.`,
    '"notes": your advice on budget and audience, in plain words; the user decides both.',
    'It makes a document with every ad, a file for Google Ads Editor’s import with everything paused, and a sheet of the Meta ads. Use only what the brand kit and the site say: no invented prices, numbers or claims.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What the ads are for, e.g. "Christmas orders"' },
      google: { type: 'array', description: 'Google search ads (see the description)' },
      meta: { type: 'array', description: 'Meta ads (see the description)' },
      notes: { type: 'string', description: 'Advice on budget and audience' },
      folder: {
        type: 'string',
        description: 'Where to save the import file (default marketing/ads)'
      }
    },
    required: []
  },
  risk: 'write',
  permissions: { marketing: 'read', artifacts: 'write', folders: 'write' },
  describe: (input) => `Draft ads${input.title ? `: ${String(input.title).slice(0, 80)}` : ''}`,
  assess(input) {
    // Ads that break a limit go back to the agent before the user is asked.
    try {
      const drafts = checkAds(input)
      return {
        risk: 'write',
        summary: `Draft ${drafts.google.length} Google and ${drafts.meta.length} Meta ad(s) for "${drafts.title}" and save the import file in ${folderOf(input.folder, 'marketing/ads')}. Nothing is sent to an ad account; you launch them yourself.`
      }
    } catch (error) {
      return { risk: 'write', summary: 'Draft ads', refuse: (error as Error).message }
    }
  },
  async run(input, ctx) {
    const drafts = checkAds(input)
    for (const ad of drafts.meta)
      if (ad.image)
        await ctx.files.resolve(ad.image).catch(() => {
          throw new PermissionError(`"${ad.image.slice(0, 120)}" isn't inside the allowed folders.`)
        })
    let file: string | null = null
    if (drafts.google.length) {
      file = `${folderOf(input.folder, 'marketing/ads')}/${slug(drafts.title, 'ads')}-google-ads-editor.tsv`
      // Editor reads Unicode text: UTF-16 with a byte-order mark, like Excel's "Unicode Text".
      await ctx.files.writeBytes(
        file,
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from(googleEditorFile(drafts.google), 'utf16le')
        ])
      )
    }
    const doc = ctx.artifacts.create({
      kind: 'document',
      title: drafts.title,
      content: adsDocument(drafts, { google: file })
    })
    const sheet = drafts.meta.length
      ? ctx.artifacts.create({
          kind: 'spreadsheet',
          title: `${drafts.title}: Meta ads`,
          content: metaSheet(drafts.meta)
        })
      : null
    const notes = drafts.meta.flatMap((ad) => metaWarnings(ad).map((w) => `- ${ad.name}: ${w}`))
    return {
      output: [
        `Drafted ${drafts.google.length} Google and ${drafts.meta.length} Meta ad(s): the document "${doc.title}"${sheet ? ` and the spreadsheet "${sheet.title}"` : ''}.`,
        file
          ? `Google Ads Editor file: ${file} (Account > Import > From file; everything arrives paused).`
          : '',
        notes.length ? `Worth a look:\n${notes.join('\n')}` : '',
        'Nothing is running: the user imports or copies the ads, sets the budget and launches them.'
      ]
        .filter(Boolean)
        .join('\n'),
      summary: `Drafted ${drafts.google.length} Google and ${drafts.meta.length} Meta ad(s)`
    }
  }
})

export const marketingTools = [
  brandGet,
  brandFromSite,
  brandSave,
  postSave,
  postList,
  postChange,
  calendarExport,
  promoVideo,
  postResults,
  campaignReportTool,
  adDrafts
]
