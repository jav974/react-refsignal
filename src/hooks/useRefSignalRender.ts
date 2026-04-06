import { useCallback, useReducer, useRef, useSyncExternalStore } from 'react';
import { RefSignal } from '../refsignal';
import { applyTimingOptions } from '../timing';
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
 *   snapshot (`lastUpdated` is unchanged), so `useSyncExternalStore` sees no difference.
 * - If the optional `callback` is specified, a re-render will only occur if it returns `true`.
 *   Note: the callback filter applies to signal-triggered re-renders only. The returned `forceUpdate`
 *   function always re-renders unconditionally, bypassing the callback.
 * - The callback is stored in a ref to avoid unnecessary resubscriptions when it changes.
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

  const { filter, throttle, debounce, maxWait, rAF } = options;

  // Store filter in ref to avoid resubscription when it changes
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Subscribe function for useSyncExternalStore
  // IMPORTANT: deps + timing values must be in useCallback deps array so subscribe
  // identity changes when they change, triggering useSyncExternalStore to resubscribe
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // Create timing wrapper scoped to this subscription lifetime
      const wrapper = applyTimingOptions(onStoreChange, options);
      const notify = wrapper.call;

      const listener = () => {
        // Apply optional filter before scheduling the re-render
        if (!filterRef.current || filterRef.current()) {
          notify();
        }
      };

      // Subscribe to all signals
      deps.forEach((dep) => {
        dep.subscribe(listener);
      });

      // Return cleanup function
      return () => {
        wrapper.cancel();
        deps.forEach((dep) => {
          dep.unsubscribe(listener);
        });
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps array + timing values: new identity triggers resubscription
    [...deps, throttle, debounce, maxWait, rAF],
  );

  // Snapshot function: returns a value that changes when any signal updates
  const getSnapshot = useCallback(() => {
    return deps.reduce((sum, dep) => sum + dep.lastUpdated, 0);
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
