import {
  createRefSignal,
  Listener,
  listenersMap,
  ReadonlyRefSignal,
} from './refsignal';

/**
 * The cadence at which a {@link PulseRefSignal} fires.
 *
 * - `number` — fixed interval in milliseconds (uses `setInterval`).
 * - `'Nms'`  — same as the number form, with explicit unit.
 * - `'Nfps'` — frame-aligned cadence throttled to at most N times per
 *   second (uses `requestAnimationFrame`, so the loop pauses on hidden
 *   tabs).
 * - `'raf'`  — every animation frame, with no throttle. Follows the
 *   display's refresh rate (60Hz, 120Hz, 144Hz, …). Use this when you
 *   want "as fast as the screen draws" rather than a target fps.
 */
export type PulseRate = number | `${number}ms` | `${number}fps` | 'raf';

/**
 * A read-only signal that fires on a schedule. Conceptually a clock primitive.
 *
 * Each tick:
 * - `current` is set to `performance.now()`.
 * - `notifyUpdate` is called, so subscribers re-run and `lastUpdated` advances.
 *
 * Beyond `ReadonlyRefSignal<number>`, exposes per-session metrics:
 * - `dt` — milliseconds since the previous tick (the time between `current`
 *   updates). Reset to `0` whenever the timer is (re)started.
 * - `tick` — number of ticks fired in the current session, starting at `0`
 *   before the first fire and incrementing by `1` each tick. Reset on
 *   timer start.
 * - `elapsed` — milliseconds since the first tick of the current session.
 *   `0` until the second tick fires.
 *
 * Lazy lifecycle: the timer only runs while the signal has at least one
 * subscriber. It (re)starts on `0 → 1` subscriber transitions and stops on
 * `1 → 0` and on `dispose`. State (`dt`, `tick`, `elapsed`) is reset each
 * time the timer (re)starts, so a brief unsubscribe-then-resubscribe yields
 * a fresh session rather than a spike in `dt`.
 */
export interface PulseRefSignal extends ReadonlyRefSignal<number> {
  readonly dt: number;
  readonly tick: number;
  readonly elapsed: number;
  /**
   * Change the cadence of an already-created pulse signal. Useful when the
   * rate is itself reactive — a heartbeat that scales with stamina, polling
   * that backs off on errors, frame rate that adapts to a perf budget.
   *
   * - Validates the new rate (same parser as the constructor; throws on invalid).
   * - **Continuity preserved**: `tick` and `elapsed` keep going across the
   *   change. Only `lastTickTime` is reset, so the very next `dt` is
   *   measured from the rate-change moment, not from the previous tick at
   *   the old cadence.
   * - If the timer is currently running, it is stopped and restarted at the
   *   new cadence. If no subscribers are attached, the new rate is just
   *   stored and applied on the next `0 → 1` subscriber transition (which
   *   does its own full session reset, as before).
   * - Driver may switch (e.g. `'1000ms'` → `'60fps'` swaps `setInterval`
   *   for `requestAnimationFrame`).
   *
   * @example
   * useRefSignalEffect(() => {
   *   heartbeat.updatePulse(`${msPerBeat(stamina.current)}ms` as PulseRate);
   * }, [stamina]);
   */
  readonly updatePulse: (rate: PulseRate) => void;
}

interface ParsedRate {
  driver: 'raf' | 'interval';
  intervalMs: number;
}

const FPS_RE = /^(\d+(?:\.\d+)?)fps$/;
const MS_RE = /^(\d+(?:\.\d+)?)ms$/;

function parsePulseRate(rate: PulseRate): ParsedRate {
  if (typeof rate === 'number') {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(
        `[refsignal] Invalid pulse rate: ${String(rate)}. Must be a positive finite number.`,
      );
    }
    return { driver: 'interval', intervalMs: rate };
  }

  // 'raf' — every frame, no throttle. intervalMs: 0 makes the driver's
  // threshold gate a no-op (see startRAFTimer), so it fires on every
  // requestAnimationFrame callback at the display's native rate.
  if (rate === 'raf') {
    return { driver: 'raf', intervalMs: 0 };
  }

  const fpsMatch = FPS_RE.exec(rate);
  if (fpsMatch?.[1]) {
    const fps = parseFloat(fpsMatch[1]);
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new Error(
        `[refsignal] Invalid pulse rate: ${rate}. fps must be positive.`,
      );
    }
    return { driver: 'raf', intervalMs: 1000 / fps };
  }

  const msMatch = MS_RE.exec(rate);
  if (msMatch?.[1]) {
    const ms = parseFloat(msMatch[1]);
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error(
        `[refsignal] Invalid pulse rate: ${rate}. ms must be positive.`,
      );
    }
    return { driver: 'interval', intervalMs: ms };
  }

  throw new Error(
    `[refsignal] Invalid pulse rate: ${rate}. Expected number | 'Nms' | 'Nfps' | 'raf'.`,
  );
}

function startRAFTimer(intervalMs: number, tick: () => void): () => void {
  if (typeof requestAnimationFrame === 'undefined') return () => {};

  let rafId: number | null = null;
  let lastFireTime = performance.now();
  // Half-millisecond slop covers natural frame jitter — without it, a 60fps
  // request on a 60Hz display can occasionally miss a frame because RAF
  // delivers slightly under 16.67ms.
  const threshold = intervalMs - 0.5;

  const loop = () => {
    const now = performance.now();
    if (now - lastFireTime >= threshold) {
      lastFireTime = now;
      tick();
    }
    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);

  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

function startIntervalTimer(intervalMs: number, tick: () => void): () => void {
  const id = setInterval(tick, intervalMs);
  return () => {
    clearInterval(id);
  };
}

/**
 * Creates a {@link PulseRefSignal} — a self-firing read-only signal whose
 * `current` advances to `performance.now()` on every tick.
 *
 * The timer is lazy: it starts when the signal gets its first subscriber and
 * stops when subscribers drop back to zero (or on `.dispose()`). Multiple
 * subscribers share a single underlying timer.
 *
 * @param rate Cadence — number of ms, `'Nms'`, `'Nfps'`, or `'raf'`. fps
 *   notation throttles `requestAnimationFrame` to at most N times per
 *   second; `'raf'` fires on every frame at the display's native rate
 *   (60Hz / 120Hz / 144Hz / …); ms notation uses `setInterval`.
 *
 * @example
 * const now = createPulseRefSignal('1000ms');  // every second
 * const loop = createPulseRefSignal('60fps');  // throttled to 60
 * const frame = createPulseRefSignal('raf');   // every frame, native rate
 * const tick = createPulseRefSignal(250);      // every 250 ms
 *
 * @example
 * // Auth-token refresh — replaces a setInterval-in-useEffect dance with a
 * // declarative subscription.
 * const refreshTick = createPulseRefSignal(4 * 60 * 1000); // every 4 minutes
 * refreshTick.subscribe(() => { void refreshAuthToken(); });
 *
 * @example
 * // Live "X ago" — one timer, many components, perfect sync via context.
 * const now = createPulseRefSignal('1000ms');
 * // …provide via a RefSignalContext, consume from any number of components.
 */
export function createPulseRefSignal(
  rate: PulseRate,
): PulseRefSignal & { readonly dispose: () => void } {
  let parsed = parsePulseRate(rate);

  const signal = createRefSignal(performance.now());

  let dt = 0;
  let tickCount = 0;
  let elapsed = 0;
  let firstTickTime = 0;
  let lastTickTime = 0;
  let stopTimer: (() => void) | null = null;

  const onTick = () => {
    const now = performance.now();
    if (tickCount === 0) {
      firstTickTime = now;
      elapsed = 0;
    } else {
      elapsed = now - firstTickTime;
    }
    dt = now - lastTickTime;
    lastTickTime = now;
    tickCount++;
    signal.current = now;
    signal.notifyUpdate();
  };

  const installTimer = () => {
    if (typeof window === 'undefined') return;
    stopTimer =
      parsed.driver === 'raf'
        ? startRAFTimer(parsed.intervalMs, onTick)
        : startIntervalTimer(parsed.intervalMs, onTick);
  };

  const start = () => {
    // Reset session state so a re-subscribe starts a fresh epoch instead of
    // observing a giant dt spike across the idle gap.
    dt = 0;
    tickCount = 0;
    elapsed = 0;
    firstTickTime = 0;
    lastTickTime = performance.now();
    installTimer();
  };

  const stop = () => {
    if (stopTimer) {
      stopTimer();
      stopTimer = null;
    }
  };

  const updatePulse = (newRate: PulseRate): void => {
    // Validate first — throwing parse errors must not leave the timer half-stopped.
    parsed = parsePulseRate(newRate);

    if (!stopTimer) return; // not running — new rate applies on next start()

    // Continuity: keep tick / elapsed accumulating, only baseline lastTickTime
    // so the next dt reflects the rate change rather than spanning the
    // restart.
    stop();
    lastTickTime = performance.now();
    installTimer();
  };

  const subscriberCount = (): number => listenersMap.get(signal)?.size ?? 0;

  const baseSubscribe = signal.subscribe;
  const baseUnsubscribe = signal.unsubscribe;
  const baseDispose = signal.dispose;

  Object.assign(signal, {
    subscribe: (listener: Listener<number>) => {
      const before = subscriberCount();
      baseSubscribe(listener);
      if (before === 0 && subscriberCount() === 1) start();
    },
    unsubscribe: (listener: Listener<number>) => {
      baseUnsubscribe(listener);
      if (subscriberCount() === 0) stop();
    },
    dispose: () => {
      stop();
      baseDispose();
    },
    updatePulse,
  });

  Object.defineProperties(signal, {
    dt: { get: () => dt, enumerable: true },
    tick: { get: () => tickCount, enumerable: true },
    elapsed: { get: () => elapsed, enumerable: true },
  });

  return signal as unknown as PulseRefSignal & {
    readonly dispose: () => void;
  };
}
