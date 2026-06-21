// The three reactive toolbar badges. Each subscribes only to its own slice of
// the agent signals (alive / size / callTarget), `frame`-coalesced — so a
// position-only tick never re-renders them.

import { useMemo } from 'react';
import { useRefSignalRender } from 'react-refsignal';
import { Stat } from '../../../common/components/Stat';
import type { Agent } from '../types';

export function AliveCount({ agents }: { agents: Agent[] }) {
  const sigs = useMemo(() => agents.map((a) => a.alive), [agents]);
  useRefSignalRender(sigs, { frame: true });
  let n = 0;
  for (const a of agents) if (a.alive.current) n++;
  return <Stat label="alive" value={`${n}/${agents.length}`} />;
}

export function BiggestBadge({ agents }: { agents: Agent[] }) {
  const sigs = useMemo(
    () => agents.flatMap((a) => [a.size, a.alive]),
    [agents],
  );
  useRefSignalRender(sigs, { frame: true });
  let max = 0;
  for (const a of agents) {
    if (a.alive.current && a.size.current > max) max = a.size.current;
  }
  return <Stat label="biggest" value={max.toFixed(1)} highlight />;
}

export function CallsCount({ agents }: { agents: Agent[] }) {
  // callTarget slice only — never re-renders on plain position updates.
  const sigs = useMemo(() => agents.map((a) => a.callTarget), [agents]);
  useRefSignalRender(sigs, { frame: true });
  let n = 0;
  for (const a of agents)
    if (a.alive.current && a.callTarget.current !== null) n++;
  return <Stat label="calls" value={n} />;
}
