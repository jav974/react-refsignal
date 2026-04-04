import type { IDBStorageOptions } from './idb';
import { indexedDBStorage } from './idb';
import type { PersistStorage, StorageConfig } from './types';

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
