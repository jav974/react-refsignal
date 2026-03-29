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

Some values in a React app change at a pace React was never designed to handle.

Imagine a canvas with a hundred draggable nodes. Each node has connections drawn as curves between them. When the user drags a node, its position changes sixty times a second. Every connection attached to that node needs to follow — redrawing its curve in sync. The other ninety-nine nodes and forty other connections should be completely unaffected.

`useState` is the wrong tool: every position update re-renders the component, which cascades to its children. At sixty updates a second across dozens of connections, the UI grinds to a halt.

`useRef` is closer: mutations don't trigger re-renders. But a ref has no broadcast model. Other components can't subscribe to it. You'd have to build and manage a manual event emitter for each node — subscription registration, cleanup on unmount, firing in the right order. That's the library you'd be writing from scratch.

The gap is a value that:
- lives outside React's render cycle (like a ref)
- can be subscribed to by multiple, independent consumers (unlike a ref)
- triggers only those subscribers — not the whole tree (unlike state)
- lets specific components opt into re-renders when they need them

That's what `react-refsignal` is. A signal is a ref with a subscription channel. When a position signal notifies, only the effects watching it run — directly, synchronously, with no React scheduler involved. One component updates the canvas container position. Another redraws its Bezier curve. A third updates a HUD label. Everything else is untouched.

The API is deliberately close to what you already know: signals behave like refs, subscriptions behave like effects, and rendering uses `useSyncExternalStore`. No compiler, no proxy magic, no patching React internals — just standard React APIs composed differently.

This is not a replacement for `useState`. For values that drive UI directly and change at human speed, `useState` is the right tool. `react-refsignal` is for the cases where React's scheduler is the wrong layer entirely.

## Installation

```sh
npm install react-refsignal
```

Requires React ≥ 18.0.0.

## Quick Start

The simplest use: a signal that drives a re-render.

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

The real power shows when you want updates _without_ re-renders — for example, driving a canvas from a game loop:

```tsx
import { useEffect, useRef } from 'react';
import { useRefSignal, useRefSignalEffect } from 'react-refsignal';

function GameCanvas() {
  const position = useRefSignal({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let id: number;
    const tick = () => {
      position.current.x += 1;
      position.notify(); // fire subscribers — no React re-render
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  useRefSignalEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 800, 600);
    ctx.fillRect(position.current.x, position.current.y, 20, 20);
  }, [position]);

  return <canvas ref={canvasRef} width={800} height={600} />;
}
```

The canvas redraws at every frame via `useRefSignalEffect` — React's render cycle is never involved.

## Concepts

| Concept | Summary |
|---|---|
| `RefSignal<T>` | A mutable ref with `.update()`, `.subscribe()`, and a `lastUpdated` counter |
| `useRefSignal` vs `createRefSignal` | Inside a component vs anywhere else — both produce the same signal |
| `useRefSignalEffect` vs `useRefSignalRender` | Imperative side effects vs triggering React re-renders |
| `notify()` vs `notifyUpdate()` | Fire subscribers without or with bumping `lastUpdated` |
| Signal lifetime | Listeners are in a `WeakMap` — GC'd when the signal has no references |

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

This distinction matters: `useRefSignalRender` watches `lastUpdated` via `useSyncExternalStore`. If you want to drive a side effect (canvas draw) but never trigger a React re-render, use `notify()`. If you also need components to re-render, use `update()` or `notifyUpdate()`.

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
| `notify()` | Fires all subscribers. Does **not** change `lastUpdated`. [See `notify()` vs `notifyUpdate()`](#notify-vs-notifyupdate) |
| `notifyUpdate()` | Bumps `lastUpdated`, then fires all subscribers. [See `notify()` vs `notifyUpdate()`](#notify-vs-notifyupdate) |
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

Eliminates the `createContext` / Provider / `useContext` boilerplate. Generates a typed Provider and hook pair. The generated hook returns the store as-is with no transformation.

Use `createNamedContext` when components do not need to re-render on signal changes. Use [`createRefSignalContext`](#createrefsignalcontexttnametstore-name-factory) when components should selectively re-render.

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

Use `createRefSignalContext` when different components need to re-render on different signals from the same store. Use [`createNamedContext`](#createnamedcontexttnametstore-name-factory) for stores where no component ever needs to re-render.

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

> **Warning:** `unwrap: true` without `renderOn` snapshots `.current` values at mount and never refreshes them. The component reads stale values silently. Always combine `unwrap: true` with a `renderOn` list when the unwrapped values are used in JSX.

---

### `ALL`

Exported constant equivalent to `'all'`. Use instead of the string literal for better TypeScript inference:

```ts
import { ALL, createRefSignalContext } from 'react-refsignal';

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

---

## Patterns

### Draggable nodes and connections

**[Live demo on StackBlitz](https://stackblitz.com/edit/vitejs-vite-jurlgxkf?file=index.html)**

The scenario from [Why](#why): a graph where dragging a node moves it and updates all attached connections — with zero React re-renders during the drag.

Each node's position lives in a signal. A `Connection` subscribes to exactly its two endpoint signals. Moving node A notifies only the connections attached to A — node B and unrelated connections never know anything happened.

```tsx
import { useRef } from 'react';
import { useRefSignal, useRefSignalEffect } from 'react-refsignal';
import type { RefSignal } from 'react-refsignal';

type Position = { x: number; y: number };

function DraggableNode({ position }: { position: RefSignal<Position> }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Keep DOM in sync with the signal — no re-render
  useRefSignalEffect(() => {
    if (ref.current) {
      ref.current.style.transform =
        `translate(${position.current.x}px, ${position.current.y}px)`;
    }
  }, [position]);

  return (
    <div
      ref={ref}
      style={{ position: 'absolute', width: 80, height: 40, cursor: 'grab' }}
      onPointerDown={() => { dragging.current = true; }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        position.current.x += e.movementX;
        position.current.y += e.movementY;
        position.notifyUpdate(); // notifies subscribers — component does not re-render
      }}
    />
  );
}

function Connection({ from, to }: { from: RefSignal<Position>; to: RefSignal<Position> }) {
  const lineRef = useRef<SVGLineElement>(null);

  // Redraws when either endpoint moves — independently, no React re-render
  useRefSignalEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    el.setAttribute('x1', String(from.current.x));
    el.setAttribute('y1', String(from.current.y));
    el.setAttribute('x2', String(to.current.x));
    el.setAttribute('y2', String(to.current.y));
  }, [from, to]);

  return <line ref={lineRef} stroke="currentColor" strokeWidth={2} />;
}

function Graph() {
  const posA = useRefSignal<Position>({ x: 100, y: 150 });
  const posB = useRefSignal<Position>({ x: 400, y: 150 });
  const posC = useRefSignal<Position>({ x: 250, y: 300 });

  return (
    <div style={{ position: 'relative', width: 600, height: 400 }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <Connection from={posA} to={posB} />
        <Connection from={posB} to={posC} />
        <Connection from={posA} to={posC} />
      </svg>
      <DraggableNode position={posA} />
      <DraggableNode position={posB} />
      <DraggableNode position={posC} />
    </div>
  );
}
```

Drag any node — only the connections attached to it redraw. `Graph` never re-renders. `DraggableNode` never re-renders. The `Connection` effects run directly, synchronously, bypassing React entirely.

---

### Signal store with context

`createRefSignalContext` builds a typed store where each component opts into re-renders only for the signals it uses. Components that don't pass `renderOn` never re-render on signal updates.

```tsx
import { useEffect } from 'react';
import { createRefSignal, createRefSignalContext } from 'react-refsignal';

const { GameProvider, useGameContext } = createRefSignalContext('Game', () => ({
  playerName: createRefSignal('Player 1'),
  score: createRefSignal(0),
  lives: createRefSignal(3),
  isPaused: createRefSignal(false),
}));

function App() {
  return (
    <GameProvider>
      <HUD />
      <GameCanvas />
      <PauseMenu />
    </GameProvider>
  );
}

// Re-renders only when score or lives change
function HUD() {
  const { score, lives } = useGameContext({ renderOn: ['score', 'lives'], unwrap: true });
  return (
    <div>
      <span>Score: {score}</span>
      <span>Lives: {lives}</span>
    </div>
  );
}

// Never re-renders — reads signals imperatively in a loop
function GameCanvas() {
  const store = useGameContext(); // no renderOn

  useEffect(() => {
    let id: number;
    const tick = () => {
      if (!store.isPaused.current) {
        store.score.update(store.score.current + 1);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [store]);

  return <canvas />;
}

// Re-renders only when isPaused changes
function PauseMenu() {
  const { isPaused, setIsPaused } = useGameContext({ renderOn: ['isPaused'], unwrap: true });
  if (!isPaused) return null;
  return <button onClick={() => setIsPaused(false)}>Resume</button>;
}
```

---

### Collections of signals

Each item in a collection can be its own signal. Updating one item re-renders only the component rendering that item — the list component is unaffected.

```tsx
import { createRefSignal, createRefSignalContext, useRefSignalRender, batch } from 'react-refsignal';
import type { RefSignal } from 'react-refsignal';

type Product = { id: number; name: string; price: number };

const { ShopProvider, useShopContext } = createRefSignalContext('Shop', () => ({
  products: createRefSignal<RefSignal<Product>[]>([]),
}));

// Re-renders when the products array changes (item added or removed)
function ProductList() {
  const store = useShopContext({ renderOn: ['products'] });
  return (
    <>
      {store.products.current.map((productSignal) => (
        <ProductItem key={productSignal.current.id} signal={productSignal} />
      ))}
    </>
  );
}

// Re-renders only when this specific product changes — other products are unaffected
function ProductItem({ signal }: { signal: RefSignal<Product> }) {
  useRefSignalRender([signal]);
  return <div>{signal.current.name} — ${signal.current.price}</div>;
}

// Actions — updating one product re-renders only that ProductItem
function useShopActions() {
  const store = useShopContext();

  const addProduct = (product: Product) => {
    store.products.update([...store.products.current, createRefSignal(product)]);
  };

  const updatePrice = (signal: RefSignal<Product>, newPrice: number) => {
    signal.update({ ...signal.current, price: newPrice });
  };

  // Batch update: one notification per signal, fired together after the batch
  const applyDiscount = (signals: RefSignal<Product>[], pct: number) => {
    batch(() => {
      signals.forEach((s) => s.update({ ...s.current, price: s.current.price * (1 - pct) }));
    });
  };

  return { addProduct, updatePrice, applyDiscount };
}
```

---

### Derived signals with `useRefSignalMemo`

Compute a signal's value from other signals or React state. The factory runs exactly once per change regardless of the source.

```tsx
import { useState } from 'react';
import { useRefSignal, useRefSignalMemo, useRefSignalEffect } from 'react-refsignal';

function PriceCalculator() {
  const basePrice = useRefSignal(100);
  const [taxRate, setTaxRate] = useState(0.2);

  // Recomputes when basePrice fires OR when taxRate (React state) changes
  const total = useRefSignalMemo(
    () => basePrice.current * (1 + taxRate),
    [basePrice, taxRate],
  );

  useRefSignalEffect(() => {
    console.log('Total price:', total.current);
  }, [total]);

  return (
    <div>
      <button onClick={() => basePrice.update(basePrice.current + 10)}>
        Increase base price
      </button>
      <button onClick={() => setTaxRate((r) => r + 0.05)}>
        Increase tax rate
      </button>
    </div>
  );
}
```

Derived signals are fully composable:

```tsx
const count = useRefSignal(1);
const doubled = useRefSignalMemo(() => count.current * 2, [count]);
const quadrupled = useRefSignalMemo(() => doubled.current * 2, [doubled]);
```

---

### Batching multiple updates

Use `batch` when multiple signals should notify their subscribers together with a single shared `lastUpdated` timestamp.

**Auto-inference** (recommended) — tracks `.update()` calls automatically:

```ts
import { batch } from 'react-refsignal';

batch(() => {
  playerX.update(10);
  playerY.update(20);
  health.update(80);
});
// Each signal's listeners called exactly once, after the batch
// All three receive the same lastUpdated value
```

**Explicit deps** — required when mutating `.current` directly or calling `.notify()` manually:

```ts
batch(() => {
  playerX.current = 10;
  playerY.current = 20;
}, [playerX, playerY]);
```

> **Important:** In auto-inference mode, only `.update()` calls are tracked. Calls to `.notify()` or `.notifyUpdate()` inside an auto-inference batch fire immediately. Use explicit deps if you need to batch those.

**Nested batches** — the inner batch flushes when it completes; the outer continues accumulating:

```ts
batch(() => {
  playerX.update(10);

  batch(() => {
    playerY.update(20); // flushed here — playerY listeners called with value 20
  });

  playerX.update(30); // overwrites 10; playerX listeners called at outer end with value 30
});
```

**Error safety** — if the callback throws, the batch flushes via `finally` before rethrowing:

```ts
try {
  batch(() => {
    signalA.update(1);
    throw new Error('something went wrong');
  });
} catch (e) {
  // signalA listeners were still called
}
```

## How it compares

| Library | Escapes render cycle | Subscription model | Opt-in required |
|---|---|---|---|
| react-refsignal | Yes — via `useRefSignalEffect` | Yes | Yes — explicit per component |
| @preact/signals-react | Yes — patches React internals | Yes | No — automatic |
| Valtio | No | Proxy-based snapshots | No |
| Zustand | No | Selector-based | Partial |
| MobX | No | Observable / reaction | No — `observer()` wrapper |
| Redux | No | Selector-based | Partial |
| `useRef` (plain React) | Yes | None | N/A |

**The closest alternative is @preact/signals-react.** Both libraries let you update values outside React's render cycle and subscribe to those updates. The difference is how:

@preact/signals-react patches React internals to make signal-driven DOM updates bypass the diffing algorithm entirely — components can update without React knowing. This is powerful but relies on undocumented React APIs that can break across React versions.

react-refsignal uses only stable, public React APIs: `useSyncExternalStore` for render-triggered subscriptions and direct listener callbacks for side effects. Opting into a re-render is explicit — you call `useRefSignalRender` or `useRefSignalEffect`, React handles the rest normally. There is no patching, no magic, no special compiler. The tradeoff is that automatic DOM diffing bypass is not possible — but in most real-world high-frequency scenarios (canvas, WebGL, audio), you are already doing imperative work outside the DOM anyway, which is exactly what `useRefSignalEffect` is designed for.

If you want fully automatic signal-to-DOM binding with zero boilerplate, @preact/signals-react is worth considering. If you want an explicit, composable model that stays within React's contract, react-refsignal is the right fit.

---

## License

MIT
