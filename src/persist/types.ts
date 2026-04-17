import type { IDBStorageOptions } from './idb';
import type { TimingOptions, WatchOptions } from '../timing';
import type { StoreSnapshot } from '../store/useRefSignalStore';

type PersistableKeys<TStore> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof TStore]: TStore[K] extends { update: (v: any) => void }
    ? K
    : never;
}[keyof TStore];

export interface PersistStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type PersistStorageShorthand = 'local' | 'session' | 'indexeddb';

/** Discriminated union — IDB-specific options are only valid when `storage: 'indexeddb'`. */
export type StorageConfig =
  | { storage?: 'local' | 'session' | PersistStorage }
  | ({ storage: 'indexeddb' } & IDBStorageOptions);

type PersistCommonOptions = {
  /** Storage key. */
  key: string;
  /** Serialize the stored envelope to a string. Default: `JSON.stringify`. */
  serialize?: (value: unknown) => string;
  /** Deserialize the stored string back to an envelope. Default: `JSON.parse`. */
  deserialize?: (raw: string) => unknown;
  /** Current schema version. Stored alongside the value to detect stale data. Default: 1. */
  version?: number;
};

type BaseSignalOptions = PersistCommonOptions & {
  /** Called when stored version differs from `version`. Return the migrated value. */
  migrate?: (stored: unknown, fromVersion: number) => unknown;
  /** Called once hydration from storage completes (including when no stored value exists). */
  onHydrated?: () => void;
};

export type PersistSignalOptions = WatchOptions &
  BaseSignalOptions &
  StorageConfig;

/** String shorthand for signal-level persist — treated as the storage key. */
export type SignalPersistInput = string | PersistSignalOptions;

type BaseOptions<TStore> = PersistCommonOptions & {
  /** Only persist these signal keys. Defaults to all signals in the store. */
  keys?: Array<PersistableKeys<TStore>>;
  /** Called when stored version differs from `version`. Return the migrated snapshot. */
  migrate?: (
    stored: Record<string, unknown>,
    fromVersion: number,
  ) => Record<string, unknown>;
  /** Called once hydration from storage completes. */
  onHydrated?: (store: TStore) => void;
  /**
   * Skip the write when this returns `false`. Receives a snapshot of current
   * signal values. Only gates outgoing writes — hydration always runs.
   */
  filter?: (snapshot: StoreSnapshot<TStore>) => boolean;
  /**
   * Called when the component unmounts (only available via `usePersist`).
   * Receives the current snapshot and a `flush` function that writes to
   * storage immediately, bypassing `filter` and any pending timing.
   * Use to combine a final storage write with a backend save, or to guarantee
   * a pending debounce/throttle write is not lost on unmount.
   *
   * `flush` returns a `Promise<void>` that resolves when the write completes
   * and rejects if the storage adapter throws. React cleanup functions
   * cannot be async, so it is safe to call `flush()` fire-and-forget here.
   *
   * @example
   * onUnmount: (snapshot, flush) => { flush(); saveToServer(snapshot); }
   */
  onUnmount?: (
    snapshot: StoreSnapshot<TStore>,
    flush: () => Promise<void>,
  ) => void;
};

export type PersistOptions<TStore> = TimingOptions &
  BaseOptions<TStore> &
  StorageConfig;
