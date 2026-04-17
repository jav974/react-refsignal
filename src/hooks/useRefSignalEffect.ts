import { useEffect, useRef } from 'react';
import { createSubscription } from '../subscription';
import { useWatchArgs } from './useWatchArgs';
import type { WatchOptions } from '../timing';

/**
 * Options for {@link useRefSignalEffect}.
 * Extends {@link WatchOptions} (timing + filter + trackSignals) with hook-specific mount behaviour.
 */
export type EffectOptions = WatchOptions & {
  /**
   * Skip the effect run on mount. When `true`, the effect only runs on
   * signal-triggered updates — never on the initial render.
   */
  skipMount?: boolean;
};

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
 * - The effect runs once on mount and again whenever any signal in the dependencies array fires —
 *   including via `.update()`, `.notifyUpdate()`, `.notify()`, and `.reset()`.
 * - Cleanup functions are supported, just like in {@link useEffect}, but only called on unmount/deps change.
 * - If the effect function changes between renders (due to captured props/state), the new function
 *   will be used the next time a signal triggers it.
 *
 * `options.trackSignals` enables **nested-signal traversal**: return signals whose identity
 * depends on another signal's current value, and the hook will diff-subscribe to them on every
 * static dep fire. See {@link WatchOptions} for full semantics.
 *
 * @param effect A function to run when any dependency signal changes.
 * @param deps An array of RefSignal objects (and optionally other values) to watch for changes.
 * @param options Optional {@link EffectOptions} to rate-limit, gate, or dynamically track signal-triggered effect runs.
 *   The initial mount run is always synchronous and unconditional regardless of timing or filter options.
 *
 * @example
 * const count = useRefSignal(0);
 * useRefSignalEffect(() => {
 *   console.log('Count changed:', count.current);
 * }, [count]);
 *
 * @example
 * // Frame-synced — multiple signal fires per frame collapse into one effect run
 * useRefSignalEffect(() => {
 *   ctx.fillRect(position.current.x, position.current.y, 20, 20);
 * }, [position], { rAF: true });
 *
 * @example
 * // Throttled — expensive effect runs at most once per 100ms
 * useRefSignalEffect(() => {
 *   rebuildIndex(data.current);
 * }, [data], { throttle: 100 });
 *
 * @example
 * // Effects can update their dependencies (creates a controlled loop)
 * const count = useRefSignal(0);
 * useRefSignalEffect(() => {
 *   if (count.current < 5) {
 *     count.update(count.current + 1);
 *   }
 * }, [count]);
 *
 * @example
 * // Cleanup only runs on unmount, not between signal updates
 * const position = useRefSignal({ x: 0, y: 0 });
 * useRefSignalEffect(() => {
 *   console.log('Position updated:', position.current);
 *   return () => console.log('Cleanup only on unmount');
 * }, [position]);
 */
export function useRefSignalEffect(
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- mirrors React's EffectCallback: void means "no cleanup returned"
  effect: () => (() => void) | void,
  deps: ReadonlyArray<unknown>,
  options?: EffectOptions,
) {
  const effectRef = useRef(effect);
  effectRef.current = effect;

  const { filterRef, subscriptionOptions } = useWatchArgs(options);
  const { skipMount } = options ?? {};

  useEffect(() => {
    const sub = createSubscription({
      deps,
      onFire: () => {
        if (filterRef.current && !filterRef.current()) return;
        effectRef.current();
      },
      options: subscriptionOptions,
    });

    // Mount run — synchronous and unconditional, unless skipMount is true.
    // Bypasses timing and filter so users can count on setup-time side effects.
    const destructor = skipMount ? undefined : effectRef.current();

    return () => {
      sub.dispose();
      if (typeof destructor === 'function') {
        destructor();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps forwarded from caller; subscriptionOptions covers timing changes
  }, [...deps, subscriptionOptions]);
}
