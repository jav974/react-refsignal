// Single source of truth for the demo set. Both the nav (DemoNav) and the
// router (main.tsx) derive from this list — add a demo here and it shows up in
// both. `hidden: true` keeps a route reachable by hash without a nav link.

import type { ComponentType } from 'react';
import Agents from './agents';
import GameOfLife from './game-of-life';
import GraphAutomated from './graph/automated';
import GraphCanvas from './graph/canvas';
import GraphSvg from './graph/svg';
import Heartbeat from './heartbeat';
import Replay from './replay';
import Skeleton from './skeleton';
import ThemeSync from './theme-sync';

export interface DemoEntry {
  hash: string;
  label: string;
  component: ComponentType;
  /** Routable by hash, but omitted from the nav bar. */
  hidden?: boolean;
}

export const DEFAULT_HASH = 'graph';

export const DEMOS: DemoEntry[] = [
  { hash: 'graph', label: 'Graph (SVG)', component: GraphSvg },
  { hash: 'canvas', label: 'Graph (Canvas)', component: GraphCanvas },
  // No nav link on purpose. The automated benchmark must run with devtools
  // unmounted (see the mountDevTools guard in main.tsx) — but that guard only
  // fires on a fresh page load. Reaching #autobench via a navlink would be a
  // client-side hashchange that leaves devtools mounted, biasing the RefSignal
  // numbers. The headless runner (benchmark-runner/run.mjs) navigates to a
  // fresh /?...#autobench URL, so it's unaffected.
  {
    hash: 'autobench',
    label: 'Autobench',
    component: GraphAutomated,
    hidden: true,
  },
  {
    hash: 'theme',
    label: 'Theme sync (persist + broadcast)',
    component: ThemeSync,
  },
  { hash: 'gol', label: 'Game of Life', component: GameOfLife },
  { hash: 'agents', label: 'Agents', component: Agents },
  { hash: 'heart', label: 'Heartbeat (pulse)', component: Heartbeat },
  { hash: 'skeleton', label: 'Ragdoll (pulse)', component: Skeleton },
  { hash: 'replay', label: 'Comet (replay)', component: Replay },
];
