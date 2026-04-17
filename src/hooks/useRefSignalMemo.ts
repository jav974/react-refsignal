import { DependencyList, useEffect, useMemo, useRef } from 'react';
import { RefSignal } from '../refsignal';
import { useRefSignal } from './useRefSignal';
import { createSubscription } from '../subscription';
import { useWatchArgs } from './useWatchArgs';
import type { WatchOptions } from '../timing';

/**
 * React hook for creating a memoized {@link RefSignal} whose value is derived from a factory function and dependencies.
 *
 * This hook combines the behavior of {@link useMemo} and {@link useRefSignal}:
 * - The signal's value is initialized and updated using the provided factory function.
 * - The factory is re-evaluated whenever any value in the dependency list changes, and the signal is updated.
 * - Listeners subscribed to the returned signal are notified when the value changes.
 *
 * `options.trackSignals` enables **nested-signal traversal**: return signals whose identity
 * depends on another signal's current value, and the hook will diff-subscribe to them on every
 * static dep fire. See {@link WatchOptions} for full semantics.
 *
 * @template T The type of the value produced by the factory.
 * @param factory A function that returns the value to be memoized and stored in the signal.
 * @param deps Dependency list that controls when the factory is re-evaluated (same as {@link useMemo}).
 * @param options Optional {@link WatchOptions} — timing, filter, and dynamic signal tracking.
 * @returns {RefSignal<T>} A signal object whose value is kept in sync with the memoized factory result.
 *
 * @example
 * const count = useRefSignal(1);
 * const double = useRefSignalMemo(() => count.current * 2, [count]);
 * double.subscribe(val => console.log('Double changed:', val));
 * // When count.update(2) is called, double will update to 4 and notify listeners.
 *
 * @example
 * // Nested-signal traversal — follow a signal whose identity comes from another signal's value
 * const fromNode = useRefSignalMemo(
 *   () => nodes.current.get(id)?.current,
 *   [nodes, id],
 *   { trackSignals: () => {
 *       const s = nodes.current.get(id);
 *       return s ? [s] : [];
 *     }
 *   }
 * );
 */
export function useRefSignalMemo<T>(
  factory: () => T,
  deps: DependencyList,
  options?: WatchOptions,
): RefSignal<T>;
export function useRefSignalMemo<T>(
  factory: () => T | null,
  deps: DependencyList,
  options?: WatchOptions,
): RefSignal<T | null>;
export function useRefSignalMemo<T>(
  factory: () => T | undefined,
  deps: DependencyList,
  options?: WatchOptions,
): RefSignal<T | undefined>;
export function useRefSignalMemo<T>(
  factory: () => T | null | undefined,
  deps: DependencyList,
  options?: WatchOptions,
): RefSignal<T | null | undefined> {
  // Handles non-signal deps: React re-renders when state/props in deps change,
  // useMemo recomputes, and we sync the signal below — no extra factory() call needed.
  const memo = useMemo(factory, deps); // eslint-disable-line react-hooks/exhaustive-deps -- deps forwarded from caller

  const value = useRefSignal(memo);
  const isInitialMount = useRef(true);

  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  const { filterRef, subscriptionOptions } = useWatchArgs(options);

  // Sync signal when non-signal deps cause a React re-render.
  // memo is already up-to-date from useMemo above — no redundant factory() call.
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    value.update(memo);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps -- mirrors useMemo deps

  // Subscribe to signal deps (static) and optional dynamic set via trackSignals.
  useEffect(() => {
    const sub = createSubscription({
      deps,
      onFire: () => {
        if (filterRef.current && !filterRef.current()) return;
        value.update(factoryRef.current());
      },
      options: subscriptionOptions,
    });
    return () => {
      sub.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps forwarded from caller; subscriptionOptions covers timing changes
  }, [...deps, subscriptionOptions]);

  return value;
}
