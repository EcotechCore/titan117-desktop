// Marketing (phase 14; decisions §24, §62): the brand kit (15.1), the content
// calendar (15.3) and each post as a ready-to-post package (15.4). Nothing is
// ever posted for the user: "Copy and open" copies the text and opens the
// platform's own post screen, and they press Post there themselves.
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { EngineClient } from './engine'
import { monthGrid, pad } from './marketing-lib'
import { NewslettersSection, type MailView } from './Newsletters'
import type { KeyProvider } from '../../shared/protocol'
import { Icon } from './ui'

type Platform = 'linkedin' | 'facebook' | 'instagram' | 'x' | 'tiktok'
type Status = 'draft' | 'ready' | 'posted' | 'skipped'
const RESULT_KEYS = ['views', 'likes', 'comments', 'shares', 'clicks'] as const
type ResultKey = (typeof RESULT_KEYS)[number]

interface PostRow {
  id: string
  platform: Platform
  platformLabel: string
  date: string
  time: string
  text: string
  hashtags: string[]
  media: string[]
  link: string
  campaign: string
  status: Status
  fullText: string
  chars: number
  maxChars: number
  prefills: boolean
  composeUrl: string
  /** The link with where the visit came from (utm), as it is posted. */
  trackedLink: string
  /** What the post brought, typed in from the platform's own numbers. */
  results: Partial<Record<ResultKey, number>>
  warnings: string[]
}

interface Brand {
  name: string
  tagline: string
  website: string
  description: string
  audience: string
  products: string[]
  tone: string
  primary: string
  accent: string
  font: string
  headingFont: string
  logo: string
}

interface PlatformInfo {
  id: Platform
  label: string
  maxChars: number
  maxHashtags: number
  needsMedia: boolean
}

interface Listing {
  brand: Brand
  posts: PostRow[]
  due: string[]
  platforms: PlatformInfo[]
  folders: string[]
  mail: MailView
}

interface Exported {
  ics: { name: string; base64: string }
  csv: { name: string; base64: string }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  ready: 'Ready',
  posted: 'Posted',
  skipped: 'Skipped'
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
}

/** A post's first picture, read from the allowed folders by the engine. */
function Media({ client, path }: { client: EngineClient | null; path: string }): React.JSX.Element {
  const [state, setState] = useState<{ src: string | null; real: string | null; error: boolean }>({
    src: null,
    real: null,
    error: false
  })
  useEffect(() => {
    let live = true
    client
      ?.send<{ path: string; mediaType: string | null; base64: string | null }>(
        'POST',
        '/v1/marketing/media',
        { path }
      )
      .then((m) => {
        if (live)
          setState({
            src: m.base64 ? `data:${m.mediaType};base64,${m.base64}` : null,
            real: m.path,
            error: false
          })
      })
      .catch(() => live && setState({ src: null, real: null, error: true }))
    return () => {
      live = false
    }
  }, [client, path])
  return (
    <div className="post-media">
      {state.src && <img src={state.src} alt="" />}
      <div className="post-media-line">
        <span className="mono">{path}</span>
        {state.error && <span className="warn"> This file isn’t there any more.</span>}
        {state.real && (
          <button className="link" onClick={() => void window.titan117.files.reveal(state.real!)}>
            Show in folder
          </button>
        )}
      </div>
    </div>
  )
}

/** What a posted post brought: the user types in what the platform shows (15.11). */
function Results({
  post,
  onSave
}: {
  post: PostRow
  onSave(results: Record<string, string>): void
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(RESULT_KEYS.map((k) => [k, String(post.results[k] ?? '')]))
  )
  const changed = RESULT_KEYS.some((k) => values[k] !== String(post.results[k] ?? ''))
  return (
    <div className="post-results">
      <span className="muted">What it brought (from {post.platformLabel}’s own numbers):</span>
      {RESULT_KEYS.map((k) => (
        <label key={k} className="post-result">
          {k[0].toUpperCase() + k.slice(1)}
          <input
            className="search short"
            type="number"
            min={0}
            value={values[k]}
            onChange={(e) => setValues({ ...values, [k]: e.target.value })}
          />
        </label>
      ))}
      <button className="btn" disabled={!changed} onClick={() => onSave(values)}>
        Save
      </button>
    </div>
  )
}

export function MarketingView({
  client,
  changed,
  onProblem,
  onAsk,
  savedKeys,
  onKeysChanged
}: {
  client: EngineClient | null
  changed: number
  /** Which of the user's own keys are saved (the email provider's among them). */
  savedKeys: Record<KeyProvider, boolean>
  onKeysChanged(): void
  onProblem(error: unknown): void
  /** Start a task for one of the marketing agents with these words. */
  onAsk(agent: string, text: string): void
}): React.JSX.Element {
  const [data, setData] = useState<Listing | null>(null)
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<PostRow> | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  /** The post whose text couldn't be copied: the user copies it by hand. */
  const [notCopied, setNotCopied] = useState<string | null>(null)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [words, setWords] = useState('')
  const [site, setSite] = useState('')

  const load = useCallback(() => {
    client?.get<Listing>('/v1/marketing').then(setData).catch(onProblem)
  }, [client, onProblem])
  useEffect(load, [load, changed])
  // A post that comes due while the screen is open moves to "Time to post".
  useEffect(() => {
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  const post = useCallback(
    async (action: string, body: unknown): Promise<boolean> => {
      try {
        setData(await client!.send<Listing>('POST', `/v1/marketing/${action}`, body))
        return true
      } catch (error) {
        onProblem(error)
        return false
      }
    },
    [client, onProblem]
  )

  const byDay = useMemo(() => {
    const map = new Map<string, PostRow[]>()
    for (const p of data?.posts ?? []) map.set(p.date, [...(map.get(p.date) ?? []), p])
    return map
  }, [data])

  if (!data) return <div className="list-view" />

  const weeks = monthGrid(month.getFullYear(), month.getMonth())
  const today = dayKey(new Date())
  const inMonth = data.posts.filter((p) => p.date.startsWith(monthKey(month)))
  const due = data.posts.filter((p) => data.due.includes(p.id))
  const shown = data.posts.find((p) => p.id === open) ?? null
  const kit = brand ?? data.brand
  const hasKit = !!(data.brand.name || data.brand.website || data.brand.description)

  /** Copy the text, open the platform's own post screen; the user posts there. */
  async function copyAndOpen(p: PostRow): Promise<void> {
    try {
      await navigator.clipboard.writeText(p.fullText)
      setCopied(p.id)
      setNotCopied(null)
    } catch {
      // The clipboard said no: the text is still on screen, and the user is told to copy it.
      setCopied(null)
      setNotCopied(p.id)
    }
    window.open(p.composeUrl)
  }

  async function exportCalendar(): Promise<void> {
    try {
      const files = await client!.send<Exported>('POST', '/v1/marketing/export', {
        month: monthKey(month)
      })
      await window.titan117.artifacts.save(files.ics.name, files.ics.base64)
      await window.titan117.artifacts.save(files.csv.name, files.csv.base64)
    } catch (error) {
      onProblem(error)
    }
  }

  function postCard(p: PostRow): React.JSX.Element {
    const info = data!.platforms.find((x) => x.id === p.platform)
    return (
      <div className="post-card" key={p.id}>
        <div className="post-head">
          <span className={`post-dot post-${p.platform}`} />
          <strong>{p.platformLabel}</strong>
          <span className="muted">
            {longDay(p.date)} at {p.time}
            {p.campaign ? ` · ${p.campaign}` : ''}
          </span>
          <span className={`tag post-status-${p.status}`}>{STATUS_LABEL[p.status]}</span>
        </div>
        <p className="post-text">{p.fullText}</p>
        {p.link && (
          <p className="muted">
            Link: <span className="mono">{p.trackedLink || p.link}</span>
          </p>
        )}
        {p.media.map((m) => (
          <Media key={m} client={client} path={m} />
        ))}
        {p.warnings.map((w) => (
          <p className="warn" key={w}>
            {w}
          </p>
        ))}
        <p className="muted">
          {p.chars} of {p.maxChars} characters
        </p>
        {p.status === 'posted' && (
          <Results
            key={`${p.id}-${JSON.stringify(p.results)}`}
            post={p}
            onSave={(results) => void post('post-results', { id: p.id, results })}
          />
        )}
        <div className="post-actions">
          {p.status !== 'posted' && (
            <button className="btn btn-primary" onClick={() => void copyAndOpen(p)}>
              Copy and open {p.platformLabel}
            </button>
          )}
          {p.status !== 'posted' && (
            <button
              className="btn"
              onClick={() => void post('post-status', { id: p.id, status: 'posted' })}
            >
              <Icon name="check" /> I posted it
            </button>
          )}
          {p.status === 'draft' && (
            <button
              className="btn"
              onClick={() => void post('post-status', { id: p.id, status: 'ready' })}
            >
              Ready: remind me
            </button>
          )}
          {p.status === 'ready' && (
            <button
              className="btn"
              onClick={() => void post('post-status', { id: p.id, status: 'draft' })}
            >
              Back to draft
            </button>
          )}
          {p.status === 'posted' && (
            <button
              className="btn"
              onClick={() => void post('post-status', { id: p.id, status: 'ready' })}
            >
              Not posted after all
            </button>
          )}
          <button className="btn" onClick={() => setEditing(p)}>
            Edit
          </button>
          <button className="btn" onClick={() => void post('post-remove', { id: p.id })}>
            Remove
          </button>
        </div>
        {copied === p.id && p.status !== 'posted' && (
          <p className="muted">
            The text is copied.{' '}
            {p.prefills
              ? `${p.platformLabel} should open with it filled in; if not, paste it`
              : `Paste it into ${p.platformLabel}’s post screen`}
            {p.media.length ? ' and add the media from its folder.' : '.'} Press Post there, then
            come back and choose “I posted it”.
            {info?.needsMedia && !p.media.length
              ? ` ${p.platformLabel} needs a picture or video.`
              : ''}
          </p>
        )}
        {notCopied === p.id && p.status !== 'posted' && (
          <p className="warn">
            The text couldn’t be copied. Select it above, copy it, and paste it into{' '}
            {p.platformLabel}.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="list-view">
      <h1 className="view-title">Marketing</h1>
      <p className="muted">
        Your brand kit, a calendar of posts and promo videos. Titan117 writes and makes everything;
        you publish each post yourself in a click, so nothing goes out that you haven’t seen.
      </p>

      <h2 className="section">Ask for it in plain words</h2>
      <div className="add-row">
        <input
          className="search"
          placeholder="Plan December’s posts for LinkedIn and Instagram, three a week, around our winter offer"
          aria-label="What should the Marketing agent do"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && words.trim()) {
              onAsk('Marketing agent', words.trim())
              setWords('')
            }
          }}
        />
        <button
          className="btn btn-primary"
          disabled={!words.trim()}
          onClick={() => {
            onAsk('Marketing agent', words.trim())
            setWords('')
          }}
        >
          Ask the Marketing agent
        </button>
      </div>
      <div className="add-row">
        <input
          className="search"
          placeholder="https://your-site.com"
          aria-label="Your site, for a promo video"
          value={site}
          onChange={(e) => setSite(e.target.value)}
        />
        <button
          className="btn"
          disabled={!(site.trim() || data.brand.website)}
          onClick={() =>
            onAsk(
              'Video maker',
              `Make a short promo video from ${site.trim() || data.brand.website}: read the site, show me the script, then make it in landscape and portrait with a voiceover.`
            )
          }
        >
          Make a promo video from the site
        </button>
      </div>

      <div className="post-actions">
        <button
          className="btn"
          onClick={() =>
            setWords(
              'Draft Google search ads and Meta ads for … (what, for whom, where, and the page they open)'
            )
          }
        >
          Draft ads
        </button>
        <button
          className="btn"
          onClick={() =>
            setWords('Find leads: businesses in … that … (say who fits and how many you want)')
          }
        >
          Find leads
        </button>
        <button
          className="btn"
          disabled={!inMonth.length}
          onClick={() =>
            onAsk(
              'Marketing agent',
              `Make the campaign report for ${monthKey(month)} with campaign_report, then tell me in a few lines what worked and what to do next month.`
            )
          }
        >
          Report for this month
        </button>
        <button
          className="btn"
          onClick={() =>
            onAsk(
              'Web watcher',
              `I want to hear about new reviews and mentions of ${data.brand.name || 'our company'}${data.brand.website ? ` (${data.brand.website})` : ''}. Ask me which public review pages we have (our Google reviews page, Facebook, Trustpilot, a trade directory), then save one web watch for them with what matters to us (new reviews, complaints, our name), and check it once.`
            )
          }
        >
          Watch reviews and mentions
        </button>
        <button
          className="btn"
          onClick={() =>
            onAsk(
              'Builder',
              'I want a landing page for a campaign. Ask me what it is for and what visitors should do, then make it with the landing page starter in our brand kit, with one clear call to action, a sign-up form and good titles and descriptions for search engines, and run its checks.'
            )
          }
        >
          Make a landing page
        </button>
      </div>

      {due.length > 0 && (
        <>
          <h2 className="section">Time to post</h2>
          {due.map(postCard)}
        </>
      )}

      <h2 className="section">Content calendar</h2>
      <div className="cal-bar">
        <button
          className="btn"
          aria-label="Previous month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          ‹
        </button>
        <strong className="cal-month">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </strong>
        <button
          className="btn"
          aria-label="Next month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          ›
        </button>
        <span className="muted">
          {inMonth.length} post{inMonth.length === 1 ? '' : 's'}
          {inMonth.length
            ? `: ${inMonth.filter((p) => p.status === 'posted').length} posted, ${inMonth.filter((p) => p.status === 'ready').length} ready, ${inMonth.filter((p) => p.status === 'draft').length} drafts`
            : ''}
        </span>
        <span className="cal-spacer" />
        <button
          className="btn"
          onClick={() =>
            setEditing({
              platform: 'linkedin',
              date: today.startsWith(monthKey(month)) ? today : `${monthKey(month)}-01`,
              time: '09:00',
              text: '',
              hashtags: [],
              media: [],
              link: '',
              campaign: '',
              status: 'draft'
            })
          }
        >
          <Icon name="plus" /> Add a post
        </button>
        <button className="btn" disabled={!inMonth.length} onClick={() => void exportCalendar()}>
          <Icon name="down" /> Export (.ics and .csv)
        </button>
      </div>
      <div className="cal" role="grid" aria-label="Content calendar">
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-head" role="columnheader">
            {d}
          </div>
        ))}
        {weeks.flat().map((day, i) => (
          <div
            key={day ?? `empty-${i}`}
            role="gridcell"
            className={day ? (day === today ? 'cal-day cal-today' : 'cal-day') : 'cal-day cal-out'}
          >
            {day && <span className="cal-num">{Number(day.slice(8))}</span>}
            {(day ? (byDay.get(day) ?? []) : []).map((p) => (
              <button
                key={p.id}
                className={`cal-post post-status-${p.status}${open === p.id ? ' on' : ''}`}
                title={`${p.platformLabel} ${p.time}: ${p.text.slice(0, 200)}`}
                onClick={() => setOpen(open === p.id ? null : p.id)}
              >
                <span className={`post-dot post-${p.platform}`} />
                <span className="cal-post-text">
                  {p.time} {p.text}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {inMonth.length === 0 && (
        <p className="empty">
          Nothing is planned for this month yet. Ask the Marketing agent above, or add a post.
        </p>
      )}
      {shown && postCard(shown)}

      {editing && (
        <div className="post-card">
          <p className="row-title">{editing.id ? 'Edit the post' : 'A new post'}</p>
          <div className="add-row">
            <select
              aria-label="Platform"
              value={editing.platform}
              onChange={(e) => setEditing({ ...editing, platform: e.target.value as Platform })}
            >
              {data.platforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              className="search short"
              type="date"
              aria-label="Day"
              value={editing.date ?? ''}
              onChange={(e) => setEditing({ ...editing, date: e.target.value })}
            />
            <input
              className="search short"
              type="time"
              aria-label="Time"
              value={editing.time ?? '09:00'}
              onChange={(e) => setEditing({ ...editing, time: e.target.value })}
            />
            <input
              className="search"
              placeholder="Campaign (optional)"
              aria-label="Campaign"
              value={editing.campaign ?? ''}
              onChange={(e) => setEditing({ ...editing, campaign: e.target.value })}
            />
          </div>
          <label className="field">
            Text
            <textarea
              rows={6}
              value={editing.text ?? ''}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
          </label>
          <div className="add-row">
            <input
              className="search"
              placeholder="Hashtags: bread, bakery"
              aria-label="Hashtags"
              value={(editing.hashtags ?? []).join(', ')}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  hashtags: e.target.value.split(/[,\s]+/).map((t) => t.replace(/^#/, ''))
                })
              }
            />
            <input
              className="search"
              placeholder="Link (optional)"
              aria-label="Link"
              value={editing.link ?? ''}
              onChange={(e) => setEditing({ ...editing, link: e.target.value })}
            />
          </div>
          <label className="field">
            Pictures or a video, one path per line, inside the folders Titan117 may use
            <textarea
              rows={2}
              placeholder="marketing/images/loaf.png"
              value={(editing.media ?? []).join('\n')}
              onChange={(e) => setEditing({ ...editing, media: e.target.value.split('\n') })}
            />
          </label>
          <div className="post-actions">
            <button
              className="btn btn-primary"
              disabled={!(editing.text ?? '').trim() || !editing.date}
              onClick={async () => {
                const ok = await post('post', {
                  post: {
                    id: editing.id,
                    platform: editing.platform,
                    date: editing.date,
                    time: editing.time,
                    text: editing.text,
                    hashtags: (editing.hashtags ?? []).filter(Boolean),
                    media: (editing.media ?? []).map((m) => m.trim()).filter(Boolean),
                    link: editing.link,
                    campaign: editing.campaign,
                    status: editing.status
                  }
                })
                if (ok) setEditing(null)
              }}
            >
              Save
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <NewslettersSection
        client={client}
        mail={data.mail}
        savedKeys={savedKeys}
        onData={(next) => setData(next as Listing)}
        onProblem={onProblem}
        onAsk={onAsk}
        onKeysChanged={onKeysChanged}
      />

      <h2 className="section">Brand kit</h2>
      <p className="muted">
        Who you are and how you look and sound. Every marketing agent, new apps and promo videos use
        it.{' '}
        {hasKit
          ? ''
          : 'It is empty: fill it in, or ask the Marketing agent to read it from your site.'}
      </p>
      <div className="brand-grid">
        <label className="field">
          Name
          <input
            className="search"
            value={kit.name}
            onChange={(e) => setBrand({ ...kit, name: e.target.value })}
          />
        </label>
        <label className="field">
          Website
          <input
            className="search"
            placeholder="https://your-site.com"
            value={kit.website}
            onChange={(e) => setBrand({ ...kit, website: e.target.value })}
          />
        </label>
        <label className="field">
          Tagline
          <input
            className="search"
            value={kit.tagline}
            onChange={(e) => setBrand({ ...kit, tagline: e.target.value })}
          />
        </label>
        <label className="field">
          Tone of voice
          <input
            className="search"
            placeholder="Warm and plain, no jargon"
            value={kit.tone}
            onChange={(e) => setBrand({ ...kit, tone: e.target.value })}
          />
        </label>
        <label className="field brand-wide">
          What you do
          <textarea
            rows={2}
            value={kit.description}
            onChange={(e) => setBrand({ ...kit, description: e.target.value })}
          />
        </label>
        <label className="field">
          Who you sell to
          <input
            className="search"
            value={kit.audience}
            onChange={(e) => setBrand({ ...kit, audience: e.target.value })}
          />
        </label>
        <label className="field">
          Products and services, with commas between
          <input
            className="search"
            value={kit.products.join(', ')}
            onChange={(e) => setBrand({ ...kit, products: e.target.value.split(',') })}
          />
        </label>
        <label className="field">
          Main colour
          <span className="brand-colour">
            <input
              type="color"
              aria-label="Main colour"
              value={kit.primary}
              onChange={(e) => setBrand({ ...kit, primary: e.target.value })}
            />
            <span className="mono">{kit.primary}</span>
          </span>
        </label>
        <label className="field">
          Second colour
          <span className="brand-colour">
            <input
              type="color"
              aria-label="Second colour"
              value={kit.accent}
              onChange={(e) => setBrand({ ...kit, accent: e.target.value })}
            />
            <span className="mono">{kit.accent}</span>
          </span>
        </label>
        <label className="field">
          Heading font, by name
          <input
            className="search"
            placeholder="Shown in videos when this laptop has it"
            value={kit.headingFont}
            onChange={(e) => setBrand({ ...kit, headingFont: e.target.value })}
          />
        </label>
        <label className="field">
          Logo file, inside the folders Titan117 may use
          <input
            className="search"
            placeholder="marketing/brand/logo.png"
            value={kit.logo}
            onChange={(e) => setBrand({ ...kit, logo: e.target.value })}
          />
        </label>
      </div>
      <div className="post-actions">
        <button
          className="btn btn-primary"
          disabled={!brand}
          onClick={async () => {
            const ok = await post('brand', {
              brand: {
                ...kit,
                products: kit.products.map((p) => p.trim()).filter(Boolean)
              }
            })
            if (ok) setBrand(null)
          }}
        >
          Save the brand kit
        </button>
        {brand && (
          <button className="btn" onClick={() => setBrand(null)}>
            Undo changes
          </button>
        )}
        {(kit.website || site.trim()) && (
          <button
            className="btn"
            onClick={() =>
              onAsk(
                'Marketing agent',
                `Read ${kit.website || site.trim()} with brand_from_site and propose our brand kit: show me what you found, then save it with brand_save.`
              )
            }
          >
            Read it from the site
          </button>
        )}
      </div>
    </div>
  )
}
