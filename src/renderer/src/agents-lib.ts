// Plain helpers for the Agents screen and the sidebar (decisions §59).
import type { AgentDef } from '../../shared/protocol'

/** The agents, grouped by team (Titan apart, at the top), teams by name. */
export function byTeam(agents: AgentDef[]): [string, AgentDef[]][] {
  const groups = new Map<string, AgentDef[]>()
  for (const a of agents) {
    if (a.builtIn && a.name === 'Titan') continue
    const team = a.team || 'Other agents'
    groups.set(team, [...(groups.get(team) ?? []), a])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}
