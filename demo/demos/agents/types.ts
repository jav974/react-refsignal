import type { RefSignal } from 'react-refsignal';
import type { COUNTS } from './logic/config';

export type Vec = { x: number; y: number };

export type Agent = {
  id: number;
  team: number;
  hue: number;
  name: string;
  position: RefSignal<Vec> & { dispose: () => void };
  size: RefSignal<number> & { dispose: () => void };
  alive: RefSignal<boolean> & { dispose: () => void };
  vx: number;
  vy: number;
  kills: number;
  // Sticky picks across ticks — avoids flip-flop between equidistant candidates.
  targetId: number | null;
  threatId: number | null;
  // Broadcast for same-team call adoption (HEARING radius).
  callTarget: RefSignal<number | null> & { dispose: () => void };
};

export type Pellet = {
  id: number;
  x: number;
  y: number;
  alive: RefSignal<boolean> & { dispose: () => void };
  deadTicks: number;
};

export type KillEvent = {
  killerId: number;
  killerName: string;
  killerHue: number;
  victimName: string;
  victimHue: number;
};

export type ControlState = {
  agentId: number | null;
  mouse: Vec;
};

export type Count = (typeof COUNTS)[number];

export type TickResult = { gameOver: boolean; survivor: Agent | null };
