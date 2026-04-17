import {
  isRefSignal,
  RefSignal,
  setSignalBroadcastAdapter,
  SignalBroadcastInput,
} from '../refsignal';
import { StoreSnapshot } from '../store/useRefSignalStore';
import { applyTimingOptions } from '../timing';
import type { BroadcastOptions, BroadcastSignalOptions } from './types';
import { resolveTransport, Transport } from './transport';
import { takeSnapshot, applySnapshot } from './snapshot';

// ─── Message protocol ──────────────────────────────────────────────────────────

const TAB_ID = Math.random().toString(36).slice(2);

type Msg<T> =
  | { type: 'update'; tabId: string; payload: T }
  | { type: 'hello'; tabId: string; ts: number }
  | { type: 'bye'; tabId: string }
  | { type: 'broadcaster-claim'; tabId: string }
  | { type: 'state-handoff'; tabId: string; payload: Record<string, unknown> };

// ─── Core setup (plain function — shared by broadcast() and useBroadcast()) ───

export function setupBroadcast<TStore extends Record<string, unknown>>(
  store: TStore,
  options: BroadcastOptions<TStore>,
): () => void {
  // SSR guard — BroadcastChannel and cross-tab sync are browser-only.
  if (typeof window === 'undefined') return () => {};

  const {
    channel,
    mode = 'many-to-many',
    filter,
    onBroadcasterChange,
    heartbeatInterval = 2000,
    heartbeatTimeout = 5000,
  } = options;

  const transport: Transport = resolveTransport(channel);

  // In many-to-many every tab is always a broadcaster; in one-to-many election decides.
  let isBroadcaster = mode === 'many-to-many';

  // ── Outgoing ────────────────────────────────────────────────────────────────

  const sendSnapshot = () => {
    if (!isBroadcaster) return;
    const snapshot = takeSnapshot(store);
    if (filter && !filter(snapshot as StoreSnapshot<TStore>)) return;
    const msg: Msg<Record<string, unknown>> = {
      type: 'update',
      tabId: TAB_ID,
      payload: snapshot,
    };
    transport.post(msg);
  };

  const wrapper = applyTimingOptions(sendSnapshot, options);

  const signals = Object.values(store).filter(isRefSignal);
  signals.forEach((s) => {
    s.subscribe(wrapper.call);
  });

  // ── Election helpers (one-to-many only) ─────────────────────────────────────

  const tabsLastSeen = new Map<string, number>();

  // `allowClaim` controls whether this election can promote the current tab
  // to broadcaster. Yields are always allowed — if a lower-ID tab appears
  // mid-cycle we should step down immediately. Claims, however, only happen
  // on heartbeat ticks (full synchronized view of peers); triggering a claim
  // on a single `bye` message leads to transient self-election that has to
  // be undone when a concurrent `hello` arrives — user-visible flickering.
  function electBroadcaster(allowClaim = true) {
    const now = Date.now();
    for (const [id, ts] of tabsLastSeen) {
      if (now - ts >= heartbeatTimeout) tabsLastSeen.delete(id);
    }
    tabsLastSeen.set(TAB_ID, now);

    const shouldBe = [...tabsLastSeen.keys()].sort()[0] === TAB_ID;

    if (shouldBe && !isBroadcaster && allowClaim) {
      isBroadcaster = true;
      onBroadcasterChange?.(true);
      transport.post({
        type: 'broadcaster-claim',
        tabId: TAB_ID,
      } satisfies Msg<never>);
    } else if (!shouldBe && isBroadcaster) {
      // Hand off authoritative in-memory state before yielding.
      // The new broadcaster applies it and re-broadcasts, so receiver tabs
      // don't see stale data if persist hydration races with the election.
      transport.post({
        type: 'state-handoff',
        tabId: TAB_ID,
        payload: takeSnapshot(store),
      } satisfies Msg<never>);
      isBroadcaster = false;
      onBroadcasterChange?.(false);
    }
  }

  // ── Incoming ────────────────────────────────────────────────────────────────

  const stopListening = transport.listen((raw) => {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return;
    const msg = raw as Msg<Record<string, unknown>>;
    if (msg.tabId === TAB_ID) return; // never process own messages

    switch (msg.type) {
      case 'update':
        applySnapshot(store, msg.payload);
        break;
      case 'hello':
        if (mode === 'one-to-many') {
          tabsLastSeen.set(msg.tabId, msg.ts);
          // Yield-only election — if a lower-ID tab announced itself we
          // step down immediately. Claims wait for the heartbeat tick so
          // we don't transiently self-elect during a bye+hello crossover.
          electBroadcaster(false);
        }
        break;
      case 'bye':
        if (mode === 'one-to-many') {
          tabsLastSeen.delete(msg.tabId);
          // Yield-only — losing a peer never justifies claiming here; the
          // next tick decides with a settled view of remaining peers.
          electBroadcaster(false);
        }
        break;
      case 'state-handoff':
        // Apply the yielding broadcaster's in-memory state.
        // Only the new broadcaster applies it — receiver tabs ignore it.
        // Applying via update() fires the broadcast subscriber, so the
        // authoritative state is automatically re-broadcast to all receivers.
        if (mode === 'one-to-many' && isBroadcaster) {
          applySnapshot(store, msg.payload);
        }
        break;
      case 'broadcaster-claim':
        // A tab with a lower ID claimed broadcaster — yield if we think we are
        if (mode === 'one-to-many' && msg.tabId < TAB_ID && isBroadcaster) {
          transport.post({
            type: 'state-handoff',
            tabId: TAB_ID,
            payload: takeSnapshot(store),
          } satisfies Msg<never>);
          isBroadcaster = false;
          onBroadcasterChange?.(false);
        }
        break;
    }
  });

  // ── Heartbeat + visibility handling (one-to-many only) ─────────────────────

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let hasStartedOnce = false;

  const startHeartbeat = () => {
    if (heartbeatTimer !== null) return;
    tabsLastSeen.set(TAB_ID, Date.now());
    // First mount: elect immediately so a solitary tab becomes broadcaster
    // without waiting `heartbeatInterval`. On a resume from hidden, skip
    // the immediate election — peers may have been pruned from
    // `tabsLastSeen` while we were throttled, so claiming now would
    // incorrectly self-elect ahead of still-alive peers (causing the
    // resuming tab to flicker into "broadcaster" for one tick).
    if (!hasStartedOnce) {
      electBroadcaster();
      hasStartedOnce = true;
    } else {
      // Announce presence so peers add us back to their tabsLastSeen;
      // our next heartbeat tick runs the election with a fresh view.
      transport.post({
        type: 'hello',
        tabId: TAB_ID,
        ts: Date.now(),
      } satisfies Msg<never>);
    }
    heartbeatTimer = setInterval(() => {
      transport.post({
        type: 'hello',
        tabId: TAB_ID,
        ts: Date.now(),
      } satisfies Msg<never>);
      electBroadcaster();
    }, heartbeatInterval);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  // Hidden tabs have their timers throttled by the browser (often to ≥1s),
  // which causes hello heartbeats to miss aggressive `heartbeatTimeout`
  // windows, triggering leadership flapping. Treat a hidden tab as "temporarily
  // absent": stop the heartbeat, yield broadcaster role, and send `bye` so
  // other tabs elect cleanly. Resume on `visible` — election runs again.
  const hasDocument = typeof document !== 'undefined';
  let onVisibilityChange: (() => void) | null = null;

  if (mode === 'one-to-many') {
    const yieldRole = () => {
      if (isBroadcaster) {
        isBroadcaster = false;
        onBroadcasterChange?.(false);
      }
      stopHeartbeat();
      tabsLastSeen.delete(TAB_ID);
      transport.post({ type: 'bye', tabId: TAB_ID } satisfies Msg<never>);
    };

    if (hasDocument && document.visibilityState === 'visible') {
      startHeartbeat();
    } else if (!hasDocument) {
      // No visibility API (e.g. older environment) — fall back to always-on.
      startHeartbeat();
    }

    if (hasDocument) {
      onVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          startHeartbeat();
        } else {
          yieldRole();
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  return () => {
    wrapper.cancel();
    signals.forEach((s) => {
      s.unsubscribe(wrapper.call);
    });
    if (hasDocument && onVisibilityChange) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (mode === 'one-to-many') {
      stopHeartbeat();
      transport.post({ type: 'bye', tabId: TAB_ID } satisfies Msg<never>);
    }
    stopListening();
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Wraps a signal store factory to sync state across browser tabs/windows.
 *
 * Returns a new factory — pass it to `createRefSignalContext` just like the original.
 * Subscriptions live for the app lifetime (factory-level singleton).
 * Use `useBroadcast` instead when the Provider mounts and unmounts during the session.
 *
 * @example
 * const { GameProvider, useGameContext } = createRefSignalContext('Game',
 *   broadcast(
 *     () => ({ level: createRefSignal(1), xp: createRefSignal(0) }),
 *     { channel: 'game' }
 *   )
 * );
 *
 * @example
 * // one-to-many: only the elected tab sends updates
 * broadcast(factory, {
 *   channel: 'game',
 *   mode: 'one-to-many',
 *   onBroadcasterChange: (active) => isBroadcaster.update(active),
 * });
 */
export function broadcast<TStore extends Record<string, unknown>>(
  factory: () => TStore,
  options: BroadcastOptions<TStore>,
): () => TStore {
  return () => {
    const store = factory();
    const cleanup = setupBroadcast(store, options);

    // Send bye on page unload so remaining tabs re-elect immediately
    if (options.mode === 'one-to-many' && typeof window !== 'undefined') {
      window.addEventListener('beforeunload', cleanup, { once: true });
    }

    return store;
  };
}

// ─── Signal-level adapter ──────────────────────────────────────────────────────

function attachSignalBroadcastImpl(
  signal: RefSignal,
  input: SignalBroadcastInput,
): () => void {
  const opts: BroadcastSignalOptions =
    typeof input === 'string'
      ? { channel: input }
      : (input as BroadcastSignalOptions);

  // Wrap the single signal as a one-key store and delegate to setupBroadcast.
  // () => boolean is compatible with (snapshot) => boolean — extra arg is ignored.
  const KEY = '_';
  const store = { [KEY]: signal };
  return setupBroadcast(store, opts as BroadcastOptions<typeof store>);
}

// Self-register the adapter when this module is imported
setSignalBroadcastAdapter({ attach: attachSignalBroadcastImpl });
