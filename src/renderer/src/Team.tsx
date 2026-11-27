/**
 * The Team screen (11.6; decisions §68): the teams this person is in, this
 * laptop joining each team's key, letting laptops in after comparing codes,
 * the agents and apps shared with the team, shared agents and apps waiting
 * to be added, and (for owners and admins) what the team shared, opened from
 * the audit log's sealed notes. People, invites, roles and the audit log are on the web (titan117.com/team).
 *
 * The roles decide what shows: viewers receive only; members share; owners
 * and admins also let laptops in. The shell and our cloud check again.
 */
import { useEffect, useState } from 'react'

import type { TeamsView } from '../../preload/index.d'
import { teamCan, TEAM_ROLE_LABELS, type TeamRole } from '../../shared/team-roles'
import type { AgentDef } from '../../shared/protocol'
import type { SidebarAppInfo } from './SidebarApp'

type Team = TeamsView['teams'][number]

export function TeamView({
  agents,
  apps,
  folders,
  onProblem
}: {
  agents: AgentDef[]
  apps: SidebarAppInfo[]
  /** The allowed folders: a shared app's files go into a new folder inside one of them. */
  folders: string[]
  onProblem: (error: unknown) => void
}): React.JSX.Element {
  const [view, setView] = useState<TeamsView | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void window.titan117.teams.status().then(setView).catch(onProblem)
    window.titan117.teams.onChange(setView)
  }, [onProblem])

  const act = async (call: () => Promise<TeamsView>): Promise<void> => {
    try {
      setView(await call())
    } catch (error) {
      onProblem(error)
    }
  }

  if (!view) return <div className="list-view" />
  return (
    <div className="list-view">
      <h1 className="view-title">Team</h1>
      <p className="muted">
        Share agents and sidebar apps with the people on your team. What you share travels sealed
        between your laptops: Titan117 sees who is in a team, never what it shares. People, invites,
        roles and the audit log are on the Team page of your Titan117 account.
      </p>
      {!view.signedIn && <p className="warn">Sign in to your Titan117 account first.</p>}
      {view.problem && <p className="warn">{view.problem}</p>}
      {note && <p className="warn">{note}</p>}
      {view.signedIn && view.teams.length === 0 && (
        <p className="muted">
          You’re not in a team yet. Someone on a team sends you an invite link, or start one with
          the Team or Agency plan.
        </p>
      )}
      {view.teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          agents={agents}
          apps={apps}
          folders={folders}
          act={act}
          onResult={(result) => {
            setView(result.view)
            setNote(result.error)
          }}
        />
      ))}
    </div>
  )
}

type Result = { error: string | null; view: TeamsView }

function TeamCard({
  team,
  agents,
  apps,
  folders,
  act,
  onResult
}: {
  team: Team
  agents: AgentDef[]
  apps: SidebarAppInfo[]
  folders: string[]
  act: (call: () => Promise<TeamsView>) => Promise<void>
  onResult: (result: Result) => void
}): React.JSX.Element {
  const t = window.titan117.teams
  const [picked, setParent] = useState<string>('')
  // The folders arrive after the screen opens; the first is the default.
  const parent = picked || folders[0] || ''
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, call: () => Promise<Result>): Promise<void> => {
    setBusy(key)
    try {
      onResult(await call())
    } finally {
      setBusy(null)
    }
  }
  const role: TeamRole = team.role
  const mayShare = teamCan(role, 'shareItems')
  const own = agents.filter(
    (a) => !a.builtIn && !a.source.startsWith('team ') && !a.source.startsWith('add-on ')
  )

  return (
    <section aria-label={team.name}>
      <h2 className="section">
        {team.name} <span className="muted">· {TEAM_ROLE_LABELS[role].name}</span>
      </h2>
      <div className="row">
        <div className="row-main">
          <p className="row-title">
            {!team.active
              ? 'Paused: the team’s plan doesn’t cover you right now'
              : !team.on
                ? 'This laptop isn’t in the team yet'
                : team.status === 'in'
                  ? 'This laptop is in the team'
                  : team.status === 'waiting'
                    ? 'Waiting for an owner or admin to let this laptop in'
                    : 'Joining…'}
          </p>
          <p className="muted">{TEAM_ROLE_LABELS[role].what}.</p>
          {team.problem && <p className="warn">{team.problem}</p>}
        </div>
        {team.on ? (
          <button
            className="btn"
            onClick={() => {
              if (
                window.confirm(
                  `Take this laptop out of ${team.name}? It stops getting what the team shares.`
                )
              )
                void act(() => t.leave(team.id))
            }}
          >
            Leave on this laptop
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!team.active}
            onClick={() => void act(() => t.join(team.id))}
          >
            Join on this laptop
          </button>
        )}
      </div>

      {team.confirm && (
        <div className="row">
          <div className="row-main">
            <p className="row-title">
              {team.confirm.by} let this laptop in. Do they see this code too?
            </p>
            <p className="pair-code">{team.confirm.code}</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => void act(() => t.confirm(team.id, true))}
          >
            It matches
          </button>
          <button className="btn" onClick={() => void act(() => t.confirm(team.id, false))}>
            It doesn’t
          </button>
        </div>
      )}
      {team.waiting.map((w) => (
        <div className="row" key={w.id}>
          <div className="row-main">
            <p className="row-title">
              Let {w.person}’s laptop ({w.name}) in? Check they see this code:
            </p>
            <p className="pair-code">{w.code}</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => void act(() => t.allow(team.id, w.id))}
          >
            Let in
          </button>
          <button className="btn" onClick={() => void act(() => t.refuse(team.id, w.id))}>
            Don’t let in
          </button>
        </div>
      ))}

      {team.inbox.map((e) =>
        e.type === 'agent' ? (
          <div className="row" key={e.id}>
            <div className="row-main">
              <p className="row-title">
                {e.from} {e.update ? 'updated' : 'shared'} the agent {e.name}
              </p>
              <p className="muted">
                An agent follows its instructions with the tools it names, so look at it first: it
                comes to you as written by {e.from}, and every action still asks you as usual.
              </p>
            </div>
            <button
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => void run(e.id, () => t.add(team.id, e.id))}
            >
              {e.update ? 'Update it' : 'Add it'}
            </button>
            <button className="btn" onClick={() => void act(() => t.dismiss(team.id, e.id))}>
              Not now
            </button>
          </div>
        ) : (
          <div className="row" key={e.id}>
            <div className="row-main">
              <p className="row-title">
                {e.from} shared the app {e.name}
              </p>
              <p className="muted">
                Its files are copied into a new folder, <code>{e.appId}</code>, inside the folder
                you pick. Then add it to the sidebar from Apps: you’ll see what data it asks for and
                its checks run before it opens.
                {e.asks && (e.asks.reads.length > 0 || e.asks.writes.length > 0 || e.asks.ai)
                  ? ` It asks to ${[
                      e.asks.reads.length ? `read ${e.asks.reads.join(', ')}` : '',
                      e.asks.writes.length ? `change ${e.asks.writes.join(', ')}` : '',
                      e.asks.ai ? 'ask the AI model' : ''
                    ]
                      .filter(Boolean)
                      .join(', ')}.`
                  : ''}
              </p>
              {folders.length === 0 ? (
                <p className="warn">Allow a folder first (the + beside Folders).</p>
              ) : (
                <select
                  aria-label={`Folder for ${e.name}`}
                  value={parent}
                  onChange={(ev) => setParent(ev.target.value)}
                >
                  {folders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              className="btn btn-primary"
              disabled={busy !== null || !parent}
              onClick={() => void run(e.id, () => t.addApp(team.id, e.id, parent))}
            >
              Copy it here
            </button>
            <button className="btn" onClick={() => void act(() => t.dismiss(team.id, e.id))}>
              Not now
            </button>
          </div>
        )
      )}

      {team.status === 'in' && (
        <>
          <h3 className="section">Laptops in the team</h3>
          {team.laptops.map((l) => (
            <div className="row" key={l.id}>
              <div className="row-main">
                <p className="row-title">
                  {l.person} · {l.name} {l.me && <span className="muted">(this laptop)</span>}
                </p>
                {l.code && <p className="muted">Code with this laptop: {l.code}</p>}
              </div>
              {!l.me && teamCan(role, 'admitLaptop') && (
                <button
                  className="btn"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Take ${l.person}’s ${l.name} out of the team? The team key changes.`
                      )
                    )
                      void act(() => t.remove(team.id, l.id))
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}

          <h3 className="section">Your agents shared with {team.name}</h3>
          {!mayShare ? (
            <p className="muted">Viewers use what the team shares, without sharing their own.</p>
          ) : own.length === 0 ? (
            <p className="muted">Make an agent on Agents to share it here.</p>
          ) : (
            own.map((a) => {
              const on = team.sharedAgents.includes(a.name)
              return (
                <label className="row" key={a.id}>
                  <div className="row-main">
                    <p className="row-title">{a.name}</p>
                    <p className="muted">{a.role}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={on}
                    aria-label={`Share ${a.name} with ${team.name}`}
                    onChange={() => void act(() => t.shareAgent(team.id, a.name, !on))}
                  />
                </label>
              )
            })
          )}

          <h3 className="section">Sidebar apps shared with {team.name}</h3>
          <p className="muted">
            {mayShare
              ? 'Records travel between laptops that have the same app and share it with this team. “Send the app” gives the team its files; send it again after you change it.'
              : 'As a viewer you receive the team’s records, and the app’s data can’t be changed on this laptop.'}
          </p>
          {apps.length === 0 ? (
            <p className="muted">No sidebar apps yet.</p>
          ) : (
            apps.map((app) => {
              const on = team.sharedApps.includes(app.id)
              return (
                <label className="row" key={app.id}>
                  <div className="row-main">
                    <p className="row-title">{app.title}</p>
                    {team.sharedAppCode.includes(app.id) && (
                      <p className="muted">Its files were sent to the team.</p>
                    )}
                  </div>
                  {mayShare && (
                    <button
                      className="btn"
                      disabled={busy !== null}
                      onClick={(ev) => {
                        ev.preventDefault()
                        void run(`app:${app.id}`, () => t.shareAppCode(team.id, app.id))
                      }}
                    >
                      {busy === `app:${app.id}` ? 'Sending…' : 'Send the app'}
                    </button>
                  )}
                  <input
                    type="checkbox"
                    checked={on}
                    aria-label={`Share ${app.title}’s data with ${team.name}`}
                    onChange={() => void act(() => t.shareApp(team.id, app.id, !on))}
                  />
                </label>
              )
            })
          )}

          {teamCan(role, 'seeAudit') && team.activity.length > 0 && (
            <>
              <h3 className="section">What the team shared</h3>
              <p className="muted">
                From the team’s audit log, opened on this laptop with the team key.
              </p>
              {team.activity.map((a, i) => (
                <div className="row" key={`${a.at}-${i}`}>
                  <div className="row-main">
                    <p className="row-title">
                      {a.who}{' '}
                      {a.action === 'item.removed'
                        ? 'stopped sharing'
                        : a.action === 'item.updated'
                          ? 'updated'
                          : 'shared'}{' '}
                      {a.what}
                    </p>
                    <p className="muted">{new Date(a.at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </section>
  )
}
