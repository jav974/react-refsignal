// Module-scope demo state: the killcam feed + tick-rate target. These are
// referenced by simulation helpers (pushKill) that aren't React components,
// so they can't live in component state. Wrapped in a demo scope so they're
// disposed when this route unmounts and recreated on remount, instead of
// stacking in devtools across navigations.

import { createRefSignal } from 'react-refsignal';
import { createDemoScope } from '../../../common/demoScope';
import { KILLCAM_MAX } from './config';
import type { KillEvent } from '../types';

export const demo = createDemoScope(() => ({
  killFeed: createRefSignal<KillEvent[]>([], 'agents.killFeed'),
  tickSpeed: createRefSignal(60, 'agents.tickSpeed'),
}));

export function pushKill(ev: KillEvent) {
  const { killFeed } = demo.state();
  killFeed.update([ev, ...killFeed.current].slice(0, KILLCAM_MAX));
}
