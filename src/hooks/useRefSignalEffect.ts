import { useEffect } from 'react';
import { isUseRefSignalReturn } from '../refsignal';

/**
 * React hook for running an effect when one or more RefSignal values change.
 *
 * This hook is similar to React's {@link useEffect}, but it tracks changes to the `.ref.current` value
 * of each provided RefSignal dependency and runs the effect whenever any of them updates.
 *
 * - The effect runs once on mount and again whenever any signal in the dependencies array changes value.
 * - Cleanup functions are supported, just like in {@link useEffect}.
 *
 * @param effect A function to run when any dependency signal changes.
 * @param dependencies An array of RefSignal objects to watch for changes.
 *
 * @example
 * const count = useRefSignal(0);
 * useRefSignalEffect(() => {
 *   console.log('Count changed:', count.ref.current);
 * }, [count]);
 */
export function useRefSignalEffect(
    callback: React.EffectCallback,
    deps: React.DependencyList,
) {
    useEffect(() => {
        deps.forEach((dep) => {
            if (isUseRefSignalReturn(dep)) dep.subscribe(callback);
        });

        const destructor = callback();

        return () => {
            deps.forEach((dep) => {
                if (isUseRefSignalReturn(dep)) dep.unsubscribe(callback);
            });

            if (typeof destructor === 'function') {
                destructor();
            }
        };
    }, deps);
}
