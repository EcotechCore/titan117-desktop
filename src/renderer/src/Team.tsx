/**
 * The Team screen (11.6; decisions §68): the teams this person is in, this
 * laptop joining each team's key, letting laptops in after comparing codes,
 * the agents and apps shared with the team, and shared agents waiting to be
 * added. People, invites, roles and the audit log are on the web (titan117.com/team).
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
  onProblem
}: {
  agents: AgentDef[]
  apps: SidebarAppInfo[]
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
  const t = window.titan117.teams

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
          act={act}
          onAdd={async (entry) => {
            const { error, view: next } = await t.add(team.id, entry)
            setView(next)
            setNote(error)
          }}
        />
      ))}
    </div>
  )
}

function TeamCard({
  team,
  agents,
  apps,
  act,
  onAdd
}: {
  team: Team
  agents: AgentDef[]
  apps: SidebarAppInfo[]
  act: (call: () => Promise<TeamsView>) => Promise<void>
  onAdd: (entry: string) => Promise<void>
}): React.JSX.Element {
  const t = window.titan117.teams
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

      {team.inbox.map((e) => (
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
          <button className="btn btn-primary" onClick={() => void onAdd(e.id)}>
            {e.update ? 'Update it' : 'Add it'}
          </button>
          <button className="btn" onClick={() => void act(() => t.dismiss(team.id, e.id))}>
            Not now
          </button>
        </div>
      ))}

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

          <h3 className="section">Sidebar apps whose data the team shares</h3>
          <p className="muted">
            {mayShare
              ? 'Records travel between laptops that have the same app and share it with this team.'
              : 'As a viewer you receive the team’s records; changes you make here stay on this laptop.'}
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
                  </div>
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
        </>
      )}
    </section>
  )
}
