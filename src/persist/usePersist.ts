import { useEffect, useMemo, useRef } from 'react';
import type { RefSignal } from '../refsignal';
import { createRefSignal, watch } from '../refsignal';
import { PersistOptions } from './types';
import { setupPersist } from './persist';

/**
 * Hook variant of `persist` — sets up storage persistence inside a React Provider.
 * Properly tears down on unmount (unsubscribes from signal updates).
 *
 * Returns a `RefSignal<boolean>` that becomes `true` once hydration from storage
 * completes. Use it to gate rendering until stored values are loaded:
 *
 * @example
 * function GameProvider({ children }: { children: ReactNode }) {
 *   const store = useMemo(() => ({ level: createRefSignal(1), xp: createRefSignal(0) }), []);
 *   const hydrated = usePersist(store, { key: 'game' });
 *   useRefSignalRender([hydrated]);
 *   if (!hydrated.current) return <Spinner />;
 *   return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
 * }
 */
export function usePersist<TStore extends Record<string, unknown>>(
  store: TStore,
  options: PersistOptions<TStore>,
): RefSignal<boolean> {
  // Keep latest options in a ref so callbacks update without resubscription
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Stable signal returned to the caller — persists across key changes
  const isHydrated = useMemo(() => createRefSignal(false), []);

  // Resubscribe only when the fundamental identity changes (key, store)
  const { key } = options;

  useEffect(() => {
    isHydrated.update(false);
    const { cleanup, hydrated } = setupPersist(store, optionsRef.current);

    const stopWatching = watch(hydrated, () => {
      isHydrated.update(true);
    });

    return () => {
      cleanup();
      stopWatching();
    };
  }, [store, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return isHydrated;
}
