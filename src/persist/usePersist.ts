import { useEffect, useMemo, useRef } from 'react';
import type { RefSignal } from '../refsignal';
import { createRefSignal, watch } from '../refsignal';
import { PersistOptions } from './types';
import { setupPersist } from './persist';

const noop = () => {};

/**
 * Hook variant of `persist` — sets up storage persistence inside a React Provider.
 * Properly tears down on unmount (unsubscribes from signal updates).
 *
 * Returns `{ hydrated, flush }`:
 * - `hydrated` — a `RefSignal<boolean>` that becomes `true` once hydration completes.
 *   Use it to gate rendering until stored values are loaded.
 * - `flush` — writes the current store state to storage immediately, bypassing
 *   `filter` and any pending throttle/debounce timer.
 *
 * @example
 * function GameProvider({ children }: { children: ReactNode }) {
 *   const store = useMemo(() => ({ level: createRefSignal(1), xp: createRefSignal(0) }), []);
 *   const { hydrated } = usePersist(store, { key: 'game' });
 *   useRefSignalRender([hydrated]);
 *   if (!hydrated.current) return <Spinner />;
 *   return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
 * }
 */
export function usePersist<TStore extends Record<string, unknown>>(
  store: TStore,
  options: PersistOptions<TStore>,
): { hydrated: RefSignal<boolean>; flush: () => void } {
  // Keep latest options in a ref so callbacks update without resubscription
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Stable signal returned to the caller — persists across key changes
  const isHydrated = useMemo(() => createRefSignal(false), []);

  // Tracks the flush function from the current setup — updated on key change
  const flushRef = useRef<() => void>(noop);

  // Resubscribe only when the fundamental identity changes (key, store)
  const { key } = options;

  useEffect(() => {
    isHydrated.update(false);
    const { cleanup, hydrated, flush } = setupPersist(
      store,
      optionsRef.current,
    );
    flushRef.current = flush;

    const stopWatching = watch(hydrated, () => {
      isHydrated.update(true);
    });

    return () => {
      cleanup();
      stopWatching();
      flushRef.current = noop;
    };
  }, [store, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable flush — always delegates to the current setup's flush
  const stableFlush = useMemo(
    () => () => {
      flushRef.current();
    },
    [],
  );

  return { hydrated: isHydrated, flush: stableFlush };
}
