import Stack from './utils/Stack';

export type Listener<T = unknown> = (value: T) => void;
// Using object instead of RefSignal<unknown> to avoid variance issues with generic T
export const listenersMap = new WeakMap<object, Set<Listener<unknown>>>();
export const batchStack = new Stack<RefSignal<unknown>[]>();

export interface RefSignal<T = unknown> {
    current: T;
    lastUpdated: number;
    readonly subscribe: (listener: Listener<T>) => void;
    readonly unsubscribe: (listener: Listener<T>) => void;
    readonly update: (value: T) => void;
    readonly notify: () => void;
    readonly notifyUpdate: () => void;
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
    if (!batchStack.peek()?.some((s) => s === signal)) {
        listenersMap
            .get(signal)
            ?.forEach((listener) => listener(signal.current));
    }
}

export function notifyUpdate<T>(signal: RefSignal<T>): void {
    signal.lastUpdated = Date.now();
    notify(signal);
}

export function update<T>(signal: RefSignal<T>, value: T) {
    if (signal.current !== value) {
        signal.current = value;
        notifyUpdate(signal);
    }
}

export function createRefSignal<T = unknown>(initialValue: T): RefSignal<T> {
    const signal: RefSignal<T> = {
        current: initialValue,
        lastUpdated: 0,
        subscribe: (listener: Listener<T>) => subscribe(signal, listener),
        unsubscribe: (listener: Listener<T>) => unsubscribe(signal, listener),
        notify: () => notify(signal),
        notifyUpdate: () => notifyUpdate(signal),
        update: (value: T) => update(signal, value),
    };

    return signal;
}

/**
 * Defer notifications of refSignals update to the end of callback function
 * @param deps
 */
export function batch(
    callback: React.EffectCallback,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps: RefSignal<any>[],
): void {
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
}
