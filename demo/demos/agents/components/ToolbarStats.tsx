// Toolbar badges — each subscribes only to its own slice of the agent signals,
// frame-coalesced, so a slice change re-renders just that badge. None of them
// re-render the Agents tree: the sim drives the SVG imperatively and the tick
// count lives in its own signal (TickStat), so the 360-agent scene never
// re-renders. That decoupling — not throttling these badges — is what keeps it
// smooth.

import { useMemo } from 'react';
import { useRefSignalRender, type ReadonlyRefSignal } from 'react-refsignal';
import { Stat } from '../../../common/components/Stat';
import type { Agent } from '../types';

// Tick counter in its own leaf — bumping the count re-renders only this badge,
// never the scene above it.
export function TickStat({ tick }: { tick: ReadonlyRefSignal<number> }) {
  useRefSignalRender([tick], { frame: true });
  return <Stat label="tick" value={tick.current} />;
}

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
