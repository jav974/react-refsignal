# Concepts

← [Back to README](../README.md) · [API Reference](api.md) · [Patterns](patterns.md) · [Imperative renderers](imperative-renderers.md) · [Pulse](pulse.md) · [Broadcast](broadcast.md)

---

- [Signals are mutable refs with subscriptions](#signals-are-mutable-refs-with-subscriptions)
- [`useRefSignal` vs `createRefSignal`](#userefsignal-vs-createrefsignal)
- [`useRefSignalEffect` vs `useRefSignalRender`](#userefsignaleffect-vs-userefsignalrender)
- [Three write paths — `update`, `notifyUpdate`, `notify`](#three-write-paths--update-notifyupdate-notify)
- [Pulse signals — clocks with tick-context metadata](#pulse-signals--clocks-with-tick-context-metadata)
- [Signal lifetime](#signal-lifetime)

---

## Signals are mutable refs with subscriptions

A `RefSignal<T>` holds a value in `.current` and adds `.update()`, `.reset()`, `.subscribe()`, `.notify()`, and `.notifyUpdate()`. Calling `.update(value)` sets `.current`, bumps an internal `lastUpdated` counter, and notifies all subscribers. Calling `.reset()` restores `.current` to the signal's initial value via `.update()`. Direct mutation of `.current` is allowed but requires a manual `notify()` or `notifyUpdate()` call.

An optional `interceptor` function can be provided at creation time. It runs on every `.update()` call — including `reset()` — and can transform the incoming value or cancel the update entirely by returning `CANCEL`.

---

## `useRefSignal` vs `createRefSignal`

`useRefSignal(initialValue)` creates a signal inside a React component — the signal is stable for the component's lifetime. `createRefSignal(initialValue)` creates a signal anywhere: module scope, context factories, event handlers. Both are equivalent; `useRefSignal` is a convenience wrapper.

---

## `useRefSignalEffect` vs `useRefSignalRender`

Two ways to react to signal changes, with different guarantees:

| | `useRefSignalEffect` | `useRefSignalRender` |
|---|---|---|
| Purpose | Run a side effect | Trigger a React re-render |
| Runs on mount | Yes | No |
| Tearing-safe in renders | N/A — runs after commit, not during render | Yes (`useSyncExternalStore`) |
| Cleanup model | On unmount / deps change (same as `useEffect`) — no per-fire teardown, so 60 FPS consumers don't pay setup cost per frame | On unmount / deps change |

Use `useRefSignalEffect` for imperative work (canvas draws, audio, logging). Use `useRefSignalRender` when JSX needs to reflect the signal's value.

---

## Three write paths — `update`, `notifyUpdate`, `notify`

Three distinct jobs, picked by what you did to `.current`:

- **`update(value)`** — replacement updates. Runs the interceptor (if any) and the equality check, sets `.current`, bumps `lastUpdated`, fires subscribers. Default choice.
- **`notifyUpdate()`** — you mutated `.current` directly (deep object, large array, hot-path patch). Bumps `lastUpdated`, fires subscribers. The node-editor pattern: one signal per node, mutate position in place, fire.
- **`notify()`** — fire effects **without** triggering renders. Use when the signal drives an imperative consumer (canvas, audio) and no component renders from it. `useRefSignalRender` watches `lastUpdated` via `useSyncExternalStore`, so it will not pick this up — that's the point.

`reset()` is sugar for `update(initialValue)` — same code path, same notifications, no-op if already at initial value.

**Pick by what you did to `.current`, not by frequency.** Assigned a new value → `update`. Mutated in place and components render from it → `notifyUpdate`. Mutated in place and only effects consume it → `notify`.

---

## Pulse signals — clocks with tick-context metadata

A [`PulseRefSignal`](pulse.md) is a self-firing read-only signal: `.current` advances to `performance.now()` on a schedule, subscribers fire each tick, the timer is lazy (runs only while at least one subscriber is attached). Conceptually it's a clock primitive — closer to `createComputedRefSignal` than to `RefSignal`, with time playing the role of a dependency.

It also exposes `dt`, `tick`, and `elapsed` alongside `.current`. These look like parallel reactive state but they aren't: you don't `watch(loop.dt, …)`. Read them as **tick-context metadata** — values coherent with `.current` *at the moment subscribers fire*, like `event.timeStamp` inside a DOM event handler. The reactive surface is still `.current`; the metadata rides along for game/sim code that wants `dt` without writing the bookkeeping.

---

## Signal lifetime

Listeners are stored in a `WeakMap` keyed on the signal object. When no reference to the signal exists, the entry is collected automatically. Each subscriber is responsible for its own cleanup — `useRefSignalEffect` and `useRefSignalRender` handle this on unmount.
