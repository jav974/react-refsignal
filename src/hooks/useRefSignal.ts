import { useEffect, useMemo } from "react";
import { createRefSignal, listenersMap, RefSignal } from "../refsignal";

/**
 * React hook for creating a mutable signal-like ref with subscription support.
 *
 * This hook returns a {@link RefSignal} object that holds a mutable value in `.ref.current`
 * and provides methods to subscribe to changes, update the value, and notify listeners.
 *
 * - The value should be updated using the `.update()` method to ensure listeners are notified.
 * - Directly mutating `.ref.current` will NOT trigger listeners; call `.notify()` or `.notifyUpdate()` if you do so.
 * - The returned object is stable (does not change between renders).
 * - Listeners are automatically cleaned up when the component unmounts.
 *
 * @template T The type of the value stored in the signal.
 * @param value The initial value for the signal.
 * @returns {RefSignal<T>} A signal object with ref, update, subscribe, and notification methods.
 *
 * @example
 * const signal = useRefSignal(0);
 * signal.subscribe((val) => console.log('Updated:', val));
 * signal.update(1); // Triggers listeners
 */
export function useRefSignal<T>(value: T): RefSignal<T>;
export function useRefSignal<T>(value: T | null): RefSignal<T | null>;
export function useRefSignal<T>(value: T | undefined): RefSignal<T | undefined>;
export function useRefSignal<T>(value: T | null | undefined): RefSignal<T | null | undefined> {
    const refSignal = useMemo(() => createRefSignal(value), []);

    useEffect(() => {
        return () => {
            listenersMap.delete(refSignal.ref);
        };
    }, [refSignal.ref]);

    return refSignal;
}
