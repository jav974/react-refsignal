import { useEffect, useRef } from 'react';
import { isRefSignal } from '../refsignal';

/**
 * React hook for running an effect when one or more RefSignal values change.
 *
 * This hook is similar to React's {@link useEffect}, but it tracks changes to the `.current` value
 * of each provided RefSignal dependency and runs the effect whenever any of them updates.
 *
 * Implementation Notes:
 * - The effect function is stored in a ref to avoid stale closures. When a signal update triggers
 *   the effect, it always uses the latest version of the effect function from the current render.
 * - LIGHTWEIGHT: The effect runs directly when signals update - no cleanup between signal notifications.
 *   This makes it suitable for high-frequency updates (multiple times per second).
 * - Cleanup functions (if returned by the effect) ONLY run on unmount or when deps array changes.
 * - Effects CAN update signals they depend on, which will trigger the effect again (re-entrancy is allowed).
 *
 * - The effect runs once on mount and again whenever any signal in the dependencies array changes value.
 * - Cleanup functions are supported, just like in {@link useEffect}, but only called on unmount/deps change.
 * - If the effect function changes between renders (due to captured props/state), the new function
 *   will be used the next time a signal triggers it.
 *
 * @param effect A function to run when any dependency signal changes.
 * @param deps An array of RefSignal objects (and optionally other values) to watch for changes.
 *
 * @example
 * const count = useRefSignal(0);
 * useRefSignalEffect(() => {
 *   console.log('Count changed:', count.current);
 * }, [count]);
 *
 * @example
 * // Effects can update their dependencies (creates a controlled loop)
 * const count = useRefSignal(0);
 * useRefSignalEffect(() => {
 *   if (count.current < 5) {
 *     count.update(count.current + 1); // Will trigger effect again until condition is false
 *   }
 * }, [count]);
 *
 * @example
 * // The latest effect function is always used
 * const [message, setMessage] = useState('Hello');
 * const signal = useRefSignal(0);
 * useRefSignalEffect(() => {
 *   console.log(message, signal.current); // Always uses current 'message' value
 * }, [signal]);
 *
 * @example
 * // Cleanup only runs on unmount, not between signal updates
 * const position = useRefSignal({ x: 0, y: 0 });
 * useRefSignalEffect(() => {
 *   console.log('Position updated:', position.current);
 *   // This cleanup will NOT run on every position update
 *   // It only runs when component unmounts
 *   return () => console.log('Cleanup only on unmount');
 * }, [position]);
 */
export function useRefSignalEffect(
  effect: React.EffectCallback,
  deps: React.DependencyList,
) {
  // Store effect in ref to avoid stale closures when effect function changes
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    // Wrapper that calls the current effect from ref
    // The wrapper just runs the effect - no cleanup between signal notifications
    const wrappedEffect = () => {
      effectRef.current();
    };

    // Subscribe to all RefSignal dependencies
    deps.forEach((dep) => {
      if (isRefSignal(dep)) dep.subscribe(wrappedEffect);
    });

    // Run effect immediately on mount
    const destructor = effectRef.current();

    // Cleanup function - only runs on unmount or deps change
    return () => {
      // Unsubscribe from all signals
      deps.forEach((dep) => {
        if (isRefSignal(dep)) dep.unsubscribe(wrappedEffect);
      });

      // Call effect's cleanup function if it exists
      if (typeof destructor === 'function') {
        destructor();
      }
    };
  }, deps);
}
