import { useEffect, useRef } from 'react';
import { isRefSignal } from '../refsignal';
import { createDebounce, createRAF, createThrottle } from '../timing';
import type { TimingOptions } from '../timing';

/**
 * Options for {@link useRefSignalEffect} and {@link useRefSignalRender}.
 * All output mechanisms in react-refsignal (effects, renders, persist, broadcast)
 * extend this type — timing options rate-limit execution, filter gates it entirely.
 */
export type EffectOptions = TimingOptions & {
  /**
   * Skip the effect run when this returns false.
   * Applied to signal-triggered runs only — does not affect the mount run
   * (use `skipMount` to suppress that).
   */
  filter?: () => boolean;
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
 * @param effect A function to run when any dependency signal changes.
 * @param deps An array of RefSignal objects (and optionally other values) to watch for changes.
 * @param options Optional {@link EffectOptions} to rate-limit or gate signal-triggered effect runs.
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
  // Store effect in ref to avoid stale closures when effect function changes
  const effectRef = useRef(effect);
  effectRef.current = effect;

  const { throttle, debounce, maxWait, rAF, filter, skipMount } = options ?? {};

  // Store filter in ref so changes don't trigger resubscription
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    const runEffect = () => {
      if (filterRef.current && !filterRef.current()) return;
      effectRef.current();
    };

    // Create timing wrapper scoped to this subscription lifetime
    const timed = rAF
      ? createRAF(runEffect)
      : throttle !== undefined
        ? createThrottle(runEffect, throttle)
        : debounce !== undefined
          ? createDebounce(runEffect, debounce, maxWait)
          : null;

    const wrappedEffect = timed ? timed.call : runEffect;

    // Subscribe to all RefSignal dependencies
    deps.forEach((dep) => {
      if (isRefSignal(dep)) dep.subscribe(wrappedEffect);
    });

    // Mount run — synchronous and unconditional, unless skipMount is true
    const destructor = skipMount ? undefined : effectRef.current();

    // Cleanup function — only runs on unmount or deps change
    return () => {
      timed?.cancel();
      deps.forEach((dep) => {
        if (isRefSignal(dep)) dep.unsubscribe(wrappedEffect);
      });
      if (typeof destructor === 'function') {
        destructor();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps forwarded from caller; timing primitives trigger resubscription on change
  }, [...deps, throttle, debounce, maxWait, rAF]);
}
