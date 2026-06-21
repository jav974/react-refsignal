import { useMemo } from 'react';
import { useRefSignalRender } from 'react-refsignal';
import { Dot } from './Dot';
import {
  leaderMass,
  leaderName,
  leaderRow,
  panelHeading,
  panelStyle,
  rankCell,
} from '../styles/agents.styles';
import type { Agent } from '../types';

export function Leaderboard({ agents }: { agents: Agent[] }) {
  const sigs = useMemo(
    () => agents.flatMap((a) => [a.size, a.alive]),
    [agents],
  );
  useRefSignalRender(sigs, { frame: true });
  // Re-sort top-5 in the body. Cheap at N=60.
  const top = [...agents]
    .filter((a) => a.alive.current)
    .sort((a, b) => b.size.current - a.size.current)
    .slice(0, 5);

  return (
    <div style={panelStyle('top', 12)}>
      <div style={panelHeading}>TOP 5</div>
      {top.map((a, i) => (
        <div key={a.id} style={leaderRow}>
          <span style={rankCell}>#{i + 1}</span>
          <Dot hue={a.hue} />
          <span style={leaderName}>{a.name}</span>
          <span style={leaderMass}>{a.size.current.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}
