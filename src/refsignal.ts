import { applyTimingOptions } from './timing';
import type { TimingOptions, WatchOptions } from './timing';

export type Listener<T = unknown> = (value: T) => void;

export interface DevToolsAdapter {
  trackUpdate<T>(signal: RefSignal<T>, oldValue: T, newValue: T): void;
  registerSignal<T>(signal: RefSignal<T>, debugName?: string): void;
  getSignalName<T>(signal: RefSignal<T>): string | undefined;
}

let devtoolsAdapter: DevToolsAdapter | null = null;
export function setDevToolsAdapter(adapter: DevToolsAdapter | null): void {
  devtoolsAdapter = adapter;
}

/** Minimal opaque shape — full `BroadcastSignalOptions` is defined in `react-refsignal/broadcast`. */
export type SignalBroadcastInput =
  | string
  | { channel: string; [key: string]: unknown };

export interface SignalBroadcastAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attach(signal: RefSignal<any>, options: SignalBroadcastInput): () => void;
}

let signalBroadcastAdapter: SignalBroadcastAdapter | null = null;
let warnedBroadcast = false;
export function setSignalBroadcastAdapter(
  adapter: SignalBroadcastAdapter,
): void {
  signalBroadcastAdapter = adapter;
}

/** @internal Called by `useRefSignal` and `createRefSignal` to set up broadcast with React lifecycle cleanup. */
export function attachSignalBroadcast(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal: RefSignal<any>,
  options: SignalBroadcastInput,
): (() => void) | undefined {
  if (!signalBroadcastAdapter) {
    if (!warnedBroadcast) {
      warnedBroadcast = true;
      console.warn(
        '[refsignal] `broadcast` option has no effect: add `import "react-refsignal/broadcast"` to your entry point.',
      );
    }
    return;
  }
  return signalBroadcastAdapter.attach(signal, options);
}

/** Minimal opaque shape — full `PersistSignalOptions` is defined in `react-refsignal/persist`. */
export type SignalPersistInput =
  | string
  | { key: string; [key: string]: unknown };

export interface SignalPersistAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attach(signal: RefSignal<any>, options: SignalPersistInput): () => void;
}

let signalPersistAdapter: SignalPersistAdapter | null = null;
let warnedPersist = false;
export function setSignalPersistAdapter(adapter: SignalPersistAdapter): void {
  signalPersistAdapter = adapter;
}

/** @internal Called by `useRefSignal` and `createRefSignal` to set up persist with React lifecycle cleanup. */
export function attachSignalPersist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal: RefSignal<any>,
  options: SignalPersistInput,
): (() => void) | undefined {
  if (!signalPersistAdapter) {
    if (!warnedPersist) {
      warnedPersist = true;
      console.warn(
        '[refsignal] `persist` option has no effect: add `import "react-refsignal/persist"` to your entry point.',
      );
    }
    return;
  }
  return signalPersistAdapter.attach(signal, options);
}

export const CANCEL = Symbol('refsignal.cancel');
export type Interceptor<T> = (incoming: T, current: T) => T | typeof CANCEL;

export type SignalOptions<T> = {
  debugName?: string;
  interceptor?: Interceptor<T>;
  /**
   * Custom equality function. When provided, an update is skipped if `equal(incoming, current)`
   * returns `true`. Useful for object signals where reference equality produces false positives.
   *
   * @example
   * createRefSignal({ x: 0, y: 0 }, {
   *   equal: (a, b) => a.x === b.x && a.y === b.y,
   * });
   */
  equal?: (a: T, b: T) => boolean;
  /** Sync this signal across tabs. Import `react-refsignal/broadcast` to activate. */
  broadcast?: SignalBroadcastInput;
  /** Persist this signal's value to storage. Import `react-refsignal/persist` to activate. */
  persist?: SignalPersistInput;
};
// Using object instead of RefSignal to avoid variance issues with generic T
export const listenersMap = new WeakMap<object, Set<Listener>>();
export const batchStack: RefSignal[][] = [];
let batchedSignals: Set<RefSignal> | null = null;
let updateCounter = 0;

export interface RefSignal<T = unknown> {
  current: T;
  lastUpdated: number;
  readonly subscribe: (listener: Listener<T>) => void;
  readonly unsubscribe: (listener: Listener<T>) => void;
  readonly update: (value: T) => void;
  readonly reset: () => void;
  readonly notify: () => void;
  readonly notifyUpdate: () => void;
  /** Returns the signal's debug name if registered with devtools, otherwise undefined. */
  readonly getDebugName: () => string | undefined;
}

// T is used for call-site type narrowing only — the shape check is structural,
// the type of `.current` is not validated at runtime.
export function isRefSignal<T = unknown>(obj: unknown): obj is RefSignal<T> {
  if (typeof obj !== 'object' || obj === null) return false;
  const candidate = obj as Record<string, unknown>;
  return (
    'current' in candidate &&
    typeof candidate['lastUpdated'] === 'number' &&
    typeof candidate['subscribe'] === 'function' &&
    typeof candidate['unsubscribe'] === 'function' &&
    typeof candidate['update'] === 'function' &&
    typeof candidate['reset'] === 'function' &&
    typeof candidate['notify'] === 'function' &&
    typeof candidate['notifyUpdate'] === 'function'
  );
}

export function subscribe<T>(
  signal: RefSignal<T>,
  listener: Listener<T>,
): void {
  if (!listenersMap.has(signal)) {
    listenersMap.set(signal, new Set());
  }
  listenersMap.get(signal)?.add(listener as Listener);
}

export function unsubscribe<T>(
  signal: RefSignal<T>,
  listener: Listener<T>,
): void {
  const listeners = listenersMap.get(signal);

  if (listeners) {
    listeners.delete(listener as Listener);
    if (listeners.size === 0) {
      listenersMap.delete(signal);
    }
  }
}

export function notify<T>(signal: RefSignal<T>): void {
  const inBatch =
    batchStack[batchStack.length - 1]?.some((s) => s === signal) ||
    (batchedSignals && batchedSignals.has(signal as RefSignal));

  if (!inBatch) {
    listenersMap.get(signal)?.forEach((listener) => {
      try {
        listener(signal.current);
      } catch (error) {
        const name = devtoolsAdapter?.getSignalName(signal) ?? null;
        console.error(
          `[RefSignal] Listener error${name ? ` in ${name}` : ''}:`,
          error,
        );
      }
    });
  }
}

export function notifyUpdate<T>(signal: RefSignal<T>): void {
  signal.lastUpdated = ++updateCounter;
  notify(signal);
}

export function update<T>(signal: RefSignal<T>, value: T) {
  if (signal.current !== value) {
    const oldValue = signal.current;
    signal.current = value;

    if (batchedSignals) {
      batchedSignals.add(signal as RefSignal);
    }

    devtoolsAdapter?.trackUpdate(signal, oldValue, value);

    notifyUpdate(signal);
  }
}

export function createRefSignal<T = unknown>(
  initialValue: T,
  options?: string | SignalOptions<T>,
): RefSignal<T> {
  const resolved =
    typeof options === 'string' ? { debugName: options } : options;
  const { debugName, interceptor, equal } = resolved ?? {};

  const intercepted = interceptor
    ? interceptor(initialValue, initialValue)
    : initialValue;
  const safeInitial = intercepted === CANCEL ? initialValue : intercepted;

  const signal: RefSignal<T> = {
    current: safeInitial,
    lastUpdated: 0,
    subscribe: (listener: Listener<T>) => {
      subscribe(signal, listener);
    },
    unsubscribe: (listener: Listener<T>) => {
      unsubscribe(signal, listener);
    },
    notify: () => {
      notify(signal);
    },
    notifyUpdate: () => {
      notifyUpdate(signal);
    },
    update: (value: T) => {
      const result = interceptor ? interceptor(value, signal.current) : value;
      if (result === CANCEL) return;
      if (equal?.(result, signal.current)) return;
      update(signal, result);
    },
    reset: () => {
      signal.update(safeInitial);
    },
    getDebugName: () => devtoolsAdapter?.getSignalName(signal),
  };

  devtoolsAdapter?.registerSignal(signal, debugName);

  if (resolved?.broadcast) {
    attachSignalBroadcast(signal, resolved.broadcast);
  }

  if (resolved?.persist) {
    attachSignalPersist(signal, resolved.persist);
  }

  return signal;
}

/**
 * A read-only derived signal. Exposes subscription and current value but not
 * `.update()` or `.reset()`. Call `.dispose()` to stop tracking dep signals.
 * Returned by {@link createComputedSignal}.
 */
export type ComputedSignal<T> = Omit<RefSignal<T>, 'update' | 'reset'> & {
  readonly dispose: () => void;
};

/**
 * Creates a derived signal whose value is recomputed whenever any dep signal updates.
 *
 * The computed signal is read-only — calling `.update()` or `.reset()` is not exposed.
 * The computation stays live as long as any dep signal is alive.
 *
 * For React components, prefer {@link useRefSignalMemo} which ties the lifetime to the
 * component and handles non-signal deps (props, state) via React's dependency array.
 *
 * @example
 * const price = createRefSignal(10);
 * const qty   = createRefSignal(3);
 * const total = createComputedSignal(() => price.current * qty.current, [price, qty]);
 * total.subscribe(v => console.log('total:', v)); // 30
 * price.update(20); // total → 60
 */
export function createComputedSignal<T>(
  compute: () => T,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: RefSignal<any>[],
): ComputedSignal<T> {
  const signal = createRefSignal(compute());
  const recompute = () => {
    signal.update(compute());
  };
  const cleanups = deps.map((dep) => watch(dep, recompute));
  return Object.assign(signal, {
    dispose: () => {
      cleanups.forEach((stop) => {
        stop();
      });
    },
  });
}

/**
 * Subscribes a listener to a signal and returns a cleanup function.
 *
 * Mirrors the `useEffect` return pattern for non-React contexts — no need to
 * hold a reference to the listener just to unsubscribe later.
 *
 * @example
 * const stop = watch(score, (value) => console.log('score:', value));
 * // later:
 * stop();
 *
 * @example
 * // Throttled — fires at most once per 100 ms
 * const stop = watch(score, (v) => draw(v), { throttle: 100 });
 *
 * @example
 * // Frame-synced — collapses rapid updates into one call per animation frame
 * const stop = watch(position, (v) => render(v), { rAF: true });
 *
 * @example
 * // Filtered — only reacts when score is positive
 * const stop = watch(score, (v) => log(v), { filter: () => score.current > 0 });
 */
export function watch<T>(
  signal: RefSignal<T>,
  listener: Listener<T>,
  options?: WatchOptions,
): () => void {
  if (!options) {
    signal.subscribe(listener);
    return () => {
      signal.unsubscribe(listener);
    };
  }

  const { filter } = options;
  let latest = signal.current;

  // Cast to TimingOptions — applyTimingOptions only reads timing fields, not filter
  const wrapper = applyTimingOptions(() => {
    if (!filter || filter()) listener(latest);
  }, options as TimingOptions);

  const adapter: Listener<T> = (value) => {
    latest = value;
    wrapper.call();
  };

  signal.subscribe(adapter);
  return () => {
    signal.unsubscribe(adapter);
    wrapper.cancel();
  };
}

/**
 * Batch multiple signal updates and defer notifications until the callback completes.
 *
 * **Auto-inference mode** (no deps parameter):
 * - Automatically tracks signals updated via `.update()`
 * - Recommended for most use cases
 * - Direct mutations (`signal.current = value`) are NOT tracked
 *
 * **Explicit deps mode** (with deps parameter):
 * - Manually specify which signals to batch
 * - Use when you need to batch direct mutations or `.notify()` calls
 *
 * @param callback Function that performs signal updates
 * @param deps Optional array of signals to batch (for explicit mode)
 *
 * @example
 * // Auto-inferred (recommended)
 * batch(() => {
 *   signalA.update(1);
 *   signalB.update(2);
 * });
 *
 * @example
 * // Explicit deps (for direct mutations)
 * batch(() => {
 *   signalA.current = 1;
 *   signalB.current = 2;
 * }, [signalA, signalB]);
 */
export function batch(
  callback: () => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps?: RefSignal<any>[],
): void {
  if (deps !== undefined) {
    // Explicit deps mode - original behavior
    batchStack.push(deps);

    try {
      callback();
    } finally {
      batchStack.pop();

      const lastUpdated = ++updateCounter;

      deps.forEach((dep) => {
        dep.lastUpdated = lastUpdated;
        dep.notify();
      });
    }
  } else {
    // Auto-inference mode - track signals updated via .update()
    const tracked = new Set<RefSignal>();
    const previousBatchedSignals = batchedSignals;
    batchedSignals = tracked;

    try {
      callback();
    } finally {
      batchedSignals = previousBatchedSignals;

      if (tracked.size > 0) {
        const lastUpdated = ++updateCounter;

        tracked.forEach((dep) => {
          dep.lastUpdated = lastUpdated;
          dep.notify();
        });
      }
    }
  }
}
