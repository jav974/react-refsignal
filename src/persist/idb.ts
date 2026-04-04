import type { PersistStorage } from './types';

type OpenParams = Parameters<IDBFactory['open']>;

export interface IDBStorageOptions {
  /** IndexedDB database name. Maps to `IDBFactory.open(name)`. Default: `'refsignal'`. */
  dbName?: OpenParams[0];
  /** IndexedDB schema version. Maps to `IDBFactory.open(name, version)`. Default: `1`. */
  dbVersion?: OpenParams[1];
  /** Object store name used to hold persisted values. Default: `'persist'`. */
  storeName?: string;
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
 */
export function indexedDBStorage(options?: IDBStorageOptions): PersistStorage {
  // SSR guard — IndexedDB is browser-only; return a no-op adapter that lets
  // hydration resolve immediately with no stored data.
  if (typeof indexedDB === 'undefined') {
    return {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
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
        v == null ? null : (v as string),
      ),

    set: (key, value) =>
      tx('readwrite', (store) => store.put(value, key)).then(() => undefined),

    remove: (key) =>
      tx('readwrite', (store) => store.delete(key)).then(() => undefined),
  };
}
