# Devtools

← [Back to README](../README.md) · [API Reference](api.md) · [Patterns](patterns.md) · [Broadcast](broadcast.md) · [Persist](persist.md) · [Pulse](pulse.md)

---

A signal-native devtools overlay built **with** refsignal itself. Shipped as a tree-shaken subpath (`react-refsignal/devtools`) — apps that never import it pay zero cost. The Redux DevTools backend that earlier versions used is gone; the new overlay surfaces signal state, update timelines, cascade graphs, broadcast peers, persist hydration, and pulse cadence directly in your app.

- [What you get](#what-you-get)
- [Setup](#setup)
- [Mount API](#mount-api)
- [Panel reference](#panel-reference)
  - [Signals](#signals)
  - [Timeline](#timeline)
  - [Cascade](#cascade)
  - [Broadcast](#broadcast)
  - [Persist](#persist)
  - [Pulse](#pulse)
- [Embedding the overlay in your own UI](#embedding-the-overlay-in-your-own-ui)
- [Custom adapters](#custom-adapters)
- [Production safety](#production-safety)

---

## What you get

A bottom-docked overlay, resizable and persisted across reloads, with six panels:

| Panel        | Shows                                                                 |
|--------------|-----------------------------------------------------------------------|
| **Signals**  | Live table of every registered signal — name, type, current value, subscriber count |
| **Timeline** | Chronological log of `signal:update` events with old → new diffs and effect attribution |
| **Cascade**  | Directed graph: edges from effect deps to the signals they write — see how a chain of updates propagates |
| **Broadcast**| Per-channel peer count, `isStableBroadcaster` status, grace-period state |
| **Persist**  | Per-key hydration timing, backend, write count                        |
| **Pulse**    | FPS sparkline and tick stats for every active `PulseRefSignal`        |

The overlay is itself a refsignal consumer — its reactivity is driven by the same primitives the panels visualize.

---

## Setup

Install nothing extra — devtools ship inside the main package as a subpath.

```ts
// In your dev entry point (e.g. main.tsx, App.tsx)
import { mountDevTools } from 'react-refsignal/devtools';

mountDevTools();
```

That's the whole setup. The first import of `react-refsignal/devtools` registers the devtools adapter with the core, so signals created **after** the import are tracked. Add the import as early as possible to catch module-scope signals.

> The overlay also needs `react-dom` available — every React app already has it, but if you have a custom render path make sure `react-dom/client` is resolvable.

---

## Mount API

```ts
import {
  mountDevTools,
  DevToolsOverlay,
  devtools,
} from 'react-refsignal/devtools';
```

The act of importing the subpath self-registers the adapter with the core
(unless `NODE_ENV === 'production'`), so no explicit "connect" call is
required — signals created after the import are tracked.

### `mountDevTools(options?): () => void`

Mounts the overlay to `document.body` and returns a cleanup function. Safe to call once at app start; subsequent calls are no-ops while mounted. Returns a no-op cleanup in production builds (see [production safety](#production-safety)).

```ts
// Default: appends a new <div> to <body>
const dispose = mountDevTools();

// Custom container — useful when you want the overlay confined to a region
const slot = document.querySelector('#devtools-host') as HTMLElement;
mountDevTools({ container: slot });

// Later, if you want to tear it down:
dispose();
```

### `<DevToolsOverlay />`

The same UI as a React component — render it anywhere in your tree if you'd rather embed the overlay inside your own debug panel than have it float at the bottom of the page.

```tsx
import { DevToolsOverlay } from 'react-refsignal/devtools';

function MyDebugPanel() {
  return (
    <aside className="my-debug-rail">
      <DevToolsOverlay />
    </aside>
  );
}
```

### `devtools`

The adapter singleton. Useful programmatically:

```ts
import { devtools } from 'react-refsignal/devtools';

devtools.getAllSignals();      // [{ id, name?, signal }, ...]
devtools.getUpdateHistory();   // last N updates with old/new values
devtools.getCascadeEdges();    // { from, to, effectId, count }[]
devtools.getEvents();          // raw bus events (signal/effect/subsystem)
devtools.getSignalByName(name);// lookup a named signal
devtools.reset();              // clear all tracking state
```

---

## Panel reference

### Signals

Live table of every registered signal. Anonymous signals (created without a debug name) are tagged `(anon)` and given an auto-id like `signal_3`. Click a row to open a detail card with the full value and a "Copy value" button.

Sort by name, subscriber count, or last-updated counter. Filter by name with the search box.

### Timeline

Chronological log of `signal:update` events. Each row shows: time ago, signal name, optional `⤳ effectId` chip (when the update was triggered by a `watch` / `watchSignals` callback), and an inline old → new diff. Click a row to expand a full JSON diff.

The triggeredBy chip is the same `effectId` you'd see on a [Cascade](#cascade) edge — useful for tracing "which effect wrote this?".

### Cascade

Directed graph of write attribution. When an effect attached to signal `A` calls `B.update(...)`, the panel draws an edge `A → B`. Repeated cascades stack on the same edge and bump its count.

Layout uses a Kahn-style topological sort to assign depth levels — sources on the left, sinks on the right. Cycles (rare in well-formed reactive code) are broken by promoting a node to the deepest available level.

Hover any node to highlight its incoming edges (green upstream nodes) and outgoing edges (yellow downstream nodes); other edges dim.

The cascade graph is the panel that most justifies a custom devtools — it's a view that wouldn't fit the Redux action-log model.

### Broadcast

One card per channel (the `channel` argument you passed to `broadcast` / `useBroadcast`). Each card shows:

- **Role** — `STABLE BROADCASTER`, `BROADCASTER (settling)`, or `RECEIVER`. Settling means the grace period is still counting down before the leader is considered stable.
- **Peers** — live count of tabs participating on this channel.
- **Tab IDs** — the random IDs of all known peers, useful for correlating with another tab's overlay.
- Timestamps for the most recent role and stable transitions.

Multi-tab debugging is much easier with this panel open in both tabs side-by-side — you can watch leadership migrate and grace periods elapse in real time.

### Persist

One card per persisted key, each showing:

- **Hydrated** indicator — `YES` once the storage backend returns, with an `EMPTY` chip if no stored value existed.
- **Hydration time** — milliseconds spent in `storage.get(key)`.
- **Writes** — total saves since mount, plus the time since the last write.

Useful for spotting slow IndexedDB hydration or runaway writes (forgot to throttle a high-frequency signal).

### Pulse

One card per active `PulseRefSignal`. Each card shows an FPS sparkline (last ~12 seconds at the panel's emit cadence), total tick count, elapsed session time, and average frame delta.

Combine with the [Signals](#signals) panel to see which pulses are alive and at what rate.

---

## Avoiding the dock from your host page

The overlay publishes its current effective height as a CSS custom property
on `document.documentElement`:

```
--refsignal-devtools-height
```

The value updates live on resize and collapse, and is removed when the overlay
unmounts — so the same CSS works whether devtools is active, collapsed, or
absent (production build, no `mountDevTools()` call).

Use it to keep your own fixed-position UI from colliding with the dock:

```css
.my-floating-toolbar {
  position: fixed;
  bottom: calc(var(--refsignal-devtools-height, 0px) + 12px);
  right: 12px;
}
```

Or to reserve space below long-form content:

```css
body {
  padding-bottom: var(--refsignal-devtools-height, 0px);
}
```

The `0px` fallback means production users (where the overlay is a no-op) see
no layout shift.

---

## Embedding the overlay in your own UI

When you already have a debug page or admin panel, render `<DevToolsOverlay />` inline instead of letting `mountDevTools()` create a floating dock:

```tsx
import { DevToolsOverlay } from 'react-refsignal/devtools';

export function DebugRoute() {
  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr 400px', height: '100vh' }}>
      <main>...your debug page content...</main>
      <DevToolsOverlay />
    </div>
  );
}
```

The component is self-contained — no provider, no context, no extra setup. Its state (dock height, collapsed, active tab) is module-level and persisted to `localStorage`, so the panel keeps its layout across reloads.

---

## Custom adapters

The adapter interface is small enough to build your own headless backend (logger, snapshot exporter, custom UI):

```ts
import {
  setDevToolsAdapter,
  type DevToolsAdapter,
} from 'react-refsignal';

const myAdapter: DevToolsAdapter = {
  trackUpdate(signal, oldValue, newValue) { /* … */ },
  registerSignal(signal, debugName) { /* … */; return undefined; },
  getSignalName(signal) { return undefined; },
  trackEffectStart(effectId, depSignals) { /* … */ },
  trackEffectEnd(effectId) { /* … */ },
  emit(event) { /* … */ },
};

setDevToolsAdapter(myAdapter);
```

Importing `react-refsignal/devtools` is **not** required if you ship your own adapter — `setDevToolsAdapter` is exported from the core entry.

---

## Production safety

`mountDevTools()` returns a no-op cleanup when `process.env.NODE_ENV === 'production'`, so leaving the call unconditionally in your app entry won't ship the overlay to end users. The adapter also skips self-registration in production, meaning even importing the subpath becomes a cheap noop.

For belt-and-suspenders bundle savings, gate the import behind a dev check:

```ts
if (process.env.NODE_ENV !== 'production') {
  void import('react-refsignal/devtools').then((m) => m.mountDevTools());
}
```

Tsup-, esbuild-, and Vite-style bundlers will tree-shake the dynamic import in production builds.
