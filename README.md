# react-refsignal

[![CI](https://github.com/jav974/react-refsignal/actions/workflows/ci.yml/badge.svg)](https://github.com/jav974/react-refsignal/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jav974/react-refsignal/graph/badge.svg?token=32TYI353M2)](https://codecov.io/gh/jav974/react-refsignal)
![React >=18.0.0](https://img.shields.io/badge/react-%3E%3D18.0.0-blue)
[![npm version](https://img.shields.io/npm/v/react-refsignal.svg)](https://www.npmjs.com/package/react-refsignal)
[![npm downloads](https://img.shields.io/npm/dt/react-refsignal.svg)](https://www.npmjs.com/package/react-refsignal)
[![bundlephobia](https://badgen.net/bundlephobia/minzip/react-refsignal)](https://bundlephobia.com/result?p=react-refsignal)
[![MIT License](https://img.shields.io/github/license/jav974/react-refsignal.svg)](LICENSE)

Mutable signal-like refs for React — update values without re-rendering, subscribe to changes, and opt into re-renders exactly where you need them.

## Why

`useState` re-renders the component on every update. For high-frequency scenarios — game loops, canvas animation, WebSocket streams, PixiJS — this is too slow.

`react-refsignal` stores values in mutable refs with subscription support. Updating a signal never triggers a re-render by itself. Components read `.current` directly and opt into re-renders only where they need to reflect signal values in JSX.

## Installation

```sh
npm install react-refsignal
```

Requires React ≥ 18.0.0.

## Quick Start

```tsx
import { useRefSignal, useRefSignalRender } from 'react-refsignal';

function Counter() {
  const count = useRefSignal(0);

  // This component re-renders when count updates
  useRefSignalRender([count]);

  return (
    <button onClick={() => count.update(count.current + 1)}>
      {count.current}
    </button>
  );
}
```

Without `useRefSignalRender`, `count.update()` updates the value and notifies subscribers — but the component never re-renders. That is the point: renders are opt-in.

## Concepts

### Signals are mutable refs with subscriptions

A `RefSignal<T>` holds a value in `.current` and adds `.update()`, `.subscribe()`, `.notify()`, and `.notifyUpdate()`. Calling `.update(value)` sets `.current`, bumps an internal `lastUpdated` counter, and notifies all subscribers. Direct mutation of `.current` is allowed but requires a manual `notify()` or `notifyUpdate()` call.

### `useRefSignal` vs `createRefSignal`

`useRefSignal(initialValue)` creates a signal inside a React component — the signal is stable for the component's lifetime. `createRefSignal(initialValue)` creates a signal anywhere: module scope, context factories, event handlers. Both are equivalent; `useRefSignal` is a convenience wrapper.

### `useRefSignalEffect` vs `useRefSignalRender`

Two ways to react to signal changes, with different guarantees:

| | `useRefSignalEffect` | `useRefSignalRender` |
|---|---|---|
| Purpose | Run a side effect | Trigger a React re-render |
| Runs on mount | Yes | No |
| Concurrent-safe | No | Yes (`useSyncExternalStore`) |
| Cleanup between fires | No | N/A |

Use `useRefSignalEffect` for imperative work (canvas draws, audio, logging). Use `useRefSignalRender` when JSX needs to reflect the signal's value.

### `notify()` vs `notifyUpdate()`

Both fire all subscribers. The difference is whether `lastUpdated` changes:

- **`update(value)`** — sets `.current`, bumps `lastUpdated`, fires subscribers.
- **`notifyUpdate()`** — bumps `lastUpdated`, fires subscribers. Use when mutating `.current` directly.
- **`notify()`** — fires subscribers only. `lastUpdated` is unchanged, so `useRefSignalRender` does **not** re-render. Only `useRefSignalEffect` listeners run.

### Signal lifetime

Listeners are stored in a `WeakMap` keyed on the signal object. When no reference to the signal exists, the entry is collected automatically. Each subscriber is responsible for its own cleanup — `useRefSignalEffect` and `useRefSignalRender` handle this on unmount.

---

## API Reference

### `RefSignal<T>`

The core interface implemented by all signal objects.

| Member | Description |
|---|---|
| `current: T` | The current value. Mutable directly; prefer `.update()` to notify subscribers. |
| `lastUpdated: number` | Monotonic counter. Starts at `0`, incremented by `update()` and `notifyUpdate()`. |
| `update(value)` | Sets `current`, bumps `lastUpdated`, notifies subscribers. No-op if value is strictly equal. |
| `notify()` | Fires all subscribers. Does **not** change `lastUpdated`. |
| `notifyUpdate()` | Bumps `lastUpdated`, then fires all subscribers. |
| `subscribe(listener)` | Registers a listener called with the current value on every notification. |
| `unsubscribe(listener)` | Removes a previously registered listener. |
| `getDebugName?()` | Returns the signal's debug name. Only present when DevTools are enabled. |

---

### `createRefSignal<T>(initialValue, debugName?)`

Creates a signal outside of React. Use at module scope or inside context factories.

```ts
import { createRefSignal } from 'react-refsignal';

const position = createRefSignal({ x: 0, y: 0 });
position.update({ x: 10, y: 20 });
```

`lastUpdated` starts at `0` and is only incremented by `update()` or `notifyUpdate()`.

---

### `useRefSignal<T>(initialValue, debugName?)`

Creates a signal inside a React component. The signal is created once on mount and is stable across re-renders. The initial value is used only at creation — subsequent re-renders do not update it.

```tsx
const count = useRefSignal(0);
const count = useRefSignal(0, 'userCount'); // with debug name
```

---

### `isRefSignal(obj)`

Type guard. Returns `true` if `obj` has the shape of a `RefSignal`. Validates structure only — does not validate the type of `.current` at runtime.

```ts
import { isRefSignal } from 'react-refsignal';

if (isRefSignal(dep)) dep.subscribe(listener);
```

---

### `useRefSignalEffect(effect, deps)`

Runs `effect` on mount and whenever any `RefSignal` in `deps` fires. Non-signal values in `deps` follow standard `useEffect` semantics — the effect resubscribes when they change.

```tsx
useRefSignalEffect(() => {
  document.title = `Count: ${count.current}`;
}, [count]);
```

**Key behaviors:**
- Runs immediately on mount.
- If `effect` returns a cleanup function, it runs on **unmount or deps change only** — not between signal fires.
- Re-entrancy is allowed: the effect may call `.update()` on a signal in `deps`.
- Accepts mixed deps: signal deps subscribe directly, non-signal deps resubscribe via React's `useEffect`.

---

### `useRefSignalRender(deps, callback?)`

Subscribes to signals and re-renders the component when any update via `.update()` or `.notifyUpdate()`. Built on `useSyncExternalStore` — concurrent-safe and tear-free.

```tsx
const score = useRefSignal(0);
useRefSignalRender([score]);

return <div>Score: {score.current}</div>;
```

**`callback` filter** — re-renders only when the callback returns `true`:

```tsx
useRefSignalRender([count], () => count.current % 10 === 0);
```

**Returns** a `forceUpdate` function that unconditionally re-renders, bypassing the `callback` filter:

```tsx
const forceUpdate = useRefSignalRender([]);
forceUpdate();
```

> **Note:** `notify()` alone does **not** trigger a re-render. `useRefSignalRender` watches `lastUpdated`, which only changes via `update()` and `notifyUpdate()`.

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

### `createNamedContext<TName, TStore>(name, factory)`

Eliminates the `createContext` / Provider / `useContext` boilerplate. Generates a typed Provider and hook pair.

```ts
import { createNamedContext, createRefSignal } from 'react-refsignal';

const { CounterProvider, useCounterContext } = createNamedContext(
  'Counter',
  () => ({ count: createRefSignal(0) }),
);
```

- `${name}Provider` — mounts the context; calls `factory` once per mount.
- `use${name}Context()` — retrieves the store; throws if used outside the Provider.

---

### `createRefSignalContext<TName, TStore>(name, factory)`

Like `createNamedContext`, but the generated hook supports opt-in re-renders and value unwrapping. Components that do not pass `renderOn` never re-render on signal updates.

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

---

### DevTools

DevTools are enabled by default in development (`NODE_ENV !== 'production'`). Call `configureDevTools` before creating any signals to ensure full coverage.

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

---

## Patterns

See [docs/patterns.md](docs/patterns.md) for complete real-world examples:

- [High-frequency updates — game loops and canvas](docs/patterns.md#high-frequency-updates--game-loops-and-canvas)
- [Signal store with context](docs/patterns.md#signal-store-with-context)
- [Collections of signals](docs/patterns.md#collections-of-signals)
- [Derived signals with useRefSignalMemo](docs/patterns.md#derived-signals-with-userefignalmemo)
- [Batching multiple updates](docs/patterns.md#batching-multiple-updates)

## License

MIT
