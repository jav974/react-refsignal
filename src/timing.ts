/**
 * Internal timing utilities for throttle, debounce, and frame-based scheduling.
 * Used by useRefSignalRender, useRefSignalEffect, useRefSignalStore, persist, and broadcast
 * to rate-limit re-renders, effects, storage writes, and cross-tab messages.
 */

// Type-only import — avoids a runtime circular dep with `refsignal.ts`.
import type { ReadonlyRefSignal } from './refsignal';

/**
 * Discriminated union of mutually exclusive timing strategies.
 * Prevents invalid combinations such as `throttle + debounce`, `frame + throttle`,
 * or `maxWait` without `debounce`.
 *
 * Valid shapes:
 * - `{}` — no timing, run synchronously on every signal update
 * - `{ throttle: N }` — at most one run per N ms (leading + trailing)
 * - `{ debounce: N }` — run after N ms of quiet
 * - `{ debounce: N, maxWait: M }` — debounce with guaranteed flush every M ms
 * - `{ delayed: N }` — run exactly N ms after the first update of a burst
 * - `{ frame: true }` — one run per animation frame (uses `requestAnimationFrame`)
 *
 * `{ delayed: N }` reads **live state at run time** — it shifts *when* the
 * callback looks, never *what* it sees. It is sugar for
 * `{ debounce: N, maxWait: N }`. If you need the value *as it was* N ms ago
 * (trails, ghosts, delayed playback), that is a different feature: see
 * `createReplayRefSignal` / `useReplayRefSignal`.
 *
 * `rAF: true` is a deprecated alias for `frame: true` and still works.
 */
export type TimingOptions =
  | {
      throttle?: never;
      debounce?: never;
      maxWait?: never;
      delayed?: never;
      frame?: never;
      rAF?: never;
    }
  | {
      throttle: number;
      debounce?: never;
      maxWait?: never;
      delayed?: never;
      frame?: never;
      rAF?: never;
    }
  | {
      throttle?: never;
      debounce: number;
      maxWait?: number;
      delayed?: never;
      frame?: never;
      rAF?: never;
    }
  | {
      throttle?: never;
      debounce?: never;
      maxWait?: never;
      delayed: number;
      frame?: never;
      rAF?: never;
    }
  | {
      throttle?: never;
      debounce?: never;
      maxWait?: never;
      delayed?: never;
      frame: true;
      rAF?: never;
    }
  | {
      throttle?: never;
      debounce?: never;
      maxWait?: never;
      delayed?: never;
      frame?: never;
      /** @deprecated Use `frame: true` instead. `rAF` will be removed in a future major version. */
      rAF: true;
    };

export interface TimingWrapper {
  call: () => void;
  cancel: () => void;
}

/**
 * Options accepted by {@link watch} and all React hooks that subscribe to signals.
 * Extends {@link TimingOptions} with an optional filter gate and dynamic-tracking hook.
 *
 * - `filter` — skip the callback when this returns `false`. Does NOT gate
 *   the dynamic-tracking reconcile pass — subscription state stays consistent
 *   regardless of filter state.
 * - timing fields — rate-limit how often the callback fires
 * - `trackSignals` — resolves additional RefSignals to subscribe to dynamically.
 *   Re-evaluated only on fires of RefSignals in the static `deps` array (static
 *   fires), never on fires of the dynamic set itself. The subscription diffs
 *   the returned array against the previously-tracked set and performs delta
 *   subscribe/unsubscribe. Two built-in shortcuts avoid wasteful work:
 *     1. Ref-equal — returning the same array reference skips the diff entirely.
 *     2. Content-equal — same length + same elements in same order skips the
 *        diff. Safe to build a fresh array per call; stable content is rewarded.
 *   Keep this function cheap — it runs synchronously in the static-dep fire path.
 *
 * {@link EffectOptions} extends this with `skipMount` for hook mount semantics.
 */
export type WatchOptions = TimingOptions & {
  filter?: () => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches `createComputedRefSignal` / `batch` signal-array conventions
  trackSignals?: () => ReadonlyArray<ReadonlyRefSignal<any>>;
};

/**
 * Leading + trailing throttle.
 * - Calls fn immediately on the first invocation within a window.
 * - Schedules a trailing call at the end of the window if further calls arrive.
 * - Subsequent calls within the window replace the trailing timer.
 */
export function createThrottle(fn: () => void, ms: number): TimingWrapper {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const call = () => {
    const now = Date.now();
    const elapsed = now - lastCall;

    if (elapsed >= ms) {
      lastCall = now;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      fn();
    } else {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn();
      }, ms - elapsed);
    }
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return { call, cancel };
}

/**
 * Debounce with optional maxWait.
 * - Resets the timer on every call; fires after `ms` ms of quiet.
 * - If `maxWait` is set, guarantees a flush at most every `maxWait` ms
 *   even if calls keep arriving (prevents indefinite deferral).
 */
export function createDebounce(
  fn: () => void,
  ms: number,
  maxWait?: number,
): TimingWrapper {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (maxTimer !== null) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    fn();
  };

  const call = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, ms);

    if (maxWait !== undefined && maxTimer === null) {
      maxTimer = setTimeout(flush, maxWait);
    }
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (maxTimer !== null) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  };

  return { call, cancel };
}

/**
 * requestAnimationFrame-based scheduler.
 * - Schedules fn on the next animation frame.
 * - Multiple calls within the same frame are collapsed into one.
 * - cancel() prevents the scheduled frame from firing.
 */
/**
 * Wraps a callback with the timing strategy described by `options`.
 * When no timing option is set, returns a passthrough wrapper so callers
 * can always call `wrapper.call()` / `wrapper.cancel()` unconditionally.
 */
export function applyTimingOptions(
  fn: () => void,
  options: TimingOptions,
): TimingWrapper {
  const { frame, rAF, throttle, debounce, maxWait, delayed } = options as {
    frame?: true;
    rAF?: true;
    throttle?: number;
    debounce?: number;
    maxWait?: number;
    delayed?: number;
  };
  if (frame || rAF) return createRAF(fn);
  if (throttle !== undefined) return createThrottle(fn, throttle);
  if (debounce !== undefined) return createDebounce(fn, debounce, maxWait);
  // `delayed: N` — run exactly N ms after the first call of a burst.
  // Sugar for debounce with an equal maxWait: the debounce timer keeps
  // resetting during the burst, but maxWait guarantees the flush at +N.
  if (delayed !== undefined) return createDebounce(fn, delayed, delayed);
  return { call: fn, cancel: () => {} };
}

export function createRAF(fn: () => void): TimingWrapper {
  let rafId: number | null = null;

  const call = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      fn();
    });
  };

  const cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  return { call, cancel };
}
