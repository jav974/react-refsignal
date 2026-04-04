import {
  isRefSignal,
  RefSignal,
  setSignalBroadcastAdapter,
  SignalBroadcastInput,
} from '../refsignal';
import { StoreSnapshot } from '../context/createRefSignalContext';
import { createThrottle, createDebounce, createRAF } from '../timing';
import type { BroadcastOptions, BroadcastSignalOptions } from './types';
import { resolveTransport, Transport } from './transport';
import { takeSnapshot, applySnapshot } from './snapshot';

// ─── Message protocol ──────────────────────────────────────────────────────────

const TAB_ID = Math.random().toString(36).slice(2);

type Msg<T> =
  | { type: 'update'; tabId: string; payload: T }
  | { type: 'hello'; tabId: string; ts: number }
  | { type: 'bye'; tabId: string }
  | { type: 'broadcaster-claim'; tabId: string };

// ─── Core setup (plain function — shared by broadcast() and useBroadcast()) ───

export function setupBroadcast<TStore extends Record<string, unknown>>(
  store: TStore,
  options: BroadcastOptions<TStore>,
): () => void {
  const {
    channel,
    mode = 'many-to-many',
    filter,
    onBroadcasterChange,
    heartbeatInterval = 2000,
    heartbeatTimeout = 5000,
    throttle,
    debounce,
    maxWait,
    rAF,
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

  const timed = rAF
    ? createRAF(sendSnapshot)
    : throttle !== undefined
      ? createThrottle(sendSnapshot, throttle)
      : debounce !== undefined
        ? createDebounce(sendSnapshot, debounce, maxWait)
        : null;

  const timedSend = timed ? timed.call : sendSnapshot;

  const signals = Object.values(store).filter(isRefSignal);
  signals.forEach((s) => {
    s.subscribe(timedSend);
  });

  // ── Election helpers (one-to-many only) ─────────────────────────────────────

  const tabsLastSeen = new Map<string, number>();

  function electBroadcaster() {
    const now = Date.now();
    for (const [id, ts] of tabsLastSeen) {
      if (now - ts >= heartbeatTimeout) tabsLastSeen.delete(id);
    }
    tabsLastSeen.set(TAB_ID, now);

    const shouldBe = [...tabsLastSeen.keys()].sort()[0] === TAB_ID;

    if (shouldBe && !isBroadcaster) {
      isBroadcaster = true;
      onBroadcasterChange?.(true);
      transport.post({
        type: 'broadcaster-claim',
        tabId: TAB_ID,
      } satisfies Msg<never>);
    } else if (!shouldBe && isBroadcaster) {
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
          electBroadcaster();
        }
        break;
      case 'bye':
        if (mode === 'one-to-many') {
          tabsLastSeen.delete(msg.tabId);
          electBroadcaster();
        }
        break;
      case 'broadcaster-claim':
        // A tab with a lower ID claimed broadcaster — yield if we think we are
        if (mode === 'one-to-many' && msg.tabId < TAB_ID && isBroadcaster) {
          isBroadcaster = false;
          onBroadcasterChange?.(false);
        }
        break;
    }
  });

  // ── Heartbeat (one-to-many only) ────────────────────────────────────────────

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  if (mode === 'one-to-many') {
    tabsLastSeen.set(TAB_ID, Date.now());
    electBroadcaster(); // immediate first election
    heartbeatTimer = setInterval(() => {
      transport.post({
        type: 'hello',
        tabId: TAB_ID,
        ts: Date.now(),
      } satisfies Msg<never>);
      electBroadcaster();
    }, heartbeatInterval);
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  return () => {
    timed?.cancel();
    signals.forEach((s) => {
      s.unsubscribe(timedSend);
    });
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
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
