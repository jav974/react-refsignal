import { useMemo, useRef } from 'react';
import type { WatchOptions } from '../timing';

/**
 * @internal
 *
 * Shared plumbing for `useRefSignalEffect`, `useRefSignalMemo`, and
 * `useRefSignalRender`. Owns the ref dance for `filter` and `trackSignals`
 * and produces a ready-to-pass {@link WatchOptions} for `createSubscription`.
 *
 * - `filter` and `trackSignals` live in refs — identity changes between
 *   renders do NOT force a resubscription. The consuming hook inlines
 *   the filter check inside its own `onFire` body via `filterRef`.
 * - `subscriptionOptions` is memoized on timing values, so its identity
 *   only changes when timing changes — safe to include in a useEffect /
 *   useCallback dep array without spurious rebuilds.
 * - The `trackSignals` presence check is frozen when `subscriptionOptions`
 *   is (re)computed, matching the prior hand-rolled behavior: dynamic
 *   tracking flips on/off only when the subscription is recreated.
 */
export function useWatchArgs(options?: WatchOptions) {
  const filterRef = useRef(options?.filter);
  filterRef.current = options?.filter;

  const trackSignalsRef = useRef(options?.trackSignals);
  trackSignalsRef.current = options?.trackSignals;

  const { throttle, debounce, maxWait, rAF } = options ?? {};

  const subscriptionOptions = useMemo(
    (): WatchOptions =>
      ({
        throttle,
        debounce,
        maxWait,
        rAF,
        trackSignals: trackSignalsRef.current
          ? () => trackSignalsRef.current?.() ?? []
          : undefined,
      }) as WatchOptions,
    [throttle, debounce, maxWait, rAF],
  );

  return { filterRef, subscriptionOptions };
}
