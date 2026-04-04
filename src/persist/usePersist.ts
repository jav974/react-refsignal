import { useEffect, useRef } from 'react';
import { PersistOptions } from './types';
import { setupPersist } from './persist';

/**
 * Hook variant of `persist` — sets up storage persistence inside a React Provider.
 * Properly tears down on unmount (unsubscribes from signal updates).
 *
 * Signals start with their default values and update asynchronously once
 * hydration from storage completes. Use `onHydrated` to react to that moment.
 *
 * @example
 * function GameProvider({ children }: { children: ReactNode }) {
 *   const store = useMemo(() => ({ level: createRefSignal(1), xp: createRefSignal(0) }), []);
 *   usePersist(store, { key: 'game' });
 *   return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
 * }
 */
export function usePersist<TStore extends Record<string, unknown>>(
  store: TStore,
  options: PersistOptions<TStore>,
): void {
  // Keep latest options in a ref so callbacks update without resubscription
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Resubscribe only when the fundamental identity changes (key, store)
  const { key } = options;

  useEffect(() => {
    return setupPersist(store, optionsRef.current);
  }, [store, key]);
}
