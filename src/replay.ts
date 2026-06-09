/**
 * `createReplayRefSignal` — a derived signal that replays its source's value
 * timeline N milliseconds later.
 *
 * This is the *time-shifted value* primitive: the output is what the source
 * **was** N ms ago, retracing every update in order. It is intentionally a
 * signal→signal transform — timing options like `{ delayed: N }` can shift
 * *when* a callback runs, but the callback still reads live state; only a
 * signal can carry a shifted timeline to any consumer (effects, renders,
 * memos) unchanged.
 */

import {
  createRefSignal,
  watch,
  type ReadonlyRefSignal,
  type RefSignal,
} from './refsignal';

/**
 * @internal
 *
 * The replay engine shared by {@link createReplayRefSignal} and
 * `useReplayRefSignal`: follows `source` and re-emits each captured value on
 * `target` once its due time arrives. Returns a detach function that stops
 * following, cancels the pending timer, and clears the queue — mirroring the
 * `attachSignalBroadcast` / `attachSignalPersist` attach-returns-cleanup
 * convention so React hooks can own the lifetime via `useEffect`.
 *
 * Scheduling: a single `setTimeout` stays armed for the head entry's due time
 * — at most one timer exists at a time, and none while the source is quiet.
 * A late fire (busy event loop) drains everything that became due in the
 * meantime, so correctness holds under pressure.
 */
export function attachReplay<T>(
  source: ReadonlyRefSignal<T>,
  target: RefSignal<T>,
  ms: number,
  snapshot: (value: T) => T,
): () => void {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(
      `[refsignal] Invalid replay delay: ${String(ms)}. Must be a non-negative finite number of milliseconds.`,
    );
  }

  const queue: { t: number; value: T }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Emit every due entry, then keep a timer armed for the next one.
  const drain = () => {
    timer = null;
    const now = performance.now();
    let head = queue[0];
    while (head !== undefined && head.t <= now) {
      queue.shift();
      target.update(head.value);
      head = queue[0];
    }
    scheduleNext();
  };

  // One timer at a time, armed only while the queue is non-empty.
  const scheduleNext = () => {
    const head = queue[0];
    if (timer === null && head !== undefined) {
      timer = setTimeout(drain, head.t - performance.now());
    }
  };

  // Enqueue — capture every source fire, stamped with its due time.
  // Re-entrancy is safe by construction: if a `target.update()` subscriber
  // synchronously writes back to the source, the fresh entry gets
  // `t = now + ms > now` so it can never drain in the same pass, and the
  // `timer === null` guard prevents double-arming.
  const stopWatching = watch(source, (value) => {
    queue.push({ t: performance.now() + ms, value: snapshot(value) });
    scheduleNext();
  });

  return () => {
    stopWatching();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    queue.length = 0;
  };
}

/**
 * Creates a read-only signal that follows `source` exactly `ms` milliseconds
 * behind — every source update is captured and re-emitted on the replayed
 * signal once its due time arrives, preserving order and relative spacing.
 *
 * Consumer code is identical to consuming the live source — point it at a
 * different signal and choose any consumption timing (`frame`, `throttle`,
 * `debounce`, none) downstream. Each due entry is an individual update, so an
 * untimed subscriber observes every replayed value.
 *
 * **`snapshot` is required for object signals mutated in place** (the
 * `.current.x = …; .notify()` hot-path idiom). Without it the internal queue
 * holds N references to the same live object and every replayed emission
 * shows the present, not the past. Signals updated immutably via `.update()`
 * (and all primitives) don't need it — the default identity capture is
 * correct and allocation-free.
 *
 * Emissions fire at their due moment via a single armed timer — at most one
 * timer exists at a time, and none while the source is quiet. Inside React
 * components prefer `useReplayRefSignal`, which ties the lifetime to the
 * component. Outside React, call `.dispose()` to stop following the source
 * and release subscribers.
 *
 * Want a callback to simply run N ms *after* a change, reading live state?
 * That's not a replay — use the `{ delayed: N }` timing option instead.
 *
 * @param source The signal to follow.
 * @param ms How far behind the source the replayed signal runs, in milliseconds.
 * @param snapshot Captures the value at enqueue time. Defaults to identity —
 *   pass e.g. `p => ({ ...p })` for objects mutated in place.
 *
 * @example
 * // Ghost cursor trailing the live cursor by 300 ms
 * const cursor = createRefSignal({ x: 0, y: 0 }, 'cursor');
 * const ghost = createReplayRefSignal(cursor, 300, (p) => ({ ...p }));
 * watch(ghost, (p) => drawGhost(p), { frame: true });
 *
 * @example
 * // Delayed playback of a numeric feed — primitives need no snapshot
 * const price = createRefSignal(0);
 * const delayedPrice = createReplayRefSignal(price, 5000);
 * watch(delayedPrice, (v) => updateComparisonChart(v));
 */
export function createReplayRefSignal<T>(
  source: ReadonlyRefSignal<T>,
  ms: number,
  snapshot: (value: T) => T = (v) => v,
): ReadonlyRefSignal<T> & { readonly dispose: () => void } {
  const sourceName = source.getDebugName();
  const replayed = createRefSignal(
    snapshot(source.current),
    sourceName ? `${sourceName}.replay(${String(ms)}ms)` : undefined,
  );

  const detach = attachReplay(source, replayed, ms, snapshot);

  const baseDispose = replayed.dispose;
  return Object.assign(replayed, {
    dispose: () => {
      detach();
      baseDispose();
    },
  });
}
