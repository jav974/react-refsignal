# Concepts

← [Back to README](../README.md) · [API Reference](api.md) · [Patterns](patterns.md)

---

- [Signals are mutable refs with subscriptions](#signals-are-mutable-refs-with-subscriptions)
- [`useRefSignal` vs `createRefSignal`](#userefsignal-vs-createrefsignal)
- [`useRefSignalEffect` vs `useRefSignalRender`](#userefsignaleffect-vs-userefsignalrender)
- [`notify()` vs `notifyUpdate()`](#notify-vs-notifyupdate)
- [Signal lifetime](#signal-lifetime)

---

## Signals are mutable refs with subscriptions

A `RefSignal<T>` holds a value in `.current` and adds `.update()`, `.subscribe()`, `.notify()`, and `.notifyUpdate()`. Calling `.update(value)` sets `.current`, bumps an internal `lastUpdated` counter, and notifies all subscribers. Direct mutation of `.current` is allowed but requires a manual `notify()` or `notifyUpdate()` call.

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

- **`update(value)`** — sets `.current`, bumps `lastUpdated`, fires subscribers.
- **`notifyUpdate()`** — bumps `lastUpdated`, fires subscribers. Use when mutating `.current` directly.
- **`notify()`** — fires subscribers only. `lastUpdated` is unchanged, so `useRefSignalRender` does **not** re-render. Only `useRefSignalEffect` listeners run.

This distinction matters: `useRefSignalRender` watches `lastUpdated` via `useSyncExternalStore`. If you want to drive a side effect (canvas draw) but never trigger a React re-render, use `notify()`. If you also need components to re-render, use `update()` or `notifyUpdate()`.

---

## Signal lifetime

Listeners are stored in a `WeakMap` keyed on the signal object. When no reference to the signal exists, the entry is collected automatically. Each subscriber is responsible for its own cleanup — `useRefSignalEffect` and `useRefSignalRender` handle this on unmount.
