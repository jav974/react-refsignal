import { useEffect, useRef } from 'react';
import { type ReadonlyRefSignal } from '../refsignal';
import { useRefSignal } from '../hooks/useRefSignal';
import { BroadcastOptions } from './types';
import { setupBroadcast } from './broadcast';

/**
 * Hook variant of `broadcast` — sets up cross-tab sync inside a React Provider.
 * Properly tears down on unmount (closes transport, sends bye in one-to-many mode).
 *
 * @see [Decision Tree §10 — Cross-tab Broadcast](https://github.com/jav974/react-refsignal/blob/main/docs/decision-tree.md#10-cross-tab-broadcast)
 *
 * Returns `{ isBroadcaster, isStableBroadcaster }`:
 * - `isBroadcaster` — `true` when this tab is currently sending updates. Always `true`
 *   in `many-to-many` mode. In `one-to-many` mode starts `false` and becomes `true`
 *   once this tab wins the leader election.
 * - `isStableBroadcaster` — `true` when this tab is broadcaster *and* has been
 *   for at least `gracePeriod` ms (or alone at election time). Same as `isBroadcaster`
 *   when `gracePeriod` is unset. Use this to gate work that shouldn't fire during
 *   election ambiguity — e.g., `skip: !isStableBroadcaster.current` on RTK Query.
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
 *
 * @example — gate a periodic poll on stable leadership (5s grace)
 * const { isStableBroadcaster } = useBroadcast(store, {
 *   channel: 'metric-poll',
 *   mode: 'one-to-many',
 *   gracePeriod: 5000,
 * });
 * // Use the LAZY variant — the non-lazy useQuery auto-fires on skip-flip
 * // and bypasses the cadence gate. Trigger explicitly from a cadence effect.
 * const [trigger, { data }] = useLazyGetMetricQuery();
 */
export function useBroadcast<TStore extends object>(
  store: TStore,
  options: BroadcastOptions<TStore>,
): {
  isBroadcaster: ReadonlyRefSignal<boolean>;
  isStableBroadcaster: ReadonlyRefSignal<boolean>;
} {
  // Keep latest options in a ref so timing/filter/callbacks update without resubscription
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Stable signals returned to the caller — persist across channel/mode changes.
  // Initial value mirrors the internal default: many-to-many = always broadcasting,
  // so isStableBroadcaster matches isBroadcaster from the start in that mode.
  const isBroadcaster = useRefSignal(options.mode !== 'one-to-many');
  const isStableBroadcaster = useRefSignal(options.mode !== 'one-to-many');

  // Resubscribe only when the fundamental identity changes (channel, mode, store)
  const { channel, mode } = options;

  useEffect(() => {
    // Reset to the correct initial value for the new channel/mode
    const initial = optionsRef.current.mode !== 'one-to-many';
    isBroadcaster.update(initial);
    isStableBroadcaster.update(initial);

    // Merge caller's callbacks with our signal updates.
    // Cast required: overriding a non-TStore field (onBroadcasterChange) gives TypeScript
    // no anchor to resolve the spread back to BroadcastOptions<TStore>, so it
    // re-quantifies `filter` as universally generic. The result is correct — tsc agrees.
    return setupBroadcast(store, {
      ...optionsRef.current,
      onBroadcasterChange: (active: boolean) => {
        isBroadcaster.update(active);
        optionsRef.current.onBroadcasterChange?.(active);
      },
      onStableBroadcasterChange: (active: boolean) => {
        isStableBroadcaster.update(active);
        optionsRef.current.onStableBroadcasterChange?.(active);
      },
    } as BroadcastOptions<TStore>);
  }, [store, channel, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return { isBroadcaster, isStableBroadcaster };
}
