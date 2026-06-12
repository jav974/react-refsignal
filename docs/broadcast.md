# Cross-tab Broadcast

← [Back to README](../README.md) · [API Reference](api.md) · [Patterns](patterns.md) · [Pulse](pulse.md)

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
5. When a tab closes or unmounts, it sends a `bye` message.

**Initial election is deferred by `initialElectionDelay` ms (default: `heartbeatInterval + 100`)** — a grace period after setup or visibility-resume that lets existing peers respond to our `hello` with their own heartbeats before we decide. Without it, a tab joining an existing session would briefly self-elect (before any peer heartbeat arrives) and then yield — a visible flicker of `isBroadcaster` from `false → true → false`. While the window is pending, heartbeat ticks don't claim leadership either, so the delay is honored exactly.

```ts
broadcast(factory, {
  channel: 'game',
  mode: 'one-to-many',
  heartbeatInterval: 300,       // how often each tab sends a hello (default: 300ms)
  heartbeatTimeout: 5000,       // consider a tab dead after this silence (default: 5000ms)
  initialElectionDelay: 400,    // grace period before first election (default: heartbeatInterval + 100)
  onBroadcasterChange: (active) => isBroadcaster.update(active),
});
```

#### Picking values

In most cases you only pick `heartbeatInterval` — the election delay follows automatically.

- **`heartbeatInterval`** — how often each tab broadcasts a `hello`. Every tab heartbeats (this is how peers discover each other for the election); only the elected leader sends `update` messages. Lower values speed up failover when a tab disappears and let joiners decide sooner; higher values are quieter on the channel. The default of 300ms is cheap on a local `BroadcastChannel` (which is in-process, not a network hop).
- **`initialElectionDelay`** — how long a joining tab waits for peer heartbeats before electing. Defaults to `heartbeatInterval + 100` — one full heartbeat cycle to reliably catch every existing peer, plus a 100ms jitter buffer — and scales automatically when you change the heartbeat. Override it only for the extremes: `0` elects synchronously (right when the tab is known to be first, e.g. an initial page load with no existing session); explicit values below `heartbeatInterval` reintroduce the join-flicker.

Non-broadcaster tabs still receive incoming updates — they just don't send any.

#### Smoothing leadership transitions — `gracePeriod`

Opt-in window that handles two problems at leadership transitions:

1. **Trailing-emit grace.** A former broadcaster retains emit privileges for `gracePeriod` ms after losing leadership. In-flight work that fires `update()` within this window still propagates to other tabs rather than being silently dropped on the floor.
2. **Delayed `isStableBroadcaster`.** `useBroadcast` returns a second signal — `isStableBroadcaster` — that flips `true` only after `gracePeriod` ms have elapsed since gaining leadership. Useful for gating work that shouldn't fire during election ambiguity (a fresh leader's first poll, an exclusive write, etc.).

```ts
const { isBroadcaster, isStableBroadcaster } = useBroadcast(store, {
  channel: 'metric-poll',
  mode: 'one-to-many',
  gracePeriod: 5000,
});
```

The delayed flip is **skipped when this tab is alone at election time** (no observed peers) — single-tab initial loads activate `isStableBroadcaster` synchronously with `isBroadcaster`, no useless wait. Grace only applies when there's an actual contested transition to ride out.

Without `gracePeriod` (default): `isStableBroadcaster` always tracks `isBroadcaster` exactly. No trailing emits.

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

#### Polling under broadcast — preventing fetch-flicker on tab switch

A common pattern: only the elected tab polls an API, but as users switch tabs, leadership changes. Without precaution, each new leader fires a fresh request on transition — a "flicker" of redundant network calls.

Compose `gracePeriod` with a broadcast-shared `lastCompletedAt` so the polling cadence is shared across tabs:

```tsx
function LeaderPoller() {
  const store = useMemo(() => ({
    data:            createRefSignal<Result | null>(null),
    lastCompletedAt: createRefSignal(0),
  }), []);

  const { isStableBroadcaster } = useBroadcast(store, {
    channel: 'metric-poll',
    mode: 'one-to-many',
    gracePeriod: 5000,
  });

  // Use the LAZY variant. The non-lazy `useGetMetricQuery(args, { skip })`
  // auto-fires when `skip` flips false — that would bypass our cadence gate
  // and cause a fresh request every time a new tab inherits leadership.
  // Lazy returns an imperative `trigger`; the cadence effect decides when.
  const [trigger, { data, fulfilledTimeStamp }] = useLazyGetMetricQuery();

  // Mirror RTK results into shared signals (only the tab that triggered
  // the fetch sees `data` change from this hook).
  useEffect(() => {
    if (fulfilledTimeStamp) store.lastCompletedAt.update(fulfilledTimeStamp);
    if (data) store.data.update(data);
  }, [fulfilledTimeStamp, data]);

  // Cadence: only fire if the shared lastCompletedAt is older than the
  // interval. Gated on isStableBroadcaster — leadership churn doesn't fire
  // anything, the threshold against shared lastCompletedAt is the only gate.
  const tick = usePulseRefSignal('500ms');
  useRefSignalEffect(() => {
    if (!isStableBroadcaster.current) return;
    if (Date.now() - store.lastCompletedAt.current < 5000) return;
    void trigger(undefined);
  }, [tick, isStableBroadcaster, store.lastCompletedAt, trigger]);

  return <DataView data={store.data} />;
}
```

What composes here:

- **Cadence preserved across tab switches.** With the lazy variant, only the cadence effect fires a request. When a new tab inherits leadership mid-cycle, its check `Date.now() - lastCompletedAt < 5000` skips until the threshold is genuinely met. A user rapidly switching between tabs never triggers a fresh request — the global "5 s between polls" invariant holds.
- **Single network cost per cycle**, even across leadership churn.
- **Single-tab loads activate instantly** — alone at election time, `isStableBroadcaster` flips synchronously, no 5 s wait before the first poll.
- **Trailing-emit grace earns its keep.** If a former leader's lazy query was in flight when leadership flipped, the response landing within `gracePeriod` ms still writes to `store.data` and propagates across tabs (the emit gate accepts the write). Other tabs see fresh data without anyone making a second request.

**`isStableBroadcaster` semantics are asymmetric on purpose**: true-flip is delayed by `gracePeriod` (settle before starting work), false-flip is synchronous (stop scheduling new work the moment leadership is lost). The synchronous false-flip stops the cadence effect from firing on a non-leader; in-flight lazy-query promises are *not* automatically aborted — that's why trailing-emit grace works. If you want to abort, capture the trigger's returned promise and call `.abort()` from a separate effect watching leadership loss.

**Why not the non-lazy `useGetMetricQuery` + `skip` pattern?** RTK Query auto-subscribes and fetches when `skip` flips `false`. That bypasses the cadence gate — every new leader fires immediately on the tab switch, defeating the whole point of the shared `lastCompletedAt` invariant.

#### Extracting it as a reusable hook

Once you've seen the pattern, the cadence + broadcast plumbing can fold into a single hook. The caller passes a lazy `trigger` and gets back a broadcast-shared `data` signal:

```tsx
import { useMemo, useRef } from 'react';
import {
  createRefSignal,
  usePulseRefSignal,
  useRefSignalEffect,
  type ReadonlyRefSignal,
} from 'react-refsignal';
import { useBroadcast } from 'react-refsignal/broadcast';

interface UseCoordinatedPollOptions<T> {
  channel: string;
  interval: number;
  trigger: () => Promise<T>;
}

export function useCoordinatedPoll<T>({
  channel,
  interval,
  trigger,
}: UseCoordinatedPollOptions<T>): {
  data: ReadonlyRefSignal<T | null>;
  isStableBroadcaster: ReadonlyRefSignal<boolean>;
} {
  const store = useMemo(() => ({
    data:            createRefSignal<T | null>(null),
    lastCompletedAt: createRefSignal(0),
  }), []);

  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  const { isStableBroadcaster } = useBroadcast(store, {
    channel,
    mode: 'one-to-many',
    gracePeriod: interval,
  });

  const tick = usePulseRefSignal('500ms');
  useRefSignalEffect(() => {
    if (!isStableBroadcaster.current) return;
    if (Date.now() - store.lastCompletedAt.current < interval) return;

    void triggerRef.current().then((payload) => {
      store.data.update(payload);
      store.lastCompletedAt.update(Date.now());
    });
  }, [tick, isStableBroadcaster, store.lastCompletedAt, interval]);

  return { data: store.data, isStableBroadcaster };
}
```

Call site collapses to the essentials — what to fetch, how often, on which channel:

```tsx
function MetricDashboard() {
  const [trigger] = useLazyGetMetricQuery();

  const { data } = useCoordinatedPoll({
    channel: 'metric-poll',
    interval: 5000,
    trigger: () => trigger(undefined).unwrap(),
  });

  return <DataView data={data} />;
}
```

Two things to keep in mind when adopting this shape:

- **Broadcast the payload, not just the clock.** `store.data` lives inside the broadcast store, so every tab sees the result — not just the leader that fetched it. A common mistake is to keep `data` as a caller-owned signal updated via an `onData` callback; that saves the network call on follower tabs but leaves them with a stale (or null) view.
- **`gracePeriod: interval` is a convenient default, not a law.** First-load delay equals `interval` before any poll fires on a contested election. Fine for dashboards on multi-second intervals; if first-paint latency matters, decouple the two (e.g., `gracePeriod: 1000` with `interval: 5000`) — the cadence gate still holds either way.

The `triggerRef` indirection means inline closures (`trigger: () => fetch(...)`) work without `useCallback` — the latest closure is always read at poll time, and the effect's deps stay stable.

Trailing-emit grace covers leadership flips mid-flight: if `trigger()` was in flight when this tab lost leadership, the resolving `store.data.update` and `store.lastCompletedAt.update` calls still propagate (within `gracePeriod` ms), so other tabs see the result without re-fetching.

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

All timing options from `EffectOptions` are available — `throttle`, `debounce`, `maxWait`, and `frame`. They apply to **outgoing** sends only.

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
  broadcast: { channel: 'anim', frame: true },
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
| `frame` | `boolean` | — | One send per animation frame. |
| `rAF` | `boolean` | — | **Deprecated** alias for `frame`. |
| `onBroadcasterChange` | `(active: boolean) => void` | — | `one-to-many` only: called when this tab gains or loses broadcaster status. |
| `onStableBroadcasterChange` | `(active: boolean) => void` | — | `one-to-many` only: called when this tab's *stable* broadcaster state changes. Fires `true` once this tab has been broadcaster for `gracePeriod` ms (or synchronously if alone or `gracePeriod` is unset); fires `false` synchronously on losing broadcaster status. |
| `heartbeatInterval` | `number` | `300` | `one-to-many` only: how often each tab broadcasts a `hello` for peer discovery, in ms. |
| `heartbeatTimeout` | `number` | `5000` | `one-to-many` only: consider a tab dead after this silence, in ms. |
| `initialElectionDelay` | `number` | `heartbeatInterval + 100` | `one-to-many` only: grace period in ms before the first election after setup or resume. The default scales with the heartbeat (one full cycle + jitter buffer); heartbeat ticks don't claim leadership while the window is pending. Set to `0` for synchronous election (accepts the join-flicker). |
| `gracePeriod` | `number` | — | `one-to-many` only, opt-in. When set, (a) former broadcaster retains emit privileges for this many ms after losing leadership (trailing-emit window), and (b) `useBroadcast`'s `isStableBroadcaster` signal flips `true` only after this many ms have elapsed since gaining leadership — unless alone at election time, in which case the flip is synchronous. See [Smoothing leadership transitions](#smoothing-leadership-transitions--graceperiod). |

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
): {
  isBroadcaster: ReadonlyRefSignal<boolean>;
  isStableBroadcaster: ReadonlyRefSignal<boolean>;
}
```

Hook variant. Sets up broadcast inside a React Provider; tears down on unmount.

- `isBroadcaster` — `true` when this tab is currently sending updates. Always `true` in `many-to-many` mode. In `one-to-many` mode starts `false` and becomes `true` once this tab wins the leader election.
- `isStableBroadcaster` — `true` when this tab is broadcaster *and* has been for at least `gracePeriod` ms — or synchronously, if alone at election time. Identical to `isBroadcaster` when `gracePeriod` is unset. Use to gate work that shouldn't fire during election ambiguity (e.g., `skip: !isStableBroadcaster.current` on an RTK Query hook). See [Smoothing leadership transitions](#smoothing-leadership-transitions--graceperiod).

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

**Interceptors run on incoming broadcast updates.** Remote values are applied via `signal.update()`, which passes through the signal's `interceptor` (if any) — exactly as if the value came from local code. Two consequences:

- An interceptor that returns `CANCEL` silently drops the remote value. The sender and this tab will diverge until a non-cancelled update arrives.
- A transforming interceptor (clamp, normalize, coerce) runs on every tab. If only some tabs have the interceptor, they hold different values for the same broadcast.

Usually the right behavior — validation policy should apply equally to all inputs. But worth knowing when diagnosing "why aren't tabs in sync?"

## Threat model

Broadcast's trust boundary is the browser origin. `BroadcastChannel` and the `localStorage` fallback transport are both same-origin-only, and the library does not authenticate or sign messages — any same-origin script can emit a message and have it applied.

**In practice this means:**

- **Do not broadcast security-sensitive state** that a compromised same-origin script shouldn't be able to modify. Examples to avoid: auth/session flags, permission states, signed identifiers consumed by server calls.
- **Only broadcast UI state** and data whose worst-case cross-tab injection is a UI glitch (theme, sidebar width, draft text, in-flight workflow state).
- If a same-origin tab is compromised (XSS, malicious browser extension with content-script access), the attacker can already do far more than broadcast tampering — but broadcast amplifies their reach into other tabs on the same origin.

This is the same threat model as `localStorage`, `sessionStorage`, and `BroadcastChannel` themselves. The library adds no extra protection over what the browser provides.
