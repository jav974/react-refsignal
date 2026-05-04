# AI agent guide

This file is for AI coding tools (Claude Code, Cursor, Windsurf, Copilot, GitHub Models, etc.) generating code that uses `react-refsignal`. Human contributors: see [README.md](README.md) and [docs/](docs/).

## Read first

When generating code with this library, consult these docs in order:

1. **[docs/decision-tree.md](docs/decision-tree.md)** — flowcharts for picking the right API: signal creation, derived values, batching, context, persistence, cross-tab broadcast. **The library is designed around explicit choices; the decision tree encodes them.**
2. **[docs/patterns.md](docs/patterns.md)** — full worked examples for non-trivial compositions, including:
   - The sibling-leaf pattern for data hooks (RTK Query / SWR / Apollo / TanStack Query) inside a Provider.
   - The cross-tab notification badge recipe (`broadcast` + `persist` + leader-only fetcher).
3. **[docs/api.md](docs/api.md)** — the full type reference. Cross-references back to the decision tree.

## Doc freshness

The `docs/` folder bundled in this package is a snapshot from the publish point of `react-refsignal@<version>` (see `package.json`). It is authoritative for the installed version — examples and APIs match exactly.

For docs added or revised between releases, the canonical location is **https://github.com/jav974/react-refsignal/tree/main/docs**. Consult it only when:

- The local docs don't cover a feature the user is asking about (it may have been added since release).
- A pattern or recipe seems incomplete or out of date.
- The user explicitly references a doc not present locally.

For everything else, prefer the local copy — it matches the installed types exactly.

## Contract worth knowing

- **`RefSignal<T>`** — read + write. The universal contract; use as a function parameter type when you need to read and write. `createRefSignal` returns `RefSignal<T> & { dispose: () => void }` (you own the cleanup); `useRefSignal` returns plain `RefSignal<T>` (React owns it).
- **`ReadonlyRefSignal<T>`** — read-only view. Returned by `useRefSignalMemo` / `useRefSignalFollow`. Supertype of `RefSignal<T>` — accept this as a parameter type when you only read.
- **`createComputedRefSignal`** returns `ReadonlyRefSignal<T> & { dispose: () => void }` (module-scope, you own it). `ReadonlySignal<T>` and `ComputedSignal<T>` exist as deprecated aliases.
- **Ownership rule** — if a signal value's type carries `.dispose()`, you own it. Function parameters take the universal `RefSignal` / `ReadonlyRefSignal` (no dispose) so consumers can't accidentally tear down a signal they don't own.

The lib favors **explicit re-render opt-in**. Components do not re-render on signal changes unless they call `useRefSignalRender([deps])` or read `unwrap: true` from a context hook with `renderOn`. Never assume a signal `.update()` triggers a render — wire `useRefSignalRender` (or the unwrap form) explicitly.

## When generating Providers

- Construct signals once at the top with `useRefSignal` (stable for component lifetime).
- Group them into a stable store with `useMemo(() => ({ ... }), [])`.
- Never put a re-rendering data hook (RTK Query, SWR, Apollo) directly in the Provider body — it re-renders the host on every poll. Use the **sibling-leaf pattern** documented in `docs/patterns.md`.

## When composing broadcast + persist

- For "one tab fetches, all tabs see it, last-known value persisted" use cases, follow the cross-tab notification badge recipe in `docs/patterns.md` exactly. The composition order matters (broadcast wraps persist; leader-only writes via `filter: isBroadcaster.current`).

## Imports

The package has subpath exports — import from the right one:

```ts
import { createRefSignal, useRefSignal, ... } from 'react-refsignal';
import { broadcast, useBroadcast } from 'react-refsignal/broadcast';
import { persist, usePersist } from 'react-refsignal/persist';
```

Importing the broadcast or persist subpath is what activates the corresponding signal-level option (`createRefSignal(0, { broadcast: 'channel' })` is a no-op until `react-refsignal/broadcast` is imported somewhere in the app).

## Styles to avoid

- **Don't try to mutate a `ReadonlyRefSignal`** (e.g. a memo result) — `.update()` / `.reset()` / `.notify()` / `.notifyUpdate()` are hidden and `.current` / `.lastUpdated` are `readonly`. The type system rejects all of these; even if you cast around it, the next dep fire overwrites the change.
- **Don't put `useGetXQuery()` inside the Provider body.** Use the sibling-leaf pattern.
- **Don't subscribe with bare `signal.subscribe(fn)` inside a component.** Use `useRefSignalEffect` (cleanup is automatic) or `watch(signal, fn)` (returns a cleanup function for non-React code).
- **Don't cast a `ReadonlyRefSignal` back to `RefSignal` to bypass the readonly view.** That mutation is overwritten on the next dep change. If you need a writable signal, the right shape is a `useRefSignal` paired with the derivation done inline — not a memo result laundered into mutability.
