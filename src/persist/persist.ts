import {
  createRefSignal,
  isRefSignal,
  RefSignal,
  setSignalPersistAdapter,
  SignalPersistInput,
  watch,
} from '../refsignal';
import type { PersistOptions, PersistSignalOptions } from './types';
import { resolveStorage } from './storage';
import { applyTimingOptions } from '../timing';

// ─── Stored envelope ──────────────────────────────────────────────────────────

type Envelope = { v: number; data: unknown };

// ─── Signal-level setup ───────────────────────────────────────────────────────

function setupSignalPersist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal: RefSignal<any>,
  options: PersistSignalOptions,
): () => void {
  const {
    key,
    serialize = JSON.stringify,
    deserialize = JSON.parse,
    version = 1,
    migrate,
    onHydrated,
  } = options;

  const storage = resolveStorage(options);

  // ── Hydrate ────────────────────────────────────────────────────────────────

  void storage.get(key).then((raw) => {
    if (raw !== null) {
      try {
        const envelope = deserialize(raw) as Envelope;
        if (!('data' in (envelope as object))) throw new Error('corrupt');
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
    storage
      .set(
        key,
        serialize({ v: version, data: signal.current } satisfies Envelope),
      )
      .catch(() => {
        // write failed — silently skip
      });
  };

  const wrapper = applyTimingOptions(save, options);
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
): { cleanup: () => void; hydrated: RefSignal<boolean> } {
  const {
    key,
    keys,
    serialize = JSON.stringify,
    deserialize = JSON.parse,
    version = 1,
    migrate,
    onHydrated,
  } = options;

  const storage = resolveStorage(options);
  const hydrated = createRefSignal(false);

  const signalKeys = (
    keys ?? (Object.keys(store) as Array<keyof TStore>)
  ).filter((k) => isRefSignal(store[k]));

  // ── Hydrate ────────────────────────────────────────────────────────────────

  void storage.get(key).then((raw) => {
    if (raw !== null) {
      try {
        const envelope = deserialize(raw) as Envelope;
        let data = envelope.data as Record<string, unknown>;

        if (migrate && envelope.v !== version) {
          data = migrate(data, envelope.v);
        }

        for (const k of signalKeys) {
          const sk = k as string;
          if (sk in data) {
            (store[k] as RefSignal).update(data[sk]);
          }
        }
      } catch {
        // corrupt — ignore, keep defaults
      }
    }
    hydrated.update(true);
    onHydrated?.(store);
  });

  // ── Save on any signal update ──────────────────────────────────────────────

  const save = () => {
    const snapshot: Record<string, unknown> = {};
    for (const k of signalKeys) {
      snapshot[k as string] = (store[k] as RefSignal).current;
    }
    storage
      .set(key, serialize({ v: version, data: snapshot } satisfies Envelope))
      .catch(() => {
        // write failed — silently skip
      });
  };

  const wrapper = applyTimingOptions(save, options);
  const cleanups = signalKeys.map((k) =>
    watch(store[k] as RefSignal, wrapper.call),
  );

  return {
    cleanup: () => {
      wrapper.cancel();
      cleanups.forEach((stop) => {
        stop();
      });
    },
    hydrated,
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
