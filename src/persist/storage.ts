import type { IDBStorageOptions } from './idb';
import { indexedDBStorage } from './idb';
import type {
  PersistStorage,
  PersistStorageShorthand,
  StorageConfig,
} from './types';

function syncStorageAdapter(getStorage: () => Storage): PersistStorage {
  return {
    get: (key) => {
      try {
        return Promise.resolve(getStorage().getItem(key));
      } catch {
        return Promise.resolve(null);
      }
    },
    set: (key, value) => {
      try {
        getStorage().setItem(key, value);
      } catch {
        // storage full or unavailable — silently skip
      }
      return Promise.resolve();
    },
    remove: (key) => {
      try {
        getStorage().removeItem(key);
      } catch {
        // unavailable — silently skip
      }
      return Promise.resolve();
    },
  };
}

// Lazy — avoids accessing window.localStorage at module evaluation time (SSR-safe)
export const localStorageAdapter: PersistStorage = syncStorageAdapter(
  () => window.localStorage,
);

export const sessionStorageAdapter: PersistStorage = syncStorageAdapter(
  () => window.sessionStorage,
);

export function resolveStorage(config: StorageConfig): PersistStorage {
  const { storage } = config as { storage?: unknown };

  if (!storage || storage === 'local') return localStorageAdapter;
  if (storage === 'session') return sessionStorageAdapter;
  if (storage === 'indexeddb') {
    const { dbName, dbVersion, storeName } = config as IDBStorageOptions;
    return indexedDBStorage({ dbName, dbVersion, storeName });
  }
  return storage as PersistStorage;
}

/**
 * Low-level helper: remove a persisted value from storage by key.
 *
 * Resolves the storage adapter the same way `persist` / `setupPersist` do —
 * defaults to `localStorage`, accepts `'session'` / `'indexeddb'` shorthands,
 * or a custom `PersistStorage`.
 *
 * **Semantics:** only touches storage. Does NOT reset in-memory signals and
 * does NOT cancel pending throttle/debounce timers of an active `persist`
 * setup — if a save is already queued it may fire right after this resolves
 * and re-populate the key. For active-persist lifecycles, prefer the
 * controller-level `clear()` returned by `setupPersist` / `usePersist`.
 *
 * Intended for:
 * - Signal-level persist (`createRefSignal({ persist })`) users who want to
 *   wipe storage on logout without restructuring.
 * - Bulk "clear by key" operations.
 * - Internal use by `setupPersist`'s own `clear()`.
 *
 * @example
 * await clearPersistedStorage('game');               // localStorage (default)
 * await clearPersistedStorage('user', 'session');     // shorthand
 * await clearPersistedStorage('data', {               // IndexedDB
 *   storage: 'indexeddb',
 *   dbName: 'my-db',
 *   storeName: 'values',
 * });
 * await clearPersistedStorage('k', myCustomAdapter);  // custom adapter
 */
export async function clearPersistedStorage(
  key: string,
  storage?: PersistStorageShorthand | PersistStorage | StorageConfig,
): Promise<void> {
  const config: StorageConfig =
    storage === undefined
      ? {}
      : typeof storage === 'string'
        ? ({ storage } as StorageConfig)
        : 'storage' in (storage as object)
          ? (storage as StorageConfig)
          : ({ storage } as StorageConfig);
  await resolveStorage(config).remove(key);
}
