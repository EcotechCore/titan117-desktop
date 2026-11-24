// Phase 14 (decisions §24, §62): the brand kit, the content calendar with
// its reminders and exports, the promo video's script and timing, and our MP4
// writer. No network and no real browser: the video is drawn for real in
// test/live/marketing.live.ts.
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'fs'
import { join } from 'path'

import { openDb } from '../src/engine/lib/db'
import { BUILT_IN_AGENTS, agentMayUse } from '../src/engine/lib/agents'
import {
  cleanMarketingBrand,
  cleanWebsite,
  describeBrand,
  fontName,
  nameFromTitle,
  parseColour,
  pickColours
} from '../src/engine/lib/marketing/brand'
import {
  adsDocument,
  checkAds,
  googleChars,
  googleEditorFile,
  metaSheet,
  metaWarnings
} from '../src/engine/lib/marketing/ads'
import { writeMp4 } from '../src/engine/lib/marketing/mp4'
import { campaignReport, campaignSheet } from '../src/engine/lib/marketing/report'
import {
  PLATFORM_INFO,
  calendarCsv,
  calendarIcs,
  checkPost,
  composeUrl,
  countChars,
  createPostStore,
  cleanResults,
  dueAt,
  fullText,
  postWarnings,
  trackedLink
} from '../src/engine/lib/marketing/posts'
import { BRAND_MEMORY_SOURCE, createMarketing } from '../src/engine/lib/marketing/service'
import {
  AUDIO_RATE,
  captionsFor,
  checkVideo,
  mix,
  mixVoice,
  pageJob,
  textOn,
  timeline
} from '../src/engine/lib/marketing/video'
import { createMemoryStore } from '../src/engine/memory'
import { builtInTools } from '../src/engine/tools'
import { monthGrid } from '../src/renderer/src/marketing-lib'
import { call, testEngine, tempFolder } from './helpers'

const at = (text: string): number => new Date(text).getTime()

describe('the brand kit', () => {
  it('keeps what is checked and drops what is odd', () => {
    const brand = cleanMarketingBrand({
      name: '  Northwind   Bakery ',
      website: 'northwind.example/shop#top',
      primary: '#0F766E',
      accent: 'red',
      headingFont: 'Inter"; } body { display:none',
      products: ['Sourdough', 'Sourdough', '', 'Rye'],
      tone: 'warm\nand plain'
    })
    expect(brand.name).toBe('Northwind Bakery')
    expect(brand.website).toBe('https://northwind.example/shop')
    expect(brand.primary).toBe('#0F766E')
    // Not a colour: the default stays.
    expect(brand.accent).toBe('#1f2937')
    // A font's name can't carry anything into a stylesheet.
    expect(brand.headingFont).not.toMatch(/["{};:]/)
    expect(brand.products).toEqual(['Sourdough', 'Rye'])
    expect(brand.tone).toBe('warm and plain')
    expect(describeBrand(brand)).toContain('Products and services: Sourdough, Rye')
  })

  it('takes only web addresses as a website', () => {
    expect(cleanWebsite('file:///C:/secret')).toBe('')
    expect(cleanWebsite('javascript:alert(1)')).toBe('')
    expect(cleanWebsite('localhost')).toBe('')
    // A login in an address is never kept.
    expect(cleanWebsite('https://me:pw@shop.example/')).toBe('https://shop.example/')
  })

  it('picks the colourful colours a page uses most, never grey', () => {
    const picked = pickColours([
      { color: 'rgb(255, 255, 255)', weight: 500_000, kind: 'background' },
      { color: 'rgb(17, 24, 39)', weight: 90_000, kind: 'heading' },
      { color: 'rgb(15, 118, 110)', weight: 9_000, kind: 'button' },
      { color: 'rgb(16, 120, 112)', weight: 6_000, kind: 'button' },
      { color: 'rgba(245, 158, 11, 1)', weight: 4_000, kind: 'link' },
      { color: 'rgba(255, 0, 0, 0.1)', weight: 90_000, kind: 'button' }
    ])
    expect(picked.primary).toBe('#0f766e')
    expect(picked.accent).toBe('#f59e0b')
    expect(pickColours([{ color: 'rgb(20, 20, 20)', weight: 1000, kind: 'button' }])).toEqual({
      primary: null,
      accent: null
    })
    expect(parseColour('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
    expect(parseColour('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
  })

  it('reads a name from a page title and a font from a font list', () => {
    expect(nameFromTitle('Fresh bread every morning | Northwind Bakery', 'northwind.example')).toBe(
      'Northwind Bakery'
    )
    expect(nameFromTitle('', 'www.acme.example')).toBe('Acme')
    expect(fontName('"Inter Tight", system-ui, sans-serif')).toBe('Inter Tight')
    expect(fontName('system-ui, sans-serif')).toBe('')
  })

  it('is saved in parts, and kept in shared memory for every agent', () => {
    const db = openDb(':memory:')
    const memory = createMemoryStore(db)
    const marketing = createMarketing({ db, memory })
    expect(marketing.brand.get()).toBeNull()
    marketing.brand.save({ name: 'Northwind', tone: 'warm and plain', primary: '#0f766e' })
    // A later save of one field keeps the rest.
    const brand = marketing.brand.save({ tagline: 'Fresh bread, every morning' })
    expect(brand.name).toBe('Northwind')
    expect(brand.tagline).toBe('Fresh bread, every morning')
    const kept = memory.list({ scopes: ['shared'] }).filter((m) => m.source === BRAND_MEMORY_SOURCE)
    expect(kept).toHaveLength(1)
    expect(kept[0].text).toContain('Fresh bread, every morning')
    expect(kept[0].kind).toBe('profile')
  })
})

describe('posts', () => {
  const post = { platform: 'x', date: '2026-12-03', time: '09:30', text: 'Fresh bread tomorrow.' }

  it('checks a post against its platform', () => {
    const checked = checkPost({ ...post, hashtags: ['#Bread', 'bread', 'local flour!', '', 'rye'] })
    expect(checked.hashtags).toEqual(['Bread', 'localflour', 'rye'])
    expect(checked.status).toBe('draft')
    expect(fullText(checked)).toBe('Fresh bread tomorrow.\n\n#Bread #localflour #rye')
    expect(() => checkPost({ ...post, text: 'x'.repeat(281) })).toThrow(/280/)
    // Tags already in the text aren't added twice.
    expect(
      fullText(
        checkPost({
          ...post,
          text: 'Warm rye at 7. #Cluj #FreshBread',
          hashtags: ['cluj', 'FreshBread', 'rye']
        })
      )
    ).toBe('Warm rye at 7. #Cluj #FreshBread\n\n#rye')
    expect(() => checkPost({ ...post, platform: 'myspace' })).toThrow(/one of/)
    expect(() => checkPost({ ...post, date: '2026-02-30' })).toThrow(/day/)
    expect(() => checkPost({ ...post, time: '25:00' })).toThrow(/time/)
    expect(() => checkPost({ ...post, link: 'javascript:alert(1)' })).toThrow(/web address/)
    expect(() => checkPost({ ...post, text: '   ' })).toThrow(/text/)
    // LinkedIn takes a long post that X refuses.
    expect(checkPost({ ...post, platform: 'linkedin', text: 'x'.repeat(2000) }).text).toHaveLength(
      2000
    )
  })

  it('counts a link on X as 23 characters', () => {
    const long = `Read it: https://northwind.example/${'a'.repeat(200)}`
    expect(countChars('x', long)).toBe('Read it: '.length + 23)
    expect(countChars('linkedin', long)).toBe(long.length)
    // Emoji and most non-Latin characters count 2 on X.
    expect(countChars('x', 'Pâine 🍞')).toBe(8)
    expect(countChars('x', '面包')).toBe(4)
    expect(countChars('linkedin', 'Pâine 🍞')).toBe(7)
    expect(checkPost({ ...post, text: long }).text).toBe(long)
  })

  it('says what a post still needs', () => {
    expect(postWarnings({ platform: 'instagram', media: [] })[0]).toMatch(/picture or a video/)
    expect(postWarnings({ platform: 'instagram', media: ['a.png'] })).toEqual([])
    expect(postWarnings({ platform: 'linkedin', media: [] })).toEqual([])
  })

  it('opens each platform’s own post screen, text filled in where the platform allows', () => {
    const base = { text: 'Fresh & warm', hashtags: ['bread'], link: 'https://northwind.example/' }
    const x = new URL(composeUrl({ ...base, platform: 'x' }))
    expect(x.origin + x.pathname).toBe('https://x.com/intent/post')
    expect(x.searchParams.get('text')).toBe('Fresh & warm\n\n#bread')
    expect(x.searchParams.get('url')).toBe(
      'https://northwind.example/?utm_source=x&utm_medium=social'
    )
    const linkedin = new URL(composeUrl({ ...base, platform: 'linkedin' }))
    expect(linkedin.hostname).toBe('www.linkedin.com')
    expect(linkedin.searchParams.get('text')).toContain('Fresh & warm')
    expect(linkedin.searchParams.get('text')).toContain('https://northwind.example/')
    expect(composeUrl({ ...base, platform: 'instagram' })).toBe('https://www.instagram.com/')
    expect(composeUrl({ ...base, platform: 'tiktok' })).toBe('https://www.tiktok.com/upload')
    expect(composeUrl({ ...base, platform: 'facebook' })).toBe('https://www.facebook.com/')
    // Every one is an https address on the platform's own site.
    for (const platform of Object.keys(PLATFORM_INFO))
      expect(composeUrl({ ...base, platform: platform as 'x' })).toMatch(/^https:\/\//)
  })

  it('saves a batch together or not at all', () => {
    const store = createPostStore({ db: openDb(':memory:') })
    expect(() =>
      store.save([post, { ...post, platform: 'linkedin', text: '' }], 'Marketing agent')
    ).toThrow(/Post 2/)
    expect(store.list()).toHaveLength(0)
    const saved = store.save(
      [post, { ...post, platform: 'linkedin', date: '2026-12-10', campaign: 'Winter' }],
      'Marketing agent'
    )
    expect(saved).toHaveLength(2)
    expect(store.list({ month: '2026-12' })).toHaveLength(2)
    expect(store.list({ month: '2027-01' })).toHaveLength(0)
    expect(store.list({ platform: 'linkedin' })[0].campaign).toBe('Winter')
    expect(store.list({ campaign: 'winter' })).toHaveLength(1)
    // A change by id keeps what isn't given.
    const [changed] = store.save([{ id: saved[0].id, text: 'Warm loaves at 7.' }], 'you')
    expect(changed.text).toBe('Warm loaves at 7.')
    expect(changed.platform).toBe('x')
    expect(changed.source).toBe('Marketing agent')
    expect(() => store.save([{ id: 'nope', text: 'x' }], 'you')).toThrow(/no post/)
  })

  it('reminds once when a ready post is due, and again only if it is moved', () => {
    let now = at('2026-12-03T09:00:00')
    const store = createPostStore({ db: openDb(':memory:'), now: () => now })
    const [ready, draft] = store.save(
      [
        { ...post, status: 'ready' },
        { ...post, platform: 'linkedin' }
      ],
      'you'
    )
    expect(dueAt(ready)).toBe(at('2026-12-03T09:30:00'))
    expect(store.takeDue()).toEqual([])
    now = at('2026-12-03T09:31:00')
    // Only the ready one; a draft is never announced.
    expect(store.takeDue().map((p) => p.id)).toEqual([ready.id])
    expect(store.takeDue()).toEqual([])
    expect(store.due().map((p) => p.id)).toEqual([ready.id])
    expect(store.get(draft.id)?.remindedAt).toBeNull()
    // Moved to later: it will be announced again then.
    store.save([{ id: ready.id, time: '15:00' }], 'you')
    expect(store.takeDue()).toEqual([])
    now = at('2026-12-03T15:00:30')
    expect(store.takeDue()).toHaveLength(1)
    // Posted: no longer due.
    store.setStatus(ready.id, 'posted')
    expect(store.due()).toEqual([])
    expect(store.get(ready.id)?.postedAt).toBe(now)
  })

  it('does not announce a post whose day passed long ago', () => {
    let now = at('2026-12-01T08:00:00')
    const store = createPostStore({ db: openDb(':memory:'), now: () => now })
    store.save([{ ...post, status: 'ready' }], 'you')
    // The laptop was off for two weeks.
    now = at('2026-12-17T08:00:00')
    expect(store.takeDue()).toEqual([])
    // It still shows as due on the screen, and isn't looked at again.
    expect(store.due()).toHaveLength(1)
    expect(store.list()[0].remindedAt).toBe(now)
  })

  it('says nothing while the app is locked, then catches up', () => {
    let locked: string | null = 'locked'
    const reminded: string[] = []
    const marketing = createMarketing({
      db: openDb(':memory:'),
      now: () => at('2026-12-03T10:00:00'),
      locked: () => locked,
      onRemind: (posts) => reminded.push(...posts.map((p) => p.text))
    })
    marketing.posts.save([{ ...post, status: 'ready' }], 'you')
    marketing.tick()
    expect(reminded).toEqual([])
    locked = null
    marketing.tick()
    marketing.tick()
    expect(reminded).toEqual(['Fresh bread tomorrow.'])
  })

  it('exports the calendar for a calendar app and a spreadsheet', () => {
    const store = createPostStore({ db: openDb(':memory:'), now: () => at('2026-12-01T08:00:00') })
    const posts = store.save(
      [
        { ...post, text: 'Fresh, warm; and "local"\nCome by.', hashtags: ['bread'] },
        { ...post, platform: 'linkedin', text: '=HYPERLINK("https://evil.example")' }
      ],
      'you'
    )
    const ics = calendarIcs(posts, at('2026-12-01T08:00:00'))
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('DTSTART:20261203T093000')
    expect(ics).toContain('DTEND:20261203T094500')
    expect(ics).toContain('SUMMARY:Post on X: Fresh\\, warm\\; and "local"')
    expect(ics).toContain('BEGIN:VALARM')
    // No line is longer than RFC 5545 allows.
    for (const row of ics.split('\r\n')) expect(Buffer.byteLength(row)).toBeLessThanOrEqual(75)
    const csv = calendarCsv(posts)
    expect(csv).toContain('"Fresh, warm; and ""local""\nCome by."')
    // A cell that starts like a formula can't run in a spreadsheet.
    expect(csv).toContain('"\'=HYPERLINK(""https://evil.example"")"')
    expect(csv.split('\r\n')[0]).toContain('Date,Time,Platform,Text')
  })
})

describe('the promo video’s script', () => {
  const scenes = [
    { kind: 'title', heading: 'Fresh bread, every morning', say: 'Fresh bread, every morning.' },
    { kind: 'points', heading: 'Why', points: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'] },
    { kind: 'image', image: 'shots/home.png', frame: 'tablet' },
    { kind: 'outro', heading: 'Order now', url: 'northwind.example', seconds: 99 }
  ]

  it('checks the scenes and takes its look from the brand kit', () => {
    const spec = checkVideo(
      { title: 'Northwind', scenes, look: { primary: 'tomato' } },
      { primary: '#0F766E', accent: '#f59e0b', font: 'Inter', name: 'Northwind', logo: 'logo.svg' }
    )
    expect(spec.format).toBe('landscape')
    expect(spec.scenes.map((s) => s.seconds)).toEqual([4, 6, 5, 30])
    expect(spec.scenes[1]).toMatchObject({
      kind: 'points',
      points: ['One', 'Two', 'Three', 'Four', 'Five']
    })
    expect(spec.scenes[2]).toMatchObject({ kind: 'image', frame: 'browser' })
    // A look that isn't a colour falls back to the brand's.
    expect(spec.look).toEqual({
      primary: '#0f766e',
      accent: '#f59e0b',
      font: 'Inter',
      name: 'Northwind',
      logo: 'logo.svg'
    })
    expect(spec.voiceover).toBe(false)
    expect(spec.captions).toBe(true)
  })

  it('refuses what is not a video', () => {
    expect(() => checkVideo({ scenes: [] })).toThrow(/1 to 24 scenes/)
    expect(() => checkVideo({ scenes: [{ kind: 'explosion' }] })).toThrow(/Scene 1/)
    expect(() => checkVideo({ scenes: [{ kind: 'title' }] })).toThrow(/heading/)
    expect(() => checkVideo({ scenes: [{ kind: 'image', image: 'notes.txt' }] })).toThrow(/picture/)
    expect(() => checkVideo({ scenes, format: 'cinema' })).toThrow(/format/)
    expect(() =>
      checkVideo({
        scenes: Array.from({ length: 10 }, () => ({ kind: 'title', heading: 'x', seconds: 30 }))
      })
    ).toThrow(/at most 180/)
  })

  it('gives a scene the time its voice needs, in whole frames', () => {
    const spec = checkVideo({ scenes: scenes.slice(0, 2), voiceover: true })
    const timed = timeline(spec, [5.01, null])
    // 0.35 s before the voice and 0.5 s after it, rounded to a frame.
    expect(timed[0].seconds).toBeCloseTo(5.8667, 3)
    expect(timed[0].voice).toEqual({ at: 0.35, seconds: 5.01 })
    expect(timed[1].start).toBeCloseTo(5.8667, 3)
    expect(timed[1].seconds).toBe(6)
    expect(timed[1].voice).toBeNull()
    const voice = new Float32Array(AUDIO_RATE).fill(0.5)
    const track = mixVoice(timed, [voice, null])
    expect(track.length).toBe(Math.ceil((timed[1].start + 6) * AUDIO_RATE))
    expect(track[Math.round(0.35 * AUDIO_RATE) - 1]).toBe(0)
    expect(track[Math.round(0.35 * AUDIO_RATE)]).toBe(0.5)
    expect(track[Math.round(1.35 * AUDIO_RATE) + 1]).toBe(0)
  })

  it('cuts what is said into captions spread over the time', () => {
    const captions = captionsFor(
      'Fresh bread, every morning. Order before six and collect warm loaves from seven.',
      1,
      6
    )
    expect(captions.length).toBeGreaterThan(1)
    expect(captions[0].from).toBe(1)
    expect(captions[captions.length - 1].to).toBeCloseTo(7, 6)
    for (const [i, c] of captions.entries()) {
      expect(c.text.length).toBeLessThanOrEqual(60)
      if (i) expect(c.from).toBeCloseTo(captions[i - 1].to, 6)
    }
    expect(captionsFor('', 0, 3)).toEqual([])
  })

  it('hands the page only what it draws', () => {
    const spec = checkVideo({ scenes, voiceover: true, format: 'portrait' }, { primary: '#0f766e' })
    const timed = timeline(spec, [1.5, null, null, null])
    const job = pageJob(spec, {
      images: new Map([['shots/home.png', 'data:image/png;base64,AAAA']]),
      logo: '',
      voice: new Float32Array(10),
      timed
    })
    expect([job.width, job.height, job.fps]).toEqual([1080, 1920, 30])
    expect(job.scenes[2].image).toBe(0)
    expect(job.scenes[0].captions.length).toBeGreaterThan(0)
    expect(job.scenes[1].captions).toEqual([])
    expect(job.colours.onPrimary).toBe('#ffffff')
    expect(Buffer.from(job.audio, 'base64')).toHaveLength(20)
    expect(textOn('#fde047')).toBe('#14161a')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('what posts brought', () => {
  const post = { platform: 'linkedin', date: '2026-12-03', time: '09:30', text: 'Fresh bread.' }

  it('adds where a visit came from to a post’s link, once', () => {
    const link = trackedLink({
      platform: 'linkedin',
      link: 'https://northwind.example/order?ref=a',
      campaign: 'Winter Offer 2026!'
    })
    const url = new URL(link)
    expect(url.searchParams.get('ref')).toBe('a')
    expect(url.searchParams.get('utm_source')).toBe('linkedin')
    expect(url.searchParams.get('utm_medium')).toBe('social')
    expect(url.searchParams.get('utm_campaign')).toBe('winter-offer-2026')
    // A link that already says where it came from is left alone; no link stays none.
    const own = 'https://northwind.example/?utm_source=newsletter'
    expect(trackedLink({ platform: 'x', link: own })).toBe(own)
    expect(trackedLink({ platform: 'x', link: '' })).toBe('')
    // Copy and open posts the tracked link.
    const x = new URL(
      composeUrl({ platform: 'x', text: 'Hi', hashtags: [], link: 'https://northwind.example/' })
    )
    expect(x.searchParams.get('url')).toContain('utm_source=x')
  })

  it('keeps only whole numbers from 0 up as results', () => {
    expect(cleanResults({ likes: '14', clicks: 3.6, views: -1, shares: 'lots', other: 9 })).toEqual(
      {
        likes: 14,
        clicks: 4
      }
    )
    const store = createPostStore({ db: openDb(':memory:') })
    const [saved] = store.save([{ ...post, status: 'posted' }], 'you')
    store.setResults(saved.id, { likes: 14 })
    // A later number is added; the first stays.
    expect(store.setResults(saved.id, { clicks: 3 }).results).toEqual({ likes: 14, clicks: 3 })
    expect(() => store.setResults('nope', { likes: 1 })).toThrow(/no such post/)
  })

  it('reports what was planned, posted, overdue and brought', () => {
    const now = new Date('2026-12-20T12:00:00').getTime()
    const store = createPostStore({ db: openDb(':memory:'), now: () => now })
    const [a, b] = store.save(
      [
        { ...post, status: 'posted', campaign: 'Winter', link: 'https://northwind.example/' },
        { ...post, platform: 'x', text: 'Rye | today', status: 'posted', campaign: 'Winter' },
        { ...post, date: '2026-12-10', status: 'ready' },
        { ...post, date: '2026-12-28', platform: 'instagram' }
      ],
      'you'
    )
    store.setResults(a.id, { likes: 10, clicks: 4 })
    store.setResults(b.id, { likes: 2 })
    const posts = store.list({ month: '2026-12' })
    const report = campaignReport(posts, 'December 2026', now)
    expect(report).toContain('4 planned: 2 posted, 1 ready, 1 drafts, 0 skipped')
    expect(report).toContain('**1 post(s) were due and are not marked as posted.**')
    expect(report).toContain('| LinkedIn | 2 | 1 | – | 10 | – | – | 4 |')
    expect(report).toContain('| Winter | 2 | 2 | – | 12 | – | – | 4 |')
    // A post's words can't break the table.
    expect(report).toContain('| Rye / today | X |')
    expect(report).toContain('utm_campaign')
    const sheet = JSON.parse(campaignSheet(posts)) as { columns: string[]; rows: unknown[][] }
    expect(sheet.columns).toContain('Clicks')
    expect(sheet.rows).toHaveLength(4)
    expect(String(sheet.rows[0][6])).toContain('utm_source=linkedin')
    // Nothing typed in yet: it says where to type it.
    const bare = store.save([{ ...post, date: '2026-11-02', status: 'posted' }], 'you')
    expect(campaignReport(bare, 'x', now)).toMatch(/No results are typed in yet/)
  })
})

describe('ad drafts', () => {
  const google = {
    campaign: 'Christmas',
    ad_group: 'Bread',
    final_url: 'https://bakery.example/order',
    headlines: ['Fresh bread in Cluj', 'Order by 18:00', 'Collect warm at 7', 'Order by 18:00'],
    descriptions: ['Sourdough and rye baked by hand.', 'Order online in two minutes.'],
    paths: ['xmas orders'],
    keywords: ['bakery cluj', { text: '[sourdough "cluj"]', match: 'exact' }, { text: '=cmd' }]
  }
  const meta = {
    name: 'Warm rye',
    primary_text: 'Warm rye at seven. '.repeat(10),
    headline: 'Order tonight, collect warm tomorrow',
    button: 'order now',
    link: 'https://bakery.example/order'
  }

  it('checks Google’s limits to the character', () => {
    const drafts = checkAds({ title: 'Christmas orders', google: [google], meta: [meta] })
    // A repeated headline counts once.
    expect(drafts.google[0].headlines).toHaveLength(3)
    expect(drafts.google[0].paths).toEqual(['xmas-orders'])
    expect(drafts.google[0].keywords).toEqual([
      { text: 'bakery cluj', match: 'phrase' },
      { text: 'sourdough cluj', match: 'exact' },
      { text: 'cmd', match: 'phrase' }
    ])
    expect(() => checkAds({ google: [{ ...google, headlines: ['a', 'b'] }] })).toThrow(/3 to 15/)
    expect(() =>
      checkAds({ google: [{ ...google, headlines: [...google.headlines, 'x'.repeat(31)] }] })
    ).toThrow(/31 characters; Google takes 30/)
    expect(() =>
      checkAds({ google: [{ ...google, descriptions: ['x'.repeat(91), 'ok'] }] })
    ).toThrow(/takes 90/)
    expect(() => checkAds({ google: [{ ...google, keywords: [] }] })).toThrow(/keywords/)
    expect(() => checkAds({ google: [{ ...google, final_url: 'ftp://x' }] })).toThrow(/page/)
    expect(() => checkAds({})).toThrow(/at least one/)
    // Double-width characters count 2, as Google counts them.
    expect(googleChars('パン屋')).toBe(6)
    expect(googleChars('Pâine')).toBe(5)
  })

  it('advises on Meta’s recommendations without refusing', () => {
    const drafts = checkAds({ meta: [meta] })
    expect(drafts.meta[0].button).toBe('Order now')
    const warnings = metaWarnings(drafts.meta[0])
    expect(warnings.join(' ')).toMatch(/recommends up to 150/)
    expect(warnings.join(' ')).toMatch(/recommends 27/)
    expect(warnings.join(' ')).toMatch(/no picture/)
    expect(() => checkAds({ meta: [{ ...meta, image: 'notes.txt' }] })).toThrow(/PNG or JPEG/)
    const sheet = JSON.parse(metaSheet(drafts.meta)) as { columns: string[]; rows: string[][] }
    expect(sheet.columns[0]).toBe('Ad name')
    expect(sheet.rows[0][4]).toBe('Order now')
  })

  it('writes Google Ads Editor’s import file with everything paused', () => {
    const drafts = checkAds({
      google: [google, { ...google, ad_group: 'Pastry', headlines: ['=1+1', 'Rolls', 'Buns'] }]
    })
    const rows = googleEditorFile(drafts.google)
      .trimEnd()
      .split('\r\n')
      .map((r) => r.split('\t'))
    const col = (name: string): number => rows[0].indexOf(name)
    for (const name of [
      'Campaign',
      'Ad group',
      'Headline 15',
      'Description 4',
      'Final URL',
      'Type'
    ])
      expect(col(name)).toBeGreaterThanOrEqual(0)
    expect(rows.every((r) => r.length === rows[0].length)).toBe(true)
    // One campaign row, two ad groups, two ads and three keywords each.
    expect(rows).toHaveLength(1 + 1 + 2 + 2 + 6)
    expect(rows.filter((r) => r[col('Campaign status')] === 'Paused')).toHaveLength(1)
    const ads = rows.filter((r) => r[col('Ad type')] === 'Responsive search ad')
    expect(ads).toHaveLength(2)
    // Every ad and keyword is paused; nothing is enabled anywhere in the file.
    expect(
      rows
        .slice(1)
        .every((r) =>
          [r[col('Campaign status')], r[col('Ad group status')], r[col('Status')]].includes(
            'Paused'
          )
        )
    ).toBe(true)
    expect(googleEditorFile(drafts.google)).not.toContain('Enabled')
    expect(ads[0][col('Headline 1')]).toBe('Fresh bread in Cluj')
    expect(ads[0][col('Path 1')]).toBe('xmas-orders')
    // A cell that starts like a formula can't run in a spreadsheet.
    expect(ads[1][col('Headline 1')]).toBe("'=1+1")
    const exact = rows.find((r) => r[col('Keyword')] === 'sourdough cluj')!
    expect(exact[col('Type')]).toBe('Exact')
  })

  it('says in the document that nothing is running', () => {
    const drafts = checkAds({
      title: 'Christmas',
      google: [google],
      meta: [meta],
      notes: 'Start small.'
    })
    const doc = adsDocument(drafts, { google: 'marketing/ads/christmas.tsv' })
    expect(doc).toContain('**Nothing is running and nothing was sent to an ad account.**')
    expect(doc).toContain('Account > Import > From file')
    expect(doc).toContain('Fresh bread in Cluj _(19/30)_')
    expect(doc).toContain('Start small.')
    expect(doc).toContain('**Button:** Order now')
  })
})

/** The boxes inside a box, as names with their bodies. */
function boxes(data: Buffer): { type: string; body: Buffer }[] {
  const found: { type: string; body: Buffer }[] = []
  for (let at = 0; at + 8 <= data.length;) {
    const size = data.readUInt32BE(at)
    found.push({
      type: data.toString('latin1', at + 4, at + 8),
      body: data.subarray(at + 8, at + size)
    })
    at += size
  }
  return found
}
function find(data: Buffer, ...path: string[]): Buffer {
  let current = data
  for (const type of path) {
    const next = boxes(current).find((b) => b.type === type)
    if (!next) throw new Error(`no ${type}`)
    current = next.body
  }
  return current
}

describe('the MP4 writer', () => {
  const frame = (n: number, key = false): { data: Uint8Array; key: boolean } => ({
    data: new Uint8Array(100 + n).fill(n),
    key
  })
  const video = {
    width: 1920,
    height: 1080,
    fps: 30,
    description: new Uint8Array([1, 100, 0, 40, 255, 225, 0, 0]),
    samples: Array.from({ length: 75 }, (_, i) => frame(i, i % 60 === 0))
  }
  const audio = {
    sampleRate: 48_000,
    channels: 2,
    description: new Uint8Array([0x11, 0x90]),
    samples: Array.from({ length: 118 }, (_, i) => ({
      data: new Uint8Array(50).fill(200 + (i % 50))
    }))
  }

  it('writes the index first, then every sample where the index says', () => {
    const file = writeMp4(video, audio)
    const top = boxes(file)
    expect(top.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat'])
    expect(top.reduce((sum, b) => sum + b.body.length + 8, 0)).toBe(file.length)
    const traks = boxes(find(file, 'moov')).filter((b) => b.type === 'trak')
    expect(traks).toHaveLength(2)

    const stbl = find(traks[0].body, 'mdia', 'minf', 'stbl')
    // 75 frames of 1/30 s: 2.5 seconds.
    const mdhd = find(traks[0].body, 'mdia', 'mdhd')
    expect(mdhd.readUInt32BE(16) / mdhd.readUInt32BE(12)).toBe(2.5)
    const stss = find(stbl, 'stss')
    expect([stss.readUInt32BE(4), stss.readUInt32BE(8), stss.readUInt32BE(12)]).toEqual([2, 1, 61])
    const stsz = find(stbl, 'stsz')
    expect(stsz.readUInt32BE(8)).toBe(75)
    // The first sample of each video chunk sits where its offset points.
    const stco = find(stbl, 'stco')
    expect(stco.readUInt32BE(4)).toBe(3)
    for (const [chunk, first] of [0, 30, 60].entries()) {
      const offset = stco.readUInt32BE(8 + chunk * 4)
      expect(file[offset]).toBe(first)
      expect(file.subarray(offset, offset + 100 + first)).toEqual(
        Buffer.from(video.samples[first].data)
      )
    }
    // The last chunk is shorter, and the index says so.
    const stsc = find(stbl, 'stsc')
    expect(stsc.readUInt32BE(4)).toBe(2)
    expect([stsc.readUInt32BE(8), stsc.readUInt32BE(12)]).toEqual([1, 30])
    expect([stsc.readUInt32BE(20), stsc.readUInt32BE(24)]).toEqual([3, 15])
    const avc1 = find(stbl, 'stsd').subarray(8)
    expect(avc1.toString('latin1', 4, 8)).toBe('avc1')
    expect([avc1.readUInt16BE(32), avc1.readUInt16BE(34)]).toEqual([1920, 1080])

    const sound = find(traks[1].body, 'mdia', 'minf', 'stbl')
    const mp4a = find(sound, 'stsd').subarray(8)
    expect(mp4a.toString('latin1', 4, 8)).toBe('mp4a')
    expect(mp4a.readUInt16BE(24)).toBe(2)
    expect(mp4a.readUInt32BE(32) >>> 16).toBe(48_000)
    const soundOffsets = find(sound, 'stco')
    expect(file[soundOffsets.readUInt32BE(8)]).toBe(200)
    expect(find(traks[1].body, 'mdia', 'hdlr').toString('latin1', 8, 12)).toBe('soun')
  })

  it('writes a silent video, and refuses what cannot play', () => {
    const silent = writeMp4(video)
    expect(boxes(find(silent, 'moov')).filter((b) => b.type === 'trak')).toHaveLength(1)
    expect(() => writeMp4({ ...video, samples: [] })).toThrow(/no frames/)
    expect(() => writeMp4({ ...video, samples: [frame(1)] })).toThrow(/key frame/)
    expect(() => writeMp4({ ...video, description: new Uint8Array(2) })).toThrow(/settings/)
  })
})

describe('marketing in the app', () => {
  it('gives the marketing tools to the marketing agents only', () => {
    const tool = (name: string): (typeof builtInTools)[number] =>
      builtInTools.find((t) => t.name === name)!
    const agent = (name: string): (typeof BUILT_IN_AGENTS)[number] =>
      BUILT_IN_AGENTS.find((a) => a.name === name)!
    for (const name of ['Marketing agent', 'Video maker'])
      for (const t of ['brand_get', 'brand_from_site', 'post_save', 'promo_video'])
        expect(agentMayUse(agent(name), tool(t), { isPart: false })).toBe(true)
    expect(agentMayUse(agent('Titan'), tool('promo_video'), { isPart: false })).toBe(true)
    for (const name of ['Researcher', 'QA tester', 'Recorder'])
      expect(agentMayUse(agent(name), tool('post_save'), { isPart: false })).toBe(false)
    // The Video maker has no shell, browser or code tools.
    expect(agentMayUse(agent('Video maker'), tool('run_command'), { isPart: false })).toBe(false)
  })

  it('serves the Marketing screen: brand kit, posts, statuses and exports', async () => {
    const folder = tempFolder()
    // Files outside the allowed folder, as a real absolute path on every system.
    const outside = tempFolder()
    writeFileSync(join(outside, 'logo.png'), 'not a logo')
    writeFileSync(join(outside, 'secret.ini'), 'secret')
    const engine = await testEngine({ folder })
    try {
      const empty = await call(engine, 'GET', '/v1/marketing')
      expect(empty.status).toBe(200)
      expect(empty.body.posts).toEqual([])
      expect(empty.body.platforms.map((p: { id: string }) => p.id)).toContain('tiktok')

      const brand = await call(engine, 'POST', '/v1/marketing/brand', {
        brand: { name: 'Northwind', primary: '#0f766e', website: 'northwind.example' }
      })
      expect(brand.body.brand).toMatchObject({ name: 'Northwind', primary: '#0f766e' })
      // A logo outside the allowed folders is refused.
      const logo = await call(engine, 'POST', '/v1/marketing/brand', {
        brand: { logo: join(outside, 'logo.png') }
      })
      expect(logo.status).toBe(400)
      // The Apps screen's look keeps what marketing knows.
      await call(engine, 'PUT', '/v1/apps/brand', { primary: '#112233', accent: '#445566' })
      const after = await call(engine, 'GET', '/v1/marketing')
      expect(after.body.brand).toMatchObject({ name: 'Northwind', primary: '#112233' })

      const saved = await call(engine, 'POST', '/v1/marketing/post', {
        post: { platform: 'x', date: '2020-01-02', time: '09:00', text: 'Hello', status: 'ready' }
      })
      expect(saved.status).toBe(200)
      const [post] = saved.body.posts
      expect(post.composeUrl).toContain('https://x.com/intent/post')
      expect(post.chars).toBe(5)
      // Its day is long past: due on the screen.
      expect(saved.body.due).toEqual([post.id])
      const bad = await call(engine, 'POST', '/v1/marketing/post', {
        post: { platform: 'x', date: '2020-01-02', text: 'x'.repeat(300) }
      })
      expect(bad.status).toBe(400)
      expect(bad.body.message).toMatch(/280/)

      const files = await call(engine, 'POST', '/v1/marketing/export', { month: '2020-01' })
      expect(files.body.ics.name).toBe('content-calendar-2020-01.ics')
      expect(Buffer.from(files.body.csv.base64, 'base64').toString()).toContain('Hello')

      const posted = await call(engine, 'POST', '/v1/marketing/post-status', {
        id: post.id,
        status: 'posted'
      })
      expect(posted.body.posts[0].status).toBe('posted')
      expect(posted.body.due).toEqual([])
      expect(
        (await call(engine, 'POST', '/v1/marketing/post-status', { id: post.id, status: 'sent' }))
          .status
      ).toBe(400)
      // Media is read only from inside the allowed folders.
      expect(
        (await call(engine, 'POST', '/v1/marketing/media', { path: join(outside, 'secret.ini') }))
          .status
      ).toBe(400)
      const removed = await call(engine, 'POST', '/v1/marketing/post-remove', { id: post.id })
      expect(removed.body.posts).toEqual([])
    } finally {
      await engine.close()
    }
  })

  it('lays a month out in weeks from Monday', () => {
    // December 2026 starts on a Tuesday.
    const weeks = monthGrid(2026, 11)
    expect(weeks[0]).toEqual([
      null,
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06'
    ])
    expect(weeks.flat().filter(Boolean)).toHaveLength(31)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    // February 2027 starts on a Monday and fills four weeks exactly.
    expect(monthGrid(2027, 1)).toHaveLength(4)
  })
})
