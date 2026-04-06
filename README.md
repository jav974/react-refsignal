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

## Docs

- [Concepts](docs/concepts.md) — signals, notify vs notifyUpdate, effect vs render, signal lifetime
- [API Reference](docs/api.md) — full API with examples for every hook and function
- [Patterns](docs/patterns.md) — draggable graphs, signal stores, collections, batching, high-frequency consumers, filtered renders
- [Cross-tab Broadcast](docs/broadcast.md) — sync signals across tabs with `react-refsignal/broadcast`
- [Persist](docs/persist.md) — persist signals across page loads with `react-refsignal/persist`
- [Decision Tree](docs/decision-tree.md) — pick the right API for any scenario

## Concepts

| Concept | Summary |
|---|---|
| `RefSignal<T>` | A mutable ref with `.update()`, `.reset()`, `.subscribe()`, a `lastUpdated` counter, and an optional `interceptor` |
| `useRefSignal` vs `createRefSignal` | Inside a component vs anywhere else — both produce the same signal |
| `useRefSignalEffect` vs `useRefSignalRender` | Imperative side effects vs triggering React re-renders |
| `notify()` vs `notifyUpdate()` | Fire subscribers without or with bumping `lastUpdated` |
| `createComputedSignal` / `useRefSignalMemo` | Derived signals — recompute whenever deps change; module-scope or component-scoped |
| `watch(signal, listener)` | Subscribe outside React and get a cleanup function back — mirrors `useEffect` return pattern |
| `EffectOptions` | Gate and rate-limit re-renders and effects via `filter`, `throttle`, `debounce`, `maxWait`, or `rAF` |
| `createRefSignalStore` / `useRefSignalStore` | Provider-free global store — create at module scope, use in any component with `renderOn` opt-in |
| `createRefSignalContext` | Per-subtree store with auto-generated Provider and hook — for isolated state per route or section |
| Signal lifetime | Listeners are in a `WeakMap` — GC'd when the signal has no references |
| Cross-tab broadcast | Sync signals across tabs via `react-refsignal/broadcast` — zero cost if unused |
| Persist | Persist signal values across page loads via `react-refsignal/persist` — `localStorage`, `sessionStorage`, IndexedDB, or custom adapter |

See [Concepts](docs/concepts.md) for the full explanation of each.

## Global stores

`createRefSignalStore` creates a module-scope singleton store — no Provider required. `useRefSignalStore` connects any store to a component with the same `renderOn`, timing, and `unwrap` options as the context hook.

```ts
import { createRefSignalStore, useRefSignalStore, createRefSignal } from 'react-refsignal';

const gameStore = createRefSignalStore(() => ({
  score: createRefSignal(0),
  level: createRefSignal(1),
}));

// Outside React — direct access
gameStore.score.update(42);

// In a component — opt into re-renders explicitly
function ScoreDisplay() {
  const store = useRefSignalStore(gameStore, { renderOn: ['score'] });
  return <div>{store.score.current}</div>;
}

// Unwrapped — plain value + auto-generated setter
function ScoreEditor() {
  const { score, setScore } = useRefSignalStore(gameStore, {
    renderOn: ['score'],
    unwrap: true,
  });
  return <button onClick={() => setScore(score + 1)}>{score}</button>;
}
```

Composes with `persist` and `broadcast` — wrap the factory before passing it in:

```ts
import { persist } from 'react-refsignal/persist';

const gameStore = createRefSignalStore(
  persist(() => ({ score: createRefSignal(0) }), { key: 'game' }),
);
```

Use `createRefSignalContext` instead when you need per-subtree isolation — a separate store instance per Provider mount (different routes, multiple widget instances).

## Persist

Persist signal values across page loads with `react-refsignal/persist`. Importing the subpath is the only activation step — apps that never import it pay zero cost.

```ts
import 'react-refsignal/persist';
import { createRefSignal } from 'react-refsignal';

// Signal-level — survives page reloads via localStorage
const theme = createRefSignal<'light' | 'dark'>('light', {
  persist: { key: 'theme' },
});
```

Store-level, with versioning and IndexedDB:

```ts
import { createRefSignalContext, createRefSignal } from 'react-refsignal';
import { persist } from 'react-refsignal/persist';

const { GameProvider, useGameContext } = createRefSignalContext(
  'Game',
  persist(
    () => ({
      level: createRefSignal(1),
      xp:    createRefSignal(0),
    }),
    {
      key: 'game',
      storage: 'indexeddb',
      dbName: 'myApp',
      version: 2,
      migrate: (stored) => ({ xp: 0, ...stored }),
    },
  ),
);
```

Signals always start with their default values. Hydration from storage is asynchronous — the signal updates once the read resolves, triggering subscribers and re-renders as normal.

Composes with broadcast — wrap one with the other to get both cross-tab sync and persistence:

```ts
broadcast(
  persist(factory, { key: 'game' }),
  { channel: 'game' },
)
```

Rate-limit writes with the same timing options used by `broadcast` and `useRefSignalEffect`:

```ts
persist(factory, { key: 'game', throttle: 200 }); // at most one write per 200ms
persist(factory, { key: 'game', rAF: true });      // one write per animation frame
```

See [Persist](docs/persist.md) for the full reference including `usePersist`, `indexedDBStorage`, custom adapters, migration, and timing options.

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

## License

MIT
