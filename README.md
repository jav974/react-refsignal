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

Imagine a canvas with a hundred draggable nodes, each connected by curves. The user drags one node — its position changes sixty times a second. Every curve attached to it must follow. The other ninety-nine nodes should be completely unaffected.

React's render cycle is the wrong layer for this. You don't want a re-render — you want a targeted notification: *this value changed, only the things watching it should react*.

`useRef` gets you out of the render cycle, but a ref is silent. Nothing can subscribe to it. You end up building a manual event emitter per node — registration, cleanup, ordering. That's the library you'd be writing from scratch.

`react-refsignal` is that primitive: **a ref with a subscription channel**. When a position signal updates, only its subscribers run — directly, synchronously, with no React scheduler involved. One effect redraws the curve. Another updates a HUD label. Everything else is untouched.

Outside of high-frequency scenarios, the same model scales down cleanly. Components opt into re-renders explicitly — no selector callbacks, no wrapper components, no observability magic. Just `useRefSignalRender([signal])` where you need it and nothing elsewhere.

The API stays within React's public contract: `useSyncExternalStore` for render subscriptions, direct listener callbacks for effects. No compiler, no proxy, no patched internals.

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
- [Imperative renderers](docs/imperative-renderers.md) — Canvas / Pixi / WebGL / audio driven by signals, bypassing React reconciliation
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
| `watch(signal, listener, options?)` | Subscribe outside React and get a cleanup function back — mirrors `useEffect` return pattern; accepts the same `filter` and timing options as the hooks |
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

## How it compares

| Library | Subscribe without re-render | Subscription model | Default reactivity |
|---|---|---|---|
| react-refsignal | Yes — via `useRefSignalEffect` | Direct listeners | Off — opt in via `useRefSignalRender` |
| @preact/signals-react | Yes — patches React internals | Auto-tracked | On — any signal read in render |
| Jotai | No | Atom-based | On — `useAtom` triggers re-renders |
| Zustand | No | Selector-based | Narrowable via selector, but always renders |
| MobX | No | Observable graph | On within `observer()` wrapper |
| Valtio | No | Proxy snapshots | On — proxy auto-tracks |
| Redux | No | Selector-based | Narrowable via selector, but always renders |
| `useRef` (plain React) | N/A | None | No subscription possible |

react-refsignal is the only entry that can subscribe to a value via a stable React API and not re-render at all.

**The closest alternative is @preact/signals-react.** Both libraries let you update values outside React's render cycle and subscribe to those updates. The difference is how:

@preact/signals-react patches React internals to make signal-driven DOM updates bypass the diffing algorithm entirely — components can update without React knowing. This is powerful but relies on undocumented React APIs that can break across React versions.

react-refsignal uses only stable, public React APIs: `useSyncExternalStore` for render-triggered subscriptions and direct listener callbacks for side effects. Opting into a re-render is explicit — you call `useRefSignalRender` or `useRefSignalEffect`, React handles the rest normally. There is no patching, no magic, no special compiler. The tradeoff is that automatic DOM diffing bypass is not possible — but in most real-world high-frequency scenarios (canvas, WebGL, audio), you are already doing imperative work outside the DOM anyway, which is exactly what `useRefSignalEffect` is designed for.

If you want fully automatic signal-to-DOM binding with zero boilerplate, @preact/signals-react is worth considering. If you want an explicit, composable model that stays within React's contract, react-refsignal is the right fit.

## License

MIT
