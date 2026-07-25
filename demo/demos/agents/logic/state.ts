// Module-scope demo state: the killcam feed + tick-rate target. These are
// referenced by simulation helpers (pushKill) that aren't React components,
// so they can't live in component state. Wrapped in a lazy scope so they're
// disposed when this route unmounts and recreated on remount, instead of
// stacking in devtools across navigations.

import { useEffect } from 'react';
import { createRefSignal } from 'react-refsignal';
import { KILLCAM_MAX } from './config';
import type { KillEvent } from '../types';

const factory = () => ({
  killFeed: createRefSignal<KillEvent[]>([], 'agents.killFeed'),
  tickSpeed: createRefSignal(60, 'agents.tickSpeed'),
});

let current: ReturnType<typeof factory> | null = null;

export const demo = {
  /** Returns the current state, creating it lazily on first access. */
  state() {
    if (current === null) current = factory();
    return current;
  },
  /** Component hook: ensures state exists on mount, disposes on unmount.
   *  Subsequent mounts re-run the factory. */
  useLifetime(): void {
    useEffect(() => {
      if (current === null) current = factory();
      return () => {
        if (current === null) return;
        for (const item of Object.values(current)) {
          item.dispose();
        }
        current = null;
      };
    }, []);
  },
};

export function pushKill(ev: KillEvent) {
  const { killFeed } = demo.state();
  killFeed.update([ev, ...killFeed.current].slice(0, KILLCAM_MAX));
}
