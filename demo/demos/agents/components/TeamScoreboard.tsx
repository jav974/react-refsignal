import { useMemo } from 'react';
import { useRefSignalRender } from 'react-refsignal';
import { N_TEAMS, TEAM_HUES, TEAM_NAMES } from '../logic/config';
import {
  panelHeading,
  panelStyle,
  teamCount,
  teamMass,
  teamName,
  teamRow,
  teamSwatch,
} from '../styles/agents.styles';
import type { Agent } from '../types';

export function TeamScoreboard({ agents }: { agents: Agent[] }) {
  return (
    <div style={panelStyle('left', 12)}>
      <div style={panelHeading}>TEAMS</div>
      {Array.from({ length: N_TEAMS }, (_, t) => (
        <TeamRow key={t} team={t} agents={agents} />
      ))}
    </div>
  );
}

function TeamRow({ team, agents }: { team: number; agents: Agent[] }) {
  const teamAgents = useMemo(
    () => agents.filter((a) => a.team === team),
    [agents, team],
  );
  const sigs = useMemo(
    () => teamAgents.flatMap((a) => [a.size, a.alive]),
    [teamAgents],
  );
  // Re-renders only on its own team's signals — other teams trigger nothing here.
  useRefSignalRender(sigs, { frame: true });

  let alive = 0;
  let mass = 0;
  for (const a of teamAgents) {
    if (a.alive.current) {
      alive++;
      mass += a.size.current;
    }
  }
  const eliminated = alive === 0;

  return (
    <div style={teamRow(eliminated)}>
      <span style={teamSwatch(TEAM_HUES[team])} />
      <span style={teamName}>{TEAM_NAMES[team]}</span>
      <span style={teamCount}>
        {alive}/{teamAgents.length}
      </span>
      <span style={teamMass}>{mass.toFixed(0)}</span>
    </div>
  );
}
