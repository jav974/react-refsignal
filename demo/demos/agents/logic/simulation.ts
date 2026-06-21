// The whole agar-style simulation: agent/pellet construction, the math
// helpers, and the per-tick step (spatial-hash AI, collisions, pellet
// respawn). Each agent owns its own RefSignals; the tick mutates them inside a
// single `batch()` so consumers fan out once per tick, not per write.

import { batch, createRefSignal } from 'react-refsignal';
import {
  BASE_SPEED,
  GRID_CELL,
  HEARING,
  MASS_GAIN,
  MIN_SIZE,
  N_TEAMS,
  PELLET_RESPAWN_TICKS,
  PELLET_VALUE,
  SIZE_THRESHOLD,
  TEAM_HUES,
  TURN_RATE,
  VISION,
  ADJ,
  NOUN,
} from './config';
import { pushKill } from './state';
import type { Agent, ControlState, Pellet, TickResult, Vec } from '../types';

export function radiusOf(size: number): number {
  return Math.sqrt(size) * 2.6;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function distSq(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// X dominates Y when X exceeds Y's mass by the size threshold (eat / flee gate).
function dominates(predator: number, prey: number): boolean {
  return predator > prey * SIZE_THRESHOLD;
}

// Apply steering inertia, clamp to world bounds, write the new position.
// Shared by player control and AI control — same physics either way.
function steerAndMove(
  a: Agent,
  ap: Vec,
  ddx: number,
  ddy: number,
  speed: number,
  world: Vec,
): void {
  // sqrt(x*x + y*y) over Math.hypot — hypot's overflow guard is needless for
  // these small deltas and measurably slower in this per-agent hot loop.
  const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
  const desVx = (ddx / dlen) * speed;
  const desVy = (ddy / dlen) * speed;
  const sVx = a.vx * (1 - TURN_RATE) + desVx * TURN_RATE;
  const sVy = a.vy * (1 - TURN_RATE) + desVy * TURN_RATE;
  const sLen = Math.sqrt(sVx * sVx + sVy * sVy) || 1;
  a.vx = (sVx / sLen) * speed;
  a.vy = (sVy / sLen) * speed;
  let nx = ap.x + a.vx;
  let ny = ap.y + a.vy;
  if (nx < 0) {
    nx = 0;
    a.vx = Math.abs(a.vx);
  } else if (nx > world.x) {
    nx = world.x;
    a.vx = -Math.abs(a.vx);
  }
  if (ny < 0) {
    ny = 0;
    a.vy = Math.abs(a.vy);
  } else if (ny > world.y) {
    ny = world.y;
    a.vy = -Math.abs(a.vy);
  }
  // Mutate in place + notify rather than `update({ x, y })`: this runs once per
  // agent per tick (×360 ×~60/s), and the fresh-object allocation was the
  // dominant GC pressure. ap IS a.position.current; nx/ny are already read off
  // it above, and consumers (AgentDot, the AI scan) read x/y straight off
  // `.current` without retaining the reference, so in-place is safe.
  ap.x = nx;
  ap.y = ny;
  a.position.notify();
}

// Pairwise eat-test over two buckets. `sameBucket` short-circuits the i/j
// pairing so we don't double-test pairs from the same cell.
function eatPairs(
  bucketA: Agent[],
  bucketB: Agent[],
  sameBucket: boolean,
): void {
  for (let i = 0; i < bucketA.length; i++) {
    const a = bucketA[i];
    if (!a.alive.current) continue;
    const jStart = sameBucket ? i + 1 : 0;
    for (let j = jStart; j < bucketB.length; j++) {
      const b = bucketB[j];
      if (!b.alive.current) continue;
      tryEat(a, b);
      // tryEat may flip a.alive
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!a.alive.current) break;
    }
  }
}

export function makeAgent(id: number, world: Vec): Agent {
  const team = id % N_TEAMS;
  const baseHue = TEAM_HUES[team]!;
  // Slight per-agent jitter within team color band.
  const hue = (baseHue + rand(-12, 12) + 360) % 360;
  const name = `${pick(ADJ)}${pick(NOUN)}`;
  // Generated names can collide; fold in the id so devtools entries are unique.
  const tag = `${name}#${id}`;
  return {
    id,
    team,
    hue,
    name,
    position: createRefSignal(
      {
        x: rand(40, world.x - 40),
        y: rand(40, world.y - 40),
      },
      `${tag}.pos`,
    ),
    size: createRefSignal(rand(MIN_SIZE, MIN_SIZE + 6), `${tag}.size`),
    alive: createRefSignal(true, `${tag}.alive`),
    vx: rand(-1, 1),
    vy: rand(-1, 1),
    kills: 0,
    targetId: null,
    threatId: null,
    callTarget: createRefSignal<number | null>(null, `${tag}.callTarget`),
  };
}

export function makePellet(id: number, world: Vec): Pellet {
  return {
    id,
    x: rand(20, world.x - 20),
    y: rand(20, world.y - 20),
    alive: createRefSignal(true),
    deadTicks: 0,
  };
}

// Cell-neighbor offsets (E, SW, S, SE) — covers each cross-cell agent pair
// exactly once. Module-scope so it isn't rebuilt every tick.
const NEIGH: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

// Persistent spatial-hash buckets, reused across ticks. Reallocating hundreds
// of cell arrays every frame was needless GC churn; instead each cell is
// truncated (length = 0, keeping its backing capacity) and refilled, rebuilt
// only when the cell count changes (world resize). tick() is single-threaded
// and non-reentrant, so sharing these scratch buffers is safe.
let aGrid: Agent[][] = [];
let pGrid: Pellet[][] = [];

function resetGrids(total: number): void {
  if (aGrid.length !== total) {
    aGrid = Array.from({ length: total }, () => []);
    pGrid = Array.from({ length: total }, () => []);
    return;
  }
  for (let i = 0; i < total; i++) {
    aGrid[i].length = 0;
    pGrid[i].length = 0;
  }
}

function tryEat(a: Agent, b: Agent) {
  const ap = a.position.current;
  const bp = b.position.current;
  const aSize = a.size.current;
  const bSize = b.size.current;
  const eatD = Math.max(radiusOf(aSize), radiusOf(bSize)) * 0.6;
  if (distSq(ap, bp) >= eatD * eatD) return;
  if (dominates(aSize, bSize)) {
    a.size.update(aSize + bSize * MASS_GAIN);
    b.alive.update(false);
    b.callTarget.update(null);
    a.kills++;
    pushKill({
      killerId: a.id,
      killerName: a.name,
      killerHue: a.hue,
      victimName: b.name,
      victimHue: b.hue,
    });
  } else if (dominates(bSize, aSize)) {
    b.size.update(bSize + aSize * MASS_GAIN);
    a.alive.update(false);
    a.callTarget.update(null);
    b.kills++;
    pushKill({
      killerId: b.id,
      killerName: b.name,
      killerHue: b.hue,
      victimName: a.name,
      victimHue: a.hue,
    });
  }
}

export function tick(
  agents: Agent[],
  pellets: Pellet[],
  world: Vec,
  control: ControlState,
): TickResult {
  // Spatial hash → AI and collision queries are O(local density), not O(N).
  const cw = ((world.x / GRID_CELL) | 0) + 2;
  const ch = ((world.y / GRID_CELL) | 0) + 2;
  const total = cw * ch;
  resetGrids(total);

  const cellAt = (x: number, y: number) => {
    let cx = (x / GRID_CELL) | 0;
    let cy = (y / GRID_CELL) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= cw) cx = cw - 1;
    if (cy < 0) cy = 0;
    else if (cy >= ch) cy = ch - 1;
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

      // Player control: steer toward cursor, bypass AI (no auto threat avoidance).
      if (control.agentId === a.id) {
        a.targetId = null;
        a.threatId = null;
        a.callTarget.update(null);
        steerAndMove(
          a,
          ap,
          control.mouse.x - ap.x,
          control.mouse.y - ap.y,
          speed,
          world,
        );
        continue;
      }

      const acx = (ap.x / GRID_CELL) | 0;
      const acy = (ap.y / GRID_CELL) | 0;

      // Keep last tick's pick if still valid — avoids flip-flop between equidistant candidates.
      let target: Agent | null = null;
      let threat: Agent | null = null;

      if (a.targetId !== null) {
        const c = agents[a.targetId];
        if (
          c?.alive.current &&
          dominates(aSize, c.size.current) &&
          distSq(c.position.current, ap) <= visionD2
        ) {
          target = c;
        }
      }
      if (a.threatId !== null) {
        const c = agents[a.threatId];
        if (
          c?.alive.current &&
          dominates(c.size.current, aSize) &&
          distSq(c.position.current, ap) <= visionD2
        ) {
          threat = c;
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
              const d2 = distSq(b.position.current, ap);
              if (d2 > visionD2) continue;
              const bSize = b.size.current;
              if (!target && dominates(aSize, bSize)) {
                if (d2 < bestTargetD2) {
                  target = b;
                  bestTargetD2 = d2;
                }
              } else if (!threat && dominates(bSize, aSize)) {
                if (d2 < bestThreatD2) {
                  threat = b;
                  bestThreatD2 = d2;
                }
              }
            }
          }
        }
      }
      // Adopt nearest hearable ally's call when idle. Pack-hunting emerges as
      // calls propagate via the re-broadcast below.
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
              const d2 = distSq(ally.position.current, ap);
              if (d2 > hearingD2 || d2 >= bestD2) continue;
              const calledId = ally.callTarget.current;
              if (calledId === null) continue;
              const called = agents[calledId];
              if (!called?.alive.current) continue;
              if (!dominates(aSize, called.size.current)) continue;
              target = called;
              bestD2 = d2;
            }
          }
        }
      }

      a.targetId = target ? target.id : null;
      a.threatId = threat ? threat.id : null;
      // Only broadcast while hunting — fleeing would propagate panic.
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
              const d2 = distSq(p, ap);
              if (d2 > visionD2) continue;
              if (d2 < pelletD2) {
                pelletT = p;
                pelletD2 = d2;
              }
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

      steerAndMove(a, ap, ddx, ddy, speed, world);
    }

    // ─── 2. Agent-agent collisions via grid. ──────────────────────────
    // For each cell: pairs within + pairs with 4 "later" neighbor cells.
    // 4 neighbors (E, SW, S, SE) covers each cross-cell pair exactly once.
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const bucket = aGrid[cy * cw + cx];
        eatPairs(bucket, bucket, true);
        for (let n = 0; n < NEIGH.length; n++) {
          const ncx = cx + NEIGH[n][0];
          const ncy = cy + NEIGH[n][1];
          if (ncx < 0 || ncx >= cw || ncy < 0 || ncy >= ch) continue;
          eatPairs(bucket, aGrid[ncy * cw + ncx], false);
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
            if (distSq(ap, p) < ar2) {
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

  return {
    gameOver: aliveCount <= 1,
    survivor: aliveCount === 1 ? last : null,
  };
}
