import { DependencyList } from 'react';
import { ReadonlySignal } from '../refsignal';
import { useRefSignalMemo } from './useRefSignalMemo';
import type { WatchOptions } from '../timing';

/**
 * Options for {@link useRefSignalFollow}.
 * Accepts timing and filter from {@link WatchOptions}. `trackSignals` is
 * managed internally by the hook and cannot be overridden.
 */
export type FollowOptions = Omit<WatchOptions, 'trackSignals'>;

/**
 * React hook that produces a stable {@link RefSignal} whose value tracks
 * another signal resolved dynamically through `getter`.
 *
 * @see [Decision Tree §7 — Dynamic Signal Identity](https://github.com/jav974/react-refsignal/blob/main/docs/decision-tree.md#7-dynamic-signal-identity)
 *
 * The inner signal's **identity** is allowed to change over time — whenever
 * any signal in `deps` fires, the hook re-evaluates `getter`, unsubscribes
 * from the previous inner signal, and subscribes to the new one.
 *
 * This is shorthand for a {@link useRefSignalMemo} that reads
 * `getter()?.current` while tracking `getter()` as a dynamic signal. Use it
 * for "nested-signal traversal" — e.g. `RefSignal<Map<K, RefSignal<V>>>` →
 * `RefSignal<V | undefined>`.
 *
 * @template T The inner signal's value type.
 * @param getter Resolves the currently-tracked inner signal. May return
 *   `null` / `undefined` when no signal is currently available — the
 *   returned signal's value then becomes `undefined`.
 * @param deps Signals and non-signal values that, when they change, may
 *   cause `getter` to resolve a different inner signal. React re-runs
 *   `getter` on any dep change (static identity or signal fire).
 * @param options Optional timing + filter. `trackSignals` is reserved.
 * @returns A {@link RefSignal} whose value is kept in sync with whatever
 *   inner signal `getter` currently resolves. Value type is `T | undefined`.
 *
 * @example
 * // Follow the currently-focused node's data signal in a graph editor.
 * const node = useRefSignalFollow(
 *   () => nodes.current.get(focusedId),
 *   [nodes, focusedId],
 * );
 * // node.current → NodeData | undefined
 *
 * @example
 * // Frame-sync expensive reads from the followed signal.
 * const pos = useRefSignalFollow(
 *   () => positions.current.get(id),
 *   [positions, id],
 *   { rAF: true },
 * );
 */
export function useRefSignalFollow<T>(
  getter: () => ReadonlySignal<T> | null | undefined,
  deps: DependencyList,
  options?: FollowOptions,
): ReadonlySignal<T | undefined> {
  return useRefSignalMemo(() => getter()?.current, deps, {
    ...options,
    trackSignals: () => {
      const s = getter();
      return s ? [s] : [];
    },
    // Cast needed because spreading the Omit<...> loses the TimingOptions
    // discriminated-union narrowing — each timing field is widened to optional.
  } as WatchOptions);
}
