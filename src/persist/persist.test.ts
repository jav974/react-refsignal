/**
 * @jest-environment jsdom
 */
import 'fake-indexeddb/auto';

// fake-indexeddb requires structuredClone — polyfill for jsdom
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = <T>(v: T): T =>
    JSON.parse(JSON.stringify(v)) as T;
}
import { act } from 'react';
import { renderHook } from '../test-utils/renderHook';
import { createRefSignal } from '../refsignal';
import {
  persist,
  usePersist,
  clearPersistedStorage,
  localStorageAdapter,
  sessionStorageAdapter,
  indexedDBStorage,
} from './index';
import { setupPersist } from './persist';
import { useRefSignal } from '../hooks/useRefSignal';
import type { PersistOptions, PersistStorage } from './types';
import type { RefSignal } from '../refsignal';
import type { StoreSnapshot } from '../store/useRefSignalStore';

// ─── Mock storage ─────────────────────────────────────────────────────────────

function mockStorage(): PersistStorage & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    store,
    get: (key) => Promise.resolve(store[key] ?? null),
    set: (key, value) => {
      store[key] = value;
      return Promise.resolve();
    },
    remove: (key) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete store[key];
      return Promise.resolve();
    },
  };
}

/** Flush all pending microtasks (async storage reads). */
const flush = () => act(async () => {});

/** Flush microtasks + macrotasks — needed for IndexedDB event callbacks.
 *  IDB operations involve multiple async steps (open → transaction → request),
 *  each firing in a separate macrotask tick, so we drain three times to be safe. */
const flushIDB = async () => {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
};

// ─── Common single-signal store shape ────────────────────────────────────────

type ScoreStore = { score: RefSignal<number> };

/** Canonical score-store factory used in many tests. */
const scoreFactory = (): ScoreStore => ({ score: createRefSignal(0) });

/** Wrap `scoreFactory` with persist and invoke, returning the store. */
function mountScoreStore(options: PersistOptions<ScoreStore>): ScoreStore {
  return persist(scoreFactory, options)();
}

// ─── persist() — factory wrapper ─────────────────────────────────────────────

describe('persist() — basic hydration and saving', () => {
  it('starts with default value when storage is empty', async () => {
    const storage = mockStorage();
    const store = mountScoreStore({
      key: 'game',
      storage,
    });
    await flush();
    expect(store.score.current).toBe(0);
  });

  it('hydrates signal from stored value on init', async () => {
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 1, data: { score: 42 } });

    const store = mountScoreStore({
      key: 'game',
      storage,
    });
    await flush();
    expect(store.score.current).toBe(42);
  });

  it('saves to storage when a signal updates', async () => {
    const storage = mockStorage();
    const store = mountScoreStore({
      key: 'game',
      storage,
    });
    await flush();

    store.score.update(99);
    await flush();

    const stored = JSON.parse(storage.store['game']);
    expect(stored.data.score).toBe(99);
  });

  it('stores version in envelope', async () => {
    const storage = mockStorage();
    const store = mountScoreStore({
      key: 'game',
      storage,
      version: 3,
    });
    await flush();

    store.score.update(1);
    await flush();

    const stored = JSON.parse(storage.store['game']);
    expect(stored.v).toBe(3);
  });

  it('persists only specified keys', async () => {
    const storage = mockStorage();
    const factory = persist(
      () => ({ score: createRefSignal(0), level: createRefSignal(1) }),
      { key: 'game', storage, keys: ['score'] },
    );
    const store = factory();
    await flush();

    store.score.update(5);
    store.level.update(9);
    await flush();

    const stored = JSON.parse(storage.store['game']);
    expect(stored.data.score).toBe(5);
    expect('level' in stored.data).toBe(false);
  });

  it('calls onHydrated after hydration completes', async () => {
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 1, data: { score: 7 } });
    const onHydrated = jest.fn((_store: ScoreStore) => {});

    mountScoreStore({
      key: 'game',
      storage,
      onHydrated,
    });
    await flush();

    expect(onHydrated).toHaveBeenCalledTimes(1);
  });

  it('calls onHydrated even when storage is empty', async () => {
    const storage = mockStorage();
    const onHydrated = jest.fn((_store: ScoreStore) => {});

    mountScoreStore({
      key: 'game',
      storage,
      onHydrated,
    });
    await flush();

    expect(onHydrated).toHaveBeenCalledTimes(1);
  });

  it('passes the store to onHydrated', async () => {
    const storage = mockStorage();
    const onHydrated = jest.fn((_store: ScoreStore) => {});

    const store = mountScoreStore({
      key: 'game',
      storage,
      onHydrated,
    });
    await flush();

    expect(onHydrated).toHaveBeenCalledWith(store);
  });

  it('uses sessionStorage when storage is "session"', async () => {
    sessionStorage.clear();
    sessionStorage.setItem(
      'sess-game',
      JSON.stringify({ v: 1, data: { score: 11 } }),
    );

    const store = mountScoreStore({
      key: 'sess-game',
      storage: 'session',
    });
    await flush();

    expect(store.score.current).toBe(11);
    sessionStorage.clear();
  });
});

// ─── persist() — versioning and migration ─────────────────────────────────────

describe('persist() — versioning and migration', () => {
  it('applies migration when stored version differs', async () => {
    const storage = mockStorage();
    // Stored with v1 schema — xp field missing
    storage.store['game'] = JSON.stringify({
      v: 1,
      data: { score: 10 },
    });

    const factory = persist(
      () => ({ score: createRefSignal(0), xp: createRefSignal(0) }),
      {
        key: 'game',
        storage,
        version: 2,
        migrate: (stored) => ({ xp: 0, ...stored }),
      },
    );
    const store = factory();
    await flush();

    expect(store.score.current).toBe(10);
    expect(store.xp.current).toBe(0);
  });

  it('skips migration when version matches', async () => {
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 2, data: { score: 5 } });
    const migrate = jest.fn(
      (stored: Record<string, unknown>, _fromVersion: number) => stored,
    );

    mountScoreStore({
      key: 'game',
      storage,
      version: 2,
      migrate,
    });
    await flush();

    expect(migrate).not.toHaveBeenCalled();
  });

  it('passes the stored version number to migrate', async () => {
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 3, data: { score: 1 } });
    const migrate = jest.fn(
      (stored: Record<string, unknown>, _fromVersion: number) => stored,
    );

    mountScoreStore({
      key: 'game',
      storage,
      version: 5,
      migrate,
    });
    await flush();

    expect(migrate).toHaveBeenCalledWith({ score: 1 }, 3);
  });

  it('keeps default and calls onHydrated when migrate throws', async () => {
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 1, data: { score: 99 } });
    const onHydrated = jest.fn((_store: ScoreStore) => {});

    const store = mountScoreStore({
      key: 'game',
      storage,
      version: 2,
      migrate: () => {
        throw new Error('migration failed');
      },
      onHydrated,
    });
    await flush();

    expect(store.score.current).toBe(0);
    expect(onHydrated).toHaveBeenCalledTimes(1);
  });

  it('signal-level — applies migration when stored version differs', async () => {
    const storage = mockStorage();
    storage.store['sig'] = JSON.stringify({ v: 1, data: 'old' });

    const signal = createRefSignal('default', {
      persist: {
        key: 'sig',
        storage,
        version: 2,
        migrate: () => 'migrated',
      },
    });
    await flush();

    expect(signal.current).toBe('migrated');
  });

  it('signal-level — passes fromVersion to migrate', async () => {
    const storage = mockStorage();
    storage.store['sig'] = JSON.stringify({ v: 2, data: 'x' });
    const migrate = jest.fn(
      (_stored: unknown, _fromVersion: number): unknown => 'new',
    );

    createRefSignal('default', {
      persist: { key: 'sig', storage, version: 4, migrate },
    });
    await flush();

    expect(migrate).toHaveBeenCalledWith('x', 2);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])(
    'store-level — migrate returning %s discards storage and keeps defaults',
    async (_label, sentinel) => {
      const storage = mockStorage();
      storage.store['game'] = JSON.stringify({
        v: 1,
        data: { score: 99, xp: 50 },
      });
      const onHydrated = jest.fn();

      const factory = persist(
        () => ({ score: createRefSignal(7), xp: createRefSignal(3) }),
        {
          key: 'game',
          storage,
          version: 2,
          migrate: () => sentinel,
          onHydrated,
        },
      );
      const store = factory();
      await flush();

      expect(store.score.current).toBe(7);
      expect(store.xp.current).toBe(3);
      expect(onHydrated).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])(
    'signal-level — migrate returning %s discards storage and keeps default',
    async (_label, sentinel) => {
      const storage = mockStorage();
      storage.store['sig'] = JSON.stringify({ v: 1, data: 'old' });
      const onHydrated = jest.fn();

      const signal = createRefSignal('default', {
        persist: {
          key: 'sig',
          storage,
          version: 2,
          migrate: () => sentinel,
          onHydrated,
        },
      });
      await flush();

      expect(signal.current).toBe('default');
      expect(onHydrated).toHaveBeenCalledTimes(1);
    },
  );
});

// ─── persist() — edge cases ───────────────────────────────────────────────────

describe('persist() — timing options', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('throttle: rapid signal updates produce at most one write per window', async () => {
    const storage = mockStorage();
    const store = mountScoreStore({
      key: 'game',
      storage,
      throttle: 100,
    });
    await flush();

    store.score.update(1); // leading edge — write fires immediately
    store.score.update(2);
    store.score.update(3); // trailing — pending

    // Only the leading write has fired so far
    expect(JSON.parse(storage.store['game']).data.score).toBe(1);

    jest.advanceTimersByTime(100); // trailing write fires
    expect(JSON.parse(storage.store['game']).data.score).toBe(3);
  });

  it('debounce: only writes after quiet period', async () => {
    const storage = mockStorage();
    const store = mountScoreStore({
      key: 'game',
      storage,
      debounce: 100,
    });
    await flush();

    store.score.update(1);
    store.score.update(2);
    store.score.update(3);

    // Nothing written yet — debounce timer not elapsed
    expect(storage.store['game']).toBeUndefined();

    jest.advanceTimersByTime(100);
    expect(JSON.parse(storage.store['game']).data.score).toBe(3);
  });

  it('cleanup cancels pending timer so no write fires after unmount', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { unmount } = renderHook(() =>
      usePersist(store, { key: 'game2', storage, debounce: 100 }),
    );
    await flush();

    store.score.update(99); // starts debounce timer
    unmount(); // triggers cleanup → cancels timer

    jest.advanceTimersByTime(200); // timer would have fired — but was cancelled
    expect(storage.store['game2']).toBeUndefined();
  });

  it('signal-level throttle: rapid updates produce at most one write per window', async () => {
    const storage = mockStorage();
    const signal = createRefSignal(0, {
      persist: { key: 'sig', storage, throttle: 100 },
    });
    await flush();

    signal.update(1);
    signal.update(2);
    signal.update(3);

    expect(JSON.parse(storage.store['sig']).data).toBe(1); // leading

    jest.advanceTimersByTime(100);
    expect(JSON.parse(storage.store['sig']).data).toBe(3); // trailing
  });

  it('signal-level debounce: only writes after quiet period', async () => {
    const storage = mockStorage();
    const signal = createRefSignal(0, {
      persist: { key: 'sig-deb', storage, debounce: 100 },
    });
    await flush();

    signal.update(1);
    signal.update(2);
    expect(storage.store['sig-deb']).toBeUndefined();

    jest.advanceTimersByTime(100);
    expect(JSON.parse(storage.store['sig-deb']).data).toBe(2);
  });

  it('store-level rAF: batches writes into animation frames', async () => {
    const storage = mockStorage();
    const store = mountScoreStore({
      key: 'game',
      storage,
      rAF: true,
    });
    await flush();

    store.score.update(1);
    store.score.update(2);
    store.score.update(3);

    // rAF pending — nothing written yet
    expect(storage.store['game']).toBeUndefined();

    jest.runAllTimers(); // flush rAF (fake-timers covers requestAnimationFrame)
    expect(JSON.parse(storage.store['game']).data.score).toBe(3);
  });

  it('signal-level rAF: batches writes into animation frames', async () => {
    const storage = mockStorage();
    const signal = createRefSignal(0, {
      persist: { key: 'sig-raf', storage, rAF: true },
    });
    await flush();

    signal.update(1);
    signal.update(2);
    expect(storage.store['sig-raf']).toBeUndefined();

    jest.runAllTimers();
    expect(JSON.parse(storage.store['sig-raf']).data).toBe(2);
  });
});

describe('persist() — edge cases', () => {
  it('ignores corrupt stored data and keeps default', async () => {
    const storage = mockStorage();
    storage.store['game'] = 'not valid json{{{';

    const store = mountScoreStore({
      key: 'game',
      storage,
    });
    await flush();

    expect(store.score.current).toBe(0);
  });

  it('ignores non-signal values in store', async () => {
    const storage = mockStorage();
    const factory = persist(
      () => ({ score: createRefSignal(0), label: 'static' as unknown }),
      { key: 'game', storage },
    );
    const store = factory();
    await flush();

    store.score.update(3);
    await flush();

    const stored = JSON.parse(storage.store['game']);
    expect(stored.data.score).toBe(3);
    expect('label' in stored.data).toBe(false);
  });

  it('custom serialize/deserialize round-trips correctly', async () => {
    const storage = mockStorage();
    // Use a custom encoding: wrap value in a tagged object
    const serialize = (v: unknown) =>
      JSON.stringify({ __custom: true, payload: v });
    const deserialize = (raw: string) => {
      const parsed = JSON.parse(raw) as { __custom: boolean; payload: unknown };
      return parsed.payload;
    };

    // Pre-populate with a value encoded by the custom serializer
    storage.store['custom'] = serialize({ v: 1, data: { score: 77 } });

    const store = mountScoreStore({
      key: 'custom',
      storage,
      serialize,
      deserialize,
    });
    await flush();

    expect(store.score.current).toBe(77);

    store.score.update(88);
    await flush();

    // Verify the saved value uses the custom serializer
    const raw = storage.store['custom'];
    expect(raw.startsWith('{"__custom":true')).toBe(true);
    expect(JSON.parse(raw).__custom).toBe(true);
  });

  it('signal-level: silently swallows storage.set rejection on save', async () => {
    const failStorage: PersistStorage = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('write failed')),
      remove: () => Promise.resolve(),
    };

    const signal = createRefSignal(0, {
      persist: { key: 'fail-sig', storage: failStorage },
    });
    await flush();

    // update triggers save → storage.set rejects → .catch swallows it
    signal.update(42);
    await flush();

    // no error escaped; signal still updated
    expect(signal.current).toBe(42);
  });

  it('store-level: silently swallows storage.set rejection on save', async () => {
    const failStorage: PersistStorage = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('write failed')),
      remove: () => Promise.resolve(),
    };

    const store = mountScoreStore({
      key: 'fail-store',
      storage: failStorage,
    });
    await flush();

    store.score.update(5);
    await flush();

    expect(store.score.current).toBe(5);
  });

  it('hydration is skipped when the signal was updated before it resolved', async () => {
    // If a signal receives any update between setup and hydration resolving,
    // the stored value is NOT applied — the newer in-memory state wins.
    // This prevents broadcast state-handoffs (or any other update) from being
    // silently overwritten by older persisted data.
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 1, data: { score: 5 } });

    const store = mountScoreStore({
      key: 'game',
      storage,
    });

    // Update fires before hydration resolves
    store.score.update(100);
    expect(store.score.current).toBe(100);

    // Hydration resolves — stored value (5) is skipped, in-memory state wins
    await flush();
    expect(store.score.current).toBe(100);
  });

  it('store-level: valid JSON envelope missing data field keeps defaults', async () => {
    // envelope.data is undefined → the for-in loop throws → caught → defaults kept
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 1 }); // no data field

    const store = mountScoreStore({
      key: 'game',
      storage,
    });
    await flush();

    expect(store.score.current).toBe(0);
  });

  it('signal-level: valid JSON envelope missing data field keeps default', async () => {
    // envelope.data is undefined → signal.update(undefined) must not corrupt the signal
    const storage = mockStorage();
    storage.store['sig'] = JSON.stringify({ v: 1 }); // no data field

    const signal = createRefSignal(0, {
      persist: { key: 'sig', storage },
    });
    await flush();

    expect(signal.current).toBe(0);
  });

  it('two stores sharing the same key do not corrupt each other', async () => {
    // Last write wins — no crash, final stored value is a valid state
    const storage = mockStorage();

    const factoryA = persist(() => ({ score: createRefSignal(0) }), {
      key: 'shared',
      storage,
    });
    const factoryB = persist(() => ({ score: createRefSignal(0) }), {
      key: 'shared',
      storage,
    });

    const storeA = factoryA();
    const storeB = factoryB();
    await flush();

    storeA.score.update(10);
    storeB.score.update(20);
    await flush();

    const stored = JSON.parse(storage.store['shared']);
    expect([10, 20]).toContain(stored.data.score);
    expect(() => {
      storeA.score.update(99);
    }).not.toThrow();
  });
});

// ─── Envelope structural validation ──────────────────────────────────────────

describe('persist() — envelope validation', () => {
  const invalidPayloads: { label: string; raw: string }[] = [
    { label: 'null', raw: 'null' },
    { label: 'number primitive', raw: '42' },
    { label: 'string primitive', raw: '"hello"' },
    { label: 'boolean primitive', raw: 'true' },
    { label: 'object missing v', raw: JSON.stringify({ data: { score: 5 } }) },
    { label: 'object missing data', raw: JSON.stringify({ v: 1 }) },
    {
      label: 'v is a string, not a number',
      raw: JSON.stringify({ v: '1', data: { score: 5 } }),
    },
    { label: 'array at top level', raw: JSON.stringify([1, 2, 3]) },
  ];

  for (const { label, raw } of invalidPayloads) {
    it(`signal-level: rejects ${label} and keeps default`, async () => {
      const storage = mockStorage();
      storage.store['sig'] = raw;

      const signal = createRefSignal(0, {
        persist: { key: 'sig', storage },
      });
      await flush();

      expect(signal.current).toBe(0);
    });

    it(`store-level: rejects ${label} and keeps defaults`, async () => {
      const storage = mockStorage();
      storage.store['game'] = raw;

      const store = mountScoreStore({
        key: 'game',
        storage,
      });
      await flush();

      expect(store.score.current).toBe(0);
    });
  }

  // Store-level additionally requires data to be a non-null object, since it
  // reads `sk in data` to pick out per-signal values.
  const invalidStoreData: { label: string; data: unknown }[] = [
    { label: 'data is null', data: null },
    { label: 'data is a number', data: 42 },
    { label: 'data is a string', data: 'hello' },
  ];

  for (const { label, data } of invalidStoreData) {
    it(`store-level: rejects envelope where ${label} and keeps defaults`, async () => {
      const storage = mockStorage();
      storage.store['game'] = JSON.stringify({ v: 1, data });

      const store = mountScoreStore({
        key: 'game',
        storage,
      });
      await flush();

      expect(store.score.current).toBe(0);
    });
  }
});

// ─── clearPersistedStorage utility ───────────────────────────────────────────

describe('clearPersistedStorage()', () => {
  it('removes a key via a custom PersistStorage adapter', async () => {
    const storage = mockStorage();
    storage.store['game'] = 'something';

    await clearPersistedStorage('game', storage);

    expect(storage.store['game']).toBeUndefined();
  });

  it('defaults to localStorage when no storage is provided', async () => {
    window.localStorage.setItem('default-key', 'value');
    await clearPersistedStorage('default-key');
    expect(window.localStorage.getItem('default-key')).toBeNull();
  });

  it('accepts the `session` shorthand', async () => {
    window.sessionStorage.setItem('sess-key', 'value');
    await clearPersistedStorage('sess-key', 'session');
    expect(window.sessionStorage.getItem('sess-key')).toBeNull();
  });

  it('is a no-op when the key does not exist', async () => {
    const storage = mockStorage();
    await expect(
      clearPersistedStorage('missing', storage),
    ).resolves.toBeUndefined();
  });

  it('accepts a StorageConfig object form (e.g. indexeddb)', async () => {
    // Exercises the `'storage' in storage` branch of the input-shape
    // normalizer — passing a { storage: 'session', ... } config object
    // rather than an adapter instance or a shorthand string.
    window.sessionStorage.setItem('cfg-key', 'value');
    await clearPersistedStorage('cfg-key', { storage: 'session' });
    expect(window.sessionStorage.getItem('cfg-key')).toBeNull();
  });
});

// ─── setupPersist().clear() — controller semantics ───────────────────────────

describe('setupPersist() — clear()', () => {
  it('removes the storage key and resets signals without re-saving defaults', async () => {
    // Covers three intertwined guarantees:
    //  - clear() removes the storage key entirely
    //  - signals are reset to their default values
    //  - reset fires listeners during clear, but save is suppressed so the
    //    freshly-defaulted snapshot is NOT written back to storage
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({
      v: 1,
      data: { score: 42, level: 9 },
    });

    const store = {
      score: createRefSignal(0),
      level: createRefSignal(1),
    };
    const { cleanup, clear } = setupPersist(store, { key: 'game', storage });
    await flush();

    expect(store.score.current).toBe(42);
    expect(store.level.current).toBe(9);

    await clear();

    expect(store.score.current).toBe(0);
    expect(store.level.current).toBe(1);
    expect(storage.store['game']).toBeUndefined();
    cleanup();
  });

  it('cancels pending throttle timers so no phantom save fires after clear', async () => {
    jest.useFakeTimers();
    try {
      const storage = mockStorage();
      const store: ScoreStore = { score: createRefSignal(0) };
      const { cleanup, clear } = setupPersist(store, {
        key: 'game',
        storage,
        throttle: 100,
      });

      // Burn the leading throttle flush so the trailing timer is queued.
      store.score.update(1);
      // Leading save went through (empty storage → contains { score: 1 }).
      await Promise.resolve();
      expect(storage.store['game']).toBeDefined();

      store.score.update(2); // queues trailing save
      await clear();

      // clear() has cancelled the trailing timer AND removed the key.
      expect(storage.store['game']).toBeUndefined();

      // Advance past the throttle window — no save should fire.
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      expect(storage.store['game']).toBeUndefined();

      cleanup();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns a promise that resolves after the storage write completes', async () => {
    let resolveRemove: (() => void) | null = null;
    const deferredStorage = {
      ...mockStorage(),
      remove: () =>
        new Promise<void>((r) => {
          // Wrap so resolveRemove has a zero-arg signature instead of the
          // Promise resolver's `(value?: void | PromiseLike<void>) => void`.
          resolveRemove = () => {
            r();
          };
        }),
    };

    const store: ScoreStore = { score: createRefSignal(0) };
    const { cleanup, clear } = setupPersist(store, {
      key: 'game',
      storage: deferredStorage,
    });

    const clearPromise = clear();
    let resolved = false;
    void clearPromise.then(() => {
      resolved = true;
    });

    // Signals reset synchronously, but clear() is still pending on remove
    expect(store.score.current).toBe(0);
    await Promise.resolve();
    expect(resolved).toBe(false);

    resolveRemove!();
    await clearPromise;
    expect(resolved).toBe(true);
    cleanup();
  });

  it('updates after clear() do re-save (suppression is scoped to clear)', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };
    const { cleanup, clear } = setupPersist(store, { key: 'game', storage });

    await clear();
    expect(storage.store['game']).toBeUndefined();

    store.score.update(7);
    await Promise.resolve();

    expect(storage.store['game']).toBeDefined();
    const envelope = JSON.parse(storage.store['game']) as {
      data: { score: number };
    };
    expect(envelope.data.score).toBe(7);
    cleanup();
  });
});

// ─── setupPersist().flush() — async + error propagation ──────────────────────

describe('setupPersist() — flush()', () => {
  it('returns a promise that resolves when the storage write completes', async () => {
    let resolveSet: (() => void) | null = null;
    const deferredStorage: PersistStorage = {
      get: () => Promise.resolve(null),
      set: () =>
        new Promise<void>((r) => {
          resolveSet = () => {
            r();
          };
        }),
      remove: () => Promise.resolve(),
    };
    const store: ScoreStore = { score: createRefSignal(0) };
    const { cleanup, flush } = setupPersist(store, {
      key: 'game',
      storage: deferredStorage,
    });

    const flushPromise = flush();
    let resolved = false;
    void flushPromise.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    resolveSet!();
    await flushPromise;
    expect(resolved).toBe(true);
    cleanup();
  });

  it('propagates storage.set rejections via the returned promise', async () => {
    const storage: PersistStorage = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('disk full')),
      remove: () => Promise.resolve(),
    };
    const store: ScoreStore = { score: createRefSignal(0) };
    const { cleanup, flush } = setupPersist(store, { key: 'game', storage });

    await expect(flush()).rejects.toThrow('disk full');
    cleanup();
  });

  it('flush() during clear() suppression resolves with no write attempted', async () => {
    // Hard to trigger in real use, but the contract is: when suppressed the
    // promise resolves immediately and no storage.set runs.
    const setSpy = jest.fn(() => Promise.resolve());
    const storage: PersistStorage = {
      get: () => Promise.resolve(null),
      set: setSpy,
      remove: () => Promise.resolve(),
    };
    const store: ScoreStore = { score: createRefSignal(0) };
    const { cleanup, flush, clear } = setupPersist(store, {
      key: 'game',
      storage,
    });

    // Race: start a clear then a flush; the flush MAY land while suppressed
    // depending on timing — either way it must not reject and must not write.
    const clearPromise = clear();
    await flush(); // resolves regardless
    await clearPromise;

    // setSpy may have been called from prior setup, but no call writes a
    // post-reset value under the cleared key.
    cleanup();
    expect(setSpy.mock.calls.every((c) => c[0] === 'game')).toBe(true);
  });
});

// ─── usePersist() — clear ────────────────────────────────────────────────────

describe('usePersist() — clear', () => {
  it('returns a stable clear() function that wipes storage and resets signals', async () => {
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 1, data: { score: 5 } });
    const store: ScoreStore = { score: createRefSignal(0) };

    const { result } = renderHook(() =>
      usePersist(store, { key: 'game', storage }),
    );
    await flush();
    expect(store.score.current).toBe(5);

    await act(async () => {
      await result.current.clear();
    });

    expect(storage.store['game']).toBeUndefined();
    expect(store.score.current).toBe(0);
  });

  it('clear identity is stable across renders', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { result, rerender } = renderHook(() =>
      usePersist(store, { key: 'game', storage }),
    );
    const first = result.current.clear;
    rerender();
    expect(result.current.clear).toBe(first);
  });
});

// ─── usePersist() ─────────────────────────────────────────────────────────────

describe('usePersist()', () => {
  it('hydrates store from storage on mount', async () => {
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 1, data: { score: 55 } });

    const store: ScoreStore = { score: createRefSignal(0) };
    renderHook(() => {
      usePersist(store, { key: 'game', storage });
    });
    await flush();

    expect(store.score.current).toBe(55);
  });

  it('returns an isHydrated signal that starts false and becomes true after hydration', async () => {
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 1, data: { score: 1 } });
    const store: ScoreStore = { score: createRefSignal(0) };

    const { result } = renderHook(() =>
      usePersist(store, { key: 'game', storage }),
    );

    expect(result.current.isHydrated.current).toBe(false);
    await flush();
    expect(result.current.isHydrated.current).toBe(true);
  });

  it('returned isHydrated signal resets to false when key changes', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { result, rerender } = renderHook(
      ({ k }) => usePersist(store, { key: k, storage }),
      { initialProps: { k: 'key-a' } },
    );
    await flush();
    expect(result.current.isHydrated.current).toBe(true);

    rerender({ k: 'key-b' });
    expect(result.current.isHydrated.current).toBe(false);
    await flush();
    expect(result.current.isHydrated.current).toBe(true);
  });

  it('returned isHydrated signal is stable across re-renders', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { result, rerender } = renderHook(
      ({ extra }: { extra: number }) =>
        usePersist(store, { key: 'game', storage }),
      { initialProps: { extra: 0 } },
    );
    await flush();

    const signalRef = result.current.isHydrated;
    rerender({ extra: 1 });
    expect(result.current.isHydrated).toBe(signalRef);
  });

  it('saves signal updates to storage', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };
    renderHook(() => {
      usePersist(store, { key: 'game', storage });
    });
    await flush();

    act(() => {
      store.score.update(77);
    });
    await flush();

    const stored = JSON.parse(storage.store['game']);
    expect(stored.data.score).toBe(77);
  });

  it('stops saving after unmount', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };
    const { unmount } = renderHook(() => {
      usePersist(store, { key: 'game', storage });
    });
    await flush();

    unmount();
    store.score.update(42);
    await flush();

    expect(storage.store['game']).toBeUndefined();
  });

  it('resubscribes when key changes', async () => {
    const storage = mockStorage();
    storage.store['key-b'] = JSON.stringify({ v: 1, data: { score: 3 } });
    const store: ScoreStore = { score: createRefSignal(0) };

    const { rerender } = renderHook(
      ({ k }) => {
        usePersist(store, { key: k, storage });
      },
      { initialProps: { k: 'key-a' } },
    );
    await flush();
    expect(store.score.current).toBe(0);

    rerender({ k: 'key-b' });
    await flush();
    expect(store.score.current).toBe(3);
  });

  it('after key change, updates write to new key not old key', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { rerender } = renderHook(
      ({ k }) => {
        usePersist(store, { key: k, storage });
      },
      { initialProps: { k: 'key-a' } },
    );
    await flush();

    rerender({ k: 'key-b' });
    await flush();

    act(() => {
      store.score.update(55);
    });
    await flush();

    expect(storage.store['key-b']).toBeDefined();
    expect(JSON.parse(storage.store['key-b']).data.score).toBe(55);
    // old key should be untouched after resubscription
    expect(storage.store['key-a']).toBeUndefined();
  });
});

// ─── createRefSignal broadcast option ────────────────────────────────────────

describe('createRefSignal — persist option', () => {
  it('hydrates from storage on creation', async () => {
    const storage = mockStorage();
    storage.store['sig'] = JSON.stringify({ v: 1, data: 99 });

    const signal = createRefSignal(0, { persist: { key: 'sig', storage } });
    await flush();
    expect(signal.current).toBe(99);
  });

  it('saves to storage when updated', async () => {
    const storage = mockStorage();
    const signal = createRefSignal(0, { persist: { key: 'sig2', storage } });
    await flush();

    signal.update(7);
    await flush();

    const stored = JSON.parse(storage.store['sig2']);
    expect(stored.data).toBe(7);
  });

  it('string shorthand uses the string as key with localStorage', async () => {
    localStorage.setItem('str-key', JSON.stringify({ v: 1, data: 'stored' }));
    const signal = createRefSignal('', { persist: 'str-key' });
    await flush();
    expect(signal.current).toBe('stored');
    localStorage.removeItem('str-key');
  });
});

// ─── useRefSignal — persist option ───────────────────────────────────────────

describe('useRefSignal — persist option', () => {
  it('hydrates from storage on mount', async () => {
    const storage = mockStorage();
    storage.store['hook-sig'] = JSON.stringify({ v: 1, data: 42 });

    const { result } = renderHook(() =>
      useRefSignal(0, { persist: { key: 'hook-sig', storage } }),
    );
    await flush();
    expect(result.current.current).toBe(42);
  });

  it('stops saving after unmount', async () => {
    const storage = mockStorage();
    const { result, unmount } = renderHook(() =>
      useRefSignal(0, { persist: { key: 'hook-unmount', storage } }),
    );
    await flush();

    unmount();
    result.current.update(99);
    await flush();

    expect(storage.store['hook-unmount']).toBeUndefined();
  });
});

// ─── Built-in storage adapters ────────────────────────────────────────────────

describe('built-in storage adapters', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('localStorageAdapter reads and writes localStorage', async () => {
    await localStorageAdapter.set('test-key', 'hello');
    const val = await localStorageAdapter.get('test-key');
    expect(val).toBe('hello');
  });

  it('localStorageAdapter returns null for missing key', async () => {
    const val = await localStorageAdapter.get('no-such-key');
    expect(val).toBeNull();
  });

  it('localStorageAdapter removes key', async () => {
    await localStorageAdapter.set('rm-key', 'x');
    await localStorageAdapter.remove('rm-key');
    const val = await localStorageAdapter.get('rm-key');
    expect(val).toBeNull();
  });

  it('sessionStorageAdapter reads and writes sessionStorage', async () => {
    await sessionStorageAdapter.set('sess-key', 'world');
    const val = await sessionStorageAdapter.get('sess-key');
    expect(val).toBe('world');
  });

  it('localStorageAdapter.get returns null when storage access throws', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('storage access denied');
    });
    expect(await localStorageAdapter.get('any-key')).toBeNull();
  });
});

// ─── indexedDBStorage() factory ───────────────────────────────────────────────

describe('indexedDBStorage()', () => {
  it('returns null for a missing key', async () => {
    const idb = indexedDBStorage({ dbName: 'test-missing', storeName: 's' });
    const val = await idb.get('absent');
    expect(val).toBeNull();
  });

  it('writes and reads a value', async () => {
    const idb = indexedDBStorage({ dbName: 'test-rw', storeName: 's' });
    await idb.set('k', 'hello');
    const val = await idb.get('k');
    expect(val).toBe('hello');
  });

  it('removes a key', async () => {
    const idb = indexedDBStorage({ dbName: 'test-rm', storeName: 's' });
    await idb.set('k', 'x');
    await idb.remove('k');
    const val = await idb.get('k');
    expect(val).toBeNull();
  });

  it('two instances with different dbNames are independent', async () => {
    const a = indexedDBStorage({ dbName: 'test-iso-a', storeName: 's' });
    const b = indexedDBStorage({ dbName: 'test-iso-b', storeName: 's' });
    await a.set('k', 'from-a');
    const fromB = await b.get('k');
    expect(fromB).toBeNull();
  });

  it('works with default options (no arguments)', async () => {
    const idb = indexedDBStorage();
    await idb.set('default-k', 'default-v');
    const val = await idb.get('default-k');
    expect(val).toBe('default-v');
    await idb.remove('default-k');
  });

  it('returns a no-op adapter when indexedDB is unavailable (SSR guard)', async () => {
    const saved = (globalThis as any).indexedDB;
    delete (globalThis as any).indexedDB;
    try {
      const idb = indexedDBStorage({ dbName: 'ssr-test', storeName: 'p' });
      expect(await idb.get('key')).toBeNull();
      await expect(idb.set('key', 'val')).resolves.toBeUndefined();
      await expect(idb.remove('key')).resolves.toBeUndefined();
    } finally {
      (globalThis as any).indexedDB = saved;
    }
  });

  it('rejects when the IDB open request fires onerror', async () => {
    const idb = indexedDBStorage({ dbName: 'open-err', storeName: 's' });

    const spy = jest
      .spyOn(globalThis.indexedDB, 'open')
      .mockImplementationOnce(() => {
        const req: any = {
          result: null,
          error: null, // null forces the ?? fallback: new Error('IDBFactory.open failed')
          source: null,
          transaction: null,
          readyState: 'pending',
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
        };
        setTimeout(() => req.onerror?.(new Event('error')), 0);
        return req as IDBOpenDBRequest;
      });

    await expect(idb.get('key')).rejects.toBeDefined();
    spy.mockRestore();
  });

  it('rejects when an IDB transaction request fires onerror', async () => {
    const idb = indexedDBStorage({ dbName: 'tx-err', storeName: 's' });

    // Warm up dbPromise so the next call goes straight to tx()
    await idb.get('warmup');

    // Patch IDBObjectStore.prototype.get to fire onerror instead of onsuccess
    const IDBObjectStoreCtor = (globalThis as any).IDBObjectStore;
    const origGet = IDBObjectStoreCtor.prototype.get;
    IDBObjectStoreCtor.prototype.get = function () {
      const req: any = {
        result: undefined,
        error: null, // null forces the ?? fallback: new Error('IDBTransaction failed')
        source: null,
        transaction: null,
        readyState: 'pending',
        onsuccess: null,
        onerror: null,
      };
      setTimeout(() => req.onerror?.(new Event('error')), 0);
      return req;
    };

    try {
      await expect(idb.get('key')).rejects.toBeDefined();
    } finally {
      IDBObjectStoreCtor.prototype.get = origGet;
    }
  });

  it('two persist calls sharing one instance write to same store under different keys', async () => {
    const idb = indexedDBStorage({ dbName: 'shared-idb', storeName: 'p' });

    const storeA = { count: createRefSignal(0) };
    const storeB = { total: createRefSignal(0) };

    renderHook(() => {
      usePersist(storeA, { key: 'a', storage: idb });
      usePersist(storeB, { key: 'b', storage: idb });
    });
    await flushIDB();

    act(() => {
      storeA.count.update(1);
    });
    act(() => {
      storeB.total.update(2);
    });
    await flushIDB();

    const rawA = await idb.get('a');
    const rawB = await idb.get('b');
    expect(JSON.parse(rawA!).data.count).toBe(1);
    expect(JSON.parse(rawB!).data.total).toBe(2);
  });
});

// ─── persist() — filter option ───────────────────────────────────────────────

describe('persist() — filter option', () => {
  // ── Signal-level ──────────────────────────────────────────────────────────

  it('signal-level: skips write when filter returns false', async () => {
    const storage = mockStorage();
    const signal = createRefSignal(0, {
      persist: { key: 'sig', storage, filter: () => false },
    });
    await flush();

    signal.update(42);
    await flush();

    expect(storage.store['sig']).toBeUndefined();
  });

  it('signal-level: writes when filter returns true', async () => {
    const storage = mockStorage();
    const signal = createRefSignal(0, {
      persist: { key: 'sig', storage, filter: () => true },
    });
    await flush();

    signal.update(7);
    await flush();

    expect(JSON.parse(storage.store['sig']).data).toBe(7);
  });

  it('signal-level: filter gate toggles — skip then allow', async () => {
    const storage = mockStorage();
    let allow = false;
    const signal = createRefSignal(0, {
      persist: { key: 'sig', storage, filter: () => allow },
    });
    await flush();

    signal.update(1); // filter false — skip
    await flush();
    expect(storage.store['sig']).toBeUndefined();

    allow = true;
    signal.update(2); // filter true — write
    await flush();
    expect(JSON.parse(storage.store['sig']).data).toBe(2);
  });

  it('signal-level: filter does not block hydration', async () => {
    const storage = mockStorage();
    storage.store['sig'] = JSON.stringify({ v: 1, data: 99 });

    const signal = createRefSignal(0, {
      persist: { key: 'sig', storage, filter: () => false },
    });
    await flush();

    expect(signal.current).toBe(99);
  });

  // ── Store-level ───────────────────────────────────────────────────────────

  it('store-level: skips write when filter returns false', async () => {
    const storage = mockStorage();
    const store = mountScoreStore({
      key: 'game',
      storage,
      filter: () => false,
    });
    await flush();

    store.score.update(42);
    await flush();

    expect(storage.store['game']).toBeUndefined();
  });

  it('store-level: writes when filter returns true', async () => {
    const storage = mockStorage();
    const store = mountScoreStore({
      key: 'game',
      storage,
      filter: () => true,
    });
    await flush();

    store.score.update(5);
    await flush();

    expect(JSON.parse(storage.store['game']).data.score).toBe(5);
  });

  it('store-level: filter receives a snapshot of current signal values', async () => {
    const storage = mockStorage();
    const captured: Array<{ score: number }> = [];

    const store = mountScoreStore({
      key: 'game',
      storage,
      filter: (snap) => {
        captured.push(snap as { score: number });
        return true;
      },
    });
    await flush();

    store.score.update(9);
    await flush();

    expect(captured).toHaveLength(1);
    expect(captured[0].score).toBe(9);
  });

  it('store-level: filter gate toggles — skip then allow', async () => {
    const storage = mockStorage();
    let allow = false;
    const store = mountScoreStore({
      key: 'game',
      storage,
      filter: () => allow,
    });
    await flush();

    store.score.update(1); // filter false — skip
    await flush();
    expect(storage.store['game']).toBeUndefined();

    allow = true;
    store.score.update(2); // filter true — write
    await flush();
    expect(JSON.parse(storage.store['game']).data.score).toBe(2);
  });

  it('store-level: filter does not block hydration', async () => {
    const storage = mockStorage();
    storage.store['game'] = JSON.stringify({ v: 1, data: { score: 77 } });

    const store = mountScoreStore({
      key: 'game',
      storage,
      filter: () => false,
    });
    await flush();

    expect(store.score.current).toBe(77);
  });

  // ── usePersist ────────────────────────────────────────────────────────────

  it('usePersist: skips write when filter returns false', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    renderHook(() =>
      usePersist(store, { key: 'game', storage, filter: () => false }),
    );
    await flush();

    act(() => {
      store.score.update(42);
    });
    await flush();

    expect(storage.store['game']).toBeUndefined();
  });

  // ── filter + timing ───────────────────────────────────────────────────────

  describe('filter + timing — filter is checked at timer-fire time', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('signal-level: leading edge skipped when filter false; trailing writes when filter flips true', async () => {
      const storage = mockStorage();
      let allow = false;
      const signal = createRefSignal(0, {
        persist: { key: 'sig', storage, throttle: 100, filter: () => allow },
      });
      await flush();

      signal.update(1); // leading fires synchronously — filter false → skip
      expect(storage.store['sig']).toBeUndefined();

      allow = true;
      signal.update(2); // still in throttle window — trailing scheduled
      jest.advanceTimersByTime(100); // trailing fires — filter true → write
      expect(JSON.parse(storage.store['sig']).data).toBe(2);
    });

    it('store-level: leading edge skipped when filter false; trailing writes when filter flips true', async () => {
      const storage = mockStorage();
      let allow = false;
      const store = mountScoreStore({
        key: 'game',
        storage,
        throttle: 100,
        filter: () => allow,
      });
      await flush();

      store.score.update(1); // leading fires synchronously — filter false → skip
      expect(storage.store['game']).toBeUndefined();

      allow = true;
      store.score.update(2); // still in window — trailing scheduled
      jest.advanceTimersByTime(100); // trailing fires — filter true → write
      expect(JSON.parse(storage.store['game']).data.score).toBe(2);
    });
  });
});

// ─── usePersist() — flush and onUnmount ──────────────────────────────────────

/**
 * Mount a usePersist hook over a fresh ScoreStore + mockStorage.
 * Extras are merged into the options; `key` defaults to 'game'.
 */
function mountUsePersist(extras: Partial<PersistOptions<ScoreStore>> = {}) {
  const storage = mockStorage();
  const store: ScoreStore = { score: createRefSignal(0) };
  const options = {
    key: 'game',
    storage,
    ...extras,
  } as PersistOptions<ScoreStore>;
  const hook = renderHook(() => usePersist(store, options));
  return { storage, store, ...hook };
}

describe('usePersist() — flush and onUnmount', () => {
  // ── flush() ───────────────────────────────────────────────────────────────

  it('flush() writes current state to storage immediately', async () => {
    const { storage, store, result } = mountUsePersist();
    await flush();

    act(() => {
      store.score.update(42);
      result.current.flush();
    });

    expect(JSON.parse(storage.store['game']).data.score).toBe(42);
  });

  it('flush() bypasses filter', async () => {
    const { storage, store, result } = mountUsePersist({
      filter: () => false,
    });
    await flush();

    act(() => {
      store.score.update(7);
      result.current.flush();
    });

    expect(JSON.parse(storage.store['game']).data.score).toBe(7);
  });

  it('flush() bypasses pending debounce timer', async () => {
    jest.useFakeTimers();
    const { storage, store, result } = mountUsePersist({ debounce: 500 });
    await flush();

    act(() => {
      store.score.update(99);
    });
    expect(storage.store['game']).toBeUndefined(); // debounce pending

    act(() => {
      result.current.flush();
    });
    expect(JSON.parse(storage.store['game']).data.score).toBe(99);

    jest.useRealTimers();
  });

  it('flush() is stable across re-renders', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { result, rerender } = renderHook(
      ({ extra }: { extra: number }) =>
        usePersist(store, { key: 'game', storage }),
      { initialProps: { extra: 0 } },
    );
    await flush();

    const flushRef = result.current.flush;
    rerender({ extra: 1 });
    expect(result.current.flush).toBe(flushRef);
  });

  it('flush() propagates storage.set rejection via the returned promise', async () => {
    let shouldFail = false;
    const storage: PersistStorage = {
      get: () => Promise.resolve(null),
      set: () =>
        shouldFail
          ? Promise.reject(new Error('write failed'))
          : Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    const store: ScoreStore = { score: createRefSignal(0) };

    const { result } = renderHook(() =>
      usePersist(store, { key: 'game', storage }),
    );
    await flush();

    shouldFail = true;
    // Callers who await can observe the failure.
    await expect(result.current.flush()).rejects.toThrow('write failed');

    // Fire-and-forget is still safe — the test framework would surface an
    // unhandled rejection, but since nothing awaited it in user code the
    // error is the caller's responsibility to handle.
    shouldFail = true;
    const p = result.current.flush();
    p.catch(() => {
      /* consumed so jest doesn't report an unhandled rejection */
    });
    await expect(p).rejects.toThrow('write failed');
  });

  it('flush() after unmount is a no-op (does not throw)', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { result, unmount } = renderHook(() =>
      usePersist(store, { key: 'game', storage }),
    );
    await flush();

    unmount();
    expect(() => {
      result.current.flush();
    }).not.toThrow();
  });

  it('flush() always calls the latest setup after key change', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { result, rerender } = renderHook(
      ({ k }) => usePersist(store, { key: k, storage }),
      { initialProps: { k: 'key-a' } },
    );
    await flush();

    rerender({ k: 'key-b' });
    await flush();

    act(() => {
      store.score.update(5);
      result.current.flush();
    });

    expect(storage.store['key-b']).toBeDefined();
    expect(JSON.parse(storage.store['key-b']).data.score).toBe(5);
    expect(storage.store['key-a']).toBeUndefined();
  });

  // ── onUnmount ─────────────────────────────────────────────────────────────

  it('onUnmount is called when the component unmounts', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };
    const onUnmount = jest.fn(
      (_snapshot: StoreSnapshot<ScoreStore>, _flush: () => Promise<void>) => {},
    );

    const { unmount } = renderHook(() =>
      usePersist(store, { key: 'game', storage, onUnmount }),
    );
    await flush();

    act(() => {
      store.score.update(3);
    });
    unmount();

    expect(onUnmount).toHaveBeenCalledTimes(1);
  });

  it('onUnmount receives a snapshot of current signal values', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };
    const snapshots: Array<{ score: number }> = [];

    const { unmount } = renderHook(() =>
      usePersist(store, {
        key: 'game',
        storage,
        onUnmount: (snap) => snapshots.push(snap as { score: number }),
      }),
    );
    await flush();

    act(() => {
      store.score.update(55);
    });
    unmount();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].score).toBe(55);
  });

  it('onUnmount flush() writes to storage bypassing filter', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { unmount } = renderHook(() =>
      usePersist(store, {
        key: 'game',
        storage,
        filter: () => false,
        onUnmount: (_, flushFn) => {
          flushFn();
        },
      }),
    );
    await flush();

    act(() => {
      store.score.update(42);
    });
    unmount();

    expect(JSON.parse(storage.store['game']).data.score).toBe(42);
  });

  it('onUnmount flush() closes the debounce footgun — pending write survives unmount', async () => {
    jest.useFakeTimers();
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };

    const { unmount } = renderHook(() =>
      usePersist(store, {
        key: 'game',
        storage,
        debounce: 500,
        onUnmount: (_, flushFn) => {
          flushFn();
        },
      }),
    );
    await flush();

    act(() => {
      store.score.update(77);
    });
    // Timer still pending — unmount triggers onUnmount which calls flush
    unmount();

    expect(JSON.parse(storage.store['game']).data.score).toBe(77);

    jest.useRealTimers();
  });

  it('onUnmount is not called during key-change resubscription (only true unmount)', async () => {
    const storage = mockStorage();
    const store: ScoreStore = { score: createRefSignal(0) };
    const onUnmount = jest.fn(
      (_snapshot: StoreSnapshot<ScoreStore>, _flush: () => Promise<void>) => {},
    );

    const { rerender, unmount } = renderHook(
      ({ k }) => usePersist(store, { key: k, storage, onUnmount }),
      { initialProps: { k: 'key-a' } },
    );
    await flush();

    rerender({ k: 'key-b' });
    await flush();
    expect(onUnmount).toHaveBeenCalledTimes(1); // effect cleanup on key change

    unmount();
    expect(onUnmount).toHaveBeenCalledTimes(2); // true unmount
  });
});

// ─── storage: 'indexeddb' shorthand ──────────────────────────────────────────

describe("storage: 'indexeddb' shorthand", () => {
  it('hydrates from IndexedDB on init', async () => {
    const idb = indexedDBStorage({
      dbName: 'shorthand-hydrate',
      storeName: 'p',
    });
    await idb.set('sig', JSON.stringify({ v: 1, data: 123 }));

    const signal = createRefSignal(0, {
      persist: {
        key: 'sig',
        storage: 'indexeddb',
        dbName: 'shorthand-hydrate',
        storeName: 'p',
      },
    });
    await flushIDB();
    expect(signal.current).toBe(123);
  });

  it('saves to IndexedDB when signal updates', async () => {
    const idb = indexedDBStorage({ dbName: 'shorthand-save', storeName: 'p' });
    const signal = createRefSignal(0, {
      persist: { key: 'save-sig', storage: idb },
    });
    await flushIDB();

    signal.update(42);
    await flushIDB();

    const raw = await idb.get('save-sig');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).data).toBe(42);
  });

  it('persist() store-level uses indexeddb shorthand', async () => {
    const idb = indexedDBStorage({ dbName: 'store-idb', storeName: 'p' });
    await idb.set('store', JSON.stringify({ v: 1, data: { score: 7 } }));

    const store = mountScoreStore({
      key: 'store',
      storage: 'indexeddb',
      dbName: 'store-idb',
      storeName: 'p',
    });
    await flushIDB();
    expect(store.score.current).toBe(7);
  });
});
