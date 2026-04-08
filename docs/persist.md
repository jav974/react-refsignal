# Persist

← [Back to README](../README.md) · [API Reference](api.md) · [Patterns](patterns.md) · [Broadcast](broadcast.md)

---

Persist signal values across page loads using any async storage backend — `localStorage`, `sessionStorage`, IndexedDB, or your own adapter. The persist feature is a **separate subpath** (`react-refsignal/persist`) — importing it is the only activation step required. Apps that never import it pay zero cost.

- [How it works](#how-it-works)
- [Signal-level persist](#signal-level-persist)
- [Store-level persist](#store-level-persist)
  - [`persist()` — factory wrapper](#persist--factory-wrapper)
  - [`usePersist()` — hook variant](#usepersist--hook-variant)
- [Storage backends](#storage-backends)
  - [localStorage and sessionStorage](#localstorage-and-sessionstorage)
  - [IndexedDB](#indexeddb)
  - [Custom adapter](#custom-adapter)
- [Versioning and migration](#versioning-and-migration)
- [Hydration timing](#hydration-timing)
- [Filtering writes](#filtering-writes)
- [Rate-limiting writes](#rate-limiting-writes)
- [onUnmount callback](#onunmount-callback)
- [Composing with broadcast](#composing-with-broadcast)
- [API reference](#api-reference)

---

## How it works

On setup, persist reads the stored value and calls `.update()` on the signal once the async read resolves. The signal starts with its default value and updates when storage is ready — this keeps setup synchronous and works with any async backend.

On every signal update, the new value is serialized and written to storage. Values are stored in an envelope:

```json
{ "v": 1, "data": <value> }
```

The `v` field holds the schema version. When the stored version differs from the current version, a `migrate` function can transform the data before it is applied.

---

## Signal-level persist

Attach persist to a single signal via the `persist` option on `createRefSignal` or `useRefSignal`.

```ts
import 'react-refsignal/persist'; // activate the adapter
import { createRefSignal } from 'react-refsignal';

// Shorthand — key only, uses localStorage by default
const theme = createRefSignal<'light' | 'dark'>('light', { persist: { key: 'theme' } });

// The signal starts as 'light', then updates from storage once the read resolves
```

Inside a React component, use `useRefSignal` — the persist subscription is tied to the component's lifetime and cleaned up on unmount:

```tsx
import 'react-refsignal/persist';
import { useRefSignal, useRefSignalRender } from 'react-refsignal';

function ThemeToggle() {
  const theme = useRefSignal<'light' | 'dark'>('light', {
    persist: { key: 'theme' },
  });
  useRefSignalRender([theme]);

  return (
    <button onClick={() => theme.update(theme.current === 'light' ? 'dark' : 'light')}>
      {theme.current}
    </button>
  );
}
```

The theme survives page reloads. The first render always shows `'light'` (the default), then the component re-renders with the stored value once the storage read resolves.

---

## Store-level persist

For persisting a whole signal store (typically created with `createRefSignalContext`), two functions are available: `persist()` and `usePersist()`.

### `persist()` — factory wrapper

Wraps a store factory function. The persist subscription is set up once when the factory is called and lives for the application's lifetime. Pass the wrapped factory to `createRefSignalContext` exactly as you would the original.

```tsx
import { createRefSignalContext, createRefSignal } from 'react-refsignal';
import { persist } from 'react-refsignal/persist';

const { GameProvider, useGameContext } = createRefSignalContext(
  'Game',
  persist(
    () => ({
      level: createRefSignal(1),
      xp:    createRefSignal(0),
      score: createRefSignal(0),
    }),
    { key: 'game' },
  ),
);
```

All three signals are stored under a single key as one JSON blob. When the page loads, each signal is hydrated from its stored value once the read resolves.

### `usePersist()` — hook variant

Use `usePersist` when your Provider needs to be a full React component — for example, when the storage key is derived from a prop (`userId`, `roomId`, route param), when you want to gate rendering until hydration completes, or when you need to combine persistence with other hooks such as data fetching, auth, or a WebSocket subscription. The hook ties persistence to the Provider's lifetime: subscriptions are created on mount and torn down on unmount, so no writes occur after the component leaves the tree.

Returns `{ hydrated, flush }`:
- `hydrated` — a `RefSignal<boolean>` that becomes `true` once hydration completes. Use it to gate rendering.
- `flush` — writes the current store state to storage immediately, bypassing `filter` and any pending throttle/debounce timer.

```tsx
import { createRefSignalContextHook, useRefSignal } from 'react-refsignal';
import { usePersist } from 'react-refsignal/persist';
import { useMemo, type ReactNode } from 'react';

const [GameContext, useGameContext] = createRefSignalContextHook<GameStore>('Game');

function GameProvider({ children }: { children: ReactNode }) {
  const level = useRefSignal(1);
  const xp    = useRefSignal(0);
  const score = useRefSignal(0);
  const store  = useMemo(() => ({ level, xp, score }), []);

  const { hydrated, flush } = usePersist(store, { key: 'game' });

  return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
}
```

Gate rendering until hydration completes:

```tsx
const { hydrated } = usePersist(store, { key: 'game' });
useRefSignalRender([hydrated]);
if (!hydrated.current) return <Spinner />;
```

#### Persisting only a subset of signals

Use the `keys` option to select which signals are persisted. Non-listed signals are excluded from reads and writes.

```ts
usePersist(store, {
  key: 'game',
  keys: ['score', 'level'], // xp is ephemeral — not saved
});
```

#### Imperative flush

`flush()` writes the current store state immediately — bypasses `filter` and any pending timer. Useful for an explicit save button or ensuring a pending write completes before a navigation:

```tsx
const { flush } = usePersist(store, { key: 'game', debounce: 500 });
<button onClick={flush}>Save now</button>
```

---

## Storage backends

### localStorage and sessionStorage

The default backend is `localStorage`. Use the `storage` option to switch:

```ts
persist(factory, { key: 'game' });                           // localStorage (default)
persist(factory, { key: 'game', storage: 'local' });         // explicit localStorage
persist(factory, { key: 'game', storage: 'session' });       // sessionStorage
```

Both adapters are SSR-safe — `window.localStorage` and `window.sessionStorage` are accessed lazily at call time, not at import time.

You can also import the adapters directly if you need them elsewhere:

```ts
import { localStorageAdapter, sessionStorageAdapter } from 'react-refsignal/persist';
```

### IndexedDB

IndexedDB is the right backend when you need:
- More than ~5 MB of storage
- Storage that does not block the main thread on reads
- A non-string value store (values are serialized strings internally, but the async API avoids I/O contention)

**Inline shorthand** — the common case, one store per app:

```ts
import { persist } from 'react-refsignal/persist';

persist(factory, {
  key: 'game',
  storage: 'indexeddb',
  dbName: 'myApp',     // IDBFactory.open(name) — default: 'refsignal'
  dbVersion: 1,        // IDBFactory.open(name, version) — default: 1
  storeName: 'persist', // object store name — default: 'persist'
});
```

**Factory form** — when you need multiple independent stores in the same app, or want to reuse one adapter across several `persist` calls:

```ts
import { indexedDBStorage, persist } from 'react-refsignal/persist';

const idb = indexedDBStorage({ dbName: 'myApp', storeName: 'game-signals' });

persist(factoryA, { key: 'store-a', storage: idb });
persist(factoryB, { key: 'store-b', storage: idb });
```

Both `persist` calls share the same database connection. Each uses its own storage `key` within the same object store.

The database is opened lazily on first read or write. If `indexedDB` is unavailable, operations fail silently (writes are swallowed, reads return `null`, signals keep their defaults).

### Custom adapter

Any object implementing `PersistStorage` works as a backend — OPFS, SQLite over WASM, a remote API, an in-memory store for tests:

```ts
import type { PersistStorage } from 'react-refsignal/persist';

const myAdapter: PersistStorage = {
  get: (key)        => fetch(`/api/storage/${key}`).then(r => r.text()),
  set: (key, value) => fetch(`/api/storage/${key}`, { method: 'PUT', body: value }).then(() => {}),
  remove: (key)     => fetch(`/api/storage/${key}`, { method: 'DELETE' }).then(() => {}),
};

persist(factory, { key: 'game', storage: myAdapter });
```

The interface is intentionally minimal — three async methods, string keys, string values (the serialized envelope).

---

## Versioning and migration

Use `version` and `migrate` when your signal shapes change between releases. The stored version is compared to the current `version` on every hydration. If they differ, `migrate` is called with the stored data and the stored version number.

**Signal-level:**

```ts
const score = createRefSignal({ value: 0, rank: 'bronze' }, {
  persist: {
    key: 'score',
    version: 2,
    // v1 stored a plain number; v2 uses an object
    migrate: (stored) => ({
      value: typeof stored === 'number' ? stored : 0,
      rank: 'bronze',
    }),
  },
});
```

**Store-level:**

```ts
persist(
  () => ({
    score: createRefSignal(0),
    xp:    createRefSignal(0),
  }),
  {
    key: 'game',
    version: 2,
    // v1 had no xp field
    migrate: (stored) => ({ xp: 0, ...stored }),
  },
);
```

If `version` matches the stored version, `migrate` is never called — no overhead on normal loads.

If the stored data is corrupt or cannot be deserialized, it is silently discarded and signals keep their default values.

---

## Hydration timing

Signals always start with their default value. Hydration from storage is asynchronous — even for `localStorage` (wrapped in `Promise.resolve` for a consistent API). The signal updates once the read resolves, which triggers subscribers and re-renders as normal.

**In-memory state wins over hydration.** Each signal's update counter is snapshotted when `persist()` or `usePersist()` is called. If a signal receives any update before the storage read resolves (for example, a broadcast `state-handoff` from another tab), hydration is skipped for that signal — the newer in-memory state is preserved. Signals that were not updated receive the stored value as normal.

Use `onHydrated` to react to the moment hydration completes — whether storage had a value or not:

**Signal-level:**

```ts
const theme = createRefSignal('light', {
  persist: {
    key: 'theme',
    onHydrated: () => document.body.classList.add('hydrated'),
  },
});
```

**Store-level:**

```ts
const isHydrated = createRefSignal(false);

persist(factory, {
  key: 'game',
  onHydrated: () => isHydrated.update(true),
});
```

`onHydrated` is called exactly once per setup, after hydration completes (or immediately if storage is empty).

---

## Filtering writes

Use `filter` to gate writes conditionally — the write is skipped when `filter` returns `false`. Hydration always runs regardless.

```ts
// Signal-level — only persist when a valid position is set
const position = createRefSignal<{ x: number; y: number } | null>(null, {
  persist: { key: 'cursor', filter: () => position.current !== null },
});

// Store-level — only persist when the game has actually started
persist(factory, {
  key: 'game',
  filter: (store) => store.level > 0,
});
```

`filter` is checked at write time, not at subscription time. When combined with timing options, it is evaluated when the throttle/debounce timer fires — not when the update was scheduled.

---

## Rate-limiting writes

By default, persist writes to storage on every signal update. At high update frequencies — animation loops, pointer tracking, rapid user input — this can mean dozens of writes per second. Use the timing options to coalesce writes:

```ts
// At most one write per 200ms (leading + trailing)
persist(factory, { key: 'game', throttle: 200 });

// Write only after 300ms of quiet
persist(factory, { key: 'game', debounce: 300 });

// With debounce: guaranteed flush every 1s even if the signal keeps firing
persist(factory, { key: 'game', debounce: 300, maxWait: 1000 });

// Coalesce writes into one per animation frame (~16ms at 60 Hz)
persist(factory, { key: 'game', rAF: true });
```

The same options work at the signal level:

```ts
const position = createRefSignal({ x: 0, y: 0 }, {
  persist: { key: 'cursor', throttle: 100 },
});
```

These are the same `TimingOptions` used by `useRefSignalRender`, `useRefSignalEffect`, and `broadcast` — the four options are mutually exclusive.

> **Cleanup:** when using `usePersist`, any pending debounce or throttle timer is cancelled on unmount. Use `onUnmount` with `flush` to guarantee the last update is saved despite cancellation.

---

## onUnmount callback

`onUnmount` runs when the component unmounts. It receives the current store snapshot and a `flush` function that writes to storage immediately, bypassing `filter` and any pending timer.

```ts
// Close the debounce footgun — pending write survives unmount
usePersist(store, {
  key: 'game',
  debounce: 500,
  onUnmount: (_, flush) => flush(),
});

// Combine a final storage write with a backend save
usePersist(store, {
  key: 'game',
  onUnmount: (snapshot, flush) => {
    flush();
    saveToServer(snapshot);
  },
});

// Persist only on unmount — no automatic writes during the session
usePersist(store, {
  key: 'game',
  filter: () => false,
  onUnmount: (_, flush) => flush(),
});
```

`onUnmount` is only available via `usePersist` — the factory-level `persist()` has no unmount lifecycle.

---

## Composing with broadcast

`persist` and `broadcast` compose by wrapping one with the other. Order does not matter functionally — both wrappers call the inner factory and attach their own subscriptions:

```ts
import { createRefSignalContext, createRefSignal } from 'react-refsignal';
import { broadcast } from 'react-refsignal/broadcast';
import { persist }    from 'react-refsignal/persist';

const { GameProvider, useGameContext } = createRefSignalContext(
  'Game',
  broadcast(
    persist(
      () => ({
        level: createRefSignal(1),
        xp:    createRefSignal(0),
      }),
      { key: 'game' },
    ),
    { channel: 'game' },
  ),
);
```

With this setup, the store is persisted across reloads **and** synced across tabs in real time. A tab that reloads hydrates from storage first, then receives live updates from the broadcaster.

---

## API reference

### `PersistSignalOptions`

Options for the `persist` field on `createRefSignal` / `useRefSignal`.

| Option | Type | Default | Description |
|---|---|---|---|
| `key` | `string` | — | Storage key. |
| `storage` | `'local' \| 'session' \| 'indexeddb' \| PersistStorage` | `'local'` | Backend. When `'indexeddb'`, `dbName` / `dbVersion` / `storeName` are also available. |
| `dbName` | `string` | `'refsignal'` | `'indexeddb'` only. Database name (`IDBFactory.open` param). |
| `dbVersion` | `number` | `1` | `'indexeddb'` only. Database schema version (`IDBFactory.open` param). |
| `storeName` | `string` | `'persist'` | `'indexeddb'` only. Object store name. |
| `version` | `number` | `1` | Schema version stored in the envelope. Triggers `migrate` when it differs from the stored value. |
| `migrate` | `(stored: unknown, fromVersion: number) => unknown` | — | Transform stored data when the version changes. Return the migrated value. |
| `serialize` | `(value: unknown) => string` | `JSON.stringify` | Serialize the envelope to a string before writing. |
| `deserialize` | `(raw: string) => unknown` | `JSON.parse` | Deserialize the stored string back to an envelope. |
| `filter` | `() => boolean` | — | Skip the write when this returns `false`. Only gates writes — hydration always runs. |
| `onHydrated` | `() => void` | — | Called once after hydration completes (including when storage is empty). |
| `throttle` | `number` | — | At most one write per N ms (leading + trailing). |
| `debounce` | `number` | — | Write after N ms of quiet. |
| `maxWait` | `number` | — | With `debounce` only: guaranteed flush every N ms even if the signal keeps firing. |
| `rAF` | `boolean` | — | Coalesce writes into one per animation frame. |

The timing options are mutually exclusive — combining them is a type error.

### `PersistOptions<TStore>`

Options for `persist()` and `usePersist()`. All fields from `PersistSignalOptions` are present, plus:

> **`onHydrated` signature differs by level.** Signal-level (`PersistSignalOptions`) calls `onHydrated()` with no arguments — there is no store to pass. Store-level (`PersistOptions`) calls `onHydrated(store)` with the full store object.

| Option | Type | Default | Description |
|---|---|---|---|
| `keys` | `Array<keyof TStore>` | all signals | Persist only these signal keys. Non-signal values are always excluded. |
| `filter` | `(snapshot: StoreSnapshot<TStore>) => boolean` | — | Skip the write when this returns `false`. Receives current signal values unwrapped. Only gates writes — hydration always runs. |
| `onHydrated` | `(store: TStore) => void` | — | Called once after hydration. Receives the full store object. |
| `onUnmount` | `(snapshot: StoreSnapshot<TStore>, flush: () => void) => void` | — | `usePersist` only. Called on unmount with the current snapshot and a `flush` function that writes immediately, bypassing filter and timing. |
| `migrate` | `(stored: Record<string, unknown>, fromVersion: number) => Record<string, unknown>` | — | Transform stored snapshot when version changes. |

### `persist(factory, options)`

```ts
import { persist } from 'react-refsignal/persist';

function persist<TStore>(
  factory: () => TStore,
  options: PersistOptions<TStore>,
): () => TStore
```

Wraps a store factory. Returns a new factory — pass it to `createRefSignalContext`. Subscription is set up once and lives for the app lifetime.

### `usePersist(store, options)`

```ts
import { usePersist } from 'react-refsignal/persist';

function usePersist<TStore>(
  store: TStore,
  options: PersistOptions<TStore>,
): { hydrated: RefSignal<boolean>; flush: () => void }
```

Hook variant. Sets up persist inside a React Provider; tears down subscriptions on unmount. Re-hydrates when `key` changes.

- `hydrated` — becomes `true` once hydration from storage completes.
- `flush` — writes current state to storage immediately, bypassing `filter` and any pending timer. Stable across re-renders.

### `indexedDBStorage(options?)`

```ts
import { indexedDBStorage } from 'react-refsignal/persist';

function indexedDBStorage(options?: IDBStorageOptions): PersistStorage
```

Creates a `PersistStorage` adapter backed by IndexedDB. The database is opened lazily on first access.

### `IDBStorageOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `dbName` | `Parameters<IDBFactory['open']>[0]` | `'refsignal'` | Database name. |
| `dbVersion` | `Parameters<IDBFactory['open']>[1]` | `1` | Database schema version. |
| `storeName` | `string` | `'persist'` | Object store name. |

### `PersistStorage`

The interface every storage adapter implements.

```ts
interface PersistStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
```

### `localStorageAdapter` / `sessionStorageAdapter`

Pre-built `PersistStorage` implementations for `localStorage` and `sessionStorage`. Accessed lazily — safe in SSR environments.
