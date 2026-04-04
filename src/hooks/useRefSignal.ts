import { useMemo } from 'react';
import { createRefSignal, RefSignal, SignalOptions } from '../refsignal';

/**
 * React hook for creating a mutable signal-like ref with subscription support.
 *
 * This hook returns a {@link RefSignal} object that holds a mutable value in `.current`
 * and provides methods to subscribe to changes, update the value, and notify listeners.
 *
 * - The value should be updated using the `.update()` method to ensure listeners are notified.
 * - Directly mutating `.current` will NOT trigger listeners; call `.notify()` or `.notifyUpdate()` if you do so.
 * - The returned object is stable (does not change between renders).
 * - Listener cleanup is handled by the WeakMap: when no component holds a reference to
 *   the signal, the entry is collected automatically. Each subscriber is responsible for
 *   unsubscribing via its own cleanup (e.g. `useRefSignalEffect` does this automatically).
 *
 * @template T The type of the value stored in the signal.
 * @param value The initial value for the signal. If an `interceptor` is provided, it is
 *   applied to this value at construction — the signal's effective initial value is the
 *   interceptor's return value (or `value` itself if the interceptor returns `CANCEL`).
 * @param options A debug name string, or a {@link SignalOptions} object with:
 *   - `debugName` — name shown in DevTools (equivalent to passing a plain string).
 *   - `interceptor` — runs on every `.update()` call. Return a `T` to store that value,
 *     or return `CANCEL` to silently drop the update. Also applied to the initial value.
 * @returns {RefSignal<T>} A stable RefSignal with `current`, `update`, `reset`, `subscribe`,
 *   and notification methods.
 *
 * @example
 * const signal = useRefSignal(0);
 * signal.subscribe((val) => console.log('Updated:', val));
 * signal.update(1); // Triggers listeners
 *
 * @example
 * // With debug name
 * const count = useRefSignal(0, 'userCount');
 *
 * @example
 * // Clamp value — interceptor applied on every update and at mount
 * const health = useRefSignal(100, { interceptor: (v) => Math.max(0, Math.min(100, v)) });
 *
 * @example
 * // Cancel invalid updates
 * const step = useRefSignal(0, { interceptor: (incoming, current) => incoming < current ? CANCEL : incoming });
 */
export function useRefSignal<T>(
  value: T,
  options?: string | SignalOptions<T>,
): RefSignal<T>;
export function useRefSignal<T>(
  value: T | null,
  options?: string | SignalOptions<T | null>,
): RefSignal<T | null>;
export function useRefSignal<T>(
  value: T | undefined,
  options?: string | SignalOptions<T | undefined>,
): RefSignal<T | undefined>;
export function useRefSignal<T>(
  value: T | null | undefined,
  options?: string | SignalOptions<T | null | undefined>,
): RefSignal<T | null | undefined> {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- signal is intentionally created once on mount
  return useMemo(() => createRefSignal(value, options), []);
}
