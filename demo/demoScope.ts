import { useEffect } from 'react';

/**
 * Helper for managing module-scope refsignals across React route changes.
 *
 * Module-scope refsignals normally live for the whole app session — there's
 * no React unmount to trigger `.dispose()`. In a route-switching app (like
 * the demos), that means each demo's module-scope state stacks up in
 * devtools forever.
 *
 * `createDemoScope` defers creation until first access via `.state()`, and
 * disposes the entire group on component unmount via `.useLifetime()`. The
 * factory is re-run on the next mount, so remounted demos get a fresh set
 * of signals with the same names — devtools shows them appear and disappear
 * with the demo's lifetime.
 *
 * Requirement: every value the factory returns must have a `dispose()`
 * method (RefSignals from `createRefSignal` / `createPulseRefSignal` /
 * `createComputedRefSignal` all satisfy this).
 *
 * @example
 * const demo = createDemoScope(() => ({
 *   killFeed: createRefSignal<KillEvent[]>([], 'agents.killFeed'),
 *   tickSpeed: createRefSignal(60, 'agents.tickSpeed'),
 * }));
 *
 * function pushKill(ev: KillEvent) {
 *   const { killFeed } = demo.state();
 *   killFeed.update([ev, ...killFeed.current].slice(0, 10));
 * }
 *
 * export default function AgentsDemo() {
 *   demo.useLifetime();
 *   const { killFeed, tickSpeed } = demo.state();
 *   // ...
 * }
 */
export interface Disposable {
  dispose: () => void;
}

export interface DemoScope<T> {
  /** Returns the current state, creating it lazily on first access. */
  state(): T;
  /** Component hook: ensures state exists on mount, disposes on unmount.
   *  Subsequent mounts re-run the factory. */
  useLifetime(): void;
}

export function createDemoScope<T extends Record<string, Disposable>>(
  factory: () => T,
): DemoScope<T> {
  let current: T | null = null;

  const state = (): T => {
    if (current === null) current = factory();
    return current;
  };

  const useLifetime = (): void => {
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
  };

  return { state, useLifetime };
}
