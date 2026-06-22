// Agar.io-style chase/flee simulation, permadeath. Each agent owns
// position/size/alive/callTarget signals; per-signal effects update the SVG
// directly — no per-frame React renders. Reactive panels each subscribe only
// to their slice. Same-team call broadcasts via `callTarget` propagate through
// `trackSignals` for emergent pack-hunting.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  usePulseRefSignal,
  useRefSignal,
  useRefSignalEffect,
} from 'react-refsignal';
import { CodeChip } from '../../common/components/CodeChip';
import { FpsBadge } from '../../common/components/FpsBadge';
import { Stat } from '../../common/components/Stat';
import { useElementSize } from '../../common/hooks/useElementSize';
import {
  btnStyle,
  hintStyle,
  selectStyle,
  sliderLabel,
  toolbarStyle,
} from '../../common/styles';
import { AgentDot } from './components/AgentDot';
import { CallLines } from './components/CallLines';
import { Killcam } from './components/Killcam';
import { Leaderboard } from './components/Leaderboard';
import { PelletDot } from './components/PelletDot';
import { SpeedControl } from './components/SpeedControl';
import { TeamScoreboard } from './components/TeamScoreboard';
import {
  AliveCount,
  BiggestBadge,
  CallsCount,
  TickStat,
} from './components/ToolbarStats';
import { WinnerBanner } from './components/WinnerBanner';
import { COUNTS, DEFAULT_COUNT } from './logic/config';
import { makeAgent, makePellet, tick } from './logic/simulation';
import { demo } from './logic/state';
import {
  pageStyle,
  rightGroup,
  stageStyle,
  stageSvgStyle,
} from './styles/agents.styles';
import type { Agent, Count, Vec } from './types';

export default function Agents() {
  demo.useLifetime();
  const { killFeed, tickSpeed } = demo.state();
  const [seed, setSeed] = useState(0);
  const [count, setCount] = useState<Count>(DEFAULT_COUNT);
  const [running, setRunning] = useState(true);
  // Tick count lives in a signal, not React state — bumping it each tick must
  // not re-render Agents (which would re-render all 360 AgentDots + pellets).
  // Only <TickStat> subscribes to it.
  const tickN = useRefSignal(0, 'agents.tickN');
  const [winner, setWinner] = useState<Agent | null>(null);
  const [controlledId, setControlledId] = useState<number | null>(null);
  // World-coord mouse — ref (not state) so motion doesn't trigger re-renders.
  const mouseRef = useRef({ x: 0, y: 0 });

  // Stage size → world bounds. The sim takes a `Vec`, so map width/height to
  // x/y; `stage` is identity-stable, so `world` only re-rolls on real resize.
  const { ref: stageRef, size: stage } = useElementSize(() => ({
    width: window.innerWidth - 32,
    height: window.innerHeight - 140,
  }));
  const world = useMemo<Vec>(
    () => ({ x: stage.width, y: stage.height }),
    [stage],
  );

  const pelletCount = count * 2;

  // Recreate on count/world change or seed bump (reset).
  const agents = useMemo(
    () => Array.from({ length: count }, (_, i) => makeAgent(i, world)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed deliberately invalidates the memo on reset
    [count, world, seed],
  );
  const pellets = useMemo(
    () => Array.from({ length: pelletCount }, (_, i) => makePellet(i, world)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pelletCount, world, seed],
  );

  // Dispose the previous generation's per-agent / per-pellet signals when
  // the memos re-roll (count/world/seed change), and on unmount. Each agent
  // owns 4 signals × N agents, plus 1 per pellet — without cleanup, every
  // reset would stack hundreds of dead signals in the devtools registry.
  useEffect(() => {
    return () => {
      for (const a of agents) {
        a.position.dispose();
        a.size.dispose();
        a.alive.dispose();
        a.callTarget.dispose();
      }
    };
  }, [agents]);
  useEffect(() => {
    return () => {
      for (const p of pellets) p.alive.dispose();
    };
  }, [pellets]);

  // Reset round-state on agent-identity change.
  useEffect(() => {
    killFeed.update([]);
    setWinner(null);
    tickN.update(0);
    setRunning(true);
    setControlledId(null);
  }, [agents, killFeed, tickN]);

  // Auto-release control when the controlled agent dies.
  useEffect(() => {
    if (controlledId === null) return;
    const a = agents[controlledId];
    if (!a) return;
    const listener = () => {
      if (!a.alive.current) setControlledId(null);
    };
    a.alive.subscribe(listener);
    return () => {
      a.alive.unsubscribe(listener);
    };
  }, [controlledId, agents]);

  // Tick loop, rate-gated by `tickSpeed.current` (read directly so speed
  // changes don't restart the subscription).
  const frame = usePulseRefSignal('frame', 'agents.frame');
  const lastTickRef = useRef(0);
  useEffect(() => {
    if (!running || winner) return;
    lastTickRef.current = 0;
  }, [running, agents, pellets, world, winner, controlledId]);
  useRefSignalEffect(() => {
    if (!running || winner) return;
    const now = frame.elapsed;
    const interval = 1000 / Math.max(1, tickSpeed.current);
    if (now - lastTickRef.current >= interval) {
      const result = tick(agents, pellets, world, {
        agentId: controlledId,
        mouse: mouseRef.current,
      });
      lastTickRef.current = now;
      tickN.update(tickN.current + 1);
      if (result.gameOver) {
        setWinner(result.survivor);
      }
    }
    // tickN is intentionally NOT a dep: it's written here, and subscribing to a
    // signal you write re-fires the effect (re-entrancy). The latest closure is
    // always used, so reading/writing tickN.current works without listing it.
  }, [frame, running, agents, pellets, world, winner, controlledId]);

  const reset = () => {
    setSeed((s) => s + 1);
  };

  return (
    <div style={pageStyle}>
      <div style={toolbarStyle}>
        <button
          onClick={() => {
            setRunning((r) => !r);
          }}
          disabled={!!winner}
          style={btnStyle(running && !winner, running ? '#f97316' : '#10b981')}
        >
          {running ? 'Pause' : 'Play'}
        </button>
        <button onClick={reset} style={btnStyle(false, '#64748b')}>
          New round
        </button>

        <label style={sliderLabel}>
          Agents
          <select
            value={count}
            onChange={(e) => {
              setCount(+e.target.value as Count);
            }}
            style={selectStyle}
          >
            {COUNTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <SpeedControl />

        <span style={rightGroup}>
          {controlledId !== null && agents[controlledId] && (
            <Stat label="control" value={agents[controlledId].name} highlight />
          )}
          <TickStat tick={tickN} />
          <AliveCount agents={agents} />
          <BiggestBadge agents={agents} />
          <CallsCount agents={agents} />
          <FpsBadge src={frame} />
        </span>
      </div>

      <div style={hintStyle}>
        {count} agents, 4 teams, permadeath — bigger eats smaller.{' '}
        <b>Click any agent</b> to control it (steers toward cursor). Each agent
        owns 4 signals = {count * 4} reactive cells. <b>Pack hunting:</b> agents
        broadcast their target via <CodeChip>callTarget</CodeChip>; teammates
        within hearing range adopt it. Dashed lines follow each call through{' '}
        <CodeChip>trackSignals</CodeChip>. Panels subscribe only to their slice
        — no central re-render.
      </div>

      <div ref={stageRef} style={stageStyle}>
        <svg
          viewBox={`0 0 ${world.x} ${world.y}`}
          preserveAspectRatio="none"
          style={stageSvgStyle(controlledId !== null)}
          onPointerMove={(e) => {
            const svg = e.currentTarget;
            const rect = svg.getBoundingClientRect();
            mouseRef.current = {
              x: ((e.clientX - rect.left) / rect.width) * world.x,
              y: ((e.clientY - rect.top) / rect.height) * world.y,
            };
          }}
        >
          {pellets.map((p) => (
            <PelletDot key={p.id} pellet={p} />
          ))}
          <CallLines agents={agents} />
          {agents.map((a) => (
            <AgentDot
              key={a.id}
              agent={a}
              showName={count <= 120}
              showVision={count <= 120}
              controlled={a.id === controlledId}
              onTakeControl={setControlledId}
            />
          ))}
        </svg>

        <TeamScoreboard agents={agents} />
        <Leaderboard agents={agents} />
        <Killcam />

        {winner && <WinnerBanner winner={winner} onReset={reset} />}
      </div>
    </div>
  );
}
