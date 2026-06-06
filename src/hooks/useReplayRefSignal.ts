import { useEffect } from 'react';
import type { ReadonlyRefSignal } from '../refsignal';
import { attachReplay } from '../replay';
import { useRefSignal } from './useRefSignal';

/**
 * React hook companion to {@link createReplayRefSignal} — a read-only signal
 * that follows `source` exactly `ms` milliseconds behind, retracing every
 * update in order.
 *
 * @see [Patterns — Time-shifted signals](https://github.com/jav974/react-refsignal/blob/main/docs/patterns.md#time-shifted-signals--usereplayrefsignal)
 *
 * The replayed signal is stable for the component lifetime and is torn down
 * on unmount — React owns the lifetime, so no `.dispose()` is exposed (same
 * contract as {@link useRefSignalMemo}). `source`, `ms`, and `snapshot` are
 * captured at mount time, mirroring the mount-time-options convention of
 * {@link useRefSignal} and {@link usePulseRefSignal}.
 *
 * Consume it like any other signal — the body is the exact code you would
 * write against the live source, pointed at a different timeline:
 *
 * **`snapshot` is required for object signals mutated in place** (the
 * `.current.x = …; .notify()` hot-path idiom) — without it the queue holds
 * references to one live object and every replayed emission shows the
 * present, not the past. Immutably-updated signals and primitives don't need
 * it.
 *
 * Want an effect to simply run N ms *after* a change, reading live state?
 * That's not a replay — use the `{ delayed: N }` timing option instead.
 *
 * @param source The signal to follow.
 * @param ms How far behind the source the replayed signal runs, in milliseconds.
 * @param snapshot Captures the value at enqueue time. Defaults to identity —
 *   pass e.g. `p => ({ ...p })` for objects mutated in place.
 *
 * @example
 * // Ghost cursor trailing the live cursor by 300 ms
 * const cursor = useRefSignal({ x: 0, y: 0 });
 * const ghost = useReplayRefSignal(cursor, 300, (p) => ({ ...p }));
 *
 * useRefSignalEffect(() => {
 *   drawGhost(ctx, ghost.current.x, ghost.current.y);
 * }, [ghost], { frame: true });
 *
 * @example
 * // Each consumer picks its own consumption timing downstream
 * const delayedPrice = useReplayRefSignal(price, 5000);
 * useRefSignalEffect(log, [delayedPrice]);                   // every replayed value
 * useRefSignalRender([delayedPrice], { throttle: 200 });     // cheap UI mirror
 */
export function useReplayRefSignal<T>(
  source: ReadonlyRefSignal<T>,
  ms: number,
  snapshot: (value: T) => T = (v) => v,
): ReadonlyRefSignal<T> {
  const sourceName = source.getDebugName();
  const replayed = useRefSignal(
    snapshot(source.current),
    sourceName ? `${sourceName}.replay(${String(ms)}ms)` : undefined,
  );

  // The replay engine lives in the effect so it detaches/re-attaches across
  // React's StrictMode mount cycle — the signal shell above stays stable.
  useEffect(
    () => attachReplay(source, replayed, ms, snapshot),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- source/ms/snapshot are mount-time options; replayed is stable for the component lifetime
    [],
  );

  return replayed;
}
