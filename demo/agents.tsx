// demo/agents.tsx
//
// Automated agar.io-style chase/flee simulation. Permadeath — last one standing
// wins. The actual signal demo:
//
//   - Each agent owns position / size / alive / callTarget signals.
//   - SVG circles update via per-signal `useRefSignalEffect` — no React renders
//     in the per-frame path.
//   - Six independent reactive consumers each subscribe to ONLY the signals they
//     care about: alive count, biggest badge, calls count, leaderboard, team
//     scoreboard, killcam feed, winner banner. None of them re-render on
//     simulation ticks unless their slice of state actually changed.
//   - Inter-agent coordination via signals: each agent broadcasts its current
//     target via `callTarget`. Same-team allies within HEARING radius adopt
//     the call when they lack a target of their own — pack-hunting emerges.
//     The CallLines layer follows each call with `trackSignals` so when an
//     agent's callTarget changes, the line subscription swaps to the new
//     target's position signal automatically.
//
// This is what signals are actually for: heterogeneous fanout of changes to
// different consumers without a central re-render or manual invalidation,
// plus declarative cross-entity communication without a central event bus.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  batch,
  createRefSignal,
  usePulseRefSignal,
  useRefSignalEffect,
  useRefSignalRender,
  type RefSignal,
} from 'react-refsignal';
import { FpsBadge } from './fps';

// ---------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------

type Vec = { x: number; y: number };

type Agent = {
  id: number;
  team: number;
  hue: number;
  name: string;
  position: RefSignal<Vec>;
  size: RefSignal<number>;
  alive: RefSignal<boolean>;
  vx: number;
  vy: number;
  kills: number;
  // Tracked across ticks to avoid flip-flop between equidistant candidates —
  // each agent sticks with its current target/threat as long as it remains valid.
  targetId: number | null;
  threatId: number | null;
  // Public broadcast of "the target I've committed to." Same-team allies within
  // HEARING radius can adopt this when they have no target of their own. Pack
  // hunting emerges as the call propagates outward each tick.
  callTarget: RefSignal<number | null>;
};

type Pellet = {
  id: number;
  x: number;
  y: number;
  alive: RefSignal<boolean>;
  deadTicks: number;
};

type KillEvent = {
  killerId: number;
  killerName: string;
  killerHue: number;
  victimName: string;
  victimHue: number;
};

type ControlState = {
  agentId: number | null;
  mouse: Vec;
};

const COUNTS = [60, 120, 180, 240, 360] as const;
type Count = (typeof COUNTS)[number];
const DEFAULT_COUNT: Count = 120;
const TEAM_HUES = [10, 50, 140, 220];
const TEAM_NAMES = ['Crimson', 'Solar', 'Forest', 'Tide'];
const N_TEAMS = TEAM_NAMES.length;
const VISION = 220;
const HEARING = 320; // teammate-call propagation radius — wider than vision so calls inform agents that don't see the prey themselves
const BASE_SPEED = 2.2;
const MIN_SIZE = 4;
const SIZE_THRESHOLD = 1.15;
const MASS_GAIN = 0.7;
const PELLET_RESPAWN_TICKS = 240;
const PELLET_VALUE = 0.7;
const KILLCAM_MAX = 6;
const GRID_CELL = 80; // spatial-hash cell size — tuned so VISION (220) covers ~3 cells
const TURN_RATE = 0.15; // steering inertia (0 = no turn, 1 = instant turn)

const ADJ = [
  'Swift', 'Brave', 'Sneaky', 'Wild', 'Clever', 'Bold', 'Sly', 'Fierce',
  'Cosmic', 'Thunder', 'Iron', 'Storm', 'Shadow', 'Crystal', 'Nimble',
];
const NOUN = [
  'Fox', 'Wolf', 'Hawk', 'Bear', 'Tiger', 'Owl', 'Cobra', 'Falcon',
  'Lynx', 'Raven', 'Lion', 'Shark', 'Eagle', 'Panther', 'Drake',
];

// Killcam feed — one RefSignal holding the last N kills. Subscribed by the
// Killcam component and (transitively) the leaderboard's "kills" stat.
const killFeed = createRefSignal<KillEvent[]>([]);

// Module-scope simulation speed (ticks/sec target). The slider component
// subscribes via useRefSignalRender; the RAF loop reads `.current` directly
// without re-subscribing — changing speed never restarts the loop.
const tickSpeed = createRefSignal<number>(60);

function pushKill(ev: KillEvent) {
  killFeed.update([ev, ...killFeed.current].slice(0, KILLCAM_MAX));
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function radiusOf(size: number): number {
  return Math.sqrt(size) * 2.6;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeAgent(id: number, world: Vec): Agent {
  const team = id % N_TEAMS;
  const baseHue = TEAM_HUES[team];
  // Slight per-agent jitter within team color band.
  const hue = (baseHue + rand(-12, 12) + 360) % 360;
  return {
    id,
    team,
    hue,
    name: `${pick(ADJ)}${pick(NOUN)}`,
    position: createRefSignal<Vec>({
      x: rand(40, world.x - 40),
      y: rand(40, world.y - 40),
    }),
    size: createRefSignal(rand(MIN_SIZE, MIN_SIZE + 6)),
    alive: createRefSignal(true),
    vx: rand(-1, 1),
    vy: rand(-1, 1),
    kills: 0,
    targetId: null,
    threatId: null,
    callTarget: createRefSignal<number | null>(null),
  };
}

function makePellet(id: number, world: Vec): Pellet {
  return {
    id,
    x: rand(20, world.x - 20),
    y: rand(20, world.y - 20),
    alive: createRefSignal(true),
    deadTicks: 0,
  };
}

// ---------------------------------------------------------------
// Tick
// ---------------------------------------------------------------

type TickResult = { gameOver: boolean; survivor: Agent | null };

function tryEat(a: Agent, b: Agent) {
  const ap = a.position.current;
  const bp = b.position.current;
  const aSize = a.size.current;
  const bSize = b.size.current;
  const ar = radiusOf(aSize);
  const br = radiusOf(bSize);
  const dx = ap.x - bp.x;
  const dy = ap.y - bp.y;
  const d2 = dx * dx + dy * dy;
  const eatD = Math.max(ar, br) * 0.6;
  if (d2 >= eatD * eatD) return;
  if (aSize > bSize * SIZE_THRESHOLD) {
    a.size.update(aSize + bSize * MASS_GAIN);
    b.alive.update(false);
    b.callTarget.update(null);
    a.kills++;
    pushKill({
      killerId: a.id, killerName: a.name, killerHue: a.hue,
      victimName: b.name, victimHue: b.hue,
    });
  } else if (bSize > aSize * SIZE_THRESHOLD) {
    b.size.update(bSize + aSize * MASS_GAIN);
    a.alive.update(false);
    a.callTarget.update(null);
    b.kills++;
    pushKill({
      killerId: b.id, killerName: b.name, killerHue: b.hue,
      victimName: a.name, victimHue: a.hue,
    });
  }
}

function tick(
  agents: Agent[],
  pellets: Pellet[],
  world: Vec,
  control: ControlState,
): TickResult {
  // ─── Spatial hash: bucket alive agents + pellets into a coarse grid. ───
  // AI and collision queries become O(local density) instead of O(N).
  const cw = ((world.x / GRID_CELL) | 0) + 2;
  const ch = ((world.y / GRID_CELL) | 0) + 2;
  const total = cw * ch;
  const aGrid: Agent[][] = new Array(total);
  const pGrid: Pellet[][] = new Array(total);
  for (let i = 0; i < total; i++) { aGrid[i] = []; pGrid[i] = []; }

  const cellAt = (x: number, y: number) => {
    let cx = (x / GRID_CELL) | 0;
    let cy = (y / GRID_CELL) | 0;
    if (cx < 0) cx = 0; else if (cx >= cw) cx = cw - 1;
    if (cy < 0) cy = 0; else if (cy >= ch) cy = ch - 1;
    return cy * cw + cx;
  };

  for (const a of agents) {
    if (!a.alive.current) continue;
    const p = a.position.current;
    aGrid[cellAt(p.x, p.y)].push(a);
  }
  for (const p of pellets) {
    if (!p.alive.current) continue;
    pGrid[cellAt(p.x, p.y)].push(p);
  }

  const visionRad = Math.ceil(VISION / GRID_CELL);
  const visionD2 = VISION * VISION;
  const hearingRad = Math.ceil(HEARING / GRID_CELL);
  const hearingD2 = HEARING * HEARING;

  let aliveCount = 0;
  let last: Agent | null = null;

  batch(() => {
    // ─── 1. AI + physics ──────────────────────────────────────────────
    for (const a of agents) {
      if (!a.alive.current) continue;
      aliveCount++;
      last = a;

      const ap = a.position.current;
      const aSize = a.size.current;
      const speed = BASE_SPEED / Math.sqrt(Math.max(1, aSize / 5));

      // ── Player control: bypass AI entirely. ──────────────────────────
      // Controlled agent steers toward the mouse cursor. No automatic
      // threat avoidance — getting eaten is the player's responsibility.
      if (control.agentId === a.id) {
        a.targetId = null;
        a.threatId = null;
        a.callTarget.update(null);
        const ddx = control.mouse.x - ap.x;
        const ddy = control.mouse.y - ap.y;
        const dlen = Math.hypot(ddx, ddy) || 1;
        const desVx = (ddx / dlen) * speed;
        const desVy = (ddy / dlen) * speed;
        const sVx = a.vx * (1 - TURN_RATE) + desVx * TURN_RATE;
        const sVy = a.vy * (1 - TURN_RATE) + desVy * TURN_RATE;
        const sLen = Math.hypot(sVx, sVy) || 1;
        a.vx = (sVx / sLen) * speed;
        a.vy = (sVy / sLen) * speed;
        let nx = ap.x + a.vx;
        let ny = ap.y + a.vy;
        if (nx < 0) { nx = 0; a.vx = Math.abs(a.vx); }
        else if (nx > world.x) { nx = world.x; a.vx = -Math.abs(a.vx); }
        if (ny < 0) { ny = 0; a.vy = Math.abs(a.vy); }
        else if (ny > world.y) { ny = world.y; a.vy = -Math.abs(a.vy); }
        a.position.update({ x: nx, y: ny });
        continue;
      }

      const acx = (ap.x / GRID_CELL) | 0;
      const acy = (ap.y / GRID_CELL) | 0;

      // ── Persistence: keep last tick's target/threat if still valid. ──
      // This is the main fix for "bouncing": instead of re-picking from
      // scratch each tick (which flip-flops between equidistant candidates),
      // we stick with the current pick until it dies, leaves vision, or
      // ceases to satisfy the size threshold.
      let target: Agent | null = null;
      let threat: Agent | null = null;

      if (a.targetId !== null) {
        const c = agents[a.targetId];
        if (c && c.alive.current && aSize > c.size.current * SIZE_THRESHOLD) {
          const cp = c.position.current;
          const cdx = cp.x - ap.x;
          const cdy = cp.y - ap.y;
          if (cdx * cdx + cdy * cdy <= visionD2) target = c;
        }
      }
      if (a.threatId !== null) {
        const c = agents[a.threatId];
        if (c && c.alive.current && c.size.current > aSize * SIZE_THRESHOLD) {
          const cp = c.position.current;
          const cdx = cp.x - ap.x;
          const cdy = cp.y - ap.y;
          if (cdx * cdx + cdy * cdy <= visionD2) threat = c;
        }
      }

      // Scan grid for new target/threat only if needed.
      if (!target || !threat) {
        let bestTargetD2 = Infinity;
        let bestThreatD2 = Infinity;
        const xLo = Math.max(0, acx - visionRad);
        const xHi = Math.min(cw - 1, acx + visionRad);
        const yLo = Math.max(0, acy - visionRad);
        const yHi = Math.min(ch - 1, acy + visionRad);
        for (let cy = yLo; cy <= yHi; cy++) {
          for (let cx = xLo; cx <= xHi; cx++) {
            const bucket = aGrid[cy * cw + cx];
            for (let bi = 0; bi < bucket.length; bi++) {
              const b = bucket[bi];
              if (b === a) continue;
              const bp = b.position.current;
              const dxx = bp.x - ap.x;
              const dyy = bp.y - ap.y;
              const d2 = dxx * dxx + dyy * dyy;
              if (d2 > visionD2) continue;
              const bSize = b.size.current;
              if (!target && aSize > bSize * SIZE_THRESHOLD) {
                if (d2 < bestTargetD2) { target = b; bestTargetD2 = d2; }
              } else if (!threat && bSize > aSize * SIZE_THRESHOLD) {
                if (d2 < bestThreatD2) { threat = b; bestThreatD2 = d2; }
              }
            }
          }
        }
      }
      // Same-team call adoption — listen for nearby allies broadcasting a target.
      // If we have no target of our own and no threat, adopt the closest hearable
      // ally's call (prey must still pass our own size threshold). Calls then
      // propagate as we re-broadcast below — pack-hunting emerges across the team.
      if (!target && !threat) {
        const xLo = Math.max(0, acx - hearingRad);
        const xHi = Math.min(cw - 1, acx + hearingRad);
        const yLo = Math.max(0, acy - hearingRad);
        const yHi = Math.min(ch - 1, acy + hearingRad);
        let bestD2 = Infinity;
        for (let cy = yLo; cy <= yHi; cy++) {
          for (let cx = xLo; cx <= xHi; cx++) {
            const bucket = aGrid[cy * cw + cx];
            for (let bi = 0; bi < bucket.length; bi++) {
              const ally = bucket[bi];
              if (ally === a || ally.team !== a.team) continue;
              const aap = ally.position.current;
              const ddx = aap.x - ap.x;
              const ddy = aap.y - ap.y;
              const d2 = ddx * ddx + ddy * ddy;
              if (d2 > hearingD2 || d2 >= bestD2) continue;
              const calledId = ally.callTarget.current;
              if (calledId === null) continue;
              const called = agents[calledId];
              if (!called || !called.alive.current) continue;
              if (aSize <= called.size.current * SIZE_THRESHOLD) continue;
              target = called;
              bestD2 = d2;
            }
          }
        }
      }

      a.targetId = target ? target.id : null;
      a.threatId = threat ? threat.id : null;
      // Broadcast the target only when actively hunting — never while fleeing
      // (would propagate panic) and never when there's no target. `update()` is
      // a no-op when the value is unchanged, so this is cheap each tick.
      a.callTarget.update(!threat && target ? target.id : null);

      // Pellet seek when no agent priority.
      let pelletT: Pellet | null = null;
      if (!threat && !target) {
        let pelletD2 = Infinity;
        const xLo = Math.max(0, acx - visionRad);
        const xHi = Math.min(cw - 1, acx + visionRad);
        const yLo = Math.max(0, acy - visionRad);
        const yHi = Math.min(ch - 1, acy + visionRad);
        for (let cy = yLo; cy <= yHi; cy++) {
          for (let cx = xLo; cx <= xHi; cx++) {
            const bucket = pGrid[cy * cw + cx];
            for (let bi = 0; bi < bucket.length; bi++) {
              const p = bucket[bi];
              const dxx = p.x - ap.x;
              const dyy = p.y - ap.y;
              const d2 = dxx * dxx + dyy * dyy;
              if (d2 > visionD2) continue;
              if (d2 < pelletD2) { pelletT = p; pelletD2 = d2; }
            }
          }
        }
      }

      // Desired heading.
      let ddx: number;
      let ddy: number;
      if (threat) {
        const tp = threat.position.current;
        ddx = ap.x - tp.x;
        ddy = ap.y - tp.y;
      } else if (target) {
        const tp = target.position.current;
        ddx = tp.x - ap.x;
        ddy = tp.y - ap.y;
      } else if (pelletT) {
        ddx = pelletT.x - ap.x;
        ddy = pelletT.y - ap.y;
      } else {
        ddx = a.vx + rand(-0.4, 0.4);
        ddy = a.vy + rand(-0.4, 0.4);
      }

      const dlen = Math.hypot(ddx, ddy) || 1;
      const desVx = (ddx / dlen) * speed;
      const desVy = (ddy / dlen) * speed;

      // Steering inertia: blend toward desired velocity. Smooths out
      // direction flips and removes the "bouncing" feel for agents
      // hesitating between candidates.
      const sVx = a.vx * (1 - TURN_RATE) + desVx * TURN_RATE;
      const sVy = a.vy * (1 - TURN_RATE) + desVy * TURN_RATE;
      const sLen = Math.hypot(sVx, sVy) || 1;
      a.vx = (sVx / sLen) * speed;
      a.vy = (sVy / sLen) * speed;

      let nx = ap.x + a.vx;
      let ny = ap.y + a.vy;
      if (nx < 0) { nx = 0; a.vx = Math.abs(a.vx); }
      else if (nx > world.x) { nx = world.x; a.vx = -Math.abs(a.vx); }
      if (ny < 0) { ny = 0; a.vy = Math.abs(a.vy); }
      else if (ny > world.y) { ny = world.y; a.vy = -Math.abs(a.vy); }
      a.position.update({ x: nx, y: ny });
    }

    // ─── 2. Agent-agent collisions via grid. ──────────────────────────
    // For each cell: pairs within + pairs with 4 "later" neighbor cells.
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const bucket = aGrid[cy * cw + cx];
        for (let i = 0; i < bucket.length; i++) {
          const a = bucket[i];
          if (!a.alive.current) continue;
          for (let j = i + 1; j < bucket.length; j++) {
            const b = bucket[j];
            if (!b.alive.current) continue;
            tryEat(a, b);
            if (!a.alive.current) break;
          }
        }
        // 4 neighbors: E, SW, S, SE — covers each pair exactly once.
        const neigh: [number, number][] = [[1, 0], [-1, 1], [0, 1], [1, 1]];
        for (let n = 0; n < neigh.length; n++) {
          const ncx = cx + neigh[n][0];
          const ncy = cy + neigh[n][1];
          if (ncx < 0 || ncx >= cw || ncy < 0 || ncy >= ch) continue;
          const nbucket = aGrid[ncy * cw + ncx];
          for (let i = 0; i < bucket.length; i++) {
            const a = bucket[i];
            if (!a.alive.current) continue;
            for (let j = 0; j < nbucket.length; j++) {
              const b = nbucket[j];
              if (!b.alive.current) continue;
              tryEat(a, b);
              if (!a.alive.current) break;
            }
          }
        }
      }
    }

    // ─── 3. Agent-pellet collisions via grid (3x3). ───────────────────
    for (const a of agents) {
      if (!a.alive.current) continue;
      const ap = a.position.current;
      const acx = (ap.x / GRID_CELL) | 0;
      const acy = (ap.y / GRID_CELL) | 0;
      const ar = radiusOf(a.size.current);
      const ar2 = ar * ar;
      const xLo = Math.max(0, acx - 1);
      const xHi = Math.min(cw - 1, acx + 1);
      const yLo = Math.max(0, acy - 1);
      const yHi = Math.min(ch - 1, acy + 1);
      for (let cy = yLo; cy <= yHi; cy++) {
        for (let cx = xLo; cx <= xHi; cx++) {
          const bucket = pGrid[cy * cw + cx];
          for (let bi = 0; bi < bucket.length; bi++) {
            const p = bucket[bi];
            if (!p.alive.current) continue;
            const dxx = ap.x - p.x;
            const dyy = ap.y - p.y;
            if (dxx * dxx + dyy * dyy < ar2) {
              a.size.update(a.size.current + PELLET_VALUE);
              p.alive.update(false);
              p.deadTicks = 0;
            }
          }
        }
      }
    }

    // ─── 4. Pellet respawn. ───────────────────────────────────────────
    for (const p of pellets) {
      if (p.alive.current) continue;
      p.deadTicks++;
      if (p.deadTicks >= PELLET_RESPAWN_TICKS) {
        p.x = rand(20, world.x - 20);
        p.y = rand(20, world.y - 20);
        p.deadTicks = 0;
        p.alive.update(true);
      }
    }
  });

  return { gameOver: aliveCount <= 1, survivor: aliveCount === 1 ? last : null };
}

// ---------------------------------------------------------------
// AgentDot — vision ring + body + name. Three per-signal effects.
// ---------------------------------------------------------------

function AgentDot({ agent, showName, showVision, controlled, onTakeControl }: {
  agent: Agent;
  showName: boolean;
  showVision: boolean;
  controlled: boolean;
  onTakeControl: (id: number) => void;
}) {
  const gRef = useRef<SVGGElement>(null);
  const bodyRef = useRef<SVGCircleElement>(null);
  const textRef = useRef<SVGTextElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const fill = `hsl(${agent.hue} 75% 55%)`;
  const stroke = `hsl(${agent.hue} 60% 30%)`;
  const initialP = agent.position.current;
  const initialR = radiusOf(agent.size.current);

  useRefSignalEffect(() => {
    const g = gRef.current;
    if (!g) return;
    const p = agent.position.current;
    g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
  }, [agent.position]);

  useRefSignalEffect(() => {
    const r = radiusOf(agent.size.current);
    bodyRef.current?.setAttribute('r', r.toFixed(1));
    textRef.current?.setAttribute('y', String(-(r + 4)));
    haloRef.current?.setAttribute('r', (r + 8).toFixed(1));
  }, [agent.size]);

  useRefSignalEffect(() => {
    const g = gRef.current;
    if (g) g.style.opacity = agent.alive.current ? '1' : '0';
  }, [agent.alive]);

  return (
    <g
      ref={gRef}
      transform={`translate(${initialP.x},${initialP.y})`}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onTakeControl(agent.id);
      }}
    >
      {showVision && (
        <circle
          r={VISION}
          fill="none"
          stroke={fill}
          strokeOpacity={0.04}
          strokeWidth={1}
        />
      )}
      {controlled && (
        <circle
          ref={haloRef}
          r={initialR + 8}
          fill="none"
          stroke="#fff"
          strokeOpacity={0.7}
          strokeWidth={2}
          pointerEvents="none"
        />
      )}
      <circle
        ref={bodyRef}
        r={initialR}
        fill={fill}
        stroke={controlled ? '#fff' : stroke}
        strokeWidth={controlled ? 2.5 : 1.5}
      />
      {showName && (
        <text
          ref={textRef}
          y={-(initialR + 4)}
          textAnchor="middle"
          fontSize={9}
          fontFamily="system-ui, sans-serif"
          fontWeight={600}
          fill="rgba(255,255,255,0.85)"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth={2}
          paintOrder="stroke"
          pointerEvents="none"
        >
          {agent.name}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------
// PelletDot — minimal: opacity flip on alive change, cx/cy move on respawn.
// ---------------------------------------------------------------

function PelletDot({ pellet }: { pellet: Pellet }) {
  const ref = useRef<SVGCircleElement>(null);

  useRefSignalEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.opacity = pellet.alive.current ? '1' : '0';
    // On respawn, x/y were mutated before alive flipped to true — reflect them.
    el.setAttribute('cx', String(pellet.x));
    el.setAttribute('cy', String(pellet.y));
  }, [pellet.alive]);

  return (
    <circle
      ref={ref}
      cx={pellet.x}
      cy={pellet.y}
      r={2.5}
      fill="rgba(255, 220, 100, 0.85)"
    />
  );
}

// ---------------------------------------------------------------
// CallLines — one <line> per agent, drawn while that agent is broadcasting
// a call. Each line follows the caller's position, the call signal, and the
// CALLED target's position — the last of which has dynamic identity (it
// changes whenever the agent re-targets), so we use `trackSignals` to
// re-subscribe automatically. This is the inter-agent comms made visible.
// ---------------------------------------------------------------

function CallLines({ agents }: { agents: Agent[] }) {
  return (
    <g>
      {agents.map((a) => (
        <CallLine key={a.id} agent={a} agents={agents} />
      ))}
    </g>
  );
}

function CallLine({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const ref = useRef<SVGLineElement>(null);

  useRefSignalEffect(
    () => {
      const el = ref.current;
      if (!el) return;
      const targetId = agent.callTarget.current;
      if (targetId === null || !agent.alive.current) {
        el.style.display = 'none';
        return;
      }
      const target = agents[targetId];
      if (!target || !target.alive.current) {
        el.style.display = 'none';
        return;
      }
      const ap = agent.position.current;
      const tp = target.position.current;
      el.style.display = '';
      el.setAttribute('x1', ap.x.toFixed(1));
      el.setAttribute('y1', ap.y.toFixed(1));
      el.setAttribute('x2', tp.x.toFixed(1));
      el.setAttribute('y2', tp.y.toFixed(1));
      el.setAttribute('stroke', `hsl(${agent.hue} 70% 60%)`);
    },
    [agent.callTarget, agent.position, agent.alive],
    {
      // Dynamic dep — when callTarget swaps, the subscription follows the new
      // target's position/alive without needing to tear down + recreate the effect.
      trackSignals: () => {
        const id = agent.callTarget.current;
        if (id === null) return [];
        const target = agents[id];
        return target ? [target.position, target.alive] : [];
      },
    },
  );

  return (
    <line
      ref={ref}
      stroke="white"
      strokeOpacity={0.4}
      strokeWidth={1.2}
      strokeDasharray="3 4"
      pointerEvents="none"
      style={{ display: 'none' }}
    />
  );
}

// ---------------------------------------------------------------
// Reactive consumers — each subscribes only to its slice.
// ---------------------------------------------------------------

function AliveCount({ agents }: { agents: Agent[] }) {
  const sigs = useMemo(() => agents.map((a) => a.alive), [agents]);
  useRefSignalRender(sigs, { rAF: true });
  let n = 0;
  for (const a of agents) if (a.alive.current) n++;
  return <Stat label="alive" value={`${n}/${agents.length}`} />;
}

function BiggestBadge({ agents }: { agents: Agent[] }) {
  const sigs = useMemo(
    () => agents.flatMap((a) => [a.size, a.alive]),
    [agents],
  );
  useRefSignalRender(sigs, { rAF: true });
  let max = 0;
  for (const a of agents) {
    if (a.alive.current && a.size.current > max) max = a.size.current;
  }
  return <Stat label="biggest" value={max.toFixed(1)} highlight />;
}

function CallsCount({ agents }: { agents: Agent[] }) {
  // Subscribes only to the callTarget slice — re-renders when agents start
  // or stop broadcasting, never on plain position updates.
  const sigs = useMemo(() => agents.map((a) => a.callTarget), [agents]);
  useRefSignalRender(sigs, { rAF: true });
  let n = 0;
  for (const a of agents) if (a.alive.current && a.callTarget.current !== null) n++;
  return <Stat label="calls" value={n} />;
}

function Leaderboard({ agents }: { agents: Agent[] }) {
  const sigs = useMemo(
    () => agents.flatMap((a) => [a.size, a.alive]),
    [agents],
  );
  useRefSignalRender(sigs, { rAF: true });
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
          <span style={{ fontSize: 11, opacity: 0.85, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.name}
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
            {a.size.current.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TeamScoreboard({ agents }: { agents: Agent[] }) {
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
  // KEY POINT: this row only re-renders when its own team's signals fire.
  // Other teams' changes don't trigger anything here.
  useRefSignalRender(sigs, { rAF: true });

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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 0',
        opacity: eliminated ? 0.3 : 1,
        textDecoration: eliminated ? 'line-through' : 'none',
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: `hsl(${TEAM_HUES[team]} 70% 55%)`,
        }}
      />
      <span style={{ fontSize: 11, flex: 1 }}>{TEAM_NAMES[team]}</span>
      <span style={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.7, minWidth: 30, textAlign: 'right' }}>
        {alive}/{teamAgents.length}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a9eff', minWidth: 36, textAlign: 'right' }}>
        {mass.toFixed(0)}
      </span>
    </div>
  );
}

function Killcam() {
  // Subscribes only to the killFeed signal — re-renders only on kills.
  useRefSignalRender([killFeed]);
  const events = killFeed.current;

  return (
    <div style={panelStyle('bottom-right', 12)}>
      <div style={panelHeading}>FEED</div>
      {events.length === 0 ? (
        <div style={{ opacity: 0.35, fontSize: 11, fontStyle: 'italic' }}>
          No casualties yet
        </div>
      ) : (
        events.map((e, i) => (
          <div key={`${e.killerId}-${i}-${e.victimName}`} style={killRow}>
            <Dot hue={e.killerHue} />
            <span style={{ fontSize: 11 }}>{e.killerName}</span>
            <span style={{ opacity: 0.4, fontSize: 10 }}>ate</span>
            <Dot hue={e.victimHue} />
            <span style={{ fontSize: 11, opacity: 0.7 }}>{e.victimName}</span>
          </div>
        ))
      )}
    </div>
  );
}

function WinnerBanner({ winner, onReset }: { winner: Agent; onReset: () => void }) {
  // Subscribe to the winner's size in case mass keeps creeping from pellets.
  useRefSignalRender([winner.size]);
  return (
    <div style={winnerOverlayStyle}>
      <div style={winnerCardStyle}>
        <div style={{ fontSize: 12, opacity: 0.55, letterSpacing: 1 }}>WINNER</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: `hsl(${winner.hue} 75% 55%)`,
              border: `2px solid hsl(${winner.hue} 60% 30%)`,
            }}
          />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{winner.name}</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              {TEAM_NAMES[winner.team]} · {winner.kills} kills · {winner.size.current.toFixed(1)} mass
            </div>
          </div>
        </div>
        <button onClick={onReset} style={{ ...btnStyle(false, '#10b981'), marginTop: 14 }}>
          New round
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

export default function Agents() {
  const [seed, setSeed] = useState(0);
  const [count, setCount] = useState<Count>(DEFAULT_COUNT);
  const [running, setRunning] = useState(true);
  const [tickN, setTickN] = useState(0);
  const [winner, setWinner] = useState<Agent | null>(null);
  const [controlledId, setControlledId] = useState<number | null>(null);
  // Mouse position in WORLD coords. Updated on every pointermove; read by
  // tick() each frame. A ref (not state) — no re-renders on mouse motion.
  const mouseRef = useRef<Vec>({ x: 0, y: 0 });

  const stageRef = useRef<HTMLDivElement>(null);
  const [world, setWorld] = useState<Vec>(() => ({
    x: typeof window !== 'undefined' ? window.innerWidth - 32 : 1200,
    y: typeof window !== 'undefined' ? window.innerHeight - 140 : 720,
  }));

  useEffect(() => {
    const measure = () => {
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = Math.floor(r.width);
      const y = Math.floor(r.height);
      setWorld((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
    };
    const id = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Pellets scale with agent count so density of food stays meaningful.
  const pelletCount = count * 2;

  // Recreate agents/pellets on count change, world change, OR reset (seed bump).
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

  // Reset round-state when agents identity changes (count change, world resize, or reset).
  useEffect(() => {
    killFeed.update([]);
    setWinner(null);
    setTickN(0);
    setRunning(true);
    setControlledId(null);
  }, [agents]);

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

  // Tick loop. Stops on game over. Rate-gated by the module-scope `tickSpeed`
  // signal — read directly inside the effect so speed changes don't restart
  // the subscription (and don't need to be in the dep array).
  const frame = usePulseRefSignal('raf');
  const lastTickRef = useRef(0);
  useEffect(() => {
    if (!running || winner) return;
    lastTickRef.current = 0;
  }, [running, agents, pellets, world, winner, controlledId]);
  useRefSignalEffect(
    () => {
      if (!running || winner) return;
      const now = frame.elapsed;
      const interval = 1000 / Math.max(1, tickSpeed.current);
      if (now - lastTickRef.current >= interval) {
        const result = tick(agents, pellets, world, {
          agentId: controlledId,
          mouse: mouseRef.current,
        });
        lastTickRef.current = now;
        setTickN((n) => n + 1);
        if (result.gameOver) {
          setWinner(result.survivor);
        }
      }
    },
    [frame, running, agents, pellets, world, winner, controlledId],
  );

  const reset = () => setSeed((s) => s + 1);

  return (
    <div style={pageStyle}>
      <div style={toolbarStyle}>
        <button
          onClick={() => setRunning((r) => !r)}
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
            onChange={(e) => setCount(+e.target.value as Count)}
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

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {controlledId !== null && agents[controlledId] && (
            <Stat label="control" value={agents[controlledId].name} highlight />
          )}
          <Stat label="tick" value={tickN} />
          <AliveCount agents={agents} />
          <BiggestBadge agents={agents} />
          <CallsCount agents={agents} />
          <FpsBadge />
        </span>
      </div>

      <div style={hintStyle}>
        {count} agents in 4 teams, permadeath. Bigger eats smaller (any team).
        Pellets refill mass. <b>Click any agent to take control</b> — it&apos;ll steer
        toward your cursor; auto-released when it dies. Each agent owns four signals
        (<code style={codeStyle}>position</code>, <code style={codeStyle}>size</code>,{' '}
        <code style={codeStyle}>alive</code>, <code style={codeStyle}>callTarget</code>)
        — that&apos;s {count * 4} reactive cells. <b>Pack hunting via signals:</b> when
        an agent locks a target it broadcasts via <code style={codeStyle}>callTarget</code>;
        same-team allies within hearing range adopt the call when they have no target
        of their own — propagating outward each tick. The dashed lines visualize
        live calls; their subscriptions follow the called target dynamically via{' '}
        <code style={codeStyle}>trackSignals</code>. The reactive panels each subscribe
        only to their slice — TeamRows re-render only when their team changes; the
        Killcam subscribes only to <code style={codeStyle}>killFeed</code>; no central
        re-render anywhere.
      </div>

      <div ref={stageRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <svg
          viewBox={`0 0 ${world.x} ${world.y}`}
          preserveAspectRatio="none"
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            cursor: controlledId !== null ? 'crosshair' : 'default',
          }}
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

// ---------------------------------------------------------------
// UI bits
// ---------------------------------------------------------------

// SpeedControl — controlled slider over the module-scope `tickSpeed` signal.
// Re-renders only on speed changes (its own input or anything else updating
// the signal). The RAF loop reads `tickSpeed.current` directly each frame.
function SpeedControl() {
  useRefSignalRender([tickSpeed]);
  return (
    <label style={sliderLabel}>
      Speed
      <input
        type="range"
        min={1}
        max={120}
        value={tickSpeed.current}
        onChange={(e) => tickSpeed.update(+e.target.value)}
        style={{ width: 100 }}
      />
      <span style={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.7, minWidth: 36, textAlign: 'right' }}>
        {tickSpeed.current}/s
      </span>
    </label>
  );
}

function Dot({ hue }: { hue: number }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: `hsl(${hue} 70% 55%)`,
        border: '1px solid rgba(0,0,0,0.4)',
        flexShrink: 0,
      }}
    />
  );
}

function Stat({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <span style={{
      background: '#0d1117',
      padding: '4px 10px',
      borderRadius: 4,
      fontSize: 12,
      fontFamily: 'monospace',
      border: highlight ? '1px solid #4a9eff' : '1px solid transparent',
    }}>
      {label} <b style={{ color: highlight ? '#4a9eff' : '#fff' }}>{value}</b>
    </span>
  );
}

const pageStyle: React.CSSProperties = {
  background: '#0a0d18',
  color: '#fff',
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'system-ui, sans-serif',
  userSelect: 'none',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  background: '#16213e',
  flexWrap: 'wrap',
};

const hintStyle: React.CSSProperties = {
  padding: '4px 14px',
  fontSize: 11,
  opacity: 0.55,
  background: '#16213e',
  borderTop: '1px solid #1a1a2e',
  lineHeight: 1.5,
};

const codeStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 11,
  background: 'rgba(255,255,255,0.1)',
};

const sliderLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  opacity: 0.85,
};

const selectStyle: React.CSSProperties = {
  background: '#0d1117',
  color: '#fff',
  border: '1px solid #334155',
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 12,
};

function panelStyle(corner: 'top' | 'left' | 'bottom-right', offset: number): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    background: 'rgba(13, 17, 23, 0.85)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '10px 14px',
    minWidth: 170,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  };
  if (corner === 'top') return { ...base, top: offset, right: offset };
  if (corner === 'left') return { ...base, top: offset, left: offset };
  return { ...base, bottom: offset, right: offset };
}

const panelHeading: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.55,
  marginBottom: 8,
  letterSpacing: 1,
  fontWeight: 700,
};

const leaderRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
};

const rankCell: React.CSSProperties = {
  width: 14,
  opacity: 0.5,
  fontSize: 10,
  fontFamily: 'monospace',
};

const killRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 3,
};

const winnerOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(2px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
};

const winnerCardStyle: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  padding: '24px 30px',
  minWidth: 320,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
};

function btnStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '5px 14px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 12,
    background: active ? color : '#333',
    color: '#fff',
    opacity: active ? 1 : 0.75,
    transition: 'opacity 0.15s',
  };
}
