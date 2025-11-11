import Stack from './utils/Stack';
import { devtools } from './devtools';

export type Listener<T = unknown> = (value: T) => void;
// Using object instead of RefSignal<unknown> to avoid variance issues with generic T
export const listenersMap = new WeakMap<object, Set<Listener<unknown>>>();
export const batchStack = new Stack<RefSignal<unknown>[]>();

// Auto-inference: track signals updated during batch execution
let batchedSignals: Set<RefSignal<unknown>> | null = null;

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isRefSignal<T>(obj: any): obj is RefSignal<T> {
    return (
        obj &&
        typeof obj === 'object' &&
        'current' in obj &&
        typeof obj.lastUpdated === 'number' &&
        typeof obj.subscribe === 'function' &&
        typeof obj.unsubscribe === 'function' &&
        typeof obj.update === 'function' &&
        typeof obj.notify === 'function' &&
        typeof obj.notifyUpdate === 'function'
    );
}

export function subscribe<T>(
    signal: RefSignal<T>,
    listener: Listener<T>,
): void {
    if (!listenersMap.has(signal)) {
        listenersMap.set(signal, new Set());
    }
    listenersMap.get(signal)?.add(listener as Listener<unknown>);
}

export function unsubscribe<T>(
    signal: RefSignal<T>,
    listener: Listener<T>,
): void {
    const listeners = listenersMap.get(signal);

    if (listeners) {
        listeners.delete(listener as Listener<unknown>);

        if (listeners.size === 0) {
            listenersMap.delete(signal); // Cleanup if no listeners remain
        }
    }
}

export function notify<T>(signal: RefSignal<T>): void {
    // Check if we're in a batch (explicit deps in stack OR auto-inference mode tracking this signal)
    const inBatch =
        batchStack.peek()?.some((s) => s === signal) ||
        (batchedSignals && batchedSignals.has(signal as RefSignal<unknown>));

    if (!inBatch) {
        listenersMap.get(signal)?.forEach((listener) => {
            try {
                listener(signal.current);
            } catch (error) {
                // Isolate listener errors to prevent breaking the notification chain
                if (devtools.isEnabled()) {
                    console.error(
                        '[RefSignal] Listener error in signal:',
                        devtools.getSignalName(signal) || 'unknown',
                        error,
                    );
                } else {
                    console.error('[RefSignal] Listener error:', error);
                }
            }
        });
    }
}

export function notifyUpdate<T>(signal: RefSignal<T>): void {
    signal.lastUpdated = Date.now();
    notify(signal);
}

export function update<T>(signal: RefSignal<T>, value: T) {
    if (signal.current !== value) {
        const oldValue = signal.current;
        signal.current = value;

        // Track signal for auto-inferred batch
        if (batchedSignals) {
            batchedSignals.add(signal as RefSignal<unknown>);
        }

        // Track update in devtools
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
        subscribe: (listener: Listener<T>) => subscribe(signal, listener),
        unsubscribe: (listener: Listener<T>) => unsubscribe(signal, listener),
        notify: () => notify(signal),
        notifyUpdate: () => notifyUpdate(signal),
        update: (value: T) => update(signal, value),
        getDebugName: devtools.isEnabled()
            ? () => devtools.getSignalName(signal)
            : undefined,
    };

    // Register with devtools if enabled
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
export function batch(callback: React.EffectCallback): void;
export function batch(
    callback: React.EffectCallback,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps: RefSignal<any>[],
): void;
export function batch(
    callback: React.EffectCallback,
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

            const lastUpdated = Date.now();

            deps.forEach((dep) => {
                dep.lastUpdated = lastUpdated;
                dep.notify();
            });
        }
    } else {
        // Auto-inference mode - track signals updated via .update()
        const tracked = new Set<RefSignal<unknown>>();
        const previousBatchedSignals = batchedSignals;
        batchedSignals = tracked;

        try {
            callback();
        } finally {
            batchedSignals = previousBatchedSignals;

            // Notify all tracked signals (now that batchedSignals is cleared, they'll notify normally)
            const depsArray = Array.from(tracked);
            if (depsArray.length > 0) {
                const lastUpdated = Date.now();
                depsArray.forEach((dep) => {
                    dep.lastUpdated = lastUpdated;
                    dep.notify();
                });
            }
        }
    }
}
