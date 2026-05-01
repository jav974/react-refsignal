import { useEffect, useRef } from 'react';
import { type RefSignal } from '../refsignal';
import { useRefSignal } from '../hooks/useRefSignal';
import { BroadcastOptions } from './types';
import { setupBroadcast } from './broadcast';

/**
 * Hook variant of `broadcast` — sets up cross-tab sync inside a React Provider.
 * Properly tears down on unmount (closes transport, sends bye in one-to-many mode).
 *
 * Returns `{ isBroadcaster }`:
 * - `isBroadcaster` — a `RefSignal<boolean>` that is `true` when this tab is currently
 *   sending updates. Always `true` in `many-to-many` mode. In `one-to-many` mode starts
 *   `false` and becomes `true` once this tab wins the leader election.
 *
 * @example
 * function GameProvider({ children }: { children: ReactNode }) {
 *   const store = useMemo(() => ({ level: createRefSignal(1), xp: createRefSignal(0) }), []);
 *   const { isBroadcaster } = useBroadcast(store, { channel: 'game', throttle: 100 });
 *   return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
 * }
 *
 * @example — restrict localStorage writes to the leader tab only
 * const { isBroadcaster } = useBroadcast(store, { channel: 'game', mode: 'one-to-many' });
 * usePersist(store, { key: 'game', filter: () => isBroadcaster.current });
 */
export function useBroadcast<TStore extends object>(
  store: TStore,
  options: BroadcastOptions<TStore>,
): { isBroadcaster: RefSignal<boolean> } {
  // Keep latest options in a ref so timing/filter/callbacks update without resubscription
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Stable signal returned to the caller — persists across channel/mode changes.
  // Initial value mirrors the internal default: many-to-many = always broadcasting.
  const isBroadcaster = useRefSignal(options.mode !== 'one-to-many');

  // Resubscribe only when the fundamental identity changes (channel, mode, store)
  const { channel, mode } = options;

  useEffect(() => {
    // Reset to the correct initial value for the new channel/mode
    isBroadcaster.update(optionsRef.current.mode !== 'one-to-many');

    // Merge caller's onBroadcasterChange with our signal update.
    // Cast required: overriding a non-TStore field (onBroadcasterChange) gives TypeScript
    // no anchor to resolve the spread back to BroadcastOptions<TStore>, so it
    // re-quantifies `filter` as universally generic. The result is correct — tsc agrees.
    return setupBroadcast(store, {
      ...optionsRef.current,
      onBroadcasterChange: (active: boolean) => {
        isBroadcaster.update(active);
        optionsRef.current.onBroadcasterChange?.(active);
      },
    } as BroadcastOptions<TStore>);
  }, [store, channel, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return { isBroadcaster };
}
