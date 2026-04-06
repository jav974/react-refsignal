import type { IDBStorageOptions } from './idb';
import type { TimingOptions } from '../timing';

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

type BaseSignalOptions = {
  /** Storage key. */
  key: string;
  /** Serialize the stored envelope to a string. Default: `JSON.stringify`. */
  serialize?: (value: unknown) => string;
  /** Deserialize the stored string back to an envelope. Default: `JSON.parse`. */
  deserialize?: (raw: string) => unknown;
  /** Current schema version. Stored alongside the value to detect stale data. Default: 1. */
  version?: number;
  /** Called when stored version differs from `version`. Return the migrated value. */
  migrate?: (stored: unknown, fromVersion: number) => unknown;
  /** Called once hydration from storage completes (including when no stored value exists). */
  onHydrated?: () => void;
};

export type PersistSignalOptions = TimingOptions &
  BaseSignalOptions &
  StorageConfig;

/** String shorthand for signal-level persist — treated as the storage key. */
export type SignalPersistInput = string | PersistSignalOptions;

type BaseOptions<TStore> = {
  /** Storage key for the entire store blob. */
  key: string;
  /** Only persist these signal keys. Defaults to all signals in the store. */
  keys?: Array<PersistableKeys<TStore>>;
  /** Serialize the stored envelope to a string. Default: `JSON.stringify`. */
  serialize?: (value: unknown) => string;
  /** Deserialize the stored string back to an envelope. Default: `JSON.parse`. */
  deserialize?: (raw: string) => unknown;
  /** Current schema version. Default: 1. */
  version?: number;
  /** Called when stored version differs from `version`. Return the migrated snapshot. */
  migrate?: (
    stored: Record<string, unknown>,
    fromVersion: number,
  ) => Record<string, unknown>;
  /** Called once hydration from storage completes. */
  onHydrated?: (store: TStore) => void;
};

export type PersistOptions<TStore> = TimingOptions &
  BaseOptions<TStore> &
  StorageConfig;
