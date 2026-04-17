# Concepts

← [Back to README](../README.md) · [API Reference](api.md) · [Patterns](patterns.md) · [Imperative renderers](imperative-renderers.md) · [Broadcast](broadcast.md)

---

- [Signals are mutable refs with subscriptions](#signals-are-mutable-refs-with-subscriptions)
- [`useRefSignal` vs `createRefSignal`](#userefsignal-vs-createrefsignal)
- [`useRefSignalEffect` vs `useRefSignalRender`](#userefsignaleffect-vs-userefsignalrender)
- [`notify()` vs `notifyUpdate()`](#notify-vs-notifyupdate)
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
| Concurrent-safe | No | Yes (`useSyncExternalStore`) |
| Cleanup between fires | No | N/A |

Use `useRefSignalEffect` for imperative work (canvas draws, audio, logging). Use `useRefSignalRender` when JSX needs to reflect the signal's value.

---

## `notify()` vs `notifyUpdate()`

Both fire all subscribers. The difference is whether `lastUpdated` changes:

- **`update(value)`** — runs the interceptor (if any), sets `.current`, bumps `lastUpdated`, fires subscribers.
- **`reset()`** — calls `.update(initialValue)`, so the interceptor runs, `lastUpdated` is bumped, and subscribers are notified. No-op if already at initial value.
- **`notifyUpdate()`** — bumps `lastUpdated`, fires subscribers. Use when mutating `.current` directly.
- **`notify()`** — fires subscribers only. `lastUpdated` is unchanged, so `useRefSignalRender` does **not** re-render. Only `useRefSignalEffect` listeners run.

This distinction matters: `useRefSignalRender` watches `lastUpdated` via `useSyncExternalStore`. If you want to drive a side effect (canvas draw) but never trigger a React re-render, use `notify()`. If you also need components to re-render, use `update()` or `notifyUpdate()`.

---

## Signal lifetime

Listeners are stored in a `WeakMap` keyed on the signal object. When no reference to the signal exists, the entry is collected automatically. Each subscriber is responsible for its own cleanup — `useRefSignalEffect` and `useRefSignalRender` handle this on unmount.
