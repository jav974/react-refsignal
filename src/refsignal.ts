import React, { createRef } from "react";
import Stack from "./utils/Stack";

export type Listener<T> = (value: T) => void;
export const listenersMap = new WeakMap<object, Set<Listener<any>>>();
export const batchStack = new Stack<React.RefObject<unknown>[]>();

export interface RefSignal<T = unknown> {
    readonly ref: React.RefObject<T>;
    readonly lastUpdated: React.RefObject<number>;
    readonly subscribe: (listener: Listener<T>) => void;
    readonly unsubscribe: (listener: Listener<T>) => void;
    readonly update: (value: T) => void;
    readonly notify: () => void;
    readonly notifyUpdate: () => void;
}

export function isUseRefSignalReturn<T>(obj: any): obj is RefSignal<T> {
    return (
        obj &&
        typeof obj.ref === "object" &&
        typeof obj.lastUpdated === "object" &&
        typeof obj.subscribe === "function" &&
        typeof obj.unsubscribe === "function" &&
        typeof obj.update === "function" &&
        typeof obj.notify === "function" &&
        typeof obj.notifyUpdate === "function"
    );
}

export function subscribe(ref: React.RefObject<unknown>, listener: Listener<any>): void{
    if (!listenersMap.has(ref)) {
        listenersMap.set(ref, new Set());
    }
    listenersMap.get(ref)?.add(listener);
}

export function unsubscribe(ref: React.RefObject<unknown>, listener: Listener<any>): void {
    const listeners = listenersMap.get(ref);
        
    if (listeners) {
        listeners.delete(listener);

        if (listeners.size === 0) {
            listenersMap.delete(ref); // Cleanup if no listeners remain
        }
    }
}

export function notify(ref: React.RefObject<unknown>): void {
    if (!batchStack.peek()?.some((r) => r === ref)) {
        listenersMap.get(ref)?.forEach((listener) => listener(ref.current));
    }
}

export function notifyUpdate(ref: React.RefObject<unknown>, lastUpdated: React.RefObject<number>): void {
    lastUpdated.current = Date.now();
    notify(ref);
}

export function update(ref: React.RefObject<unknown>, value: unknown, lastUpdated: React.RefObject<number>) {
    if (ref.current !== value) {
        ref.current = value;
        notifyUpdate(ref, lastUpdated);
    }
}

export function createRefSignal<T = unknown>(initialValue: T): RefSignal<T> {
    const ref = createRef<T>() as React.RefObject<T>;
    const lastUpdated = createRef<number>() as React.RefObject<number>;

    ref.current = initialValue;
    lastUpdated.current = 0;

    return {
        ref,
        lastUpdated,
        subscribe: (listener: Listener<any>) => subscribe(ref, listener),
        unsubscribe: (listener: Listener<any>) => unsubscribe(ref, listener),
        notify: () => notify(ref),
        notifyUpdate: () => notifyUpdate(ref, lastUpdated),
        update: (value: T) => update(ref, value, lastUpdated)
    };
}

/**
 * Defer notifications of refSignals update to the end of callback function
 * @param dependencies 
 */
export function batch(callback: React.EffectCallback, dependencies: RefSignal<any>[]): void {
    batchStack.push(dependencies.map((dep) => dep.ref));
    callback();
    batchStack.pop();

    const lastUpdated = Date.now();

    dependencies.forEach((dep) => {
        dep.lastUpdated.current = lastUpdated;
        dep.notify();
    });
}
