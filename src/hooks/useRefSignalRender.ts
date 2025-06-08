import { useCallback, useReducer, useRef } from "react";
import { RefSignal } from "../refsignal";
import { useRefSignalEffect } from "./useRefSignalEffect";

/**
 * React hook that forces a component to re-render whenever one or more {@link RefSignal} dependencies update.
 *
 * Use this hook to automatically trigger a re-render of your component when the value of any provided RefSignal changes.
 * This is useful when you want your component to reflect the latest signal values in its render output.
 *
 * - The hook subscribes to all given RefSignal dependencies.
 * - The component will re-render whenever any of the signals are updated via `.update()`, or `.notify()`, or `.notifyUpdate()`.
 * - No re-render occurs on the initial mount; only subsequent updates trigger re-renders.
 *
 * @param dependencies Array of RefSignal objects to watch for changes.
 *
 * @example
 * const count = useRefSignal(0);
 * useRefSignalRender([count]);
 * // The component will re-render whenever count.update(newValue) is called.
 */
export function useRefSignalRender(dependencies: RefSignal<any>[]): void {
    const renders = useRef<number>(0);
    const [, forceUpdate] = useReducer((x) => x + 1, 0);
    const effect = useCallback(() => {
        if (renders.current > 0) {
            forceUpdate();
        }
        renders.current++;
    }, []);

    useRefSignalEffect(effect, dependencies);
}
