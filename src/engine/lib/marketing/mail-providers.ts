/**
 * The user's own email provider (decisions §31, §63): Brevo or Postmark,
 * through each one's official API with the user's own key. The provider
 * delivers the mail and runs the unsubscribe link; we read back who
 * unsubscribed or bounced. Endpoints and fields are from the vendors' own
 * API references, read on 24 Nov 2026 (`external-services.md`).
 *
 * Brevo: an email campaign to a contact list in the user's account
 * (contacts/lists, contacts/import, emailCampaigns, sendTest, sendNow).
 * Postmark: individual messages through a broadcast message stream
 * (email/batch, 500 at a time), which Postmark requires for newsletters.
 */
import { MarketingError } from './brand'
import type { MailProviderId, MailSettings, SetupCheck } from './mail'

export interface OutgoingMail {
  /** A name for the send in the provider's own account ("Monthly news 2026-12-03"). */
  name: string
  subject: string
  preheader: string
  html: string
  text: string
  recipients: { email: string; name: string }[]
  /** A test: delivered only to these addresses (the user's own). */
  test: boolean
}

export interface SendResult {
  /** The provider's reference, kept to read suppressions back. */
  ref: string
  accepted: number
  /** Addresses the provider refused at once (inactive or suppressed there). */
  refused: string[]
}

export interface Suppressed {
  email: string
  kind: 'unsubscribed' | 'bounced'
}

export interface MailProvider {
  id: MailProviderId
  label: string
  /** The placeholder the provider turns into each person's unsubscribe link. */
  unsubscribe: string
  /** The account's name, to show the key reaches the right account. Throws when the key is refused. */
  account(): Promise<string>
  /** What the provider says about this sender: its address, domain and unsubscribe handling. */
  checks(settings: MailSettings): Promise<SetupCheck[]>
  send(mail: OutgoingMail, settings: MailSettings, signal?: AbortSignal): Promise<SendResult>
  /** Who unsubscribed or bounced, as far as the provider reports for this reference (or the stream). */
  suppressed(ref: string, settings: MailSettings): Promise<Suppressed[]>
}

export const PROVIDER_HOSTS = ['https://api.brevo.com', 'https://api.postmarkapp.com']
export const PROVIDER_LABEL: Record<MailProviderId, string> = {
  brevo: 'Brevo',
  postmark: 'Postmark'
}

async function call<T>(
  fetchFn: typeof fetch,
  label: string,
  url: string,
  init: RequestInit & { headers: Record<string, string> }
): Promise<T> {
  let response: Response
  try {
    response = await fetchFn(url, init)
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new MarketingError('The send was stopped.')
    throw new MarketingError(`${label} couldn’t be reached. Check the internet connection.`)
  }
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Not JSON: the status decides.
  }
  if (response.status === 401 || response.status === 403)
    throw new MarketingError(`${label} didn’t accept the API key.`)
  if (!response.ok) {
    const said = (body as { message?: unknown; Message?: unknown } | null) ?? {}
    const why = String(said.message ?? said.Message ?? '').slice(0, 200)
    throw new MarketingError(`${label} answered ${response.status}${why ? `: ${why}` : '.'}`)
  }
  return body as T
}

function fromHeader(settings: MailSettings): string {
  return settings.fromName ? `"${settings.fromName}" <${settings.fromEmail}>` : settings.fromEmail
}

// ---------------------------------------------------------------- Brevo

const BREVO = 'https://api.brevo.com/v3'
const BREVO_FOLDER = 'Titan117'
const BREVO_IMPORT = 2000

export function brevo(deps: {
  key: string
  fetch: typeof fetch
  /** Waiting between looks at an import; tests pass 0. */
  pollMs?: number
}): MailProvider {
  const headers = {
    'api-key': deps.key,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
  const get = <T>(path: string, signal?: AbortSignal): Promise<T> =>
    call<T>(deps.fetch, 'Brevo', `${BREVO}${path}`, { headers, signal })
  const post = <T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> =>
    call<T>(deps.fetch, 'Brevo', `${BREVO}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    })

  async function folder(signal?: AbortSignal): Promise<number> {
    const found = await get<{ folders?: { id: number; name: string }[] }>(
      '/contacts/folders?limit=50&offset=0',
      signal
    )
    const existing = found.folders?.find((f) => f.name === BREVO_FOLDER)
    if (existing) return existing.id
    return (await post<{ id: number }>('/contacts/folders', { name: BREVO_FOLDER }, signal)).id
  }

  /** Brevo imports in the background: wait until it says the contacts are in. */
  async function imported(processId: number, signal?: AbortSignal): Promise<void> {
    for (let i = 0; i < 150; i++) {
      const state = await get<{ status?: string }>(`/processes/${processId}`, signal)
      if (state.status === 'completed') return
      if (state.status === 'failed' || state.status === 'cancelled')
        throw new MarketingError('Brevo couldn’t import the subscribers. Nothing was sent.')
      await new Promise((r) => setTimeout(r, deps.pollMs ?? 2000))
      if (signal?.aborted) throw new MarketingError('The send was stopped.')
    }
    throw new MarketingError(
      'Brevo is still importing the subscribers. Nothing was sent; try again later.'
    )
  }

  return {
    id: 'brevo',
    label: 'Brevo',
    unsubscribe: '{{ unsubscribe }}',

    async account() {
      const account = await get<{ companyName?: string; email?: string }>('/account')
      return account.companyName || account.email || 'your Brevo account'
    },

    async checks(settings) {
      const domain = settings.fromEmail.split('@')[1] ?? ''
      const [senders, domains] = await Promise.all([
        get<{ senders?: { email: string; active: boolean }[] }>('/senders'),
        get<{ domains?: { domain_name: string; authenticated: boolean; verified: boolean }[] }>(
          '/senders/domains'
        )
      ])
      const sender = senders.senders?.find((s) => s.email.toLowerCase() === settings.fromEmail)
      const entry = domains.domains?.find((d) => d.domain_name.toLowerCase() === domain)
      return [
        {
          name: 'Sender',
          ok: !!sender?.active,
          blocks: true,
          detail: sender?.active
            ? `${settings.fromEmail} is an active sender in your Brevo account.`
            : `${settings.fromEmail} isn’t an active sender in Brevo yet. Add and confirm it under Senders, Domains & Dedicated IPs.`
        },
        {
          name: 'Domain (DKIM)',
          ok: !!entry?.authenticated,
          blocks: true,
          detail: entry?.authenticated
            ? `${domain} is authenticated in Brevo.`
            : `${domain} isn’t authenticated in Brevo yet. Brevo’s Domains page gives the DNS records to add; mail from an unauthenticated domain lands in spam.`
        }
      ]
    },

    async send(mail, settings, signal) {
      const folderId = await folder(signal)
      const list = await post<{ id: number }>(
        '/contacts/lists',
        { name: mail.name, folderId },
        signal
      )
      for (let i = 0; i < mail.recipients.length; i += BREVO_IMPORT) {
        const started = await post<{ processId: number }>(
          '/contacts/import',
          {
            jsonBody: mail.recipients.slice(i, i + BREVO_IMPORT).map((r) => ({ email: r.email })),
            listIds: [list.id],
            updateExistingContacts: true,
            // Never un-blacklist: someone who unsubscribed in Brevo stays unsubscribed.
            emailBlacklist: false,
            disableNotification: true
          },
          signal
        )
        await imported(started.processId, signal)
      }
      const campaign = await post<{ id: number }>(
        '/emailCampaigns',
        {
          name: mail.name,
          subject: mail.subject,
          sender: { name: settings.fromName, email: settings.fromEmail },
          htmlContent: mail.html,
          ...(mail.preheader ? { previewText: mail.preheader } : {}),
          ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
          recipients: { listIds: [list.id] }
        },
        signal
      )
      if (mail.test)
        await post(
          `/emailCampaigns/${campaign.id}/sendTest`,
          { emailTo: mail.recipients.map((r) => r.email) },
          signal
        )
      else await post(`/emailCampaigns/${campaign.id}/sendNow`, {}, signal)
      return { ref: `${list.id}:${campaign.id}`, accepted: mail.recipients.length, refused: [] }
    },

    async suppressed(ref) {
      const listId = Number(ref.split(':')[0])
      if (!Number.isInteger(listId) || listId <= 0) return []
      const out: Suppressed[] = []
      for (let offset = 0; offset < 100_000; offset += 500) {
        const page = await get<{ contacts?: { email: string; emailBlacklisted: boolean }[] }>(
          `/contacts/lists/${listId}/contacts?limit=500&offset=${offset}`
        )
        const contacts = page.contacts ?? []
        for (const c of contacts)
          if (c.emailBlacklisted) out.push({ email: c.email, kind: 'unsubscribed' })
        if (contacts.length < 500) break
      }
      return out
    }
  }
}

// ---------------------------------------------------------------- Postmark

const POSTMARK = 'https://api.postmarkapp.com'
const POSTMARK_BATCH = 500

export function postmark(deps: { key: string; fetch: typeof fetch }): MailProvider {
  const headers = {
    'X-Postmark-Server-Token': deps.key,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
  const get = <T>(path: string, signal?: AbortSignal): Promise<T> =>
    call<T>(deps.fetch, 'Postmark', `${POSTMARK}${path}`, { headers, signal })

  return {
    id: 'postmark',
    label: 'Postmark',
    unsubscribe: '{{{ pm:unsubscribe }}}',

    async account() {
      return (await get<{ Name?: string }>('/server')).Name || 'your Postmark server'
    },

    async checks(settings) {
      const streams = await get<{
        MessageStreams?: {
          ID: string
          MessageStreamType: string
          SubscriptionManagementConfiguration?: { UnsubscribeHandlingType?: string }
        }[]
      }>('/message-streams?MessageStreamType=Broadcasts')
      const stream = streams.MessageStreams?.find((s) => s.ID === settings.postmarkStream)
      const handling = stream?.SubscriptionManagementConfiguration?.UnsubscribeHandlingType
      return [
        {
          name: 'Broadcast stream',
          ok: !!stream,
          blocks: true,
          detail: stream
            ? `The broadcast stream "${stream.ID}" exists on this Postmark server.`
            : `There is no broadcast stream called "${settings.postmarkStream}" on this server. Postmark sends newsletters only through a broadcast stream; create one (Postmark approves it) and enter its ID.`
        },
        {
          name: 'Unsubscribe link',
          ok: handling === 'Postmark',
          blocks: !!stream,
          detail:
            handling === 'Postmark'
              ? 'Postmark runs the unsubscribe link for this stream.'
              : 'This stream doesn’t let Postmark run the unsubscribe link. Set its unsubscribe handling to "Postmark".'
        }
      ]
    },

    async send(mail, settings, signal) {
      const refused: string[] = []
      let accepted = 0
      for (let i = 0; i < mail.recipients.length; i += POSTMARK_BATCH) {
        const batch = mail.recipients.slice(i, i + POSTMARK_BATCH)
        const results = await call<{ ErrorCode: number; To?: string }[]>(
          deps.fetch,
          'Postmark',
          `${POSTMARK}/email/batch`,
          {
            method: 'POST',
            headers,
            signal,
            body: JSON.stringify(
              batch.map((r) => ({
                From: fromHeader(settings),
                To: r.email,
                Subject: mail.subject,
                HtmlBody: mail.html,
                TextBody: mail.text,
                ...(settings.replyTo ? { ReplyTo: settings.replyTo } : {}),
                MessageStream: settings.postmarkStream
              }))
            )
          }
        )
        results.forEach((result, n) => {
          if (result.ErrorCode === 0) accepted++
          else refused.push(batch[n].email)
        })
      }
      // Everything refused: say why instead of calling it sent.
      if (!accepted && mail.recipients.length)
        throw new MarketingError(
          'Postmark accepted none of the messages. Check that the sender address is confirmed and the broadcast stream is approved.'
        )
      return { ref: settings.postmarkStream, accepted, refused }
    },

    async suppressed(_ref, settings) {
      if (!settings.postmarkStream) return []
      const dump = await get<{
        Suppressions?: { EmailAddress: string; SuppressionReason: string }[]
      }>(`/message-streams/${encodeURIComponent(settings.postmarkStream)}/suppressions/dump`)
      return (dump.Suppressions ?? []).map((s) => ({
        email: s.EmailAddress,
        kind: s.SuppressionReason === 'HardBounce' ? 'bounced' : 'unsubscribed'
      }))
    }
  }
}

export function mailProvider(
  id: MailProviderId,
  deps: { key: string; fetch: typeof fetch; pollMs?: number }
): MailProvider {
  return id === 'brevo' ? brevo(deps) : postmark(deps)
}
