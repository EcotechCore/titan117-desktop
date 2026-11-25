// Phase 14, newsletters and sequences (15.5, 15.6; decisions §63): lists with
// consent, the email itself, the user's own provider (Brevo and Postmark,
// against fakes that answer as their API references say), the rules every
// send follows, and sequences that only mail new subscribers.
import { describe, expect, it } from 'vitest'

import { openDb } from '../src/engine/lib/db'
import {
  cleanEmail,
  cleanMailSettings,
  createMailStore,
  dnsChecks,
  parseSubscribers,
  renderEmail,
  settingsProblems
} from '../src/engine/lib/marketing/mail'
import { createMailer } from '../src/engine/lib/marketing/mailer'
import { brevo, postmark } from '../src/engine/lib/marketing/mail-providers'
import { builtInTools } from '../src/engine/tools'
import { BUILT_IN_AGENTS, agentMayUse } from '../src/engine/lib/agents'

const DAY = 86_400_000
const KEY = ['test', 'mail', 'key', '0000000000000000000000'].join('-')

const SETTINGS = {
  provider: 'postmark',
  fromName: 'Brutăria Ana',
  fromEmail: 'news@bakery.example',
  replyTo: 'ana@bakery.example',
  address: 'Strada Memorandumului 12, Cluj',
  postmarkStream: 'news'
}

interface Seen {
  method: string
  url: string
  body: unknown
  headers: Record<string, string>
}

/** A fake Postmark: one server, one broadcast stream, a suppression list. */
function fakePostmark(
  options: { stream?: boolean; handling?: string; refuse?: string[]; suppressed?: string[] } = {}
): {
  fetch: typeof fetch
  seen: Seen[]
} {
  const seen: Seen[] = []
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    seen.push({ method: init?.method ?? 'GET', url: url.toString(), body, headers })
    if (headers['X-Postmark-Server-Token'] !== KEY)
      return Response.json({ ErrorCode: 10 }, { status: 401 })
    if (url.pathname === '/server') return Response.json({ ID: 1, Name: 'Bakery' })
    if (url.pathname === '/message-streams')
      return Response.json({
        MessageStreams:
          options.stream === false
            ? []
            : [
                {
                  ID: 'news',
                  MessageStreamType: 'Broadcasts',
                  SubscriptionManagementConfiguration: {
                    UnsubscribeHandlingType: options.handling ?? 'Postmark'
                  }
                }
              ]
      })
    if (url.pathname === '/message-streams/news/suppressions/dump')
      return Response.json({
        Suppressions: (options.suppressed ?? []).map((e) => ({
          EmailAddress: e,
          SuppressionReason: 'ManualSuppression',
          Origin: 'Recipient',
          CreatedAt: '2026-11-25T08:00:00Z'
        }))
      })
    if (url.pathname === '/email/batch')
      return Response.json(
        (body as { To: string }[]).map((m) =>
          options.refuse?.includes(m.To)
            ? { ErrorCode: 406, Message: 'Inactive recipient', To: m.To }
            : { ErrorCode: 0, Message: 'OK', MessageID: `id-${m.To}`, To: m.To }
        )
      )
    return Response.json({ Message: 'not found' }, { status: 404 })
  }) as typeof fetch
  return { fetch: fake, seen }
}

/** A fake Brevo: folders, lists, imports that complete, campaigns, senders and domains. */
function fakeBrevo(options: { blacklisted?: string[]; authenticated?: boolean } = {}): {
  fetch: typeof fetch
  seen: Seen[]
} {
  const seen: Seen[] = []
  const contacts = new Map<number, string[]>()
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    seen.push({ method: init?.method ?? 'GET', url: url.toString(), body, headers })
    if (headers['api-key'] !== KEY) return Response.json({ code: 'unauthorized' }, { status: 401 })
    const path = url.pathname.replace('/v3', '')
    if (path === '/account')
      return Response.json({ companyName: 'Bakery', email: 'ana@bakery.example' })
    if (path === '/contacts/folders' && !init?.method)
      return Response.json({ folders: [], count: 0 })
    if (path === '/contacts/folders') return Response.json({ id: 7 }, { status: 201 })
    if (path === '/contacts/lists') return Response.json({ id: 42 }, { status: 201 })
    if (path === '/contacts/import') {
      const b = body as { jsonBody: { email: string }[]; listIds: number[] }
      contacts.set(b.listIds[0], [
        ...(contacts.get(b.listIds[0]) ?? []),
        ...b.jsonBody.map((c) => c.email)
      ])
      return Response.json({ processId: 99 }, { status: 202 })
    }
    if (path === '/processes/99')
      return Response.json({ id: 99, status: 'completed', name: 'IMPORTUSER' })
    if (path === '/emailCampaigns') return Response.json({ id: 5 }, { status: 201 })
    if (path === '/emailCampaigns/5/sendNow' || path === '/emailCampaigns/5/sendTest')
      return new Response(null, { status: 204 })
    if (path === '/senders')
      return Response.json({ senders: [{ email: 'news@bakery.example', active: true }] })
    if (path === '/senders/domains')
      return Response.json({
        domains: [
          {
            domain_name: 'bakery.example',
            authenticated: options.authenticated ?? true,
            verified: true
          }
        ]
      })
    const list = /^\/contacts\/lists\/(\d+)\/contacts$/.exec(path)
    if (list)
      return Response.json({
        contacts: (contacts.get(Number(list[1])) ?? []).map((email) => ({
          email,
          emailBlacklisted: options.blacklisted?.includes(email) ?? false
        })),
        count: 0
      })
    return Response.json({ message: 'not found' }, { status: 404 })
  }) as typeof fetch
  return { fetch: fake, seen }
}

function bench(
  provider: { fetch: typeof fetch; seen: Seen[] },
  settings: Record<string, unknown> = SETTINGS,
  options: { dmarc?: boolean } = {}
): {
  mailer: ReturnType<typeof createMailer>
  setNow(at: number): void
} {
  let now = new Date('2026-11-25T09:00:00').getTime()
  const db = openDb(':memory:')
  const mailer = createMailer({
    db,
    brand: () => null,
    keys: () => ({ brevo: KEY, postmark: KEY }),
    fetch: provider.fetch,
    resolveTxt: async (name) =>
      name.startsWith('_dmarc.')
        ? options.dmarc === false
          ? []
          : [['v=DMARC1; p=none']]
        : [['v=spf1 include:spf.example ~all']],
    now: () => now,
    pollMs: 0
  })
  mailer.saveSettings(settings)
  return { mailer, setNow: (at) => (now = at) }
}

describe('lists and consent', () => {
  it('keeps only real addresses, and reads them from a CSV or a plain list', () => {
    expect(cleanEmail(' Ana@Bakery.Example ')).toBe('ana@bakery.example')
    expect(cleanEmail('ana@bakery')).toBeNull()
    expect(cleanEmail('a b@x.example')).toBeNull()
    expect(cleanEmail('"x"@x.example')).toBeNull()
    expect(
      parseSubscribers(
        '﻿Name;Email\n"Pop, Ana";ana@x.example\nRadu;not-an-email\nIoana;IOANA@x.example'
      )
    ).toEqual([
      { email: 'ana@x.example', name: 'Pop, Ana' },
      { email: 'ioana@x.example', name: 'Ioana' }
    ])
    expect(parseSubscribers('ana@x.example\nradu@x.example')).toHaveLength(2)
  })

  it('adds nobody without saying how they agreed, and never adds back someone who unsubscribed', () => {
    const store = createMailStore({ db: openDb(':memory:') })
    const list = store.saveList({ name: 'Monthly news', about: 'monthly news from the bakery' })
    expect(() =>
      store.addSubscribers(list.id, [{ email: 'ana@x.example' }], { how: 'ok' })
    ).toThrow(/how these people agreed/)
    const first = store.addSubscribers(
      list.id,
      [
        { email: 'ana@x.example' },
        { email: 'ANA@x.example' },
        { email: 'nope' },
        { email: 'radu@x.example' }
      ],
      { how: 'Signed up through the form on our site' }
    )
    expect(first).toEqual({ added: 2, already: 0, unsubscribed: 0, invalid: 1 })
    expect(store.subscribers(list.id)[0].consent).toBe('Signed up through the form on our site')
    // Unsubscribed (here, by the user's click): a later import can't bring them back.
    store.removeSubscriber(store.subscribers(list.id)[0].id)
    const again = store.addSubscribers(
      list.id,
      [{ email: 'ana@x.example' }, { email: 'radu@x.example' }],
      {
        how: 'Signed up through the form on our site'
      }
    )
    expect(again).toEqual({ added: 0, already: 1, unsubscribed: 1, invalid: 0 })
    expect(store.list(list.id)).toMatchObject({ subscribed: 1, unsubscribed: 1 })
    // What a provider reports applies on every list.
    const other = store.saveList({ name: 'Offers' })
    store.addSubscribers(other.id, [{ email: 'radu@x.example' }], {
      how: 'Ticked the box when ordering'
    })
    expect(store.suppress(['RADU@x.example'], 'bounced')).toBe(2)
    expect(store.list(other.id)?.subscribed).toBe(0)
  })

  it('says what is missing before anything can be sent', () => {
    expect(settingsProblems(cleanMailSettings({}), false)).toHaveLength(4)
    const free = cleanMailSettings({ ...SETTINGS, fromEmail: 'ana@gmail.com' })
    expect(settingsProblems(free, true).join(' ')).toMatch(/free mailbox/)
    expect(settingsProblems(cleanMailSettings(SETTINGS), true)).toEqual([])
    expect(settingsProblems(cleanMailSettings({ ...SETTINGS, postmarkStream: '' }), true)).toEqual([
      'Name your Postmark broadcast stream.'
    ])
    // A name can't break the From header.
    expect(cleanMailSettings({ fromName: 'Ana <x@evil.example>' }).fromName).not.toMatch(/[<>"]/)
  })
})

describe('the email', () => {
  const base = {
    subject: 'December news',
    preheader: 'Christmas orders are open',
    brand: { name: 'Brutăria Ana', primary: '#b45309', website: 'https://bakery.example/' },
    settings: { fromName: 'Brutăria Ana', address: 'Strada Memorandumului 12, Cluj' },
    listAbout: 'monthly news from the bakery',
    unsubscribe: '{{{ pm:unsubscribe }}}'
  }

  it('renders Markdown in the brand with a footer that says who, why and how to stop', () => {
    const { html, text } = renderEmail({
      ...base,
      body: '# Christmas orders\n\nOrder **before 22 December**.\n\n[Order now](https://bakery.example/order){button}'
    })
    expect(html).toContain('Christmas orders</h1>')
    expect(html).toContain('<strong>before 22 December</strong>')
    expect(html).toContain('background:#b45309')
    expect(html).toContain('>Order now</a>')
    expect(html).toContain('Strada Memorandumului 12, Cluj')
    expect(html).toContain('signed up for monthly news from the bakery')
    expect(html).toContain('href="{{{ pm:unsubscribe }}}"')
    expect(html).toContain('Christmas orders are open')
    expect(text).toContain('Order now: https://bakery.example/order')
    expect(text).toContain('Unsubscribe: {{{ pm:unsubscribe }}}')
  })

  it('shows raw HTML and unsafe links as text, never as code', () => {
    const { html } = renderEmail({
      ...base,
      body: '<script>alert(1)</script>\n\n[click](javascript:alert(1)) ![x](http://tracker.example/p.gif)'
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('http://tracker.example')
  })

  it('reads SPF and DMARC from DNS, as Gmail and Yahoo ask', async () => {
    const ok = await dnsChecks('news@bakery.example', async (name) =>
      name.startsWith('_dmarc') ? [['v=DMARC1; p=quarantine']] : [['v=spf1 -all']]
    )
    expect(ok.every((c) => c.ok)).toBe(true)
    expect(ok[1].detail).toContain('quarantine')
    const none = await dnsChecks('news@bakery.example', async () => {
      throw Object.assign(new Error('none'), { code: 'ENODATA' })
    })
    expect(none.map((c) => c.ok)).toEqual([false, false])
    expect(none[1].detail).toContain('v=DMARC1; p=none')
    // DNS checks warn; they never block a send on their own.
    expect(none.every((c) => !c.blocks)).toBe(true)
  })
})

describe('the user’s own provider', () => {
  it('Postmark: checks the broadcast stream, sends 500 at a time, reads suppressions back', async () => {
    const pm = fakePostmark({ refuse: ['bad@x.example'], suppressed: ['gone@x.example'] })
    const p = postmark({ key: KEY, fetch: pm.fetch })
    expect(await p.account()).toBe('Bakery')
    const checks = await p.checks(cleanMailSettings(SETTINGS))
    expect(checks.every((c) => c.ok)).toBe(true)
    const recipients = Array.from({ length: 1001 }, (_, i) => ({
      email: `p${i}@x.example`,
      name: ''
    }))
    recipients.push({ email: 'bad@x.example', name: '' })
    const result = await p.send(
      {
        name: 'n',
        subject: 'Hi',
        preheader: '',
        html: '<p>Hi</p>',
        text: 'Hi',
        recipients,
        test: false
      },
      cleanMailSettings(SETTINGS)
    )
    const batches = pm.seen.filter((s) => s.url.endsWith('/email/batch'))
    expect(batches.map((b) => (b.body as unknown[]).length)).toEqual([500, 500, 2])
    const first = (batches[0].body as Record<string, unknown>[])[0]
    expect(first).toMatchObject({
      From: '"Brutăria Ana" <news@bakery.example>',
      MessageStream: 'news',
      ReplyTo: 'ana@bakery.example'
    })
    // One person per message: nobody sees anyone else's address.
    expect(first.To).toBe('p0@x.example')
    expect(result).toEqual({ ref: 'news', accepted: 1001, refused: ['bad@x.example'] })
    expect(await p.suppressed('news', cleanMailSettings(SETTINGS))).toEqual([
      { email: 'gone@x.example', kind: 'unsubscribed' }
    ])
  })

  it('Postmark: a stream that isn’t there, or doesn’t run the unsubscribe link, blocks', async () => {
    const none = await postmark({ key: KEY, fetch: fakePostmark({ stream: false }).fetch }).checks(
      cleanMailSettings(SETTINGS)
    )
    expect(none[0]).toMatchObject({ ok: false, blocks: true })
    const custom = await postmark({
      key: KEY,
      fetch: fakePostmark({ handling: 'None' }).fetch
    }).checks(cleanMailSettings(SETTINGS))
    expect(custom[1]).toMatchObject({ ok: false, blocks: true })
    await expect(
      postmark({ key: 'wrong-key-000000000000', fetch: fakePostmark().fetch }).account()
    ).rejects.toThrow(/didn’t accept the API key/)
  })

  it('Brevo: a list in the user’s account, an import, a campaign, and blacklisted contacts read back', async () => {
    const bv = fakeBrevo({ blacklisted: ['gone@x.example'] })
    const p = brevo({ key: KEY, fetch: bv.fetch, pollMs: 0 })
    const settings = cleanMailSettings({ ...SETTINGS, provider: 'brevo' })
    expect((await p.checks(settings)).every((c) => c.ok)).toBe(true)
    const result = await p.send(
      {
        name: 'Monthly news: December',
        subject: 'December news',
        preheader: 'Orders are open',
        html: '<p>Hi</p>',
        text: 'Hi',
        recipients: [
          { email: 'ana@x.example', name: '' },
          { email: 'gone@x.example', name: '' }
        ],
        test: false
      },
      settings
    )
    expect(result.ref).toBe('42:5')
    const paths = bv.seen
      .filter((s) => !/\/senders/.test(s.url))
      .map((s) => `${s.method} ${new URL(s.url).pathname}`)
    expect(paths).toEqual([
      'GET /v3/contacts/folders',
      'POST /v3/contacts/folders',
      'POST /v3/contacts/lists',
      'POST /v3/contacts/import',
      'GET /v3/processes/99',
      'POST /v3/emailCampaigns',
      'POST /v3/emailCampaigns/5/sendNow'
    ])
    const imported = bv.seen.find((s) => s.url.endsWith('/contacts/import'))!.body as Record<
      string,
      unknown
    >
    // Never un-blacklists someone who unsubscribed in Brevo.
    expect(imported.emailBlacklist).toBe(false)
    const campaign = bv.seen.find((s) => s.url.endsWith('/emailCampaigns'))!.body as Record<
      string,
      unknown
    >
    expect(campaign).toMatchObject({
      recipients: { listIds: [42] },
      previewText: 'Orders are open',
      replyTo: 'ana@bakery.example'
    })
    expect(await p.suppressed('42:5', settings)).toEqual([
      { email: 'gone@x.example', kind: 'unsubscribed' }
    ])
    expect(
      await brevo({ key: KEY, fetch: fakeBrevo({ authenticated: false }).fetch }).checks(settings)
    ).toContainEqual(expect.objectContaining({ name: 'Domain (DKIM)', ok: false, blocks: true }))
  })
})

describe('sending', () => {
  function withNewsletter(b: ReturnType<typeof bench>): string {
    const list = b.mailer.store.saveList({
      name: 'Monthly news',
      about: 'monthly news from the bakery'
    })
    b.mailer.store.addSubscribers(
      list.id,
      [{ email: 'ana@x.example' }, { email: 'radu@x.example' }, { email: 'gone@x.example' }],
      { how: 'Signed up through the form on our site' }
    )
    return b.mailer.store.saveNewsletter(
      { list: list.id, subject: 'December news', body: 'Orders are open.' },
      'Marketing agent'
    ).id
  }

  it('needs a test first, reads unsubscribes back, and sends only to who is still subscribed', async () => {
    const pm = fakePostmark({ suppressed: ['gone@x.example'] })
    const b = bench(pm)
    const id = withNewsletter(b)
    await expect(b.mailer.send(id)).rejects.toThrow(/test to yourself first/)
    expect(pm.seen.some((s) => s.url.endsWith('/email/batch'))).toBe(false)
    expect(await b.mailer.test(id)).toEqual({ to: 'ana@bakery.example' })
    const test = pm.seen.filter((s) => s.url.endsWith('/email/batch'))
    expect(
      (test[0].body as { To: string; Subject: string }[]).map((m) => [m.To, m.Subject])
    ).toEqual([['ana@bakery.example', '[Test] December news']])
    const result = await b.mailer.send(id)
    expect(result).toEqual({ sentTo: 2, refused: 0, list: 'Monthly news' })
    const sent = pm.seen.filter((s) => s.url.endsWith('/email/batch'))[1].body as {
      To: string
      HtmlBody: string
    }[]
    expect(sent.map((m) => m.To).sort()).toEqual(['ana@x.example', 'radu@x.example'])
    expect(sent[0].HtmlBody).toContain('{{{ pm:unsubscribe }}}')
    expect(b.mailer.store.newsletter(id)).toMatchObject({ status: 'sent', sentTo: 2 })
    // Sent once; never again.
    await expect(b.mailer.send(id)).rejects.toThrow(/already sent/)
    // A sent newsletter can't be edited.
    expect(() => b.mailer.store.saveNewsletter({ id, body: 'x' }, 'you')).toThrow(/was sent/)
  })

  it('sends nothing when the set-up is incomplete or the provider says the sender isn’t ready', async () => {
    const pm = fakePostmark({ handling: 'None' })
    const b = bench(pm)
    const id = withNewsletter(b)
    b.mailer.store.markNewsletter(id, { testedAt: Date.now() })
    await expect(b.mailer.send(id)).rejects.toThrow(/unsubscribe handling/)
    expect(pm.seen.some((s) => s.url.endsWith('/email/batch'))).toBe(false)
    const incomplete = bench(fakePostmark(), { ...SETTINGS, address: '' })
    const other = withNewsletter(incomplete)
    await expect(incomplete.mailer.test(other)).rejects.toThrow(/postal address/)
  })

  it('a sequence mails only people who join after it, one email at a time, each once', async () => {
    const pm = fakePostmark()
    const b = bench(pm)
    const start = new Date('2026-11-25T09:00:00').getTime()
    const list = b.mailer.store.saveList({ name: 'Monthly news' })
    b.mailer.store.addSubscribers(list.id, [{ email: 'old@x.example' }], {
      how: 'Signed up before the welcome emails'
    })
    b.setNow(start + 1000)
    b.mailer.store.saveSequence(
      {
        name: 'Welcome',
        list: list.id,
        steps: [
          { day: 3, subject: 'A tip', body: 'Keep sourdough in linen.' },
          { day: 0, subject: 'Welcome', body: 'Thanks for joining.' }
        ]
      },
      'Marketing agent'
    )
    b.setNow(start + 2000)
    b.mailer.store.addSubscribers(list.id, [{ email: 'new@x.example' }], {
      how: 'Signed up through the form on our site'
    })
    const batches = (): { To: string; Subject: string }[][] =>
      pm.seen
        .filter((s) => s.url.endsWith('/email/batch'))
        .map((s) => s.body as { To: string; Subject: string }[])
    await b.mailer.runSequences(true)
    expect(batches().map((m) => m.map((x) => [x.To, x.Subject]))).toEqual([
      [['new@x.example', 'Welcome']]
    ])
    // Nothing more is due until day 3.
    await b.mailer.runSequences(true)
    expect(batches()).toHaveLength(1)
    b.setNow(start + 3 * DAY + 5000)
    await b.mailer.runSequences(true)
    expect(batches()[1].map((x) => x.Subject)).toEqual(['A tip'])
    await b.mailer.runSequences(true)
    expect(batches()).toHaveLength(2)
    expect(b.mailer.store.sequence('Welcome')?.lastNote).toMatch(/Sent email 2/)
    // Paused: nothing goes out.
    b.mailer.store.addSubscribers(list.id, [{ email: 'later@x.example' }], {
      how: 'Signed up through the form on our site'
    })
    b.mailer.store.setSequence(b.mailer.store.sequence('Welcome')!.id, false)
    await b.mailer.runSequences(true)
    expect(batches()).toHaveLength(2)
  })

  it('a sequence says once why it couldn’t send, and sends nothing', async () => {
    const notes: string[] = []
    const pm = fakePostmark({ stream: false })
    let now = new Date('2026-11-25T09:00:00').getTime()
    const mailer = createMailer({
      db: openDb(':memory:'),
      brand: () => null,
      keys: () => ({ postmark: KEY }),
      fetch: pm.fetch,
      resolveTxt: async () => [],
      now: () => now,
      onSequence: (_q, note, failed) => failed && notes.push(note)
    })
    mailer.saveSettings(SETTINGS)
    const list = mailer.store.saveList({ name: 'News' })
    mailer.store.saveSequence(
      { name: 'Welcome', list: list.id, steps: [{ day: 0, subject: 'Hi', body: 'Hi' }] },
      'you'
    )
    now += 1000
    mailer.store.addSubscribers(list.id, [{ email: 'new@x.example' }], {
      how: 'Signed up through the form on our site'
    })
    await mailer.runSequences(true)
    await mailer.runSequences(true)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/broadcast stream/)
    expect(pm.seen.some((s) => s.url.endsWith('/email/batch'))).toBe(false)
  })
})

describe('the tools', () => {
  it('give the mail tools to the Marketing agent, and make the risky ones ask on the laptop', () => {
    const tool = (name: string): (typeof builtInTools)[number] =>
      builtInTools.find((t) => t.name === name)!
    const marketing = BUILT_IN_AGENTS.find((a) => a.name === 'Marketing agent')!
    for (const name of ['mail_state', 'subscribers_add', 'newsletter_send', 'sequence_save'])
      expect(agentMayUse(marketing, tool(name), { isPart: false })).toBe(true)
    const writer = BUILT_IN_AGENTS.find((a) => a.name === 'Writer')!
    expect(agentMayUse(writer, tool('newsletter_send'), { isPart: false })).toBe(false)
    expect(tool('newsletter_send')).toMatchObject({ risk: 'external', laptopOnly: true })
    expect(tool('sequence_save').laptopOnly).toBe(true)
    expect(
      tool('newsletter_send').assess!({ id: 'x' }, { folders: [], untrustedSeen: false }).alwaysAsks
    ).toBe(true)
    expect(
      tool('sequence_save').assess!(
        { name: 'W', list: 'L', steps: [{ day: 0 }] },
        { folders: [], untrustedSeen: false }
      ).alwaysAsks
    ).toBe(true)
  })
})
