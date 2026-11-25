// Newsletters and email sequences (features 15.5, 15.6; decisions §63), on
// the Marketing screen. Mail goes out through the user's own email provider
// account (Brevo or Postmark); lists stay on this laptop, each person with
// how they agreed. A newsletter is sent only after a test to the user's own
// address, and only by their click here or their OK on an agent's card.
import { useCallback, useState } from 'react'

import type { KeyProvider } from '../../shared/protocol'
import type { EngineClient } from './engine'
import { OwnKeys } from './Keys'

export interface MailSettingsView {
  provider: 'brevo' | 'postmark' | null
  fromName: string
  fromEmail: string
  replyTo: string
  address: string
  postmarkStream: string
}

export interface MailView {
  settings: MailSettingsView
  hasKey: boolean
  problems: string[]
  lists: { id: string; name: string; about: string; subscribed: number; unsubscribed: number }[]
  newsletters: {
    id: string
    listId: string
    subject: string
    preheader: string
    body: string
    status: 'draft' | 'sent' | 'failed'
    sentAt: number | null
    sentTo: number
    note: string
    testedAt: number | null
    source: string
  }[]
  sequences: {
    id: string
    listId: string
    name: string
    enabled: boolean
    steps: { day: number; subject: string }[]
    lastNote: string
  }[]
}

interface Check {
  name: string
  ok: boolean
  blocks: boolean
  detail: string
}

interface Subscriber {
  id: string
  email: string
  name: string
  status: string
  consent: string
  addedAt: number
}

function day(at: number | null): string {
  return at
    ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : ''
}

export function NewslettersSection({
  client,
  mail,
  savedKeys,
  onData,
  onProblem,
  onAsk,
  onKeysChanged
}: {
  client: EngineClient | null
  mail: MailView
  savedKeys: Record<KeyProvider, boolean>
  /** The Marketing screen's data, after a change here. */
  onData(data: unknown): void
  onProblem(error: unknown): void
  onAsk(agent: string, text: string): void
  onKeysChanged(): void
}): React.JSX.Element {
  const [settings, setSettings] = useState<MailSettingsView | null>(null)
  const [checks, setChecks] = useState<{ account: string; checks: Check[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [listName, setListName] = useState('')
  const [listAbout, setListAbout] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [people, setPeople] = useState('')
  const [consent, setConsent] = useState('')
  const [added, setAdded] = useState<string | null>(null)
  const [showing, setShowing] = useState<{ list: string; people: Subscriber[] } | null>(null)
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const s = settings ?? mail.settings

  const post = useCallback(
    async <T,>(action: string, body: unknown, label?: string): Promise<T | null> => {
      setBusy(label ?? action)
      setNotice(null)
      try {
        const result = await client!.send<T>('POST', `/v1/marketing/${action}`, body)
        onData(result)
        return result
      } catch (error) {
        onProblem(error)
        return null
      } finally {
        setBusy(null)
      }
    },
    [client, onData, onProblem]
  )

  const listOf = (id: string): string => mail.lists.find((l) => l.id === id)?.name ?? '?'

  return (
    <>
      <h2 className="section">Newsletters</h2>
      <p className="muted">
        Sent through your own email provider account, which delivers the mail and runs the
        unsubscribe link. Your lists stay on this computer, each person with how they agreed. Every
        email says who sent it, why the reader gets it, and how to unsubscribe.
      </p>
      <div className="post-actions">
        <button
          className="btn"
          onClick={() =>
            onAsk(
              'Marketing agent',
              'Write this month’s newsletter for our list: ask me what to put in it (news, an offer, a tip), then save it as a draft with newsletter_save and send me a test.'
            )
          }
        >
          Write a newsletter
        </button>
        <button
          className="btn"
          onClick={() =>
            onAsk(
              'Marketing agent',
              'Make a welcome sequence for new subscribers to our list: three short emails (the day they join, day 3 and day 7) in our brand kit’s voice. Show me the emails, then save them with sequence_save.'
            )
          }
        >
          Make a welcome sequence
        </button>
      </div>

      <details className="fold" open={mail.problems.length > 0}>
        <summary>
          Sending set-up
          {mail.problems.length ? `: ${mail.problems.length} thing(s) missing` : ': ready'}
        </summary>
        <div className="brand-grid">
          <label className="field">
            Your email provider
            <select
              value={s.provider ?? ''}
              onChange={(e) =>
                setSettings({
                  ...s,
                  provider: (e.target.value || null) as MailSettingsView['provider']
                })
              }
            >
              <option value="">Choose…</option>
              <option value="brevo">Brevo (a free plan; campaigns and lists)</option>
              <option value="postmark">Postmark (a broadcast stream, approved by Postmark)</option>
            </select>
          </label>
          <label className="field">
            From (your company’s name)
            <input
              className="search"
              value={s.fromName}
              onChange={(e) => setSettings({ ...s, fromName: e.target.value })}
            />
          </label>
          <label className="field">
            From address (on your own domain)
            <input
              className="search"
              placeholder="news@your-company.com"
              value={s.fromEmail}
              onChange={(e) => setSettings({ ...s, fromEmail: e.target.value })}
            />
          </label>
          <label className="field">
            Replies and tests go to
            <input
              className="search"
              placeholder="you@your-company.com"
              value={s.replyTo}
              onChange={(e) => setSettings({ ...s, replyTo: e.target.value })}
            />
          </label>
          <label className="field brand-wide">
            Your company’s postal address (shown in every email, as anti-spam laws ask)
            <input
              className="search"
              value={s.address}
              onChange={(e) => setSettings({ ...s, address: e.target.value })}
            />
          </label>
          {s.provider === 'postmark' && (
            <label className="field">
              Postmark broadcast stream ID
              <input
                className="search"
                placeholder="broadcast"
                value={s.postmarkStream}
                onChange={(e) => setSettings({ ...s, postmarkStream: e.target.value })}
              />
            </label>
          )}
        </div>
        <div className="post-actions">
          <button
            className="btn btn-primary"
            disabled={!settings}
            onClick={async () => {
              if (await post('mail-settings', { settings: s })) setSettings(null)
            }}
          >
            Save
          </button>
          <button
            className="btn"
            disabled={!!mail.problems.length || busy === 'mail-check'}
            onClick={async () => {
              const result = await post<{ check: { account: string; checks: Check[] } }>(
                'mail-check',
                {}
              )
              if (result) setChecks(result.check)
            }}
          >
            {busy === 'mail-check' ? 'Checking…' : 'Check the set-up'}
          </button>
        </div>
        {mail.problems.map((p) => (
          <p className="warn" key={p}>
            {p}
          </p>
        ))}
        {checks && (
          <div className="mail-checks">
            <p className="muted">Your provider’s account: {checks.account}</p>
            {checks.checks.map((c) => (
              <p key={c.name} className={c.ok ? 'muted' : 'warn'}>
                {c.ok ? '✓' : c.blocks ? '✗' : '!'} <strong>{c.name}:</strong> {c.detail}
              </p>
            ))}
          </div>
        )}
        <OwnKeys
          kind="mail"
          saved={savedKeys}
          models={[]}
          model={null}
          onUse={() => undefined}
          onChanged={onKeysChanged}
        />
      </details>

      <h3 className="sub-section">Lists</h3>
      {mail.lists.length === 0 && <p className="empty">No subscriber lists yet.</p>}
      {mail.lists.map((l) => (
        <div className="row" key={l.id}>
          <div className="row-main">
            <p className="row-title">{l.name}</p>
            <p className="muted">
              {l.subscribed} subscribed
              {l.unsubscribed ? `, ${l.unsubscribed} unsubscribed or bounced` : ''}
              {l.about ? ` · ${l.about}` : ''}
            </p>
          </div>
          <button
            className="btn"
            onClick={() => {
              setAdding(adding === l.id ? null : l.id)
              setAdded(null)
            }}
          >
            Add people
          </button>
          <button
            className="btn"
            onClick={async () => {
              const result = await client!
                .send<{ subscribers: Subscriber[] }>('POST', '/v1/marketing/mail-subscribers', {
                  id: l.id
                })
                .catch(onProblem)
              if (result) setShowing({ list: l.id, people: result.subscribers })
            }}
          >
            People
          </button>
          <button
            className="btn"
            onClick={() => {
              if (
                window.confirm(
                  `Remove the list "${l.name}" with its people, newsletters and sequences? This can’t be undone.`
                )
              )
                void post('mail-list-remove', { id: l.id })
            }}
          >
            Remove
          </button>
        </div>
      ))}
      {adding && (
        <div className="post-card">
          <p className="row-title">Add people to {listOf(adding)}</p>
          <p className="muted">
            Only people who agreed to get these emails. Paste addresses, or a CSV with an email
            column. Bought or collected lists aren’t consent, and someone who unsubscribed is never
            added back.
          </p>
          <label className="field">
            Addresses
            <textarea rows={4} value={people} onChange={(e) => setPeople(e.target.value)} />
          </label>
          <label className="field">
            How did they agree?
            <input
              className="search"
              placeholder="Signed up through the form on our site"
              value={consent}
              onChange={(e) => setConsent(e.target.value)}
            />
          </label>
          <div className="post-actions">
            <button
              className="btn btn-primary"
              disabled={!people.trim() || consent.trim().length < 10}
              onClick={async () => {
                const result = await post<{
                  added: { added: number; already: number; unsubscribed: number; invalid: number }
                }>('mail-subscribers-add', { id: adding, text: people, how: consent })
                if (result) {
                  const r = result.added
                  setAdded(
                    `Added ${r.added}. Already there: ${r.already}. Unsubscribed earlier, not added back: ${r.unsubscribed}. Not valid: ${r.invalid}.`
                  )
                  setPeople('')
                }
              }}
            >
              Add
            </button>
            <button className="btn" onClick={() => setAdding(null)}>
              Close
            </button>
          </div>
          {added && <p className="muted">{added}</p>}
        </div>
      )}
      {showing && (
        <div className="post-card">
          <p className="row-title">
            People on {listOf(showing.list)} ({showing.people.length})
          </p>
          {showing.people.slice(0, 200).map((p) => (
            <div className="row" key={p.id}>
              <div className="row-main">
                <p className={p.status === 'subscribed' ? 'row-title' : 'row-title faint'}>
                  {p.email} {p.name ? `· ${p.name}` : ''}{' '}
                  {p.status === 'subscribed' ? '' : `(${p.status})`}
                </p>
                <p className="muted">
                  {p.consent} · {day(p.addedAt)}
                </p>
              </div>
              {p.status === 'subscribed' && (
                <button
                  className="btn"
                  onClick={async () => {
                    await post('mail-unsubscribe', { id: p.id })
                    setShowing({
                      ...showing,
                      people: showing.people.map((x) =>
                        x.id === p.id ? { ...x, status: 'unsubscribed' } : x
                      )
                    })
                  }}
                >
                  Unsubscribe
                </button>
              )}
            </div>
          ))}
          {showing.people.length > 200 && <p className="muted">The first 200 are shown.</p>}
          <button className="btn" onClick={() => setShowing(null)}>
            Close
          </button>
        </div>
      )}
      <div className="add-row">
        <input
          className="search"
          placeholder="New list, e.g. Monthly news"
          aria-label="New list’s name"
          value={listName}
          onChange={(e) => setListName(e.target.value)}
        />
        <input
          className="search"
          placeholder="What people sign up for"
          aria-label="What people sign up for"
          value={listAbout}
          onChange={(e) => setListAbout(e.target.value)}
        />
        <button
          className="btn"
          disabled={!listName.trim()}
          onClick={async () => {
            if (await post('mail-list', { name: listName, about: listAbout })) {
              setListName('')
              setListAbout('')
            }
          }}
        >
          Add a list
        </button>
      </div>

      <h3 className="sub-section">Newsletters</h3>
      {mail.newsletters.length === 0 && <p className="empty">No newsletters yet.</p>}
      {mail.newsletters.map((n) => (
        <div className="row" key={n.id}>
          <div className="row-main">
            <p className="row-title">{n.subject}</p>
            <p className="muted">
              To {listOf(n.listId)} ·{' '}
              {n.status === 'sent'
                ? `sent ${day(n.sentAt)} to ${n.sentTo}`
                : n.status === 'failed'
                  ? `failed: ${n.note}`
                  : n.testedAt
                    ? `draft, test sent ${day(n.testedAt)}`
                    : 'draft, not tested yet'}
              {n.status === 'sent' && n.note ? ` · ${n.note}` : ''}
            </p>
          </div>
          <button
            className="btn"
            onClick={async () => {
              if (preview?.id === n.id) return setPreview(null)
              try {
                const result = await client!.send<{ html: string }>(
                  'POST',
                  '/v1/marketing/newsletter-preview',
                  { id: n.id }
                )
                setPreview({ id: n.id, url: await window.titan117.artifacts.stage(result.html) })
              } catch (error) {
                onProblem(error)
              }
            }}
          >
            {preview?.id === n.id ? 'Hide' : 'Preview'}
          </button>
          {n.status === 'draft' && (
            <>
              <button
                className="btn"
                disabled={!!mail.problems.length || busy === `test-${n.id}`}
                onClick={async () => {
                  const result = await post<{ test: { to: string } }>(
                    'newsletter-test',
                    { id: n.id },
                    `test-${n.id}`
                  )
                  if (result)
                    setNotice(
                      `A test went to ${result.test.to}. Look at it in your inbox before sending.`
                    )
                }}
              >
                {busy === `test-${n.id}` ? 'Sending…' : 'Send a test'}
              </button>
              <button
                className="btn btn-primary"
                disabled={!n.testedAt || !!mail.problems.length || busy === `send-${n.id}`}
                title={n.testedAt ? '' : 'Send yourself a test first'}
                onClick={async () => {
                  const list = mail.lists.find((l) => l.id === n.listId)
                  if (
                    !window.confirm(
                      `Send "${n.subject}" to ${list?.subscribed ?? 0} subscriber(s) of "${list?.name}" through your email provider? It can’t be taken back.`
                    )
                  )
                    return
                  const result = await post<{ sent: { sentTo: number; refused: number } }>(
                    'newsletter-send',
                    { id: n.id },
                    `send-${n.id}`
                  )
                  if (result)
                    setNotice(
                      `Sent to ${result.sent.sentTo}${result.sent.refused ? `; ${result.sent.refused} address(es) were refused` : ''}.`
                    )
                }}
              >
                {busy === `send-${n.id}` ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
          {n.status !== 'sent' && (
            <button className="btn" onClick={() => void post('newsletter-remove', { id: n.id })}>
              Remove
            </button>
          )}
        </div>
      ))}
      {notice && <p className="muted">{notice}</p>}
      {preview && (
        <iframe className="mail-preview" title="Newsletter preview" src={preview.url} sandbox="" />
      )}
      {mail.newsletters.some((n) => n.status === 'sent') && (
        <button
          className="btn"
          disabled={busy === 'mail-sync'}
          onClick={async () => {
            const result = await post<{ marked: number }>('mail-sync', {})
            if (result)
              setNotice(
                `${result.marked} unsubscribe(s) or bounce(s) read back from your provider.`
              )
          }}
        >
          Read unsubscribes back
        </button>
      )}

      <h3 className="sub-section">Sequences</h3>
      <p className="muted">
        Emails that go by themselves to each person who joins a list, on the days you choose, while
        Titan117 is open. People already on the list don’t get them.
      </p>
      {mail.sequences.length === 0 && <p className="empty">No sequences yet.</p>}
      {mail.sequences.map((q) => (
        <div className="row" key={q.id}>
          <div className="row-main">
            <p className={q.enabled ? 'row-title' : 'row-title faint'}>{q.name}</p>
            <p className="muted">
              For {listOf(q.listId)} ·{' '}
              {q.steps.map((x) => `day ${x.day}: ${x.subject}`).join(' · ')}
              {q.lastNote ? ` · last: ${q.lastNote}` : ''}
            </p>
          </div>
          <button
            className="btn"
            onClick={() => void post('sequence-set', { id: q.id, enabled: !q.enabled })}
          >
            {q.enabled ? 'Pause' : 'Resume'}
          </button>
          <button className="btn" onClick={() => void post('sequence-remove', { id: q.id })}>
            Remove
          </button>
        </div>
      ))}
    </>
  )
}
