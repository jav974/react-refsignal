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
export function setSignalBroadcastAdapter(
  adapter: SignalBroadcastAdapter,
): void {
  signalBroadcastAdapter = adapter;
}

/** @internal Called by `useRefSignal` to set up broadcast with React lifecycle cleanup. */
export function attachSignalBroadcast(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal: RefSignal<any>,
  options: SignalBroadcastInput,
): (() => void) | undefined {
  return signalBroadcastAdapter?.attach(signal, options);
}

export const CANCEL = Symbol('refsignal.cancel');
export type Interceptor<T> = (incoming: T, current: T) => T | typeof CANCEL;

export type SignalOptions<T> = {
  debugName?: string;
  interceptor?: Interceptor<T>;
  /** Sync this signal across tabs. Import `react-refsignal/broadcast` to activate. */
  broadcast?: SignalBroadcastInput;
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
  const { debugName, interceptor } = resolved ?? {};

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
      update(signal, result);
    },
    reset: () => {
      signal.update(safeInitial);
    },
    getDebugName: () => devtoolsAdapter?.getSignalName(signal),
  };

  devtoolsAdapter?.registerSignal(signal, debugName);

  if (resolved?.broadcast) {
    signalBroadcastAdapter?.attach(signal, resolved.broadcast);
  }

  return signal;
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
