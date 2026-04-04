import { useEffect, useRef } from 'react';
import { BroadcastOptions } from './types';
import { setupBroadcast } from './broadcast';

/**
 * Hook variant of `broadcast` — sets up cross-tab sync inside a React Provider.
 * Properly tears down on unmount (closes transport, sends bye in one-to-many mode).
 *
 * @example
 * function GameProvider({ children }: { children: ReactNode }) {
 *   const store = useMemo(() => ({ level: createRefSignal(1), xp: createRefSignal(0) }), []);
 *   useBroadcast(store, { channel: 'game', throttle: 100 });
 *   return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
 * }
 */
export function useBroadcast<TStore extends Record<string, unknown>>(
  store: TStore,
  options: BroadcastOptions<TStore>,
): void {
  // Keep latest options in a ref so timing/filter/callbacks update without resubscription
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Resubscribe only when the fundamental identity changes (channel, mode, store)
  const { channel, mode } = options;

  useEffect(() => {
    return setupBroadcast(store, optionsRef.current);
  }, [store, channel, mode]);
}
