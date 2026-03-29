/**
 * Internal timing utilities for throttle, debounce, and rAF-based scheduling.
 * Used by useRefSignalRender and useRefSignalEffect to rate-limit re-renders and effects.
 */

export interface TimingWrapper {
  call: () => void;
  cancel: () => void;
}

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
