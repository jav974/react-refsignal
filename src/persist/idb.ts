import type { PersistStorage } from './types';

type OpenParams = Parameters<IDBFactory['open']>;

export interface IDBStorageOptions {
  /** IndexedDB database name. Maps to `IDBFactory.open(name)`. Default: `'refsignal'`. */
  dbName?: OpenParams[0];
  /** IndexedDB schema version. Maps to `IDBFactory.open(name, version)`. Default: `1`. */
  dbVersion?: OpenParams[1];
  /** Object store name used to hold persisted values. Default: `'persist'`. */
  storeName?: string;
  /**
   * Store values via IndexedDB's native structured clone instead of
   * `JSON.stringify` — lets a signal hold a `Blob`/`ArrayBuffer`/`TypedArray`/
   * `Date`/`Map`/`Set` with no base64/JSON round-trip. Skips `serialize`/
   * `deserialize`. Default: `false`.
   *
   * Opt-in and not backward-compatible per key: a key switched to/from
   * structured reads its old data as corrupt. Use a fresh key or bump `dbVersion`.
   */
  structured?: boolean;
}

/**
 * Creates a `PersistStorage` adapter backed by IndexedDB.
 *
 * The database is opened lazily on first access.
 * Use when you need persistence beyond `localStorage` limits,
 * or when you want to store multiple independent signal stores
 * in the same database with different `storeName` values.
 *
 * @example
 * // Inline shorthand (single store, common case)
 * persist(factory, { key: 'game', storage: 'indexeddb', dbName: 'myApp' })
 *
 * @example
 * // Factory (reuse across multiple persist calls)
 * const idb = indexedDBStorage({ dbName: 'myApp', storeName: 'cache' });
 * persist(factoryA, { key: 'a', storage: idb });
 * persist(factoryB, { key: 'b', storage: idb });
 *
 * @example
 * // Structured mode — store a Blob natively (no base64/JSON round-trip)
 * const attachment = createRefSignal<Blob | null>(null, {
 *   persist: { key: 'attachment', storage: 'indexeddb', structured: true },
 * });
 */
export function indexedDBStorage(
  options?: IDBStorageOptions,
): PersistStorage<unknown> {
  const structured = options?.structured ?? false;

  // SSR guard — IndexedDB is browser-only; return a no-op adapter that lets
  // hydration resolve immediately with no stored data.
  if (typeof indexedDB === 'undefined') {
    return {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      structured,
    };
  }

  const {
    dbName = 'refsignal',
    dbVersion = 1,
    storeName = 'persist',
  } = options ?? {};

  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, dbVersion);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };

      req.onsuccess = () => {
        resolve(req.result);
      };

      req.onerror = () => {
        dbPromise = null; // allow retry
        reject(req.error ?? new Error('IDBFactory.open failed'));
      };
    });

    return dbPromise;
  }

  function tx(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          const store = transaction.objectStore(storeName);
          const req = run(store);
          req.onsuccess = () => {
            resolve(req.result as unknown);
          };
          req.onerror = () => {
            reject(req.error ?? new Error('IDBTransaction failed'));
          };
        }),
    );
  }

  return {
    get: (key) =>
      tx('readonly', (store) => store.get(key)).then((v) =>
        v == null ? null : v,
      ),

    set: (key, value) =>
      tx('readwrite', (store) => store.put(value, key)).then(() => undefined),

    remove: (key) =>
      tx('readwrite', (store) => store.delete(key)).then(() => undefined),

    structured,
  };
}
