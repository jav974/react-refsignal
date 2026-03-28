import { devtools } from './devtools';

export type Listener<T = unknown> = (value: T) => void;
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
  readonly notify: () => void;
  readonly notifyUpdate: () => void;
  /** DevTools only: Get the debug name of this signal */
  readonly getDebugName?: () => string | undefined;
}

export function isRefSignal<T>(obj: unknown): obj is RefSignal<T> {
  if (typeof obj !== 'object' || obj === null) return false;
  const candidate = obj as Record<string, unknown>;
  return (
    'current' in candidate &&
    typeof candidate['lastUpdated'] === 'number' &&
    typeof candidate['subscribe'] === 'function' &&
    typeof candidate['unsubscribe'] === 'function' &&
    typeof candidate['update'] === 'function' &&
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
        const name = devtools.isEnabled()
          ? devtools.getSignalName(signal)
          : null;
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

    if (devtools.isEnabled()) {
      devtools.trackUpdate(signal, oldValue, value);
    }

    notifyUpdate(signal);
  }
}

export function createRefSignal<T = unknown>(
  initialValue: T,
  debugName?: string,
): RefSignal<T> {
  const signal: RefSignal<T> = {
    current: initialValue,
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
      update(signal, value);
    },
    getDebugName: devtools.isEnabled()
      ? () => devtools.getSignalName(signal)
      : undefined,
  };

  if (devtools.isEnabled()) {
    devtools.registerSignal(signal, debugName);
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
