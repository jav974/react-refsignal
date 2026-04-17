# Cross-tab Broadcast

← [Back to README](../README.md) · [API Reference](api.md) · [Patterns](patterns.md)

---

Sync signal values across browser tabs and windows in real time. The broadcast feature is a **separate subpath** (`react-refsignal/broadcast`) — importing it is the only activation step required. Apps that never import it pay zero cost.

- [How it works](#how-it-works)
- [Signal-level broadcast](#signal-level-broadcast)
- [Store-level broadcast](#store-level-broadcast)
  - [`broadcast()` — factory wrapper](#broadcast--factory-wrapper)
  - [`useBroadcast()` — hook variant](#usebroadcast--hook-variant)
- [Topology modes](#topology-modes)
  - [`many-to-many` (default)](#many-to-many-default)
  - [`one-to-many` — leader election](#one-to-many--leader-election)
- [Filtering outgoing updates](#filtering-outgoing-updates)
- [Rate-limiting with timing options](#rate-limiting-with-timing-options)
- [API reference](#api-reference)
- [Transport selection](#transport-selection)
- [Caveats](#caveats)

---

## How it works

When a signal value changes, the update is serialized and sent over a `BroadcastChannel` (or `localStorage` as a fallback). Other tabs listening on the same channel receive the payload and call `.update()` on their local copy of the signal — which triggers their own subscribers and re-renders as normal.

Each tab has a unique `TAB_ID` generated at module load time. Messages from the same tab are ignored, so there is no echo loop.

---

## Signal-level broadcast

The simplest form: attach broadcast to a single signal via the `broadcast` option on `createRefSignal` or `useRefSignal`.

```ts
import 'react-refsignal/broadcast'; // activate the adapter
import { createRefSignal } from 'react-refsignal';

// String shorthand — channel name only
const theme = createRefSignal<'light' | 'dark'>('light', { broadcast: 'theme' });

// When any tab calls theme.update('dark'), all other tabs update automatically
theme.update('dark');
```

Inside a React component, use `useRefSignal` — the broadcast subscription is tied to the component's lifetime and cleaned up on unmount:

```tsx
import 'react-refsignal/broadcast';
import { useRefSignal, useRefSignalRender } from 'react-refsignal';

function ThemeToggle() {
  const theme = useRefSignal<'light' | 'dark'>('light', { broadcast: 'theme' });
  useRefSignalRender([theme]);

  return (
    <button onClick={() => theme.update(theme.current === 'light' ? 'dark' : 'light')}>
      Current theme: {theme.current}
    </button>
  );
}
```

Toggling the theme in one tab immediately updates all other open tabs.

**Object form** — pass a `BroadcastSignalOptions` object for additional control:

```ts
import { createRefSignal } from 'react-refsignal';
import type { BroadcastSignalOptions } from 'react-refsignal/broadcast';

const score = createRefSignal(0, {
  broadcast: {
    channel: 'game-score',
    throttle: 100,              // at most one broadcast per 100ms
    filter: () => score.current > 0, // only broadcast positive scores
  } satisfies BroadcastSignalOptions,
});
```

---

## Store-level broadcast

For syncing a whole signal store (typically created with `createRefSignalContext`), two functions are available: `broadcast()` and `useBroadcast()`.

### `broadcast()` — factory wrapper

Wraps a store factory function. The broadcast subscription is set up once when the factory is called and lives for the application's lifetime. Pass the wrapped factory to `createRefSignalContext` exactly as you would the original.

```tsx
import { createRefSignalContext, createRefSignal } from 'react-refsignal';
import { broadcast } from 'react-refsignal/broadcast';

const { GameProvider, useGameContext } = createRefSignalContext(
  'Game',
  broadcast(
    () => ({
      level: createRefSignal(1),
      xp:    createRefSignal(0),
      score: createRefSignal(0),
    }),
    { channel: 'game' },
  ),
);
```

Now every tab running `GameProvider` shares the same `level`, `xp`, and `score` values. Updating any signal in one tab propagates to all others.

```tsx
function LevelUpButton() {
  const store = useGameContext();
  return (
    <button onClick={() => store.level.update(store.level.current + 1)}>
      Level Up
    </button>
  );
}
```

### `useBroadcast()` — hook variant

Use `useBroadcast` when your Provider needs to be a full React component — for example, when the channel name is derived from a prop (`roomId`, route param), or when you need to combine broadcast with other hooks such as data fetching, auth, or persistence. The hook ties the broadcast to the Provider's lifetime: the transport is set up on mount and torn down on unmount (`bye` sent in `one-to-many` mode), so no messages are sent or received after the component leaves the tree.

```tsx
import { createRefSignalContextHook, useRefSignal } from 'react-refsignal';
import { useBroadcast } from 'react-refsignal/broadcast';
import { useMemo, type ReactNode } from 'react';

const [GameContext, useGameContext] = createRefSignalContextHook<GameStore>('Game');

function GameProvider({ children }: { children: ReactNode }) {
  const level = useRefSignal(1);
  const xp    = useRefSignal(0);
  const score = useRefSignal(0);
  const store  = useMemo(() => ({ level, xp, score }), []);

  useBroadcast(store, { channel: 'game' });

  return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
}
```

`useBroadcast` keeps the latest options (filter, timing callbacks) in a ref internally — changing them on re-render takes effect immediately without resubscribing.

---

## Topology modes

### `many-to-many` (default)

Every tab both sends and receives updates. Any tab can update the shared state.

```ts
broadcast(factory, { channel: 'game' });
// equivalent to:
broadcast(factory, { channel: 'game', mode: 'many-to-many' });
```

Use this for most collaborative scenarios: shared settings, presence indicators, shared carts.

### `one-to-many` — leader election

One tab is elected as the broadcaster; all other tabs are receivers. Useful when only one source of truth should produce updates — for example, a game server tab, a background sync tab, or a tab controlling an audio stream.

```ts
broadcast(factory, {
  channel: 'game',
  mode: 'one-to-many',
  onBroadcasterChange: (active) => {
    console.log(active ? 'This tab is now the broadcaster' : 'Yielded to another tab');
  },
});
```

**Election algorithm** — when a new tab joins or an existing tab leaves:

1. Each tab announces itself with a periodic `hello` heartbeat.
2. Tabs that have not sent a heartbeat within `heartbeatTimeout` ms are pruned.
3. The tab with the lexicographically smallest `TAB_ID` wins.
4. The winner sends a `broadcaster-claim` message so other tabs yield immediately.
5. When a tab closes or unmounts, it sends a `bye` message to trigger immediate re-election.

```ts
broadcast(factory, {
  channel: 'game',
  mode: 'one-to-many',
  heartbeatInterval: 2000, // how often to announce presence (default: 2000ms)
  heartbeatTimeout: 5000,  // consider a tab dead after this silence (default: 5000ms)
  onBroadcasterChange: (active) => isBroadcaster.update(active),
});
```

Non-broadcaster tabs still receive incoming updates — they just don't send any.

#### Restricting localStorage writes to the leader tab

When `persist` and `broadcast` are combined in `one-to-many` mode, all tabs write to storage by default (each tab reacts to the broadcast update and persists it). If you want only the leader to write, use `useBroadcast`'s `isBroadcaster` signal as the `filter` for `usePersist`:

```tsx
function GameProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => ({ score: createRefSignal(0) }), []);

  const { isBroadcaster } = useBroadcast(store, {
    channel: 'game',
    mode: 'one-to-many',
  });

  usePersist(store, {
    key: 'game',
    filter: () => isBroadcaster.current, // only the leader writes to storage
  });

  return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
}
```

---

## Filtering outgoing updates

The `filter` option controls whether an update is broadcast. It only gates **outgoing** messages — incoming updates from other tabs are always applied.

**Signal-level** — `() => boolean`:

```ts
const score = createRefSignal(0, {
  broadcast: {
    channel: 'game-score',
    filter: () => score.current >= 0, // don't broadcast negative scores
  },
});
```

**Store-level** — receives the full store snapshot (current values of all signals), so no closures needed:

```ts
broadcast(factory, {
  channel: 'game',
  filter: (store) => store.level > 0 && store.xp > 0,
});
```

---

## Rate-limiting with timing options

All timing options from `EffectOptions` are available — `throttle`, `debounce`, `maxWait`, and `rAF`. They apply to **outgoing** sends only.

```ts
// High-frequency signal — throttle to avoid flooding the channel
const mousePosition = createRefSignal({ x: 0, y: 0 }, {
  broadcast: { channel: 'cursor', throttle: 50 },
});

// Debounce — wait until typing stops before syncing
const searchQuery = createRefSignal('', {
  broadcast: { channel: 'search', debounce: 300 },
});

// Animation — one send per frame maximum
const animatedValue = createRefSignal(0, {
  broadcast: { channel: 'anim', rAF: true },
});

// Store-level — same options available
broadcast(factory, {
  channel: 'game',
  throttle: 100,
});
```

---

## API reference

### `BroadcastSignalOptions`

Options for the `broadcast` field on `createRefSignal` / `useRefSignal`.

| Option | Type | Default | Description |
|---|---|---|---|
| `channel` | `string` | — | Channel name. All tabs using the same name share this signal's value. |
| `mode` | `'many-to-many' \| 'one-to-many'` | `'many-to-many'` | Topology. See [Topology modes](#topology-modes). |
| `filter` | `() => boolean` | — | Skip the outgoing broadcast when this returns `false`. Incoming updates are always applied. |
| `throttle` | `number` | — | At most one send per N ms (leading + trailing). |
| `debounce` | `number` | — | Send after N ms of quiet. |
| `maxWait` | `number` | — | With `debounce`: guaranteed flush every N ms even if the signal keeps firing. |
| `rAF` | `boolean` | — | One send per animation frame. |
| `onBroadcasterChange` | `(active: boolean) => void` | — | `one-to-many` only: called when this tab gains or loses broadcaster status. |
| `heartbeatInterval` | `number` | `2000` | `one-to-many` only: how often to announce presence, in ms. |
| `heartbeatTimeout` | `number` | `5000` | `one-to-many` only: consider a tab dead after this silence, in ms. |

### `BroadcastOptions<TStore>`

Options for `broadcast()` and `useBroadcast()`. Same fields as `BroadcastSignalOptions` except `filter` receives a store snapshot:

| Option | Type | Description |
|---|---|---|
| `filter` | `(snapshot: StoreSnapshot<TStore>) => boolean` | Snapshot of the store (signals unwrapped to current values). Skip outgoing when `false`. |

All other fields are identical to `BroadcastSignalOptions`.

### `broadcast(factory, options)`

```ts
import { broadcast } from 'react-refsignal/broadcast';

function broadcast<TStore>(
  factory: () => TStore,
  options: BroadcastOptions<TStore>,
): () => TStore
```

Wraps a store factory. Returns a new factory — pass it to `createRefSignalContext`. Subscription is set up once and lives for the app lifetime.

### `useBroadcast(store, options)`

```ts
import { useBroadcast } from 'react-refsignal/broadcast';

function useBroadcast<TStore>(
  store: TStore,
  options: BroadcastOptions<TStore>,
): { isBroadcaster: RefSignal<boolean> }
```

Hook variant. Sets up broadcast inside a React Provider; tears down on unmount.

- `isBroadcaster` — a `RefSignal<boolean>` that is `true` when this tab is currently sending updates. Always `true` in `many-to-many` mode. In `one-to-many` mode starts `false` and becomes `true` once this tab wins the leader election.

---

## Transport selection

The transport is selected automatically:

| Environment | Transport |
|---|---|
| `BroadcastChannel` available (modern browsers) | Native `BroadcastChannel` — efficient, no storage writes |
| `BroadcastChannel` unavailable (older Safari, some workers) | `localStorage` + `storage` event — same-origin only |

No configuration needed. The fallback is transparent.

---

## Caveats

**Values must be serializable.** Updates are sent as JSON. Signals containing functions, class instances, or circular references will not sync correctly.

**Same origin only.** Both `BroadcastChannel` and `localStorage` are restricted to the same origin. Cross-origin sync is not possible.

**No initial state sync.** When a new tab opens, it starts with whatever initial value was passed to `createRefSignal`. There is no mechanism to pull the current state from an existing tab on load. If you need this, send a request message from the new tab and respond from the broadcaster — or persist initial state separately.

**`one-to-many` and page reload.** If the broadcaster tab reloads, the remaining tabs re-elect within one `heartbeatTimeout`. During this window, no outgoing updates are sent. Size `heartbeatTimeout` accordingly for your use case.

**Persist + broadcast composition.** When `persist` and `broadcast` are composed on the same store, hydration and state-handoff are safe to use together. Persist snapshots each signal's update counter at setup time — if a `state-handoff` (or any other update) arrives before the storage read resolves, hydration is skipped for that signal and the in-memory state is preserved.

## Threat model

Broadcast's trust boundary is the browser origin. `BroadcastChannel` and the `localStorage` fallback transport are both same-origin-only, and the library does not authenticate or sign messages — any same-origin script can emit a message and have it applied.

**In practice this means:**

- **Do not broadcast security-sensitive state** that a compromised same-origin script shouldn't be able to modify. Examples to avoid: auth/session flags, permission states, signed identifiers consumed by server calls.
- **Only broadcast UI state** and data whose worst-case cross-tab injection is a UI glitch (theme, sidebar width, draft text, in-flight workflow state).
- If a same-origin tab is compromised (XSS, malicious browser extension with content-script access), the attacker can already do far more than broadcast tampering — but broadcast amplifies their reach into other tabs on the same origin.

This is the same threat model as `localStorage`, `sessionStorage`, and `BroadcastChannel` themselves. The library adds no extra protection over what the browser provides.
