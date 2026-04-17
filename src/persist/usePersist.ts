import { useEffect, useMemo, useRef } from 'react';
import type { RefSignal } from '../refsignal';
import { useRefSignal } from '../hooks/useRefSignal';
import { PersistOptions } from './types';
import { setupPersist } from './persist';

const noopAsync = async () => {};

/**
 * Hook variant of `persist` — sets up storage persistence inside a React Provider.
 * Properly tears down on unmount (unsubscribes from signal updates).
 *
 * Returns `{ isHydrated, flush, clear }`:
 * - `isHydrated` — a `RefSignal<boolean>` that becomes `true` once hydration completes.
 *   Use it to gate rendering until stored values are loaded.
 * - `flush` — writes the current store state to storage immediately, bypassing
 *   `filter` and any pending throttle/debounce timer. Returns a `Promise<void>`
 *   that resolves when the write completes; rejects on adapter failure.
 * - `clear` — removes the storage key and resets all persisted signals to their
 *   default values. Suppresses the save cycle so storage stays empty after reset.
 *   Returns a promise that resolves once the storage write is complete.
 *
 * @example
 * function GameProvider({ children }: { children: ReactNode }) {
 *   const store = useMemo(() => ({ level: createRefSignal(1), xp: createRefSignal(0) }), []);
 *   const { isHydrated } = usePersist(store, { key: 'game' });
 *   useRefSignalRender([isHydrated]);
 *   if (!isHydrated.current) return <Spinner />;
 *   return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
 * }
 */
export function usePersist<TStore extends Record<string, unknown>>(
  store: TStore,
  options: PersistOptions<TStore>,
): {
  isHydrated: RefSignal<boolean>;
  flush: () => Promise<void>;
  clear: () => Promise<void>;
} {
  // Keep latest options in a ref so callbacks update without resubscription
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Stable signal returned to the caller — persists across key changes
  const isHydrated = useRefSignal(false);

  // Track the setup's flush and clear — updated on key change
  const flushRef = useRef<() => Promise<void>>(noopAsync);
  const clearRef = useRef<() => Promise<void>>(noopAsync);

  // Resubscribe only when the fundamental identity changes (key, store)
  const { key } = options;

  useEffect(() => {
    isHydrated.update(false);
    const { cleanup, flush, clear } = setupPersist(store, {
      ...optionsRef.current,
      onHydrated: (snapshot) => {
        isHydrated.update(true);
        optionsRef.current.onHydrated?.(snapshot);
      },
    });
    flushRef.current = flush;
    clearRef.current = clear;

    return () => {
      cleanup();
      flushRef.current = noopAsync;
      clearRef.current = noopAsync;
    };
  }, [store, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable callbacks — always delegate to the current setup's functions
  const stableFlush = useMemo(
    () => async () => {
      await flushRef.current();
    },
    [],
  );

  const stableClear = useMemo(
    () => async () => {
      await clearRef.current();
    },
    [],
  );

  return { isHydrated, flush: stableFlush, clear: stableClear };
}
