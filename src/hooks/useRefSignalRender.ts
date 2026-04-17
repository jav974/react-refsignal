import { useCallback, useReducer, useRef, useSyncExternalStore } from 'react';
import { RefSignal } from '../refsignal';
import { watchSignals, WatchHandle } from '../watchSignals';
import { useWatchArgs } from './useWatchArgs';
import type { WatchOptions } from '../timing';

/**
 * React hook that forces a component to re-render whenever one or more {@link RefSignal} dependencies update.
 *
 * Use this hook to automatically trigger a re-render of your component when the value of any provided RefSignal changes.
 * This is useful when you want your component to reflect the latest signal values in its render output.
 *
 * Implementation Note: This hook uses React 18's `useSyncExternalStore` to ensure compatibility with
 * concurrent rendering features. This prevents "tearing" - a visual inconsistency that can occur when
 * different components read different values from external state during concurrent renders.
 *
 * - The hook subscribes to all given RefSignal dependencies.
 * - The component will re-render whenever any of the signals are updated via `.update()`, `.notifyUpdate()`,
 *   or `.reset()` (which goes through `.update()` internally).
 *   Calling `.notify()` alone does NOT trigger a re-render — it fires listeners but does not change the
 *   snapshot (`lastUpdated` is unchanged), so `useSyncExternalStore` sees no difference. This holds for
 *   both static deps and dynamically-tracked signals (see `trackSignals`).
 * - If the optional `callback` is specified, a re-render will only occur if it returns `true`.
 *   Note: the callback filter applies to signal-triggered re-renders only. The returned `forceUpdate`
 *   function always re-renders unconditionally, bypassing the callback.
 * - The callback is stored in a ref to avoid unnecessary resubscriptions when it changes.
 * - `options.trackSignals` enables **nested-signal traversal**: return signals whose identity
 *   depends on another signal's current value, and the hook will diff-subscribe to them on every
 *   static dep fire. See {@link WatchOptions} for full semantics.
 *
 * @param deps Array of RefSignal objects to watch for changes.
 * @param callbackOrOptions Optional filter callback (legacy) or {@link WatchOptions} object.
 * @returns A function that unconditionally forces a re-render of the component. Bypasses the
 *          `filter` — useful for triggering a render outside of signal updates.
 *
 * @example
 * const count = useRefSignal(0);
 * useRefSignalRender([count]);
 *
 * @example
 * // Legacy callback — still supported
 * useRefSignalRender([count], () => count.current > 5);
 *
 * @example
 * // Options object
 * useRefSignalRender([count], { filter: () => count.current > 5, throttle: 100 });
 * useRefSignalRender([count], { debounce: 200, maxWait: 1000 });
 * useRefSignalRender([count], { rAF: true });
 */
export function useRefSignalRender(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: RefSignal<any>[],
  callbackOrOptions?: (() => boolean) | WatchOptions,
): () => void {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const options: WatchOptions =
    typeof callbackOrOptions === 'function'
      ? { filter: callbackOrOptions }
      : (callbackOrOptions ?? {});

  const { filterRef, watchOptions } = useWatchArgs(options);

  // Holds the active subscription so getSnapshot can read its tracked set
  // to sum dynamic signals' lastUpdated alongside static deps.
  const subRef = useRef<WatchHandle | null>(null);

  // Subscribe function for useSyncExternalStore.
  // Identity changes with deps or watchOptions (timing), triggering resubscription.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const sub = watchSignals(
        deps,
        () => {
          if (filterRef.current && !filterRef.current()) return;
          onStoreChange();
        },
        watchOptions,
      );
      subRef.current = sub;
      return () => {
        sub.dispose();
        subRef.current = null;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps forwarded from caller; watchOptions covers timing changes
    [...deps, watchOptions],
  );

  // Snapshot: sum of lastUpdated across static deps + currently-tracked dynamic
  // signals. Unchanged on `.notify()` since it does not bump lastUpdated —
  // avoids spurious re-renders for both static and dynamic sources.
  const getSnapshot = useCallback(() => {
    let sum = 0;
    for (const dep of deps) sum += dep.lastUpdated;
    const tracked = subRef.current?.trackedSignals();
    if (tracked) {
      for (const t of tracked) sum += t.lastUpdated;
    }
    return sum;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps -- deps array is the dependency: new array identity recomputes snapshot

  // Server snapshot function for SSR compatibility
  // Returns the same snapshot on server as initial client render
  // This prevents hydration mismatches in SSR environments (Next.js, Remix, etc.)
  // noinspection UnnecessaryLocalVariableJS
  const getServerSnapshot = getSnapshot;

  // Use React 18's useSyncExternalStore for concurrent-safe subscriptions
  // This ensures consistent state across all components during concurrent renders
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Return forceUpdate for manual re-renders
  return forceUpdate;
}
