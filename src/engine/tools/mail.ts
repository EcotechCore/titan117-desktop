/**
 * Newsletter and sequence tools (features 15.5, 15.6; decisions §63). Mail
 * goes out only through the user's own email provider, only to people who
 * agreed, and only after the user says yes:
 *
 *   - adding people asks, and says how they agreed (no consent, no add);
 *   - a test to the user's own address asks;
 *   - sending a newsletter asks every time, on the laptop only, and needs a
 *     test first; it can't be taken back;
 *   - a sequence is a standing instruction: making one asks every time, on
 *     the laptop only, and it mails only people who join after it was made.
 *
 * The text leaves the laptop to the provider, so it is checked for private
 * content before anyone is asked (security.md A3).
 */
import { parseSubscribers } from '../lib/marketing/mail'
import { PermissionError } from '../lib/folders'
import { defineTool } from './lib/define-tool'

export const mailState = defineTool<Record<string, never>>({
  name: 'mail_state',
  description:
    'Read the newsletter setup: the email provider, the sender, what is missing before anything can be sent, the subscriber lists (with how many are subscribed), the newsletters (drafts and sent, with their ids) and the email sequences.',
  params: { type: 'object', properties: {}, required: [] },
  risk: 'read',
  permissions: { marketing: 'read' },
  describe: () => 'Read the newsletter setup',
  async run(_input, ctx) {
    const s = ctx.marketing.mail.state()
    const lines = [
      `Provider: ${s.settings.provider ?? 'none chosen'}${s.settings.provider && !s.hasKey ? ' (no API key yet)' : ''}; from: ${s.settings.fromName || '?'} <${s.settings.fromEmail || '?'}>`,
      s.problems.length
        ? `Not ready to send: ${s.problems.join(' ')} The user sets this up under Marketing → Newsletters.`
        : 'Ready to send.',
      '',
      'Lists:',
      ...(s.lists.length
        ? s.lists.map(
            (l) =>
              `- "${l.name}" (${l.about || 'no description'}): ${l.subscribed} subscribed, ${l.unsubscribed} unsubscribed or bounced`
          )
        : ['- none yet']),
      '',
      'Newsletters:',
      ...(s.newsletters.length
        ? s.newsletters
            .slice(0, 30)
            .map(
              (n) =>
                `- [${n.id}] "${n.subject}" to ${s.lists.find((l) => l.id === n.listId)?.name ?? '?'}: ${n.status}${n.status === 'sent' ? ` to ${n.sentTo}` : n.testedAt ? ', tested' : ', not tested yet'}${n.note ? ` (${n.note})` : ''}`
            )
        : ['- none yet']),
      '',
      'Sequences:',
      ...(s.sequences.length
        ? s.sequences.map(
            (q) =>
              `- "${q.name}" for ${s.lists.find((l) => l.id === q.listId)?.name ?? '?'}: ${q.steps.length} email(s) on days ${q.steps.map((x) => x.day).join(', ')}; ${q.enabled ? 'on' : 'paused'}${q.lastNote ? `; last: ${q.lastNote}` : ''}`
          )
        : ['- none yet'])
    ]
    return {
      output: lines.join('\n'),
      summary: `Read the newsletter setup: ${s.lists.length} list(s)`
    }
  }
})

export const mailListSave = defineTool<{ name: string; about?: string }>({
  name: 'mail_list_save',
  description:
    'Make a subscriber list (or change its description). "about" says what people signed up for ("monthly news and offers from Brutăria Ana"); it is shown in every email’s footer.',
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The list’s name, e.g. "Monthly news"' },
      about: { type: 'string', description: 'What people on it signed up for' }
    },
    required: ['name']
  },
  risk: 'write',
  permissions: { marketing: 'write' },
  describe: (input) => `Make the subscriber list "${String(input.name ?? '').slice(0, 80)}"`,
  async run(input, ctx) {
    const list = ctx.marketing.mail.saveList(input)
    return {
      output: `The list "${list.name}" has ${list.subscribed} subscriber(s).`,
      summary: `Saved the list ${list.name}`
    }
  }
})

interface AddInput {
  list: string
  people?: unknown[]
  file?: string
  consent: string
}

export const subscribersAdd = defineTool<AddInput>({
  name: 'subscribers_add',
  description:
    'Add people who agreed to get a list’s emails: "people" as [{"email","name"}], or "file", a CSV or text file in the allowed folders with an email column. "consent" says how they agreed, in plain words ("signed up through the form on our site", "ticked the box on the order form in 2026"). Never add people who didn’t agree: bought lists, scraped addresses or business cards are not consent (GDPR). Someone who unsubscribed is never added back.',
  params: {
    type: 'object',
    properties: {
      list: { type: 'string', description: 'The list’s name' },
      people: { type: 'array', description: '[{"email","name"}]' },
      file: {
        type: 'string',
        description: 'A CSV or text file of addresses, in the allowed folders'
      },
      consent: { type: 'string', description: 'How these people agreed to get this list’s emails' }
    },
    required: ['list', 'consent']
  },
  risk: 'write',
  permissions: { marketing: 'write', folders: 'read' },
  privateOutput: true,
  describe: (input) => `Add subscribers to "${String(input.list ?? '').slice(0, 80)}"`,
  assess(input) {
    const how = String(input.consent ?? '').trim()
    if (how.length < 10)
      return {
        risk: 'write',
        summary: 'Add subscribers',
        refuse:
          'Say how these people agreed to get this list’s emails (for example "signed up through the form on our site"). Nobody is added without it.'
      }
    const count = Array.isArray(input.people) ? input.people.length : 0
    return {
      risk: 'write',
      summary: `Add ${input.file ? `the addresses in ${String(input.file).slice(0, 120)}` : `${count} person(s)`} to the list "${String(input.list).slice(0, 80)}". How they agreed: "${how.slice(0, 200)}". Only add people who really agreed.`
    }
  },
  async run(input, ctx) {
    let people = (Array.isArray(input.people) ? input.people : []) as {
      email: unknown
      name?: unknown
    }[]
    if (input.file) {
      const { text } = await ctx.files.read(input.file, 5_000_000)
      people = [...people, ...parseSubscribers(text)]
    }
    if (!people.length) throw new PermissionError('No email addresses were given.')
    const r = ctx.marketing.mail.addSubscribers(input.list, people, input.consent)
    return {
      output: `Added ${r.added}. Already on the list: ${r.already}. Unsubscribed earlier, so not added back: ${r.unsubscribed}. Not valid addresses: ${r.invalid}.`,
      summary: `Added ${r.added} subscriber(s) to ${input.list}`
    }
  }
})

interface NewsletterInput {
  id?: string
  list?: string
  subject?: string
  preheader?: string
  body?: string
}

export const newsletterSave = defineTool<NewsletterInput>({
  name: 'newsletter_save',
  description:
    'Write or change a newsletter draft for a list (give "id" to change one). "body" is Markdown: headings, paragraphs, lists, links, pictures by https address. A link on its own line written as [Order now](https://…){button} becomes the button. Keep one main message and one call to action; use the brand kit’s tone. Our footer (who sent it, the postal address, why they get it and the unsubscribe link) is added by itself: don’t write one.',
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'An existing draft’s id, to change it' },
      list: { type: 'string', description: 'The list it goes to' },
      subject: { type: 'string', description: 'The subject line (under 60 characters reads best)' },
      preheader: { type: 'string', description: 'The line shown after the subject in the inbox' },
      body: { type: 'string', description: 'The text, in Markdown' }
    },
    required: []
  },
  risk: 'write',
  permissions: { marketing: 'write' },
  describe: (input) => `Save the newsletter "${String(input.subject ?? '').slice(0, 80)}"`,
  assess(input) {
    return {
      risk: 'write',
      summary: `Save the newsletter draft "${String(input.subject ?? '').slice(0, 100)}"`,
      // It will leave the laptop when sent: private content is caught now, before it's even saved.
      outgoing: `${String(input.subject ?? '')}
${String(input.preheader ?? '')}
${String(input.body ?? '')}`
    }
  },
  async run(input, ctx) {
    const letter = ctx.marketing.mail.saveNewsletter({ ...input })
    return {
      output: `Saved the draft [${letter.id}] "${letter.subject}". The user can look at it under Marketing → Newsletters. Before it is sent, newsletter_test sends it to the user’s own address.`,
      summary: `Saved the newsletter ${letter.subject}`
    }
  }
})

export const newsletterTest = defineTool<{ id: string }>({
  name: 'newsletter_test',
  description:
    'Send a newsletter draft to the user’s own address only (the reply-to or sender address), through their email provider, so they can see it in their inbox before it goes to the list.',
  params: {
    type: 'object',
    properties: { id: { type: 'string', description: 'The newsletter’s id' } },
    required: ['id']
  },
  risk: 'write',
  permissions: { marketing: 'write' },
  describe: () => 'Send a test of the newsletter to your own address',
  assess(input) {
    return {
      risk: 'write',
      summary: `Send a test of the newsletter [${String(input.id ?? '').slice(0, 40)}] to your own address, through your email provider.`
    }
  },
  async run(input, ctx) {
    const { to } = await ctx.marketing.mail.test(String(input.id))
    return {
      output: `Sent a test to ${to}. Ask the user to look at it in their inbox (and on their phone) before sending it to the list.`,
      summary: `Sent a test newsletter to ${to}`
    }
  }
})

export const newsletterSend = defineTool<{ id: string }>({
  name: 'newsletter_send',
  description:
    'Send a newsletter to everyone subscribed to its list, through the user’s own email provider. Only after a test the user looked at, and only when they asked for it to go out. It can’t be taken back. The user approves every send.',
  params: {
    type: 'object',
    properties: { id: { type: 'string', description: 'The newsletter’s id' } },
    required: ['id']
  },
  risk: 'external',
  permissions: { marketing: 'write' },
  laptopOnly: true,
  describe: () => 'Send a newsletter to its list',
  assess() {
    return {
      risk: 'external',
      alwaysAsks: true,
      summary:
        'Send the newsletter to everyone subscribed to its list, through your email provider. This can’t be taken back.'
    }
  },
  async run(input, ctx) {
    const result = await ctx.marketing.mail.send(String(input.id))
    return {
      output: `Sent to ${result.sentTo} subscriber(s) of "${result.list}"${result.refused ? `; ${result.refused} address(es) were refused by the provider and are marked as bounced` : ''}. The provider delivers it and runs the unsubscribe link.`,
      summary: `Sent the newsletter to ${result.sentTo} subscriber(s)`
    }
  }
})

export const sequenceSave = defineTool<{ name: string; list: string; steps: unknown[] }>({
  name: 'sequence_save',
  description:
    'Make an email sequence (or replace one with the same name): emails that go by themselves to each person who joins a list, on day 0, 2, 7… after they joined. "steps": [{"day","subject","preheader","body" (Markdown, as in newsletter_save)}], up to 12. It mails only people who join AFTER it is made, never the people already on the list. While Titan117 is open it sends what is due once an hour. The user approves it.',
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'E.g. "Welcome"' },
      list: { type: 'string', description: 'The list whose new subscribers get it' },
      steps: { type: 'array', description: 'The emails, each with the day after joining' }
    },
    required: ['name', 'list', 'steps']
  },
  risk: 'write',
  permissions: { marketing: 'write' },
  laptopOnly: true,
  describe: (input) => `Make the email sequence "${String(input.name ?? '').slice(0, 80)}"`,
  assess(input) {
    const steps = (Array.isArray(input.steps) ? input.steps : []) as {
      day?: unknown
      subject?: unknown
      body?: unknown
    }[]
    if (!steps.length)
      return {
        risk: 'write',
        summary: 'Make an email sequence',
        refuse: 'A sequence needs its emails.'
      }
    return {
      risk: 'write',
      // A standing instruction that sends mail by itself: every time, never "always".
      alwaysAsks: true,
      summary: `Make the email sequence "${String(input.name).slice(0, 60)}" for the list "${String(input.list).slice(0, 60)}": ${steps
        .map((s) => `day ${String(s.day)}: "${String(s.subject ?? '').slice(0, 60)}"`)
        .join(
          '; '
        )}. Each person who joins the list from now on gets these by themselves, through your email provider, while Titan117 is open.`,
      outgoing: steps.map((s) => `${String(s.subject ?? '')}\n${String(s.body ?? '')}`).join('\n')
    }
  },
  async run(input, ctx) {
    const sequence = ctx.marketing.mail.saveSequence(input)
    return {
      output: `Made "${sequence.name}": ${sequence.steps.length} email(s) on days ${sequence.steps.map((s) => s.day).join(', ')}, for people who join the list from now on. The user can pause it under Marketing → Newsletters.`,
      summary: `Made the sequence ${sequence.name}`
    }
  }
})

export const mailTools = [
  mailState,
  mailListSave,
  subscribersAdd,
  newsletterSave,
  newsletterTest,
  newsletterSend,
  sequenceSave
]
