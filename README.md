# react-refsignal

[![CI](https://github.com/jav974/react-refsignal/actions/workflows/ci.yml/badge.svg)](https://github.com/jav974/react-refsignal/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jav974/react-refsignal/graph/badge.svg?token=32TYI353M2)](https://codecov.io/gh/jav974/react-refsignal)
![React >=18.0.0](https://img.shields.io/badge/react-%3E%3D18.0.0-blue)
[![npm version](https://img.shields.io/npm/v/react-refsignal.svg)](https://www.npmjs.com/package/react-refsignal)
[![npm downloads](https://img.shields.io/npm/dt/react-refsignal.svg)](https://www.npmjs.com/package/react-refsignal)
[![bundlephobia](https://badgen.net/bundlephobia/minzip/react-refsignal)](https://bundlephobia.com/result?p=react-refsignal)
[![MIT License](https://img.shields.io/github/license/jav974/react-refsignal.svg)](LICENSE)

Mutable signal-like refs for React where every consumer dictates its own subscription contract — *what* to observe, *when* to react, *whether* to trigger a re-render — independently, per call site.

The same signal can drive a 60 FPS canvas in one place, a throttled HUD label elsewhere, and a normal React component watching a derived boolean — at the same time, with no coordination between them.

Built for UIs where React's render cycle is the bottleneck: **node editors (n8n-class), real-time simulations, drag-heavy canvases**. Scales down cleanly to ordinary state.

> **[Live demo →](https://stackblitz.com/edit/vitejs-vite-jurlgxkf?file=index.html)** — drag the nodes; sixty FPS, zero React re-renders.

## Why

Most React state libraries are *producer-driven*: the store decides when consumers are notified, and selectors, equality functions, or observer wrappers narrow it from there. The producer dictates the contract.

refsignal inverts that. The signal is just a value with a channel. **Each consumer, at its call site, decides three things independently:**

- **What** to observe — the whole signal, a projection, a derived value
- **When** to react — synchronous, throttled, debounced, `rAF`, or a custom `filter`
- **Whether** to render — pure side-effect, or opt into a React re-render

Take a draggable node in a canvas editor. Its position updates sixty times a second. One consumer redraws the connecting curve every frame (`rAF`-paced, no render). Another updates a HUD label, throttled to 100 ms (no render). A third logs to analytics every second. A fourth is a React component watching a derived `isOnscreen` boolean — re-renders only when that flips. **Same signal, four contracts, no coordination.**

Producers can be time-driven too: a pulse signal ticks on a schedule (`'1000ms'`, `'60fps'`, `'raf'`) and slots into the same model — one shared timer per cadence, lazily started, with each consumer rate-limiting on top.

That model is why refsignal holds 60 FPS where a conventional store crawls below 1 FPS in a dense node-editor benchmark: high-frequency consumers don't pay for the render policy of low-frequency ones. Reconciliation isn't on the path unless a consumer explicitly opts in. Outside high-frequency scenarios the same model scales down — components opt into re-renders explicitly via `useRefSignalRender([signal])`, and nothing renders elsewhere.

`useRef` gets you out of the render cycle, but a ref is silent — nothing can subscribe. Build the subscription channel yourself and you're writing this library from scratch. refsignal is that primitive: **a ref with a per-consumer subscription channel**, built on stable, public React APIs (`useSyncExternalStore` for renders, direct listeners for effects). No compiler, no proxy, no patched internals.

## Installation

```sh
npm install react-refsignal
```

Requires React ≥ 18.0.0.

## Quick Start

The model shines when you want updates _without_ re-renders — like driving a canvas from a game loop. A pulse signal ticks every frame; the canvas redraws on each tick; React's render cycle is never involved.

```tsx
import { useRef } from 'react';
import { usePulseRefSignal, useRefSignalEffect } from 'react-refsignal';

function GameCanvas() {
  const loop = usePulseRefSignal('raf');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useRefSignalEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 800, 600);
    ctx.fillRect(loop.tick, 0, 20, 20);
  }, [loop]);

  return <canvas ref={canvasRef} width={800} height={600} />;
}
```

The same model scales down to ordinary state — opt into a re-render exactly where you want one:

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

The producer can also be a clock — pulse signals tick on a schedule and slot into the same graph:

```tsx
import { createPulseRefSignal, useRefSignalRender } from 'react-refsignal';

// Module scope: one timer for the whole app, lazily started by the first reader.
const now = createPulseRefSignal('60000ms'); // every minute

function RelativeTime({ at }: { at: number }) {
  useRefSignalRender([now]);
  return <time>{formatAgo(at, now.current)}</time>;
}
```

Mount fifty `<RelativeTime />` cells; you get fifty subscribers on one `setInterval`. Unmount them all and the timer stops. The timer never installs at all if no consumer subscribes.

## Per-consumer subscription

Every consumer of a signal picks its own **what / when / whether** at the call site. The signal doesn't know — and doesn't care — what its consumers do.

Same `position` signal, four contracts, no coordination between them:

```tsx
const position = useRefSignal({ x: 0, y: 0 });

// 1. Redraw a curve every frame — no React render
useRefSignalEffect(() => {
  drawCurve(canvasRef.current, position.current);
}, [position], { rAF: true });

// 2. Update a HUD label, throttled to 100 ms — no React render
useRefSignalEffect(() => {
  hudRef.current!.textContent = `${position.current.x}, ${position.current.y}`;
}, [position], { throttle: 100 });

// 3. Log to analytics, debounced to fire on idle — no React render
useRefSignalEffect(() => {
  analytics.track('position', position.current);
}, [position], { debounce: 1000 });

// 4. A derived boolean — re-render only when it flips
const isOnscreen = useRefSignalMemo(
  () => position.current.x >= 0 && position.current.x < viewportWidth,
  [position],
);
useRefSignalRender([isOnscreen]);
```

Adding or removing any one of these doesn't affect the others. Reconciliation is on the path only for consumer #4 — and only when the boolean actually flips.

Every hook that subscribes (`useRefSignalEffect`, `useRefSignalRender`, `useRefSignalMemo`, and the framework-agnostic `watch()`) accepts the same options: `throttle`, `debounce`, `rAF`, `filter`, `maxWait`. The producer never participates in the timing decision.

## Docs

Organized by intent, not by API surface.

**Start here**
- **[Decision Tree](docs/decision-tree.md)** — pick the right API for any scenario (signal creation, derived values, persistence, broadcast, context, batching). Doubles as a generation reference for AI tools.

**Foundations**
- [Concepts](docs/concepts.md) — `RefSignal` vs `ReadonlyRefSignal` vs `ComputedSignal`, `notify()` vs `notifyUpdate()`, effect vs render, signal lifetime.
- [API Reference](docs/api.md) — every hook and function with examples.

**Building with it**
- [Pulse](docs/pulse.md) — time-driven signals: clocks, frame loops, "X ago" timestamps, adaptive cadences via `updatePulse`.
- [Patterns](docs/patterns.md) — draggable graphs, signal stores, collections, batching, high-frequency consumers, filtered renders, the sibling-leaf pattern, cross-tab notification badges.
- [Imperative renderers](docs/imperative-renderers.md) — Canvas / Pixi / WebGL / audio driven by signals, bypassing React reconciliation.
- [Persist](docs/persist.md) — persist signals across page loads (`localStorage`, `sessionStorage`, IndexedDB, custom adapters).
- [Cross-tab Broadcast](docs/broadcast.md) — sync signals across tabs.
- [Benchmark](docs/benchmark.md) — the methodology behind the 60-FPS numbers.

## Built for AI-assisted coding

The `docs/` folder ships inside the npm package — installed at `node_modules/react-refsignal/docs/`. Cursor, Claude Code, and other LLM-backed editors read it directly, no GitHub fetch required.

The [Decision Tree](docs/decision-tree.md) is intentionally written as a generation reference: when an AI assistant asks "which API fits here?", it has a deterministic answer instead of guessing between `useRefSignal`, `useRefSignalEffect`, `useRefSignalRender`, `useRefSignalMemo`, and a store. Fewer wrong-shape suggestions, fewer stray re-renders.

## Concepts

| Concept | Summary |
|---|---|
| `RefSignal<T>` | A mutable ref with `.update()`, `.reset()`, `.subscribe()`, a `lastUpdated` counter, and an optional `interceptor` |
| `useRefSignal` vs `createRefSignal` | Inside a component vs anywhere else — both produce the same signal |
| `useRefSignalEffect` vs `useRefSignalRender` | Imperative side effects vs triggering React re-renders |
| `notify()` vs `notifyUpdate()` | Fire subscribers without or with bumping `lastUpdated` |
| `createComputedRefSignal` / `useRefSignalMemo` | Derived signals — recompute whenever deps change; module-scope or component-scoped |
| `watch(signal, listener, options?)` | Subscribe outside React and get a cleanup function back — mirrors `useEffect` return pattern; accepts the same `filter` and timing options as the hooks |
| `EffectOptions` | Gate and rate-limit re-renders and effects via `filter`, `throttle`, `debounce`, `maxWait`, or `rAF` |
| `createPulseRefSignal` / `usePulseRefSignal` | A signal that ticks on a schedule — `'1000ms'`, `'60fps'`, `'raf'`. Lazy: the timer runs only while subscribed. Carries `dt`, `tick`, `elapsed` metadata |
| `updatePulse(rate)` | Change a pulse signal's cadence reactively — drive it from another signal for adaptive heartbeats, backoff, perf-budgeted frames |
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

react-refsignal is the only entry that can subscribe to a value via a stable React API and not re-render at all. It's also the only entry where each consumer picks its own subscription rate — synchronous, `throttle`, `debounce`, `rAF`, or a custom `filter` — at the call site, independently of the producer.

**The closest alternative is @preact/signals-react.** Both libraries let you update values outside React's render cycle and subscribe to those updates. The difference is how:

@preact/signals-react patches React internals to make signal-driven DOM updates bypass the diffing algorithm entirely — components can update without React knowing. This is powerful but relies on undocumented React APIs that can break across React versions.

react-refsignal uses only stable, public React APIs: `useSyncExternalStore` for render-triggered subscriptions and direct listener callbacks for side effects. Opting into a re-render is explicit — you call `useRefSignalRender` or `useRefSignalEffect`, React handles the rest normally. There is no patching, no magic, no special compiler. The tradeoff is that automatic DOM diffing bypass is not possible — but in most real-world high-frequency scenarios (canvas, WebGL, audio), you are already doing imperative work outside the DOM anyway, which is exactly what `useRefSignalEffect` is designed for.

If you want fully automatic signal-to-DOM binding with zero boilerplate, @preact/signals-react is worth considering. If you want an explicit, composable model that stays within React's contract, react-refsignal is the right fit.

## License

MIT
