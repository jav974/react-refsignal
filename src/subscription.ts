/**
 * Shared subscription primitive used by React hooks (useRefSignalEffect,
 * useRefSignalMemo, useRefSignalRender) to bind a callback to a set of
 * RefSignals with consistent semantics around timing, filtering, and
 * dynamic (nested-signal) tracking.
 *
 * Factoring this out of each hook avoids code duplication and guarantees
 * behavior parity across the hooks — adding a new hook later gets the
 * right behavior "for free" by consuming this primitive.
 *
 * See `WatchOptions` in `./timing` for option semantics.
 */

import { isRefSignal, type RefSignal } from './refsignal';
import {
  applyTimingOptions,
  type TimingOptions,
  type WatchOptions,
} from './timing';

export interface SubscriptionHandle {
  /**
   * Cancels any pending timing-wrapped flush and unsubscribes all
   * currently-subscribed static and dynamic signals. Idempotent —
   * subsequent calls are no-ops.
   */
  dispose(): void;

  /**
   * Snapshot of signals currently subscribed via `options.trackSignals`.
   * Static deps are NOT included — the caller already has those.
   * Returns an empty array when no dynamic tracking is configured or the
   * set is currently empty. Intended for `useSyncExternalStore`
   * snapshot hashing in hooks that need to detect changes across both
   * static and dynamic deps.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trackedSignals(): RefSignal<any>[];
}

/**
 * Subscribes `onFire` to the set of RefSignals derived from `deps` (static)
 * and `options.trackSignals` (dynamic). Returns a handle whose `dispose()`
 * tears down the subscription.
 *
 * # Static vs dynamic
 *
 * - **Static**: any RefSignal inside `deps`. Subscribed at setup. Their
 *   fires request a reconcile of the dynamic set before `onFire` runs.
 * - **Dynamic**: signals returned by `options.trackSignals()`. Re-resolved
 *   on every coalesced static-fire flush (never on dynamic fires). Their
 *   fires trigger `onFire` directly with no reconcile — keeping the hot
 *   path cheap when dynamic signals tick at frame rate.
 *
 * # Reconcile semantics
 *
 * Reconcile runs when either of these happen:
 * - Initial setup (populates the initial dynamic set).
 * - A coalesced flush whose `reconcileNeeded` flag was set by one or more
 *   static fires since the last flush.
 *
 * Reconcile performs, in order:
 * 1. Ref-equal shortcut — `trackSignals()` returns `===` previous array: skip.
 * 2. Content-equal shortcut — same length + same elements same order: skip
 *    and cache the new array reference for future ref-equal hits.
 * 3. Full delta — build `nextSet`, unsubscribe any signal in `tracked` not
 *    in `nextSet`, subscribe any in `nextSet` not in `tracked`.
 *
 * # Filter
 *
 * `options.filter` gates `onFire` only. Reconcile always runs on static
 * fires so the dynamic subscription set does not go stale under filtering.
 *
 * # Not a hook
 *
 * This is a plain function. Call it inside a `useEffect` setup; pass your
 * `deps` array into the enclosing `useEffect`'s deps so React identity
 * changes tear down the subscription via `dispose()` and re-create it with
 * a fresh call to `createSubscription` — mirroring the existing pattern in
 * useRefSignalEffect.
 */
export function createSubscription(args: {
  deps: ReadonlyArray<unknown>;
  onFire: () => void;
  options?: WatchOptions;
}): SubscriptionHandle {
  const { deps, onFire, options } = args;
  const trackSignals = options?.trackSignals;
  const filter = options?.filter;

  let reconcileNeeded = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches `createComputedSignal` / `batch` signal-array conventions
  let tracked: Set<RefSignal<any>> = new Set();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastTrackedResult: ReadonlyArray<RefSignal<any>> | undefined;
  let disposed = false;

  const reconcile = () => {
    if (!trackSignals) return;
    const next = trackSignals();

    // Ref-equal shortcut — free for memoized getters.
    if (next === lastTrackedResult) return;

    // Content-equal shortcut — same signals in the same order.
    // Caches the new array ref so future ref-equal hits still work.
    if (
      lastTrackedResult !== undefined &&
      next.length === lastTrackedResult.length
    ) {
      let equal = true;
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== lastTrackedResult[i]) {
          equal = false;
          break;
        }
      }
      if (equal) {
        lastTrackedResult = next;
        return;
      }
    }

    lastTrackedResult = next;
    const nextSet = new Set(next);
    for (const signal of tracked) {
      if (!nextSet.has(signal)) signal.unsubscribe(dynamicListener);
    }
    for (const signal of nextSet) {
      if (!tracked.has(signal)) signal.subscribe(dynamicListener);
    }
    tracked = nextSet;
  };

  const flush = () => {
    if (reconcileNeeded) {
      reconcile();
      reconcileNeeded = false;
    }
    if (filter && !filter()) return;
    onFire();
  };

  // Cast is safe: applyTimingOptions only reads timing fields.
  const wrapper = applyTimingOptions(flush, (options ?? {}) as TimingOptions);

  const staticListener = () => {
    reconcileNeeded = true;
    wrapper.call();
  };

  const dynamicListener = () => {
    wrapper.call();
  };

  // Subscribe static RefSignals in deps.
  for (const dep of deps) {
    if (isRefSignal(dep)) dep.subscribe(staticListener);
  }

  // Initial dynamic resolve — populates `tracked` without firing onFire.
  reconcile();

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      wrapper.cancel();
      for (const dep of deps) {
        if (isRefSignal(dep)) dep.unsubscribe(staticListener);
      }
      for (const signal of tracked) {
        signal.unsubscribe(dynamicListener);
      }
      tracked.clear();
      lastTrackedResult = undefined;
    },
    trackedSignals: () => Array.from(tracked),
  };
}
