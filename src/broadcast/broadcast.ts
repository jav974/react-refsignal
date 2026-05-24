import {
  getDevToolsAdapter,
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

export function setupBroadcast<TStore extends object>(
  store: TStore,
  options: BroadcastOptions<TStore>,
): () => void {
  // SSR guard — BroadcastChannel and cross-tab sync are browser-only.
  // Also requires `document` for the visibility API used in one-to-many mode.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const {
    channel,
    mode = 'many-to-many',
    filter,
    onBroadcasterChange,
    onStableBroadcasterChange,
    heartbeatInterval = 300,
    heartbeatTimeout = 5000,
    initialElectionDelay = 400,
    gracePeriod,
  } = options;

  const transport: Transport = resolveTransport(channel);

  // In many-to-many every tab is always a broadcaster; in one-to-many election decides.
  let isBroadcaster = mode === 'many-to-many';
  // Stability mirror — true means consumers can act on this tab's broadcaster
  // status without risking races against an in-flight election. Many-to-many
  // has no election so it's always stable.
  let isStable = mode === 'many-to-many';

  // Grace-period state (one-to-many only).
  // `lostBroadcasterAt` enables the trailing-emit window: when this tab loses
  // broadcaster status, in-flight work that fires `sendSnapshot` within
  // `gracePeriod` ms still propagates instead of being silently dropped.
  // `stableTimer` is the deferred flip of `onStableBroadcasterChange(true)`
  // after a new election — gives the system time to settle (former leader
  // emitting trailing data, peers stabilizing) before consumers act.
  let lostBroadcasterAt: number | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;

  const withinTrailingGrace = () =>
    gracePeriod !== undefined &&
    gracePeriod > 0 &&
    lostBroadcasterAt !== null &&
    Date.now() - lostBroadcasterAt < gracePeriod;

  // Single helper that owns every isBroadcaster transition: flips the flag,
  // fires onBroadcasterChange, manages the stable-timer and lostBroadcasterAt
  // bookkeeping, then fires onStableBroadcasterChange at the right moment.
  // Skips grace (fires stable synchronously) when this tab is alone at the
  // transition — `tabsLastSeen.size <= 1` — so single-tab loads don't wait
  // a useless `gracePeriod` before becoming stable.
  const setBroadcasterStatus = (active: boolean) => {
    if (active === isBroadcaster) return;
    isBroadcaster = active;
    onBroadcasterChange?.(active);
    getDevToolsAdapter()?.emit({
      kind: 'broadcast:status',
      channel,
      active,
      t: Date.now(),
    });

    if (stableTimer !== null) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }

    if (active) {
      lostBroadcasterAt = null;
      const isAlone = tabsLastSeen.size <= 1;
      if (gracePeriod !== undefined && gracePeriod > 0 && !isAlone) {
        isStable = false;
        stableTimer = setTimeout(() => {
          stableTimer = null;
          isStable = true;
          onStableBroadcasterChange?.(true);
          getDevToolsAdapter()?.emit({
            kind: 'broadcast:stable',
            channel,
            stable: true,
            t: Date.now(),
          });
        }, gracePeriod);
      } else {
        isStable = true;
        onStableBroadcasterChange?.(true);
        getDevToolsAdapter()?.emit({
          kind: 'broadcast:stable',
          channel,
          stable: true,
          t: Date.now(),
        });
      }
    } else {
      lostBroadcasterAt = Date.now();
      isStable = false;
      onStableBroadcasterChange?.(false);
      getDevToolsAdapter()?.emit({
        kind: 'broadcast:stable',
        channel,
        stable: false,
        t: Date.now(),
      });
    }
  };

  // Bundle config + current status into every peers event — the adapter
  // routes these to a dedicated store, so the panel always has the latest
  // snapshot regardless of whether transition events (`broadcast:status` /
  // `broadcast:stable`) have rotated out of the unified ring.
  const emitPeers = () => {
    getDevToolsAdapter()?.emit({
      kind: 'broadcast:peers',
      channel,
      mode,
      heartbeatInterval,
      heartbeatTimeout,
      gracePeriod,
      isBroadcaster,
      isStable,
      count: tabsLastSeen.size,
      peers: Array.from(tabsLastSeen.entries()).map(([id, lastSeen]) => ({
        id,
        lastSeen,
      })),
      t: Date.now(),
    });
  };

  // ── Outgoing ────────────────────────────────────────────────────────────────

  const sendSnapshot = () => {
    if (!isBroadcaster && !withinTrailingGrace()) return;
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

  // Surface the channel to devtools immediately. Many-to-many has no
  // heartbeat → no periodic emitPeers, so this one event is the only way the
  // panel learns the channel exists. For one-to-many, the heartbeat takes
  // over from here. Placed after `tabsLastSeen` is declared (emitPeers reads
  // it — earlier placement would hit TDZ).
  emitPeers();

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
    // Emit on every election tick (heartbeat-aligned, ~heartbeatInterval rate)
    // so the panel's per-peer "last seen N ms ago" stays current. Cheap: bounded
    // to one event per local heartbeat regardless of peer count.
    emitPeers();

    const shouldBe = [...tabsLastSeen.keys()].sort()[0] === TAB_ID;

    if (shouldBe && !isBroadcaster && allowClaim) {
      setBroadcasterStatus(true);
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
      setBroadcasterStatus(false);
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
          const had = tabsLastSeen.has(msg.tabId);
          tabsLastSeen.set(msg.tabId, msg.ts);
          if (!had) emitPeers();
          // Yield-only election — if a lower-ID tab announced itself we
          // step down immediately. Claims wait for the heartbeat tick so
          // we don't transiently self-elect during a bye+hello crossover.
          electBroadcaster(false);
        }
        break;
      case 'bye':
        if (mode === 'one-to-many') {
          if (tabsLastSeen.delete(msg.tabId)) emitPeers();
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
          setBroadcasterStatus(false);
        }
        break;
    }
  });

  // ── Heartbeat + visibility handling (one-to-many only) ─────────────────────

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let initialElectionTimer: ReturnType<typeof setTimeout> | null = null;

  const startHeartbeat = () => {
    if (heartbeatTimer !== null) return;
    tabsLastSeen.set(TAB_ID, Date.now());
    // Announce presence immediately so peers add us to their tabsLastSeen.
    transport.post({
      type: 'hello',
      tabId: TAB_ID,
      ts: Date.now(),
    } satisfies Msg<never>);

    // Defer the first election by `initialElectionDelay` ms. Peers receive
    // our hello, respond with their own, and we elect with a complete
    // view — avoiding the "transient self-elect" flicker that happens
    // when a tab joins an existing session or resumes from hidden.
    // `initialElectionDelay: 0` opts into synchronous election.
    if (initialElectionDelay <= 0) {
      electBroadcaster();
    } else {
      initialElectionTimer = setTimeout(() => {
        initialElectionTimer = null;
        electBroadcaster();
      }, initialElectionDelay);
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
    if (initialElectionTimer !== null) {
      clearTimeout(initialElectionTimer);
      initialElectionTimer = null;
    }
  };

  // Hidden tabs have their timers throttled by the browser (often to ≥1s),
  // which causes hello heartbeats to miss aggressive `heartbeatTimeout`
  // windows, triggering leadership flapping. Treat a hidden tab as "temporarily
  // absent": stop the heartbeat, yield broadcaster role, and send `bye` so
  // other tabs elect cleanly. Resume on `visible` — election runs again.
  let onVisibilityChange: (() => void) | null = null;

  if (mode === 'one-to-many') {
    const yieldRole = () => {
      if (isBroadcaster) {
        setBroadcasterStatus(false);
      }
      stopHeartbeat();
      tabsLastSeen.delete(TAB_ID);
      transport.post({ type: 'bye', tabId: TAB_ID } satisfies Msg<never>);
    };

    if (document.visibilityState === 'visible') {
      startHeartbeat();
    }

    onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startHeartbeat();
      } else {
        yieldRole();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  return () => {
    wrapper.cancel();
    signals.forEach((s) => {
      s.unsubscribe(wrapper.call);
    });
    if (stableTimer !== null) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
    if (onVisibilityChange) {
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
 * @see [Decision Tree §10 — Cross-tab Broadcast](https://github.com/jav974/react-refsignal/blob/main/docs/decision-tree.md#10-cross-tab-broadcast)
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
export function broadcast<TStore extends object>(
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
