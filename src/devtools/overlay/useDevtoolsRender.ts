import { useRefSignalRender } from '../../hooks/useRefSignalRender';
import { devtools } from '../adapter';
import { rateOptionsFor, renderRate } from './state';

/**
 * Panel render hook. Subscribes to the devtools bus using the currently
 * selected rate preset (mode + value), so the user can dial responsiveness
 * vs host-page frame budget at runtime from the dock chrome.
 *
 * - `renderRate` is a dep, so changing it re-renders the panel, which
 *   re-evaluates this hook and (because `watchOptions` is memoized on its
 *   timing fields in `useWatchArgs`) triggers a fresh subscription with
 *   the new mode.
 * - Rate-limit policy stays inside the devtools package — subsystems are
 *   pure emitters.
 */
export function useDevtoolsRender(): void {
  useRefSignalRender(
    [devtools.bus, renderRate],
    rateOptionsFor(renderRate.current),
  );
}
