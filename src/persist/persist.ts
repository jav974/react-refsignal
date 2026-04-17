import {
  isRefSignal,
  RefSignal,
  setSignalPersistAdapter,
  SignalPersistInput,
  watch,
} from '../refsignal';
import type { PersistOptions, PersistSignalOptions } from './types';
import type { StoreSnapshot } from '../store/useRefSignalStore';
import { resolveStorage } from './storage';
import { applyTimingOptions, type TimingOptions } from '../timing';

// ─── Stored envelope ──────────────────────────────────────────────────────────

type Envelope = { v: number; data: unknown };

/**
 * Structural guard for deserialized payloads. Any storage value that does not
 * pass this check is treated as corrupt — protects against partial writes,
 * key collisions with other apps, and custom deserializers returning the
 * wrong shape.
 */
function isEnvelope(x: unknown): x is Envelope {
  return (
    typeof x === 'object' &&
    x !== null &&
    'v' in x &&
    typeof (x as { v: unknown }).v === 'number' &&
    'data' in x
  );
}

// ─── Signal-level setup ───────────────────────────────────────────────────────

function setupSignalPersist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal: RefSignal<any>,
  options: PersistSignalOptions,
): () => void {
  const {
    key,
    filter,
    serialize = JSON.stringify,
    deserialize = JSON.parse,
    version = 1,
    migrate,
    onHydrated,
  } = options;

  const storage = resolveStorage(options);

  // ── Hydrate ────────────────────────────────────────────────────────────────

  // Snapshot the update counter before the async read so we can detect whether
  // the signal was updated (e.g. via broadcast state-handoff) while the read
  // was in flight. If it was, hydration is skipped — the newer in-memory state wins.
  const counterAtSetup = signal.lastUpdated;

  void storage.get(key).then((raw) => {
    if (raw !== null && signal.lastUpdated === counterAtSetup) {
      try {
        const envelope: unknown = deserialize(raw);
        if (!isEnvelope(envelope)) throw new Error('corrupt');
        const value =
          migrate && envelope.v !== version
            ? migrate(envelope.data, envelope.v)
            : envelope.data;
        signal.update(value);
      } catch {
        // corrupt — ignore, keep default
      }
    }
    onHydrated?.();
  });

  // ── Save on update ─────────────────────────────────────────────────────────

  const save = () => {
    if (filter && !filter()) return;
    storage
      .set(
        key,
        serialize({ v: version, data: signal.current } satisfies Envelope),
      )
      .catch(() => {
        // write failed — silently skip
      });
  };

  const wrapper = applyTimingOptions(save, options as TimingOptions);
  const stopWatching = watch(signal, wrapper.call);

  return () => {
    wrapper.cancel();
    stopWatching();
  };
}

// ─── Store-level setup ────────────────────────────────────────────────────────

export function setupPersist<TStore extends Record<string, unknown>>(
  store: TStore,
  options: PersistOptions<TStore>,
): { cleanup: () => void; flush: () => void } {
  const {
    key,
    keys,
    filter,
    serialize = JSON.stringify,
    deserialize = JSON.parse,
    version = 1,
    migrate,
    onHydrated,
    onUnmount,
  } = options;

  const storage = resolveStorage(options);

  const signalKeys = (
    keys ?? (Object.keys(store) as Array<keyof TStore>)
  ).filter((k) => isRefSignal(store[k]));

  // ── Hydrate ────────────────────────────────────────────────────────────────

  // Snapshot each signal's update counter before the async read. Hydration is
  // skipped per-signal if the counter moved while the read was in flight —
  // the newer in-memory state (e.g. from a broadcast state-handoff) wins.
  const countersAtSetup = new Map(
    signalKeys.map((k) => [k, (store[k] as RefSignal).lastUpdated]),
  );

  void storage.get(key).then((raw) => {
    if (raw !== null) {
      try {
        const envelope: unknown = deserialize(raw);
        if (!isEnvelope(envelope)) throw new Error('corrupt');
        if (typeof envelope.data !== 'object' || envelope.data === null) {
          throw new Error('corrupt');
        }
        let data = envelope.data as Record<string, unknown>;

        if (migrate && envelope.v !== version) {
          data = migrate(data, envelope.v);
        }

        for (const k of signalKeys) {
          const sk = k as string;
          if (
            sk in data &&
            (store[k] as RefSignal).lastUpdated === countersAtSetup.get(k)
          ) {
            (store[k] as RefSignal).update(data[sk]);
          }
        }
      } catch {
        // corrupt — ignore, keep defaults
      }
    }
    onHydrated?.(store);
  });

  // ── Save on any signal update ──────────────────────────────────────────────

  const buildSnapshot = (): Record<string, unknown> => {
    const snapshot: Record<string, unknown> = {};
    for (const k of signalKeys) {
      snapshot[k as string] = (store[k] as RefSignal).current;
    }
    return snapshot;
  };

  // Bypasses filter and timing — always writes the current state immediately.
  const doFlush = () => {
    storage
      .set(
        key,
        serialize({ v: version, data: buildSnapshot() } satisfies Envelope),
      )
      .catch(() => {
        // write failed — silently skip
      });
  };

  const save = () => {
    const snapshot = buildSnapshot();
    if (filter && !filter(snapshot as StoreSnapshot<TStore>)) return;
    storage
      .set(key, serialize({ v: version, data: snapshot } satisfies Envelope))
      .catch(() => {
        // write failed — silently skip
      });
  };

  const wrapper = applyTimingOptions(save, options as TimingOptions);
  const cleanups = signalKeys.map((k) =>
    watch(store[k] as RefSignal, wrapper.call),
  );

  return {
    cleanup: () => {
      if (onUnmount) {
        onUnmount(buildSnapshot() as StoreSnapshot<TStore>, doFlush);
      }
      wrapper.cancel();
      cleanups.forEach((stop) => {
        stop();
      });
    },
    flush: doFlush,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Wraps a signal store factory to persist state to storage across page loads.
 *
 * Returns a new factory — pass it to `createRefSignalContext` just like the original.
 * Subscriptions live for the app lifetime (factory-level singleton).
 * Use `usePersist` instead when the Provider mounts and unmounts during the session.
 *
 * Signals start with their default values and update asynchronously once
 * hydration from storage completes. Use `onHydrated` to react to that moment.
 *
 * Composes with `broadcast` — wrap one with the other:
 * @example
 * createRefSignalContext('Game',
 *   broadcast(
 *     persist(factory, { key: 'game' }),
 *     { channel: 'game' }
 *   )
 * )
 *
 * @example
 * persist(
 *   () => ({ level: createRefSignal(1), xp: createRefSignal(0) }),
 *   { key: 'game', version: 2, migrate: (stored) => ({ ...stored, xp: stored.xp ?? 0 }) }
 * )
 */
export function persist<TStore extends Record<string, unknown>>(
  factory: () => TStore,
  options: PersistOptions<TStore>,
): () => TStore {
  return () => {
    const store = factory();
    setupPersist(store, options);
    return store;
  };
}

// ─── Signal-level adapter ──────────────────────────────────────────────────────

function attachSignalPersistImpl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal: RefSignal<any>,
  input: SignalPersistInput,
): () => void {
  const opts: PersistSignalOptions =
    typeof input === 'string' ? { key: input } : input;
  return setupSignalPersist(signal, opts);
}

// Self-register the adapter when this module is imported
setSignalPersistAdapter({ attach: attachSignalPersistImpl });
