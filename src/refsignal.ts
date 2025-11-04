import React, { createRef } from 'react';
import Stack from './utils/Stack';

type RefType = { current: RefSignal<unknown> };
// type RefType = React.RefObject<RefSignal<unknown>>; // React 19+ only
export type Listener<T = unknown> = (value: T) => void;
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

export function subscribe(ref: RefType, listener: Listener<unknown>): void {
    if (!listenersMap.has(ref)) {
        listenersMap.set(ref, new Set());
    }
    listenersMap.get(ref)?.add(listener);
}

export function unsubscribe(ref: RefType, listener: Listener<unknown>): void {
    const listeners = listenersMap.get(ref);

    if (listeners) {
        listeners.delete(listener);

        if (listeners.size === 0) {
            listenersMap.delete(ref); // Cleanup if no listeners remain
        }
    }
}

export function notify(ref: RefType): void {
    if (!batchStack.peek()?.some((signal) => signal === ref.current)) {
        listenersMap
            .get(ref)
            ?.forEach((listener) => listener(ref.current.current));
    }
}

export function notifyUpdate(ref: RefType): void {
    ref.current.lastUpdated = Date.now();
    notify(ref);
}

export function update(ref: RefType, value: unknown) {
    if (ref.current.current !== value) {
        ref.current.current = value;
        notifyUpdate(ref);
    }
}

export function createRefSignal<T = unknown>(initialValue: T): RefSignal<T> {
    const ref = createRef<RefSignal<T>>() as React.RefObject<RefSignal<T>> & {
        current: RefSignal<T>;
    };

    ref.current = {
        current: initialValue,
        lastUpdated: 0,
        subscribe: (listener: Listener<T>) =>
            subscribe(ref as RefType, listener as Listener<unknown>),
        unsubscribe: (listener: Listener<T>) =>
            unsubscribe(ref as RefType, listener as Listener<unknown>),
        notify: () => notify(ref as RefType),
        notifyUpdate: () => notifyUpdate(ref as RefType),
        update: (value: T) => update(ref as RefType, value),
    };

    return ref.current;
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
