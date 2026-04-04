# API Reference

← [Back to README](../README.md) · [Concepts](concepts.md) · [Patterns](patterns.md)

---

- [`RefSignal<T>`](#refsignalt)
- [`createRefSignal<T>(initialValue, options?)`](#createrefsignalt-initialvalue-options)
- [`SignalOptions<T>` / `Interceptor<T>` / `CANCEL`](#signaloptionst--interceptort--cancel)
- [`useRefSignal<T>(initialValue, options?)`](#userefsignalt-initialvalue-options)
- [`isRefSignal<T>(obj)`](#isrefsignalt-obj)
- [`useRefSignalEffect(effect, deps, options?)`](#userefsignaleffect-effect-deps-options)
- [`useRefSignalRender(deps, options?)`](#userefsignalrender-deps-options)
- [`RenderOptions`](#renderoptions)
- [`ContextHookOptions<TStore>`](#contexthookoptionststore)
- [`useRefSignalMemo<T>(factory, deps)`](#userefsignalmemot-factory-deps)
- [`batch(callback, deps?)`](#batchcallback-deps)
- [`createRefSignalContext<TName, TStore>(name, factory)`](#createrefsignalcontexttname-tstore-name-factory)
- [`createRefSignalContextHook<TStore>(name)`](#createrefsignalcontexthooktstore-name)
- [`ALL`](#all)
- [DevTools](#devtools)

---

### `RefSignal<T>`

The core interface implemented by all signal objects.

| Member | Description |
|---|---|
| `current: T` | The current value. Mutable directly; prefer `.update()` to notify subscribers. |
| `lastUpdated: number` | Monotonic counter. Starts at `0`, incremented by `update()` and `notifyUpdate()`. |
| `update(value)` | Sets `current`, bumps `lastUpdated`, notifies subscribers. No-op if value is strictly equal. |
| `reset()` | Restores `current` to the initial value via `.update()` — respects the interceptor, notifies subscribers, no-op if already at initial. |
| `notify()` | Fires all subscribers. Does **not** change `lastUpdated`. [See Concepts](concepts.md#notify-vs-notifyupdate) |
| `notifyUpdate()` | Bumps `lastUpdated`, then fires all subscribers. [See Concepts](concepts.md#notify-vs-notifyupdate) |
| `subscribe(listener)` | Registers a listener called with the current value on every notification. |
| `unsubscribe(listener)` | Removes a previously registered listener. |
| `getDebugName?()` | Returns the signal's debug name. Only present when DevTools are enabled. |

---

### `createRefSignal<T>(initialValue, options?)`

Creates a signal outside of React. Use at module scope or inside context factories.

```ts
import { createRefSignal, CANCEL } from 'react-refsignal';

const position = createRefSignal({ x: 0, y: 0 });
position.update({ x: 10, y: 20 });

// With debug name (string shorthand — backward compatible)
const score = createRefSignal(0, 'score');

// With interceptor — transform incoming value
const health = createRefSignal(100, { interceptor: (v) => Math.max(0, Math.min(100, v)) });
const angle  = createRefSignal(0,   { interceptor: (v) => v % 360 });

// With interceptor — cancel the update by returning CANCEL
const state = createRefSignal<'idle' | 'running' | 'paused'>('idle', {
  interceptor: (incoming, current) => {
    if (current === 'idle' && incoming === 'paused') return CANCEL; // invalid transition
    return incoming;
  },
});

// Delta-based — use current value to limit rate of change
const position = createRefSignal(0, {
  interceptor: (incoming, current) => current + Math.min(incoming - current, 10),
});
```

`lastUpdated` starts at `0` and is only incremented by `update()` or `notifyUpdate()`.

> **Note:** `interceptor` runs inside `.update()` only. Direct mutation of `.current` bypasses it.

---

### `SignalOptions<T>` / `Interceptor<T>` / `CANCEL`

Options accepted by `createRefSignal` and `useRefSignal`.

| Option | Type | Description |
|---|---|---|
| `debugName` | `string` | Name shown in DevTools. Equivalent to passing a string as the second argument. |
| `interceptor` | `Interceptor<T>` | Runs before every `.update()`. Return a `T` to store that value, or return `CANCEL` to silently drop the update. |

```ts
export const CANCEL: unique symbol;
export type Interceptor<T> = (incoming: T, current: T) => T | typeof CANCEL;
```

`CANCEL` is a unique symbol — safe to use even when `T` includes `undefined` or `null`.

---

### `useRefSignal<T>(initialValue, options?)`

Creates a signal inside a React component. The signal is created once on mount and is stable across re-renders. The initial value is used only at creation — subsequent re-renders do not update it.

```tsx
const count = useRefSignal(0);
const count = useRefSignal(0, 'userCount'); // with debug name

// With interceptor
const score = useRefSignal(0, { interceptor: (v) => Math.max(0, v) });
```

---

### `isRefSignal<T>(obj)`

Type guard. Returns `true` if `obj` has the shape of a `RefSignal`. Validates structure only — does not validate the type of `.current` at runtime.

`<T>` is used for type narrowing at the call site only — it is not checked at runtime.

```ts
import { isRefSignal } from 'react-refsignal';

if (isRefSignal(dep)) dep.subscribe(listener);

// With type narrowing:
if (isRefSignal<PointData>(from)) {
  from.current; // typed as PointData
}
```

---

### `useRefSignalEffect(effect, deps, options?)`

Runs `effect` on mount and whenever any `RefSignal` in `deps` fires. Non-signal values in `deps` follow standard `useEffect` semantics — the effect resubscribes when they change.

```tsx
useRefSignalEffect(() => {
  document.title = `Count: ${count.current}`;
}, [count]);
```

**Key behaviors:**
- Runs immediately on mount — always synchronous, unaffected by timing options.
- If `effect` returns a cleanup function, it runs on **unmount or deps change only** — not between signal fires.
- Re-entrancy is allowed: the effect may call `.update()` on a signal in `deps`.
- Accepts mixed deps: signal deps subscribe directly, non-signal deps resubscribe via React's `useEffect`.

**`options`** — rate-limit signal-triggered effect runs. Accepts `EffectOptions` (same as `RenderOptions` without `filter` — put conditional logic inside the effect body instead):

```tsx
// Collapse multiple signal fires per frame into one effect run
useRefSignalEffect(() => {
  ctx.fillRect(position.current.x, position.current.y, 20, 20);
}, [position], { rAF: true });

// Expensive effect — at most once per 100ms
useRefSignalEffect(() => {
  rebuildIndex(data.current);
}, [data], { throttle: 100 });

// Conditional? Put it in the body
useRefSignalEffect(() => {
  if (score.current < 100) return;
  triggerCelebration();
}, [score], { debounce: 200 });
```

---

### `useRefSignalRender(deps, options?)`

Subscribes to signals and re-renders the component on any update via `.update()` or `.notifyUpdate()`. Built on `useSyncExternalStore` — concurrent-safe and tear-free.

```tsx
const score = useRefSignal(0);
useRefSignalRender([score]);

return <div>Score: {score.current}</div>;
```

**`options`** — an optional `RenderOptions` object (or a legacy bare callback for backward compatibility):

```tsx
// Legacy callback — still supported
useRefSignalRender([count], () => count.current % 10 === 0);

// Options object — filter, throttle, debounce, rAF
useRefSignalRender([price], { throttle: 100 });
useRefSignalRender([query], { debounce: 200 });
useRefSignalRender([query], { debounce: 200, maxWait: 1000 });
useRefSignalRender([position], { rAF: true });
useRefSignalRender([count], { filter: () => count.current % 10 === 0 });
```

**Returns** a `forceUpdate` function that unconditionally re-renders, bypassing all options:

```tsx
const forceUpdate = useRefSignalRender([]);
forceUpdate();
```

> **Note:** `notify()` alone does **not** trigger a re-render. `useRefSignalRender` watches `lastUpdated`, which only changes via `update()` and `notifyUpdate()`.

---

### `RenderOptions`

Options accepted by `useRefSignalRender` and `useRefSignalEffect`.

| Option | Type | Description |
|---|---|---|
| `filter` | `() => boolean` | Only proceed if this returns `true`. |
| `throttle` | `number` | At most one trigger per N ms (leading + trailing). |
| `debounce` | `number` | Trigger after N ms of quiet. |
| `maxWait` | `number` | With `debounce`: guaranteed flush every N ms even if the signal keeps firing. |
| `rAF` | `boolean` | Schedule on the next animation frame; multiple fires per frame collapse into one. |

Only one timing mode should be active at a time. If multiple are provided, precedence is `rAF > throttle > debounce`.

Context hooks (`createRefSignalContext`, `createRefSignalContextHook`) accept [`ContextHookOptions`](#contexthookoptionststore) instead, which extends these same timing fields but upgrades `filter` to receive the store directly.

---

### `ContextHookOptions<TStore>`

Options accepted by the hook returned from `createRefSignalContext` and `createRefSignalContextHook`. Extends the timing fields of `RenderOptions` and adds context-specific fields.

| Option | Type | Description |
|---|---|---|
| `renderOn` | `Array<keyof TStore>` \| `'all'` | Signal keys that trigger a re-render. Omit to never re-render. |
| `unwrap` | `boolean` | If `true`, returns plain values with auto-generated setters instead of raw signals. |
| `filter` | `(store: StoreSnapshot<TStore>) => boolean` | Only re-render if this returns `true`. Receives the store snapshot — no closure needed. |
| `throttle` | `number` | At most one re-render per N ms (leading + trailing). |
| `debounce` | `number` | Re-render after N ms of quiet. |
| `maxWait` | `number` | With `debounce`: guaranteed flush every N ms even if the signal keeps firing. |
| `rAF` | `boolean` | Schedule on the next animation frame; multiple fires per frame collapse into one. |

The key difference from `RenderOptions`: `filter` receives the store snapshot as its argument (signals unwrapped to their current values, read-only), making signal-based conditions straightforward:

```tsx
// Only re-render when score crosses the 100 threshold
const store = useGameContext({
  renderOn: ['score'],
  filter: (store) => store.score > 100,
});

// Combine with timing — debounced and gated
const store = useGameContext({
  renderOn: ['score'],
  debounce: 200,
  filter: (store) => store.score % 10 === 0,
});
```

---

### `useRefSignalMemo<T>(factory, deps)`

Creates a derived signal whose value is computed by `factory` and kept in sync with `deps`.

```tsx
const count = useRefSignal(1);
const [multiplier, setMultiplier] = useState(2);

const result = useRefSignalMemo(
  () => count.current * multiplier,
  [count, multiplier],
);
```

- Signal deps trigger `factory()` via direct subscription — no React re-render needed.
- Non-signal deps trigger a React re-render → `factory` is called exactly once via `useMemo`.
- The returned signal can be subscribed to like any other signal.

---

### `batch(callback, deps?)`

Defers all signal notifications until `callback` completes. All batched signals receive the same `lastUpdated` timestamp.

**Auto-inference** (recommended) — tracks signals updated via `.update()` automatically:

```ts
batch(() => {
  positionX.update(10);
  positionY.update(20);
});
// listeners for positionX and positionY each called once, after the batch
```

**Explicit deps** — required when mutating `.current` directly or calling `.notify()` manually:

```ts
batch(() => {
  positionX.current = 10;
  positionY.current = 20;
}, [positionX, positionY]);
```

Batches are nestable. If the callback throws, the batch still flushes via `finally`.

---

### `createRefSignalContext<TName, TStore>(name, factory)`

Eliminates the `createContext` / Provider / `useContext` boilerplate for signal stores. Generates a typed Provider and hook pair with opt-in re-renders and value unwrapping. Components that do not pass `renderOn` never re-render on signal updates.

```ts
import { createRefSignalContext, createRefSignal } from 'react-refsignal';

const { UserProvider, useUserContext } = createRefSignalContext('User', () => ({
  name: createRefSignal('Alice'),
  score: createRefSignal(0),
  sessionId: 'abc123', // non-signal — passthrough, excluded from renderOn
}));
```

**`renderOn`** — controls which signal updates trigger a re-render:

```tsx
// No re-renders — read signals imperatively (game loops, rAF callbacks)
const store = useUserContext();
store.name.current; // 'Alice'

// Re-render when name changes
const store = useUserContext({ renderOn: ['name'] });

// Re-render when any signal changes
import { ALL } from 'react-refsignal';
const store = useUserContext({ renderOn: ALL });
// equivalent: useUserContext({ renderOn: 'all' })
```

Passing a non-signal key in `renderOn` is a TypeScript error.

**Timing options** — all timing fields from `RenderOptions` are accepted alongside `renderOn` and `unwrap`. `filter` is upgraded to receive the store snapshot directly (see [`ContextHookOptions`](#contexthookoptionststore)):

```tsx
// Re-render at most once per 100ms when score changes
const store = useUserContext({ renderOn: ['score'], throttle: 100 });

// Re-render on the next animation frame when any signal changes
const store = useUserContext({ renderOn: ALL, rAF: true });

// Re-render only when score exceeds 100 — store snapshot passed in, no closure needed
const store = useUserContext({
  renderOn: ['score'],
  filter: (store) => store.score > 100,
});
```

**`unwrap`** — returns plain values instead of signals, with auto-generated setters:

```tsx
const { name, setName, score, setScore, sessionId } = useUserContext({
  renderOn: ['name', 'score'],
  unwrap: true,
});
// name: string, setName: (value: string) => void
// score: number, setScore: (value: number) => void
// sessionId: string (passthrough)
```

> **Warning:** `unwrap: true` without `renderOn` snapshots `.current` values at mount and never refreshes them. The component reads stale values silently. Always combine `unwrap: true` with a `renderOn` list when the unwrapped values are used in JSX.

---

### `createRefSignalContextHook<TStore>(name)`

Creates a React context object and a fully reactive hook **without generating a Provider component**. Use this when you need to write your own Provider body — custom effects, typed props, external subscriptions, or any other logic that belongs in the Provider.

The returned hook accepts the same [`ContextHookOptions`](#contexthookoptionststore) as the hook from `createRefSignalContext` — including `renderOn`, `unwrap`, timing options, and a store-aware `filter`.

```tsx
import {
  createRefSignalContextHook,
  createRefSignal,
} from 'react-refsignal';
import { useMemo, useEffect, type ReactNode } from 'react';

type UserStore = {
  name: ReturnType<typeof createRefSignal<string>>;
  score: ReturnType<typeof createRefSignal<number>>;
};

const [UserContext, useUserContext] =
  createRefSignalContextHook<UserStore>('User');

// Write your own Provider — plain React, no new rules
function UserProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const store = useMemo(
    () => ({ name: createRefSignal('Alice'), score: createRefSignal(0) }),
    [],
  );

  useEffect(() => {
    fetchUser(userId).then(u => { store.name.current = u.name; });
  }, [userId]);

  return <UserContext.Provider value={store}>{children}</UserContext.Provider>;
}

// In a component — identical usage to createRefSignalContext
const { name, setName } = useUserContext({ renderOn: ['name'], unwrap: true });
```

`createRefSignalContextHook` returns a **tuple** so you can name both values freely:

```ts
const [UserContext, useUserContext] = createRefSignalContextHook<UserStore>('User');
const [CartContext, useCartContext] = createRefSignalContextHook<CartStore>('Cart');
```

Use `createRefSignalContext` when no custom Provider logic is needed — it is the simpler, preferred option for that case. For extended examples — typed props, async data loading, and external subscriptions — see [Custom Providers](patterns.md#custom-providers-with-createrefsignalcontexthook).

---

### `ALL`

Exported constant equivalent to `'all'`. Use instead of the string literal for better TypeScript inference:

```ts
import { ALL } from 'react-refsignal';

const store = useUserContext({ renderOn: ALL });
```

---

### DevTools

DevTools track every signal update — recording old value, new value, and timestamp — and can surface them in the Redux DevTools Extension for time-travel debugging. Enabled by default in development (`NODE_ENV !== 'production'`).

Call `configureDevTools` before creating any signals to ensure full coverage.

```ts
import { configureDevTools } from 'react-refsignal';

configureDevTools({
  enabled: true,       // default: true in development
  logUpdates: true,    // log every update to console
  reduxDevTools: true, // integrate with Redux DevTools Extension
  maxHistory: 100,     // max entries in update history (default: 100)
});
```

**Named signals** — pass a debug name to `createRefSignal` or `useRefSignal`:

```ts
const count = useRefSignal(0, 'userCount');
count.getDebugName?.(); // 'userCount'
```

**Runtime inspection:**

```ts
import { devtools } from 'react-refsignal';

devtools.getUpdateHistory(); // SignalUpdate[] — { signalId, oldValue, newValue, timestamp }
devtools.clearHistory();
devtools.getSignalByName('userCount'); // RefSignal | undefined
devtools.getAllSignals();              // Array<{ name: string; signal: RefSignal }>
```
