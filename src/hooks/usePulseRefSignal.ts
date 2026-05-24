import { useEffect, useMemo } from 'react';
import { createPulseRefSignal, PulseRate, PulseRefSignal } from '../pulse';

/**
 * React hook companion to {@link createPulseRefSignal}.
 *
 * Returns a stable {@link PulseRefSignal} created on first render and disposed
 * on unmount. Subsequent changes to `rate` are ignored — the cadence is
 * captured at mount time, mirroring the mount-time-options convention used by
 * {@link useRefSignal}.
 *
 * The signal does not expose `.dispose()` to the caller — React owns its
 * lifetime. Subscribers attached during render (e.g. via `useRefSignalEffect`)
 * are torn down by their own cleanup, and the signal itself is disposed when
 * the component unmounts.
 *
 * @example
 * const now = usePulseRefSignal('1000ms');
 * useRefSignalEffect(now, () => setLabel(formatAgo(post.createdAt, now.current)));
 *
 * @example
 * // Provide once, share many — N components consume the same tick stream
 * // through one timer.
 * const TickContext = createRefSignalContext<PulseRefSignal>();
 *
 * function Provider({ children }: { children: React.ReactNode }) {
 *   const tick = usePulseRefSignal('60fps');
 *   return <TickContext.Provider value={tick}>{children}</TickContext.Provider>;
 * }
 */
export function usePulseRefSignal(
  rate: PulseRate,
  debugName?: string,
): PulseRefSignal {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pulse rate is captured at mount, like other useRefSignal options
  const signal = useMemo(() => createPulseRefSignal(rate, debugName), []);

  useEffect(
    () => () => {
      signal.dispose();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signal is stable for the component lifetime
    [],
  );

  return signal;
}
