import { DependencyList, useEffect, useMemo, useRef } from 'react';
import { isRefSignal, RefSignal } from '../refsignal';
import { useRefSignal } from './useRefSignal';

/**
 * React hook for creating a memoized {@link RefSignal} whose value is derived from a factory function and dependencies.
 *
 * This hook combines the behavior of {@link useMemo} and {@link useRefSignal}:
 * - The signal's value is initialized and updated using the provided factory function.
 * - The factory is re-evaluated whenever any value in the dependency list changes, and the signal is updated.
 * - Listeners subscribed to the returned signal are notified when the value changes.
 *
 * @template T The type of the value produced by the factory.
 * @param factory A function that returns the value to be memoized and stored in the signal.
 * @param deps Dependency list that controls when the factory is re-evaluated (same as {@link useMemo}).
 * @returns {RefSignal<T>} A signal object whose value is kept in sync with the memoized factory result.
 *
 * @example
 * const count = useRefSignal(1);
 * const double = useRefSignalMemo(() => count.current * 2, [count]);
 * double.subscribe(val => console.log('Double changed:', val));
 * // When count.update(2) is called, double will update to 4 and notify listeners.
 */
export function useRefSignalMemo<T>(
  factory: () => T,
  deps: DependencyList,
): RefSignal<T>;
export function useRefSignalMemo<T>(
  factory: () => T | null,
  deps: DependencyList,
): RefSignal<T | null>;
export function useRefSignalMemo<T>(
  factory: () => T | undefined,
  deps: DependencyList,
): RefSignal<T | undefined>;
export function useRefSignalMemo<T>(
  factory: () => T | null | undefined,
  deps: DependencyList,
): RefSignal<T | null | undefined> {
  // Handles non-signal deps: React re-renders when state/props in deps change,
  // useMemo recomputes, and we sync the signal below — no extra factory() call needed.
  const memo = useMemo(factory, deps); // eslint-disable-line react-hooks/exhaustive-deps -- deps forwarded from caller

  const value = useRefSignal(memo);
  const isInitialMount = useRef(true);

  // Always hold the latest factory to avoid stale closures in signal listeners.
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  // Sync signal when non-signal deps cause a React re-render.
  // memo is already up-to-date from useMemo above — no redundant factory() call.
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    value.update(memo);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps -- mirrors useMemo deps

  // Subscribe to any RefSignal deps and recompute when they fire.
  // useMemo does not re-run for signal updates (signal identity is stable),
  // so factory() must be called here to read the latest signal values.
  useEffect(() => {
    const listener = () => {
      value.update(factoryRef.current());
    };
    deps.forEach((dep) => {
      if (isRefSignal(dep)) dep.subscribe(listener);
    });
    return () => {
      deps.forEach((dep) => {
        if (isRefSignal(dep)) dep.unsubscribe(listener);
      });
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps -- resubscribe when signal set changes

  return value;
}
