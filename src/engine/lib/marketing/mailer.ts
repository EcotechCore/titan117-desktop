/**
 * Sending newsletters and sequences (15.5, 15.6; decisions §63). Every send
 * goes the same way: the settings must be complete, the provider must say
 * the sender is set up, who unsubscribed at the provider is read back first,
 * and only people who are still subscribed get the mail.
 *
 * A newsletter is sent when the user approves it (a tool asks every time, on
 * the laptop only; the window's Send button is the user's own click) and
 * only after a test went to their own address. A sequence is a standing
 * instruction approved once; it then mails new subscribers by itself while
 * the app is open, never people who were on the list before it was made.
 */
import { getMeta, setMeta, type Db } from '../db'
import { MarketingError, type MarketingBrand } from './brand'
import {
  cleanMailSettings,
  createMailStore,
  dnsChecks,
  renderEmail,
  settingsProblems,
  type MailList,
  type MailProviderId,
  type MailSettings,
  type MailStore,
  type Newsletter,
  type Sequence,
  type SetupCheck,
  type Subscriber
} from './mail'
import { PROVIDER_LABEL, mailProvider, type MailProvider } from './mail-providers'

/** Sequences are looked at this often while the app is open. */
export const SEQUENCE_EVERY_MS = 60 * 60_000

export interface MailState {
  settings: MailSettings
  hasKey: boolean
  problems: string[]
  lists: MailList[]
  newsletters: Newsletter[]
  sequences: Sequence[]
}

export interface Mailer {
  store: MailStore
  settings(): MailSettings
  saveSettings(input: unknown): MailSettings
  state(): MailState
  /** DNS and the provider's own view of the sender. */
  check(): Promise<{ account: string; checks: SetupCheck[] }>
  preview(newsletterId: string): { subject: string; html: string; recipients: number }
  /** Read back who unsubscribed or bounced at the provider; returns how many were marked here. */
  sync(): Promise<number>
  /** Send the newsletter to the user's own address only. */
  test(newsletterId: string, signal?: AbortSignal): Promise<{ to: string }>
  send(
    newsletterId: string,
    signal?: AbortSignal
  ): Promise<{ sentTo: number; refused: number; list: string }>
  /** Who a send would reach right now, for the approval card. */
  audience(newsletterId: string): { list: MailList; count: number; from: string; provider: string }
  /** Send what the sequences owe; at most once an hour unless forced. */
  runSequences(force?: boolean): Promise<void>
}

export function createMailer(deps: {
  db: Db
  brand: () => MarketingBrand | null
  /** The user's own provider keys, from the keychain. */
  keys: () => Partial<Record<MailProviderId, string>>
  fetch: typeof fetch
  resolveTxt: (name: string) => Promise<string[][]>
  locked?: () => string | null
  onChange?: () => void
  /** A sequence sent something, or couldn't. */
  onSequence?: (sequence: Sequence, note: string, failed: boolean) => void
  onError?: (error: unknown, context: Record<string, unknown>) => void
  now?: () => number
  pollMs?: number
}): Mailer {
  const { db } = deps
  const now = deps.now ?? Date.now
  const store = createMailStore({ db, onChange: deps.onChange, now })
  let lastSequences = 0
  let running = false

  const settings = (): MailSettings => cleanMailSettings(getMeta<unknown>(db, 'mailSettings', null))
  const hasKey = (s: MailSettings): boolean => !!(s.provider && deps.keys()[s.provider])

  function provider(s: MailSettings): MailProvider {
    const problems = settingsProblems(s, hasKey(s))
    if (problems.length) throw new MarketingError(`Newsletters aren’t set up yet. ${problems[0]}`)
    return mailProvider(s.provider!, {
      key: deps.keys()[s.provider!]!,
      fetch: deps.fetch,
      pollMs: deps.pollMs
    })
  }

  function render(
    mail: { subject: string; preheader: string; body: string },
    list: MailList,
    s: MailSettings,
    unsubscribe: string
  ): { html: string; text: string } {
    return renderEmail({
      ...mail,
      brand: deps.brand(),
      settings: s,
      listAbout: list.about || list.name,
      unsubscribe
    })
  }

  async function sync(): Promise<number> {
    const s = settings()
    const p = provider(s)
    // Brevo reports per list it was sent to; Postmark for the whole stream.
    const refs =
      s.provider === 'brevo'
        ? [
            ...new Set(store.newsletters().flatMap((n) => (n.providerRef ? [n.providerRef] : [])))
          ].slice(0, 10)
        : ['']
    let marked = 0
    for (const ref of refs) {
      const found = await p.suppressed(ref, s)
      for (const kind of ['unsubscribed', 'bounced'] as const)
        marked += store.suppress(
          found.filter((f) => f.kind === kind).map((f) => f.email),
          kind
        )
    }
    return marked
  }

  /** The provider's blocking checks must pass before anything real goes out. */
  async function ready(p: MailProvider, s: MailSettings): Promise<void> {
    const failed = (await p.checks(s)).find((c) => !c.ok && c.blocks)
    if (failed) throw new MarketingError(`Not sent. ${failed.detail}`)
  }

  function stamp(): string {
    return new Date(now()).toISOString().slice(0, 16).replace('T', ' ')
  }

  const mailer: Mailer = {
    store,
    settings,

    saveSettings(input) {
      const next = cleanMailSettings({ ...settings(), ...((input ?? {}) as object) })
      setMeta(db, 'mailSettings', next)
      deps.onChange?.()
      return next
    },

    state() {
      const s = settings()
      return {
        settings: s,
        hasKey: hasKey(s),
        problems: settingsProblems(s, hasKey(s)),
        lists: store.lists(),
        newsletters: store.newsletters(),
        sequences: store.sequences()
      }
    },

    async check() {
      const s = settings()
      const p = provider(s)
      const account = await p.account()
      const [dns, own] = await Promise.all([dnsChecks(s.fromEmail, deps.resolveTxt), p.checks(s)])
      return { account, checks: [...own, ...dns] }
    },

    preview(newsletterId) {
      const letter = store.newsletter(newsletterId)
      const list = letter ? store.list(letter.listId) : null
      if (!letter || !list) throw new MarketingError('There is no such newsletter.')
      return {
        subject: letter.subject,
        // In the preview the unsubscribe link goes nowhere.
        html: render(letter, list, settings(), '#').html,
        recipients: list.subscribed
      }
    },

    audience(newsletterId) {
      const letter = store.newsletter(newsletterId)
      const list = letter ? store.list(letter.listId) : null
      if (!letter || !list) throw new MarketingError('There is no such newsletter.')
      const s = settings()
      return {
        list,
        count: list.subscribed,
        from: s.fromEmail,
        provider: s.provider ? PROVIDER_LABEL[s.provider] : 'no provider'
      }
    },

    sync,

    async test(newsletterId, signal) {
      const letter = store.newsletter(newsletterId)
      const list = letter ? store.list(letter.listId) : null
      if (!letter || !list) throw new MarketingError('There is no such newsletter.')
      const s = settings()
      const p = provider(s)
      const to = s.replyTo || s.fromEmail
      const { html, text } = render(letter, list, s, p.unsubscribe)
      await p.send(
        {
          name: `Test: ${letter.subject.slice(0, 60)} ${stamp()}`,
          subject: `[Test] ${letter.subject}`,
          preheader: letter.preheader,
          html,
          text,
          recipients: [{ email: to, name: '' }],
          test: true
        },
        s,
        signal
      )
      store.markNewsletter(letter.id, { testedAt: now() })
      return { to }
    },

    async send(newsletterId, signal) {
      if (deps.locked?.()) throw new MarketingError('Titan117 is locked; nothing was sent.')
      const letter = store.newsletter(newsletterId)
      const list = letter ? store.list(letter.listId) : null
      if (!letter || !list) throw new MarketingError('There is no such newsletter.')
      if (letter.status === 'sent') throw new MarketingError('That newsletter was already sent.')
      if (!letter.testedAt)
        throw new MarketingError(
          'Send a test to yourself first and look at it: a newsletter can’t be taken back.'
        )
      const s = settings()
      const p = provider(s)
      await ready(p, s)
      // Whoever unsubscribed at the provider since the last send is taken off first.
      await sync().catch((error) => deps.onError?.(error, { what: 'suppressions' }))
      const people = store.subscribers(list.id, 'subscribed')
      if (!people.length) throw new MarketingError(`Nobody is subscribed to "${list.name}".`)
      const { html, text } = render(letter, list, s, p.unsubscribe)
      try {
        const result = await p.send(
          {
            name: `${list.name}: ${letter.subject.slice(0, 60)} ${stamp()}`,
            subject: letter.subject,
            preheader: letter.preheader,
            html,
            text,
            recipients: people.map((x) => ({ email: x.email, name: x.name })),
            test: false
          },
          s,
          signal
        )
        store.suppress(result.refused, 'bounced')
        store.markNewsletter(letter.id, {
          status: 'sent',
          sentAt: now(),
          sentTo: result.accepted,
          providerRef: result.ref,
          note: result.refused.length ? `${result.refused.length} address(es) were refused.` : ''
        })
        return { sentTo: result.accepted, refused: result.refused.length, list: list.name }
      } catch (error) {
        // Part of it may have gone out: it is never sent again by itself.
        store.markNewsletter(letter.id, {
          status: 'failed',
          note: (error as Error).message.slice(0, 300)
        })
        throw error
      }
    },

    async runSequences(force = false) {
      if (running || deps.locked?.()) return
      if (!force && now() - lastSequences < SEQUENCE_EVERY_MS) return
      lastSequences = now()
      const active = store.sequences().filter((q) => q.enabled)
      if (!active.length) return
      running = true
      try {
        const s = settings()
        let p: MailProvider
        try {
          p = provider(s)
          await ready(p, s)
          await sync()
        } catch (error) {
          // Not set up, or offline: nothing goes out, and each sequence says why once.
          for (const q of active)
            if (store.sequenceDue(q.id).size && q.lastNote !== (error as Error).message) {
              store.noteSequence(q.id, (error as Error).message)
              deps.onSequence?.(q, (error as Error).message, true)
            }
          return
        }
        for (const q of active) {
          const list = store.list(q.listId)
          if (!list) continue
          for (const [step, people] of store.sequenceDue(q.id)) {
            const mail = q.steps[step]
            const { html, text } = render(mail, list, s, p.unsubscribe)
            try {
              const result = await p.send(
                {
                  name: `${q.name}, email ${step + 1} ${stamp()}`,
                  subject: mail.subject,
                  preheader: mail.preheader,
                  html,
                  text,
                  recipients: people.map((x: Subscriber) => ({ email: x.email, name: x.name })),
                  test: false
                },
                s
              )
              store.suppress(result.refused, 'bounced')
              // Marked for everyone in the batch, refused or not: nobody is mailed the same step twice.
              store.markSequenceSent(
                q.id,
                step,
                people.map((x) => x.id)
              )
              const note = `Sent email ${step + 1} ("${mail.subject.slice(0, 60)}") to ${result.accepted} new subscriber(s).`
              store.noteSequence(q.id, note)
              deps.onSequence?.(q, note, false)
            } catch (error) {
              store.noteSequence(q.id, (error as Error).message)
              deps.onSequence?.(q, (error as Error).message, true)
              break
            }
          }
        }
      } catch (error) {
        deps.onError?.(error, { what: 'sequences' })
      } finally {
        running = false
      }
    }
  }
  return mailer
}
