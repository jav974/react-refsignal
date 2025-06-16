import React, { useCallback, useReducer, useRef } from 'react';
import { RefSignal } from '../refsignal';
import { useRefSignalEffect } from './useRefSignalEffect';

/**
 * React hook that forces a component to re-render whenever one or more {@link RefSignal} dependencies update.
 *
 * Use this hook to automatically trigger a re-render of your component when the value of any provided RefSignal changes.
 * This is useful when you want your component to reflect the latest signal values in its render output.
 *
 * - The hook subscribes to all given RefSignal dependencies.
 * - The component will re-render whenever any of the signals are updated or notified via `.update()`, `.notify()`, or `.notifyUpdate()`.
 * - No re-render occurs on the initial mount; only subsequent updates trigger re-renders.
 * - If the optional `callback` is specified, a re-render will only occur if it returns `true`.
 *
 * @param deps Array of RefSignal objects to watch for changes.
 * @param callback Optional function that determines if a re-render should occur; should return a boolean.
 * @returns A function that can be called to force a re-render manually in the component.
 *
 * @example
 * const count = useRefSignal(0);
 * useRefSignalRender([count]);
 * // The component will re-render whenever count.update(newValue) is called,
 * // or you can call the returned function to force a re-render manually.
 */
export function useRefSignalRender(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps: RefSignal<any>[],
    callback?: () => boolean,
): React.ActionDispatch<[]> {
    const initialRender = useRef<boolean>(true);
    const [, forceUpdate] = useReducer((x) => x + 1, 0);
    const effect = useCallback(() => {
        if (!initialRender.current) {
            if (!callback || callback() === true) {
                forceUpdate();
            }
        }
        initialRender.current = false;
    }, [callback]);

    useRefSignalEffect(effect, deps);

    return forceUpdate;
}
