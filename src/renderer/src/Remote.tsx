// Remote control and chat (phase 15; decisions §64): use Titan117 from your
// phone, another browser or Telegram while this laptop does the work. Off by
// default; switching on asks for your second factor on the web, and every new
// device is allowed here, after you compare its code.
import { useEffect, useState } from 'react'
import { renderSVG } from 'uqr'

import type { RemoteView, TelegramView } from '../../preload/index.d'

function PairCode({ link }: { link: string }): React.JSX.Element | null {
  if (!/^https?:\/\/[^\s"<>]+$/.test(link)) return null
  return (
    <div
      className="app-qr"
      role="img"
      aria-label="QR code to pair a phone or browser"
      // uqr draws only squares from the checked address.
      dangerouslySetInnerHTML={{ __html: renderSVG(link, { border: 2 }) }}
    />
  )
}

export function RemoteView({
  folders,
  onProblem
}: {
  folders: string[]
  onProblem: (error: unknown) => void
}): React.JSX.Element {
  const [remote, setRemote] = useState<RemoteView | null>(null)
  const [telegram, setTelegram] = useState<TelegramView | null>(null)
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [tokenProblem, setTokenProblem] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    void window.titan117.remote.status().then(setRemote).catch(onProblem)
    void window.titan117.telegram.status().then(setTelegram).catch(onProblem)
    window.titan117.remote.onChange(setRemote)
    window.titan117.telegram.onChange(setTelegram)
    // Pairing links and link codes run out: redraw once a second.
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [onProblem])

  const act = async <T,>(call: () => Promise<T>, then: (v: T) => void): Promise<void> => {
    try {
      then(await call())
    } catch (error) {
      onProblem(error)
    }
  }

  if (!remote || !telegram) return <div className="list-view" />
  const r = window.titan117.remote
  const t = window.titan117.telegram
  const left = (until: number): string => {
    const s = Math.max(0, Math.round((until - now) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  return (
    <div className="list-view">
      <h1 className="view-title">Remote control</h1>
      <p className="muted">
        Start tasks, watch them and answer approvals from your phone, another browser or Telegram,
        while this laptop does the work. Messages through Titan117 are end-to-end encrypted: only
        your own devices can read them. Deleting, paying, sending things out and changing
        permissions are still approved here, on the laptop.
      </p>

      <h2 className="section">This laptop</h2>
      <div className="row">
        <div className="row-main">
          <p className="row-title">
            {!remote.on
              ? 'Off'
              : remote.confirmed
                ? 'On: paired devices can reach this laptop'
                : 'Waiting for your second factor in the browser'}
          </p>
          <p className="muted">
            {remote.on
              ? 'Switching off stops every remote task request at once.'
              : 'Switching on opens your Titan117 account in the browser to confirm with your second factor (a passkey or an authenticator app).'}
          </p>
          {remote.problem && <p className="warn">{remote.problem}</p>}
        </div>
        {remote.on ? (
          <button className="btn" onClick={() => void act(r.switchOff, setRemote)}>
            Switch off
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!remote.keychain}
            onClick={() => void act(r.switchOn, setRemote)}
          >
            Switch on
          </button>
        )}
      </div>

      {remote.confirmed && (
        <>
          <h2 className="section">Pair a phone or browser</h2>
          {remote.waiting.map((w) => (
            <div className="row" key={w.pairingId} role="alert">
              <div className="row-main">
                <p className="row-title">Allow {w.name}?</p>
                <p>
                  Check the code on that screen matches:{' '}
                  <strong className="pair-code">{w.code}</strong>
                </p>
                <p className="muted">
                  If it doesn’t match, or you didn’t just pair a device, don’t allow it.
                </p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => void act(() => r.answerPairing(w.pairingId, true), setRemote)}
              >
                Allow
              </button>
              <button
                className="btn"
                onClick={() => void act(() => r.answerPairing(w.pairingId, false), setRemote)}
              >
                Don’t allow
              </button>
            </div>
          ))}
          {remote.pairing ? (
            <div className="row">
              <PairCode link={remote.pairing.link} />
              <div className="row-main">
                <p>
                  Scan this with your phone, or open the link in another browser where you’re signed
                  in to Titan117.
                </p>
                <p className="muted">Valid for {left(remote.pairing.expiresAt)}, once.</p>
                <button
                  className="btn"
                  onClick={() => void navigator.clipboard.writeText(remote.pairing!.link)}
                >
                  Copy link
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={() => void act(r.pair, setRemote)}>
              Pair a phone or browser
            </button>
          )}

          <h2 className="section">Paired devices</h2>
          {remote.devices.length === 0 && <p className="empty">None yet.</p>}
          {remote.devices.map((d) => (
            <div className="row" key={d.publicKey}>
              <div className="row-main">
                <p className="row-title">{d.name}</p>
                <p className="muted">Paired {new Date(d.pairedAt).toLocaleDateString()}</p>
              </div>
              <button
                className="btn"
                onClick={() => void act(() => r.remove(d.publicKey), setRemote)}
              >
                Remove
              </button>
            </div>
          ))}

          <h2 className="section">Files sent from your phone or chat</h2>
          <label className="field">
            Save them in
            <select
              value={remote.inboxFolder ?? ''}
              onChange={(e) => void act(() => r.setInbox(e.target.value || null), setRemote)}
            >
              <option value="">Don’t accept files</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <h2 className="section">Telegram</h2>
      <p className="muted">
        Your own Telegram bot talks to this laptop directly; nothing goes through Titan117’s
        servers. Telegram can read these messages (they aren’t end-to-end encrypted), and as the
        bot’s owner you’re responsible for it under Telegram’s bot terms. Only your private chat
        with the bot counts; groups are ignored.
      </p>
      {telegram.problem && <p className="warn">{telegram.problem}</p>}
      {!telegram.connected ? (
        <>
          <ol className="steps">
            <li>In Telegram, open a chat with @BotFather and send /newbot.</li>
            <li>Choose a name and a user name for your bot.</li>
            <li>
              BotFather answers with a token. Paste it here; it’s kept in this laptop’s keychain.
            </li>
          </ol>
          <div className="add-row">
            <input
              className="search"
              type="password"
              aria-label="Your bot's token from BotFather"
              placeholder="123456789:AA…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={!token.trim() || connecting}
              onClick={() => {
                setConnecting(true)
                setTokenProblem(null)
                void t
                  .connect(token)
                  .then((res) => {
                    if (res.ok) setToken('')
                    else setTokenProblem(res.message)
                  })
                  .catch(onProblem)
                  .finally(() => setConnecting(false))
              }}
            >
              {connecting ? 'Checking…' : 'Connect'}
            </button>
          </div>
          {tokenProblem && <p className="warn">{tokenProblem}</p>}
        </>
      ) : (
        <div className="row">
          <div className="row-main">
            <p className="row-title">@{telegram.botName}</p>
            {telegram.linked ? (
              <p className="muted">Linked to your chat ({telegram.linked.name}).</p>
            ) : telegram.code ? (
              <p>
                Send <strong className="pair-code">{telegram.code.code}</strong> to @
                {telegram.botName} in a private chat (valid {left(telegram.code.expiresAt)}).
              </p>
            ) : (
              <p className="muted">Not linked to a chat yet.</p>
            )}
            {!remote.confirmed && (
              <p className="muted">Tasks from the chat run only while remote control is on.</p>
            )}
          </div>
          {telegram.linked ? (
            <button className="btn" onClick={() => void act(t.unlink, setTelegram)}>
              Unlink
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void act(t.link, setTelegram)}>
              Link my chat
            </button>
          )}
          <button className="btn" onClick={() => void act(t.disconnect, setTelegram)}>
            Remove bot
          </button>
        </div>
      )}

      <h2 className="section">If a device is lost</h2>
      <div className="row">
        <div className="row-main">
          <p className="muted">
            Revoke all devices unpairs every phone and browser, unlinks the chat and changes this
            laptop’s key. The laptop keeps working on its own.
          </p>
        </div>
        <button
          className="btn"
          onClick={() => {
            if (window.confirm('Unpair every phone and browser and unlink the chat?'))
              void act(r.revokeAll, setRemote)
          }}
        >
          Revoke all devices
        </button>
      </div>
    </div>
  )
}
