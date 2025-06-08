import { useMemo } from "react";
import { useRefSignal } from "./useRefSignal";
import { useRefSignalEffect } from "./useRefSignalEffect";
import { RefSignal } from "../refsignal";

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
 * const double = useRefSignalMemo(() => count.ref.current * 2, [count]);
 * double.subscribe(val => console.log('Double changed:', val));
 * // When count.update(2) is called, double will update to 4 and notify listeners.
 */
export function useRefSignalMemo<T>(factory: () => T, deps: React.DependencyList): RefSignal<T>;
export function useRefSignalMemo<T>(factory: () => T | null, deps: React.DependencyList): RefSignal<T | null>;
export function useRefSignalMemo<T>(factory: () => T | undefined, deps: React.DependencyList): RefSignal<T | undefined>;
export function useRefSignalMemo<T>(factory: () => T | null | undefined, deps: React.DependencyList): RefSignal<T | null | undefined> {
    const memo = useMemo<T | null | undefined>(factory, deps);
    const value = useRefSignal<T | null | undefined>(memo);

    useRefSignalEffect(() => {
        value.update(factory());
    }, deps);

    return value;
}
