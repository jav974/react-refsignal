# API Reference

← [Back to README](../README.md) · [Concepts](concepts.md) · [Patterns](patterns.md) · [Imperative renderers](imperative-renderers.md) · [Pulse](pulse.md) · [Broadcast](broadcast.md) · [Persist](persist.md)

---

- [`RefSignal<T>`](#refsignalt)
- [`ReadonlyRefSignal<T>`](#readonlyrefsignalt)
- [`PulseRefSignal`](#pulserefsignal)
- [`PulseRate`](#pulserate)
- [`createRefSignal<T>(initialValue, options?)`](#createrefsignalt-initialvalue-options)
- [`SignalOptions<T>` / `Interceptor<T>` / `CANCEL`](#signaloptionst--interceptort--cancel)
- [`useRefSignal<T>(initialValue, options?)`](#userefsignalt-initialvalue-options)
- [`isRefSignal<T>(obj)`](#isrefsignalt-obj)
- [`useRefSignalEffect(effect, deps, options?)`](#userefsignaleffect-effect-deps-options)
- [`useRefSignalRender(deps, options?)`](#userefsignalrender-deps-options)
- [`WatchOptions`](#watchoptions)
- [`EffectOptions`](#effectoptions)
- [`TimingOptions`](#timingoptions)
- [`SignalStoreOptions<TStore>`](#signalstoreoptionststore)
- [`useRefSignalMemo<T>(factory, deps, options?)`](#userefsignalmemot-factory-deps-options)
- [`useRefSignalFollow<T>(getter, deps, options?)`](#userefsignalfollowt-getter-deps-options)
- [`usePulseRefSignal(rate)`](#usepulserefsignalrate)
- [`useReplayRefSignal<T>(source, ms, snapshot?)`](#usereplayrefsignalt-source-ms-snapshot)
- [`createComputedRefSignal<T>(compute, deps)`](#createcomputedrefsignalt-compute-deps)
- [`createPulseRefSignal(rate)`](#createpulserefsignalrate)
- [`createReplayRefSignal<T>(source, ms, snapshot?)`](#createreplayrefsignalt-source-ms-snapshot)
- [`watch<T>(signal, listener, options?)`](#watcht-signal-listener-options)
- [`watchSignals(deps, onFire, options?)`](#watchsignalsdeps-onfire-options)
- [`WatchHandle`](#watchhandle)
- [`batch(callback, deps?)`](#batchcallback-deps)
- [`createRefSignalStore<TStore>(factory)`](#createrefsignalstoretstore-factory)
- [`useRefSignalStore<TStore>(store, options?)`](#userefsignalstoretstore-store-options)
- [`createRefSignalContext<TName, TStore>(name, factory)`](#createrefsignalcontexttname-tstore-name-factory)
- [`createRefSignalContextHook<TStore>(name)`](#createrefsignalcontexthooktstore-name)
- [`ALL`](#all)
- [DevTools](#devtools)
- [Broadcast](#broadcast)
- [Persist](#persist)

---

### `RefSignal<T>`

The core interface implemented by all signal objects.

| Member | Description |
|---|---|
| `current: T` | The current value. Mutable directly; prefer `.update()` to notify subscribers. |
| `lastUpdated: number` | Monotonic counter. Starts at `0`, incremented by `update()` and `notifyUpdate()`. |
| `update(value)` | Sets `current`, bumps `lastUpdated`, notifies subscribers. No-op if value is strictly equal. |
| `reset()` | Restores `current` to the initial value via `.update()` — respects the interceptor, notifies subscribers, no-op if already at initial. |
| `notify()` | Fires all subscribers. Does **not** change `lastUpdated`. [See Concepts](concepts.md#notify-vs-notifyupdate) |
| `notifyUpdate()` | Bumps `lastUpdated`, then fires all subscribers. [See Concepts](concepts.md#notify-vs-notifyupdate) |
| `subscribe(listener)` | Registers a listener called with the current value on every notification. |
| `unsubscribe(listener)` | Removes a previously registered listener. |
| `getDebugName?()` | Returns the signal's debug name. Only present when DevTools are enabled. |

---

### `ReadonlyRefSignal<T>`

Read-only view of a signal — `RefSignal<T>` minus the write-side APIs (`.update()`, `.reset()`, `.notify()`, `.notifyUpdate()`), with `.current` and `.lastUpdated` marked `readonly` so direct mutation (`signal.current = x`) is a compile-time error. Returned by [`useRefSignalMemo`](#userefsignalmemot-factory-deps-options) and [`useRefSignalFollow`](#userefsignalfollowt-getter-deps-options) where React owns the lifetime, so no `.dispose()` is exposed.

`.notify()` and `.notifyUpdate()` are excluded because they are escape hatches for the direct-`.current`-mutation pattern on a writable signal — irrelevant when the value is derived.

`ReadonlyRefSignal<T>` is the supertype of `RefSignal<T>` and the return shape of [`createComputedRefSignal`](#createcomputedrefsignalt-compute-deps). Use it as a parameter type whenever you only need to read or subscribe — your function will accept all forms.

```ts
function logChanges<T>(signal: ReadonlyRefSignal<T>) {
  return signal.subscribe((v) => console.log(v));
}
logChanges(myRefSignal);       // ✓
logChanges(myMemoSignal);      // ✓ (from useRefSignalMemo)
logChanges(myComputedSignal);  // ✓ (from createComputedRefSignal)
```

> **Ownership and `dispose`** — if a signal value carries `.dispose()` in its type (created via [`createRefSignal`](#createrefsignalt-initialvalue-options) or [`createComputedRefSignal`](#createcomputedrefsignalt-compute-deps)), you own its lifetime. `ReadonlyRefSignal<T>` itself does not include `.dispose()` — that only appears at creator return sites, so consumer functions taking a `ReadonlyRefSignal` can't accidentally tear down a signal they don't own.

> **Deprecated aliases** — `ReadonlySignal<T>` is kept as a deprecated alias for `ReadonlyRefSignal<T>`. `ComputedSignal<T>` is kept as a deprecated alias for `ReadonlyRefSignal<T> & { dispose: () => void }`. Both will be removed in a future major release.

---

### `PulseRefSignal`

A self-firing read-only signal whose `.current` advances to `performance.now()` on every tick. Returned by [`createPulseRefSignal`](#createpulserefsignalrate) and [`usePulseRefSignal`](#usepulserefsignalrate). Conceptually a clock primitive — see [Pulse](pulse.md) for the narrative and recipes.

`PulseRefSignal` extends `ReadonlyRefSignal<number>` with three additional readonly fields. They are **tick-context metadata**, not parallel reactive channels — coherent with `.current` at the moment subscribers fire, like `event.timeStamp` inside a DOM event handler. You read them inside a tick callback; you don't `watch(loop.dt, …)`.

| Member | Description |
|---|---|
| `current: number` | `performance.now()` at the most recent tick. Inherited from `ReadonlyRefSignal<number>`. Bumps `lastUpdated`, fires subscribers. |
| `lastUpdated: number` | Inherited. Advances on every tick. |
| `dt: number` | Milliseconds since the previous tick in the current session. Reset to `0` whenever the timer (re)starts. |
| `tick: number` | Number of ticks fired in the current session. `0` before the first fire, increments by `1` each tick. Reset on (re)start. |
| `elapsed: number` | Milliseconds since the first tick of the current session. `0` until the second tick. Reset on (re)start. |
| `subscribe(listener)` / `unsubscribe(listener)` | Inherited. Subscribers drive the lazy lifecycle: timer starts on `0 → 1`, stops on `1 → 0`. |
| `updatePulse(rate)` | Change the cadence of an already-created pulse signal. Validates the new rate, then if the timer is running, stops it and restarts at the new cadence with **continuity preserved** (`tick` and `elapsed` keep accumulating; only `lastTickTime` is reset so the next `dt` reflects the rate change). If no subscribers are attached, the new rate is just stored and applied on the next `0 → 1` start. Driver may switch (`'1000ms'` → `'60fps'` swaps `setInterval` for RAF). See [pulse.md — Reactive cadences](pulse.md#reactive-cadences-with-updatepulse). |
| `getDebugName?()` | Inherited. |

> **Why a number, not an object?** Most use cases (clocks, "X ago", token TTLs) want `.current` to be a primitive. The metadata-on-the-side shape pays the cost where it lands: game/sim code, where `loop.dt` is one identifier instead of a destructure. See [pulse.md — The shape of a pulse signal](pulse.md#the-shape-of-a-pulse-signal).

---

### `PulseRate`

The cadence accepted by [`createPulseRefSignal`](#createpulserefsignalrate) and [`usePulseRefSignal`](#usepulserefsignalrate).

```ts
type PulseRate = number | `${number}ms` | `${number}fps` | 'frame' | 'raf';
```

| Form | Driver | When to reach for it |
|---|---|---|
| `number` (e.g. `100`) | `setInterval` | Same as the `'Nms'` form — a bare number is implicitly milliseconds. |
| `'Nms'` (e.g. `'250ms'`, `'16.67ms'`) | `setInterval` | Continues firing on hidden tabs (subject to browser background-tab throttling). Use for clocks, polling, heartbeats, token refresh. |
| `'Nfps'` (e.g. `'60fps'`, `'30fps'`) | `requestAnimationFrame` | Throttled to at most N/sec. Use when you specifically want a capped rate (power-saving, retro framelock, sub-display-refresh animation). |
| `'frame'` / `'raf'` | `requestAnimationFrame` | Every frame at the display's native rate (60Hz / 120Hz / 144Hz / …), no throttle. Use for game loops, FPS counters, anything that should run as fast as the screen draws. Both names are first-class. |

Decimals are accepted in both numeric string forms. A non-positive or non-finite rate throws at construction.

---

### `createRefSignal<T>(initialValue, options?)`

Creates a signal outside of React. Use at module scope or inside context factories.

```ts
import { createRefSignal, CANCEL } from 'react-refsignal';

const position = createRefSignal({ x: 0, y: 0 });
position.update({ x: 10, y: 20 });

// With debug name (string shorthand — backward compatible)
const score = createRefSignal(0, 'score');

// With interceptor — transform incoming value
const health = createRefSignal(100, { interceptor: (v) => Math.max(0, Math.min(100, v)) });
const angle  = createRefSignal(0,   { interceptor: (v) => v % 360 });

// With interceptor — cancel the update by returning CANCEL
const state = createRefSignal<'idle' | 'running' | 'paused'>('idle', {
  interceptor: (incoming, current) => {
    if (current === 'idle' && incoming === 'paused') return CANCEL; // invalid transition
    return incoming;
  },
});

// Delta-based — use current value to limit rate of change
const position = createRefSignal(0, {
  interceptor: (incoming, current) => current + Math.min(incoming - current, 10),
});
```

`lastUpdated` starts at `0` and is only incremented by `update()` or `notifyUpdate()`.

> **Note:** `interceptor` runs inside `.update()` only. Direct mutation of `.current` bypasses it.

The returned signal also carries `.dispose()`. Call it to tear down `broadcast` / `persist` adapter cleanups and proactively clear all subscribers from the WeakMap. Idempotent. Cleanup closures returned by prior `watch()` / `subscribe()` calls become safe no-ops afterwards. Re-subscribing after dispose works normally — the signal isn't permanently dead, just released. Inside React, prefer [`useRefSignal`](#userefsignalt-initialvalue-options) which manages this lifecycle for you (its return type intentionally omits `.dispose()`).

---

### `SignalOptions<T>` / `Interceptor<T>` / `CANCEL`

Options accepted by `createRefSignal` and `useRefSignal`.

| Option | Type | Description |
|---|---|---|
| `debugName` | `string` | Name shown in DevTools. Equivalent to passing a string as the second argument. |
| `interceptor` | `Interceptor<T>` | Runs before every `.update()`. Return a `T` to store that value, or return `CANCEL` to silently drop the update. |
| `equal` | `(a: T, b: T) => boolean` | Custom equality check. When it returns `true`, the update is skipped. Useful for object signals where reference equality produces false positives. Runs after `interceptor`, before the built-in `===` check. |

```ts
export const CANCEL: unique symbol;
export type Interceptor<T> = (incoming: T, current: T) => T | typeof CANCEL;
```

**`equal` example — shallow point comparison:**

```ts
const position = createRefSignal({ x: 0, y: 0 }, {
  equal: (a, b) => a.x === b.x && a.y === b.y,
});

position.subscribe((v) => console.log('moved:', v));
position.update({ x: 0, y: 0 }); // different reference, same values — skipped
position.update({ x: 10, y: 0 }); // different values — fires
```

`CANCEL` is a unique symbol — safe to use even when `T` includes `undefined` or `null`.

---

### `useRefSignal<T>(initialValue, options?)`

Creates a signal inside a React component. The signal is created once on mount and is stable across re-renders. The initial value is used only at creation — subsequent re-renders do not update it.

```tsx
const count = useRefSignal(0);
const count = useRefSignal(0, 'userCount'); // with debug name

// With interceptor
const score = useRefSignal(0, { interceptor: (v) => Math.max(0, v) });
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

### `useRefSignalEffect(effect, deps, options?)`

Runs `effect` on mount and whenever any `RefSignal` in `deps` fires. Non-signal values in `deps` follow standard `useEffect` semantics — the effect resubscribes when they change.

```tsx
useRefSignalEffect(() => {
  document.title = `Count: ${count.current}`;
}, [count]);
```

**Key behaviors:**
- Runs immediately on mount — always synchronous, unaffected by timing options.
- If `effect` returns a cleanup function, it runs on **unmount or deps change only** — not between signal fires.
- Re-entrancy is allowed: the effect may call `.update()` on a signal in `deps`.
- Accepts mixed deps: signal deps subscribe directly, non-signal deps resubscribe via React's `useEffect`.

**`options`** — rate-limit or gate signal-triggered effect runs. Accepts [`EffectOptions`](#effectoptions). The mount run is always synchronous and unconditional regardless of timing or filter options. Pass `{ skipMount: true }` to suppress it entirely:

```tsx
// Collapse multiple signal fires per frame into one effect run
useRefSignalEffect(() => {
  ctx.fillRect(position.current.x, position.current.y, 20, 20);
}, [position], { frame: true });

// Expensive effect — at most once per 100ms
useRefSignalEffect(() => {
  rebuildIndex(data.current);
}, [data], { throttle: 100 });

// Skip effect unless score crossed the threshold
useRefSignalEffect(() => {
  triggerCelebration();
}, [score], { filter: () => score.current >= 100 });

// Skip the mount run — react to changes only, not initial state
useRefSignalEffect(() => {
  toast(`Score updated to ${score.current}`);
}, [score], { skipMount: true });
```

---

### `useRefSignalRender(deps, options?)`

Subscribes to signals and re-renders the component on any update via `.update()` or `.notifyUpdate()`. Built on `useSyncExternalStore` — concurrent-safe and tear-free.

```tsx
const score = useRefSignal(0);
useRefSignalRender([score]);

return <div>Score: {score.current}</div>;
```

**`options`** — an optional [`WatchOptions`](#watchoptions) object (or a legacy bare callback for backward compatibility). `WatchOptions` is the same as `EffectOptions` minus `skipMount`, which has no meaning for render hooks:

```tsx
// Legacy callback — still supported
useRefSignalRender([count], () => count.current % 10 === 0);

// Options object — filter, throttle, debounce, frame
useRefSignalRender([price], { throttle: 100 });
useRefSignalRender([query], { debounce: 200 });
useRefSignalRender([query], { debounce: 200, maxWait: 1000 });
useRefSignalRender([position], { frame: true });
useRefSignalRender([count], { filter: () => count.current % 10 === 0 });
```

**Returns** a `forceUpdate` function that unconditionally re-renders, bypassing all options:

```tsx
const forceUpdate = useRefSignalRender([]);
forceUpdate();
```

> **Note:** `notify()` alone does **not** trigger a re-render. `useRefSignalRender` watches `lastUpdated`, which only changes via `update()` and `notifyUpdate()`.

---

### `WatchOptions`

The options type accepted by `watch()`, `useRefSignalRender`, `useRefSignalMemo`, and as the base for all other options types. Extends [`TimingOptions`](#timingoptions) with a filter gate and dynamic-signal tracking.

```
TimingOptions
  └── WatchOptions       = TimingOptions & { filter?, trackSignals? }  ← watch(), useRefSignalMemo, useRefSignalRender
        └── EffectOptions = WatchOptions & { skipMount? }               ← useRefSignalEffect
```

| Option | Type | Description |
|---|---|---|
| `filter` | `() => boolean` | Skip the callback when this returns `false`. Does not gate the dynamic-tracking reconcile pass — the subscription set stays consistent regardless of filter state. |
| `trackSignals` | `() => ReadonlyArray<RefSignal<unknown>>` | Resolves additional signals to subscribe to dynamically. Re-evaluated only on fires of static `deps` signals (not on fires of the returned set itself). The diff runs with ref-equal and content-equal shortcuts, so returning a memoized array or the same content each call costs nothing. Use for nested-signal traversal where an inner signal's identity comes from another signal's current value. Prefer [`useRefSignalFollow`](#userefsignalfollowt-getter-deps-options) for the common single-signal case. |
| `throttle` / `debounce` / `maxWait` / `delayed` / `frame` | — | See [`TimingOptions`](#timingoptions). |

---

### `EffectOptions`

Options accepted by `useRefSignalEffect`. Extends [`WatchOptions`](#watchoptions) with hook-specific mount behaviour.

`EffectOptions` is defined as `WatchOptions & { skipMount? }`. The timing fields come from `TimingOptions` — a discriminated union that makes invalid combinations type errors at compile time.

| Option | Type | Description |
|---|---|---|
| `filter` | `() => boolean` | Skip the run if this returns `false`. Applied to signal-triggered runs only — mount always executes (unless `skipMount` is set). |
| `skipMount` | `boolean` | Skip the effect run on mount. When `true`, the effect only fires on signal-triggered updates. *(Not available in `WatchOptions` or `useRefSignalRender` — mount is not a concept there.)* |
| `throttle` | `number` | At most one trigger per N ms (leading + trailing). |
| `debounce` | `number` | Trigger after N ms of quiet. |
| `maxWait` | `number` | With `debounce` only: guaranteed flush every N ms even if the signal keeps firing. |
| `delayed` | `number` | Trigger exactly N ms after the *first* fire of a burst, reading live state at run time. Sugar for `{ debounce: N, maxWait: N }`. Need the value *as it was* N ms ago instead? See [`useReplayRefSignal`](#usereplayrefsignalt-source-ms-snapshot). |
| `frame` | `boolean` | Schedule on the next animation frame (`requestAnimationFrame`); multiple fires per frame collapse into one. |
| `rAF` | `boolean` | **Deprecated** alias for `frame`. Still works; will be removed in a future major version. |

The timing options are mutually exclusive — combining them is a type error:

```ts
{ throttle: 100, debounce: 200 } // ✗ type error
{ maxWait: 500 }                 // ✗ type error — maxWait requires debounce
{ frame: true, throttle: 50 }   // ✗ type error
{ delayed: 100, frame: true }   // ✗ type error
{ debounce: 200, maxWait: 1000 } // ✓
{ delayed: 100 }                 // ✓
```

Context hooks (`createRefSignalContext`, `createRefSignalContextHook`) accept [`SignalStoreOptions`](#signalstoreoptionststore) instead, which extends these same fields but upgrades `filter` to receive the store snapshot directly.

### `TimingOptions`

The discriminated union underlying `WatchOptions` and `EffectOptions`. Exported separately for cases where you want to pass timing configuration without `filter` (e.g. building custom hooks on top of the library). For most use cases, prefer `WatchOptions`.

```ts
import type { TimingOptions, WatchOptions } from 'react-refsignal';
```

---

### `SignalStoreOptions<TStore>`

Options accepted by `useRefSignalStore`, `createRefSignalContext`, and `createRefSignalContextHook`. Extends [`TimingOptions`](#timingoptions). The `filter` field is upgraded from `WatchOptions`'s `() => boolean` to receive the store snapshot directly.

| Option | Type | Description |
|---|---|---|
| `renderOn` | `Array<RefSignalKeys<TStore>>` \| `'all'` | Signal keys that trigger a re-render. Omit to never re-render. |
| `unwrap` | `boolean` | If `true`, returns plain values with auto-generated setters instead of raw signals. Requires `renderOn`. |
| `filter` | `(store: StoreSnapshot<TStore>) => boolean` | Only re-render if this returns `true`. Receives the store snapshot — signals unwrapped to their current values. |
| `throttle` / `debounce` / `maxWait` / `frame` | — | Same as [`TimingOptions`](#timingoptions). |

```tsx
// Only re-render when score crosses the 100 threshold
useRefSignalStore(gameStore, {
  renderOn: ['score'],
  filter: (store) => store.score > 100,
});

// Debounced and gated
useRefSignalStore(gameStore, {
  renderOn: ['score'],
  debounce: 200,
  filter: (store) => store.score % 10 === 0,
});
```

---

### `useRefSignalMemo<T>(factory, deps, options?)`

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
- `options` is a [`WatchOptions`](#watchoptions) — timing, filter, and `trackSignals` for dynamic-signal traversal.

Returns a [`ReadonlyRefSignal<T>`](#readonlyrefsignalt) — read-side APIs (`.current`, `.lastUpdated`, `.subscribe`/`.unsubscribe`, `.getDebugName`) only; the write-side APIs (`.update`, `.reset`, `.notify`, `.notifyUpdate`) are hidden. The lifetime is tied to the component, so no `.dispose()` either. Pass it as a dep wherever a `ReadonlyRefSignal` is accepted: `useRefSignalRender`, `useRefSignalEffect`, `useRefSignalMemo`, `useRefSignalFollow`, `createComputedRefSignal`, `watch`, `watchSignals`, and `WatchOptions.trackSignals`.

---

### `useRefSignalFollow<T>(getter, deps, options?)`

Produces a stable signal whose value tracks another signal resolved dynamically through `getter`. The inner signal's **identity** may change over time — when any static dep fires, `getter` is re-evaluated and the subscription swaps.

```tsx
// nodes: RefSignal<Map<string, RefSignal<NodeData>>>
const node = useRefSignalFollow(
  () => nodes.current.get(focusedId),
  [nodes, focusedId],
);
// node: ReadonlyRefSignal<NodeData | undefined>
```

Shorthand for a [`useRefSignalMemo`](#userefsignalmemot-factory-deps-options) that reads `getter()?.current` while auto-tracking `getter()` as a dynamic signal. Use it whenever you would otherwise write a memo + matching `trackSignals` pair by hand.

- `getter` may return `null` or `undefined` — the followed signal's value is then `undefined`, no crash.
- `options` accepts timing and filter from [`WatchOptions`](#watchoptions); `trackSignals` is managed internally and reserved.

---

### `usePulseRefSignal(rate)`

Creates a [`PulseRefSignal`](#pulserefsignal) inside a React component — a self-firing read-only signal whose `.current` advances to `performance.now()` on every tick. The signal is stable for the component's lifetime and disposed on unmount; React owns the lifecycle, so `.dispose()` is not exposed.

```tsx
import { usePulseRefSignal, useRefSignalRender } from 'react-refsignal';

function Clock() {
  const now = usePulseRefSignal('1000ms');
  useRefSignalRender([now]);
  return <span>{new Date().toLocaleTimeString()}</span>;
}

function GameLoop() {
  const loop = usePulseRefSignal('60fps');
  useRefSignalEffect(() => {
    advancePhysics(loop.dt);
  }, [loop]);
  return null;
}
```

- `rate` is captured at mount time. Subsequent renders with a different `rate` keep the original cadence — mirrors the mount-time-options convention used by [`useRefSignal`](#userefsignalt-initialvalue-options).
- The timer is **lazy**: it starts on the first subscriber and stops when subscribers drop to zero. Multiple consumers (e.g. several `useRefSignalRender` calls or a `useRefSignalEffect`) share one timer.
- See [Pulse](pulse.md) for narrative, recipes (live timestamps, auth refresh, game loops, shared tick via provider), and what pulse can't compose with (`persist`, `broadcast`, both at signal- and store-level).

---

### `useReplayRefSignal<T>(source, ms, snapshot?)`

Creates a read-only signal that follows `source` exactly `ms` milliseconds behind — every source update is captured and re-emitted once its due time arrives, preserving order and relative spacing. The *time-shifted value* primitive: trails, ghosts, delayed playback. The signal is stable for the component's lifetime and torn down on unmount; React owns the lifecycle, so `.dispose()` is not exposed.

```tsx
import { useRefSignal, useReplayRefSignal, useRefSignalEffect } from 'react-refsignal';

function NodeWithGhost() {
  const pos = useRefSignal({ x: 0, y: 0 });
  const ghost = useReplayRefSignal(pos, 300, (p) => ({ ...p }));

  useRefSignalEffect(() => {
    drawGhost(ctx, ghost.current.x, ghost.current.y);
  }, [ghost], { frame: true });
  // …
}
```

- Consumer code is identical to consuming the live source — point it at a different signal, and pick any consumption timing (`frame`, `throttle`, `debounce`, none) downstream. Each due entry is an individual update, so an untimed subscriber observes every replayed value.
- **`snapshot` is required for object signals mutated in place** (the `.current.x = …; .notify()` hot-path idiom) — without it the internal queue holds references to one live object and every replayed emission shows the present, not the past. Immutably-updated signals and primitives don't need it; the default identity capture is allocation-free.
- `source`, `ms`, and `snapshot` are captured at mount time, mirroring the mount-time-options convention of [`useRefSignal`](#userefsignalt-initialvalue-options).
- Want an effect to simply run N ms *after* a change, reading live state? That's not a replay — use the [`{ delayed: N }`](#timingoptions) timing option.

Outside React, use [`createReplayRefSignal`](#createreplayrefsignalt-source-ms-snapshot). See [Patterns — Time-shifted signals](patterns.md#time-shifted-signals--usereplayrefsignal) for the recipe.

---

### `createComputedRefSignal<T>(compute, deps)`

Creates a derived signal whose value is recomputed whenever any dep signal updates. The returned signal is read-only — `.update()` and `.reset()` are not exposed.

Use this at module scope or in context factories. Inside a component, prefer [`useRefSignalMemo`](#userefsignalmemot-factory-deps-options), which ties the signal's lifetime to the component and handles non-signal deps via React's dependency array.

```ts
import { createRefSignal, createComputedRefSignal } from 'react-refsignal';

const price = createRefSignal(10);
const qty   = createRefSignal(3);
const total = createComputedRefSignal(() => price.current * qty.current, [price, qty]);

total.current; // 30
total.subscribe((v) => console.log('total:', v));

price.update(20); // total → 60, subscriber called
```

The computation stays live as long as at least one dep signal is alive (the computed signal holds subscriptions to each dep). Call `.dispose()` to unsubscribe from deps, stop recomputing, and proactively release the computed's own subscribers from the WeakMap:

```ts
const total = createComputedRefSignal(() => price.current * qty.current, [price, qty]);

// Later — detach from deps, stop recomputing, release subscribers
total.dispose();
price.update(99); // total.current remains at the last computed value
```

> **Deprecated alias** — `createComputedSignal` is kept as a deprecated alias and will be removed in a future major release. Migrate to `createComputedRefSignal` for brand consistency with the rest of the API.

---

### `createPulseRefSignal(rate)`

Creates a [`PulseRefSignal`](#pulserefsignal) outside React — at module scope, in context factories, or anywhere else. Returns the signal augmented with `.dispose()`.

```ts
import { createPulseRefSignal } from 'react-refsignal';

const now      = createPulseRefSignal('1000ms');  // every second
const loop     = createPulseRefSignal('60fps');   // throttled to 60
const frame    = createPulseRefSignal('frame');   // every frame, native rate
const everyHalf = createPulseRefSignal(500);      // bare number — same as '500ms'
```

- The timer is **lazy**: it starts on the `0 → 1` subscriber transition and stops on `1 → 0` and on `.dispose()`. A signal that is never subscribed to never installs a timer.
- Each subscribe-cycle is a fresh session: `dt`, `tick`, and `elapsed` reset on (re)start, so a brief unsubscribe-then-resubscribe doesn't show up as a giant `dt` spike across the idle gap.
- Driver: `'Nfps'` → `requestAnimationFrame` (frame-aligned, paused on hidden tabs); `number` / `'Nms'` → `setInterval` (continues firing on hidden tabs, subject to browser throttling).
- **No `persist` / `broadcast` options.** They're absent intentionally — `performance.now()` is bound to the document's `performance.timeOrigin` and is meaningless to serialize or send across tabs. The same applies when a `PulseRefSignal` is placed inside a store wrapped by `persist()` or `broadcast()`: the type system doesn't catch this, but the runtime behavior is broken in the same ways. See [pulse.md — What pulse can't compose with](pulse.md#what-pulse-cant-compose-with).
- SSR-safe: construction works in non-browser environments (so server output is stable), but no timer is installed when `typeof window === 'undefined'`. The timer starts naturally on the client after hydration.

For full narrative, recipes, and the store-level composition trap, see [Pulse](pulse.md).

---

### `createReplayRefSignal<T>(source, ms, snapshot?)`

Creates a replayed signal outside React — at module scope, in context factories, or anywhere else. Same semantics as [`useReplayRefSignal`](#usereplayrefsignalt-source-ms-snapshot); returns the signal augmented with `.dispose()`.

```ts
import { createRefSignal, createReplayRefSignal, watch } from 'react-refsignal';

const price = createRefSignal(0, 'price');
const delayedPrice = createReplayRefSignal(price, 5000); // price, 5 s ago

watch(delayedPrice, (v) => updateComparisonChart(v));

// Later — stop following the source, cancel pending emissions, release subscribers
delayedPrice.dispose();
```

- Emissions fire at their due moment via a single armed `setTimeout` — at most one timer exists at a time, and none while the source is quiet. A quiet replay signal costs one listener entry on the source.
- The drain is intentionally not configurable — any timing policy on the emission side would corrupt the "value as it was `ms` ago" contract. Consumption timing belongs downstream, per consumer.
- Works in non-browser environments (no `requestAnimationFrame` dependency) and keeps progressing in background tabs, subject to browser timer throttling.
- Throws on a negative or non-finite `ms`.

---

### `watch<T>(signal, listener, options?)`

Subscribes a listener to a signal and returns a cleanup function. The framework-free counterpart to `useRefSignalEffect` — same `filter` and timing options, no React required.

```ts
import { createRefSignal, watch } from 'react-refsignal';

const score = createRefSignal(0);

// Basic — fires synchronously on every update
const stop = watch(score, (value) => console.log('score:', value));
score.update(10); // → 'score: 10'
stop();           // unsubscribe

// Throttled — at most once per 100 ms
const stop = watch(score, (v) => draw(v), { throttle: 100 });

// Debounced — only after 300 ms of quiet
const stop = watch(score, (v) => save(v), { debounce: 300, maxWait: 1000 });

// Frame-synced — collapses rapid updates into one call per animation frame
const stop = watch(position, (v) => render(v), { frame: true });

// Filtered — only reacts when score is positive
const stop = watch(score, (v) => log(v), { filter: () => score.current > 0 });

// Combined — debounce + filter
const stop = watch(score, (v) => sync(v), {
  debounce: 200,
  filter: () => score.current > 0,
});
```

**`options`** — accepts [`WatchOptions`](#watchoptions) *minus* `trackSignals`. Supports `filter`, `throttle`, `debounce`, `maxWait`, `frame`. Timing options are mutually exclusive.

When timing is active, `listener` receives the **latest captured value** at the moment the timer fires — intermediate values between fires are not replayed.

`stop()` also cancels any pending timer or animation frame so the listener never fires after unsubscribing.

> **Why no `trackSignals`?** `watch()` is single-signal — the listener receives `T`, the type of the one watched signal. Dynamic tracking means "fire when *other* signals change", which doesn't have a clean value to pass. Use [`watchSignals`](#watchsignalsdeps-onfire-options) for the multi-signal and dynamic-identity cases.

---

### `watchSignals(deps, onFire, options?)`

The non-React primitive for watching a set of signals — including dynamically-resolved ones. Returns a [`WatchHandle`](#watchhandle). The React hooks (`useRefSignalEffect`, `useRefSignalMemo`, `useRefSignalRender`) use this internally, so semantics are identical in and out of React.

```ts
import { createRefSignal, watchSignals } from 'react-refsignal';

// Multi-signal — fires when anything in deps updates
const a = createRefSignal(0);
const b = createRefSignal(0);
const sub = watchSignals([a, b], () => {
  console.log('a =', a.current, 'b =', b.current);
});
a.update(1); // logs — a fired
b.update(1); // logs — b fired
sub.dispose();

// Dynamic identity — the "inner" signal is resolved through an outer one
const nodes = createRefSignal(new Map<string, RefSignal<number>>());
const id = 'x';

const sub2 = watchSignals(
  [nodes],
  () => {
    const s = nodes.current.get(id);
    render(s?.current ?? 0);
  },
  {
    trackSignals: () => {
      const s = nodes.current.get(id);
      return s ? [s] : [];
    },
    frame: true,
  },
);
```

**Static vs dynamic:**

- `deps: ReadonlyArray<unknown>` — static set. Subscribed once at setup. Non-signal values in the array are silently ignored. Static-dep fires reconcile the dynamic set before `onFire` runs.
- `options.trackSignals: () => RefSignal<any>[]` — dynamic set. Re-resolved on every coalesced static fire (never on dynamic fires). Signals entering the set are subscribed, signals leaving are unsubscribed. Ref-equal and content-equal shortcuts make repeated identical returns free.

**`onFire`** takes no arguments — read whatever signals you need via `.current` inside. This is different from `watch()`'s value-delivering listener; it's what allows `watchSignals` to bind to many signals of different types.

**`options`** — full [`WatchOptions`](#watchoptions): `filter`, `throttle`, `debounce`, `maxWait`, `frame`, and `trackSignals`.

**Returns** a [`WatchHandle`](#watchhandle):
- `dispose()` — cancels pending timers, unsubscribes all static + dynamic signals. Idempotent.
- `trackedSignals()` — snapshot of the currently-subscribed dynamic set (static deps not included). Used internally by `useRefSignalRender` for concurrent-safe snapshotting; exposed for advanced users who need similar hashing.

---

### `WatchHandle`

Returned by `watchSignals`. See [`watchSignals`](#watchsignalsdeps-onfire-options) above for field semantics.

```ts
interface WatchHandle {
  dispose(): void;
  trackedSignals(): RefSignal<any>[];
}
```

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

### `createRefSignalStore<TStore>(factory)`

Creates a module-scope signal store singleton. The factory is called once immediately — the returned store lives for the application's lifetime. No Provider required.

Use [`useRefSignalStore`](#userefsignalstoretstore-store-options) to connect the store to React components. Use [`createRefSignalContext`](#createrefsignalcontexttname-tstore-name-factory) instead when you need per-subtree isolation (separate store per Provider mount).

```ts
import { createRefSignalStore, createRefSignal } from 'react-refsignal';

const gameStore = createRefSignalStore(() => ({
  score: createRefSignal(0),
  level: createRefSignal(1),
  tag:   'game', // non-signal passthrough
}));

// Outside React — direct access, no Provider
gameStore.score.update(42);
gameStore.score.current; // 42
```

Composes with `persist()` and `broadcast()` — wrap the factory before passing it in:

```ts
import { persist } from 'react-refsignal/persist';
import { broadcast } from 'react-refsignal/broadcast';

const gameStore = createRefSignalStore(
  broadcast(
    persist(() => ({ score: createRefSignal(0) }), { key: 'game' }),
    { channel: 'game' },
  ),
);
```

---

### `useRefSignalStore<TStore>(store, options?)`

Connects a signal store to a React component with opt-in re-renders, timing, filtering, and optional value unwrapping. Works with any store object — from `createRefSignalStore`, from context, or plain.

```ts
import { useRefSignalStore, ALL } from 'react-refsignal';

// No re-renders — read signals imperatively
const store = useRefSignalStore(gameStore);

// Re-render when score changes
const store = useRefSignalStore(gameStore, { renderOn: ['score'] });

// Re-render when any signal changes
const store = useRefSignalStore(gameStore, { renderOn: ALL });

// Rate-limit re-renders
const store = useRefSignalStore(gameStore, { renderOn: ['score'], throttle: 100 });

// Plain values + auto-generated setters
const { score, setScore } = useRefSignalStore(gameStore, {
  renderOn: ['score'],
  unwrap: true,
});
```

`options` accepts [`SignalStoreOptions<TStore>`](#signalstoreoptionststore--contexthookoptionststore).

---

### `createRefSignalContext<TName, TStore>(name, factory)`

Eliminates the `createContext` / Provider / `useContext` boilerplate for signal stores. Generates a typed Provider and hook pair with opt-in re-renders and value unwrapping. Components that do not pass `renderOn` never re-render on signal updates.

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
// No re-renders — read signals imperatively (game loops, frame callbacks)
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

**Timing and filter options** — all [`EffectOptions`](#effectoptions) fields are accepted alongside `renderOn` and `unwrap`. `filter` is upgraded to receive the store snapshot directly (see [`SignalStoreOptions`](#signalstoreoptionststore)):

```tsx
// Re-render at most once per 100ms when score changes
const store = useUserContext({ renderOn: ['score'], throttle: 100 });

// Re-render on the next animation frame when any signal changes
const store = useUserContext({ renderOn: ALL, frame: true });

// Re-render only when score exceeds 100 — store snapshot passed in, no closure needed
const store = useUserContext({
  renderOn: ['score'],
  filter: (store) => store.score > 100,
});
```

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

### `createRefSignalContextHook<TStore>(name)`

Creates a React context object and a fully reactive hook **without generating a Provider component**. Use this when you need to write your own Provider body — custom effects, typed props, external subscriptions, or any other logic that belongs in the Provider.

The returned hook accepts the same [`SignalStoreOptions`](#signalstoreoptionststore) as the hook from `createRefSignalContext` — including `renderOn`, `unwrap`, timing options, and a store-aware `filter`.

```tsx
import {
  createRefSignalContextHook,
  createRefSignal,
} from 'react-refsignal';
import { useMemo, useEffect, type ReactNode } from 'react';

type UserStore = {
  name: ReturnType<typeof createRefSignal<string>>;
  score: ReturnType<typeof createRefSignal<number>>;
};

const [UserContext, useUserContext] =
  createRefSignalContextHook<UserStore>('User');

// Write your own Provider — plain React, no new rules
function UserProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const store = useMemo(
    () => ({ name: createRefSignal('Alice'), score: createRefSignal(0) }),
    [],
  );

  useEffect(() => {
    fetchUser(userId).then(u => { store.name.current = u.name; });
  }, [userId]);

  return <UserContext.Provider value={store}>{children}</UserContext.Provider>;
}

// In a component — identical usage to createRefSignalContext
const { name, setName } = useUserContext({ renderOn: ['name'], unwrap: true });
```

`createRefSignalContextHook` returns a **tuple** so you can name both values freely:

```ts
const [UserContext, useUserContext] = createRefSignalContextHook<UserStore>('User');
const [CartContext, useCartContext] = createRefSignalContextHook<CartStore>('Cart');
```

Use `createRefSignalContext` when no custom Provider logic is needed — it is the simpler, preferred option for that case. For extended examples — typed props, async data loading, and external subscriptions — see [Custom Providers](patterns.md#custom-providers-with-createrefsignalcontexthook).

---

### `ALL`

Exported constant equivalent to `'all'`. Use instead of the string literal for better TypeScript inference:

```ts
import { ALL } from 'react-refsignal';

const store = useUserContext({ renderOn: ALL });
```

---

### DevTools

DevTools are a separate subpath — import from `react-refsignal/devtools` to keep them out of your main bundle. Importing the subpath is sufficient to activate them; no explicit enable call is required.

DevTools track every signal update — recording old value, new value, and timestamp — and can surface them in the Redux DevTools Extension for time-travel debugging. They are always active once the subpath is imported — no enable flag needed.

`configureDevTools` is optional. Call it to adjust defaults:

```ts
import { configureDevTools } from 'react-refsignal/devtools';

configureDevTools({
  logUpdates: true,    // log every update to console
  reduxDevTools: true, // integrate with Redux DevTools Extension
  maxHistory: 100,     // max entries in update history (default: 100)
});
```

**Named signals** — pass a debug name to `createRefSignal` or `useRefSignal`:

```ts
const count = useRefSignal(0, 'userCount');
count.getDebugName(); // 'userCount'
```

**Runtime inspection:**

```ts
import { devtools } from 'react-refsignal/devtools';

devtools.getUpdateHistory(); // SignalUpdate[] — { signalId, oldValue, newValue, timestamp }
devtools.clearHistory();
devtools.getSignalByName('userCount'); // RefSignal | undefined
devtools.getAllSignals();              // Array<{ name: string; signal: RefSignal }>
```

---

### Broadcast

Cross-tab sync is a separate subpath — import from `react-refsignal/broadcast`. Importing the subpath is sufficient to activate it; apps that never import it pay zero cost (~1.3 KB gzipped).

> **SSR:** `broadcast` and `useBroadcast` are no-ops when `typeof window === 'undefined'`. The broadcast subpath is safe to import in SSR environments.

For a full tour with examples, see [Cross-tab Broadcast](broadcast.md).

**Signal-level** — `broadcast` option on `createRefSignal` / `useRefSignal`:

```ts
import 'react-refsignal/broadcast';
import { createRefSignal, useRefSignal } from 'react-refsignal';

// Module-scope signal — broadcast lives for the app lifetime
const theme = createRefSignal<'light' | 'dark'>('light', { broadcast: 'theme' });

// Hook — broadcast is cleaned up on unmount
const score = useRefSignal(0, { broadcast: 'game-score' });

// With options
const cursor = useRefSignal({ x: 0, y: 0 }, {
  broadcast: { channel: 'cursor', throttle: 50 },
});
```

**Store-level** — `broadcast()` factory wrapper or `useBroadcast()` hook:

```ts
import { broadcast, useBroadcast } from 'react-refsignal/broadcast';

// Factory wrapper — use with createRefSignalContext
const { GameProvider, useGameContext } = createRefSignalContext(
  'Game',
  broadcast(
    () => ({ level: createRefSignal(1), xp: createRefSignal(0) }),
    { channel: 'game' },
  ),
);

// Hook variant — use inside a custom Provider for lifecycle-aware cleanup
useBroadcast(store, { channel: 'game', throttle: 100 });
```

`BroadcastOptions` and `BroadcastSignalOptions` accept the same timing fields as `EffectOptions` (`throttle`, `debounce`, `maxWait`, `frame`) plus broadcast-specific fields. See the [full reference](broadcast.md#api-reference).

`useBroadcast` returns `{ isBroadcaster, isStableBroadcaster }` (both `ReadonlyRefSignal<boolean>`). With the opt-in `gracePeriod` option, `isStableBroadcaster` flips `true` only after the grace window elapses since gaining leadership — useful for gating work that shouldn't fire during election ambiguity, e.g. `skip: !isStableBroadcaster.current` on a query hook. The same option also extends emit privileges for a former broadcaster within the window so in-flight work propagates instead of being silently dropped. See [Smoothing leadership transitions](broadcast.md#smoothing-leadership-transitions--graceperiod).

---

### Persist

Cross-session persistence is a separate subpath — import from `react-refsignal/persist`. Importing the subpath is sufficient to activate it; apps that never import it pay zero cost.

> **SSR:** `localStorage` and `sessionStorage` adapters are safe on SSR — access errors are caught and hydration resolves immediately with no stored data. The `indexedDBStorage` adapter also no-ops gracefully when `indexedDB` is unavailable.

For a full tour with examples, see [Persist](persist.md).

**Signal-level** — `persist` option on `createRefSignal` / `useRefSignal`:

```ts
import 'react-refsignal/persist';
import { createRefSignal, useRefSignal } from 'react-refsignal';

// Module-scope signal — persists to localStorage under key 'theme'
const theme = createRefSignal<'light' | 'dark'>('light', {
  persist: { key: 'theme' },
});

// Hook — persist subscription is cleaned up on unmount
const score = useRefSignal(0, { persist: { key: 'score' } });

// IndexedDB backend
const highScore = useRefSignal(0, {
  persist: { key: 'high-score', storage: 'indexeddb', dbName: 'myApp' },
});
```

**Store-level** — `persist()` factory wrapper or `usePersist()` hook:

```ts
import { persist, usePersist } from 'react-refsignal/persist';

// Factory wrapper — use with createRefSignalContext
const { GameProvider, useGameContext } = createRefSignalContext(
  'Game',
  persist(
    () => ({ level: createRefSignal(1), xp: createRefSignal(0) }),
    { key: 'game' },
  ),
);

// Hook variant — returns { isHydrated, flush, clear }
const { isHydrated, flush, clear } = usePersist(store, { key: 'game', keys: ['score', 'level'] });
// isHydrated: RefSignal<boolean>    — true once storage read resolves
// flush():    () => Promise<void>    — write current state immediately; awaitable; rejects on adapter failure
// clear():    () => Promise<void>    — wipe storage + reset all signals to defaults
```

**Versioning and migration:**

```ts
persist(factory, {
  key: 'game',
  version: 2,
  migrate: (stored) => ({ xp: 0, ...stored }), // backfill missing field
});

// Or discard the stored snapshot when the old shape isn't worth migrating —
// signals keep their declared defaults.
persist(factory, {
  key: 'game',
  version: 2,
  migrate: () => null,
});
```

**Rate-limiting writes** — same timing fields as `EffectOptions` (`throttle`, `debounce`, `maxWait`, `frame`) prevent high-frequency updates from hammering storage:

```ts
persist(factory, { key: 'game', throttle: 200 });       // at most one write per 200ms
persist(factory, { key: 'game', debounce: 300 });        // write after 300ms quiet
persist(factory, { key: 'game', frame: true });          // one write per animation frame
```

**Filtering writes** — skip writes conditionally without unsubscribing:

```ts
persist(factory, { key: 'game', filter: (store) => store.level > 0 });
```

**`onUnmount`** (`usePersist` only) — called on unmount with `(snapshot, flush)`. Closes the debounce footgun or combines a storage write with a backend save:

```ts
// Guarantee pending debounced write is not lost on unmount
const { isHydrated } = usePersist(store, {
  key: 'game',
  debounce: 500,
  onUnmount: (_, flush) => flush(),
});

// Persist only on unmount — no automatic writes during the session
usePersist(store, {
  key: 'game',
  filter: () => false,
  onUnmount: (_, flush) => flush(),
});
```

**Clearing persisted data:**

```ts
// Controller-level (recommended when you have a usePersist handle)
const { clear } = usePersist(store, { key: 'game' });
await clear(); // cancels pending timers, resets signals, wipes storage key

// Low-level (for signal-level persist or anywhere you only have the key)
import { clearPersistedStorage } from 'react-refsignal/persist';
await clearPersistedStorage('game');                    // localStorage (default)
await clearPersistedStorage('user', 'session');          // shorthand
await clearPersistedStorage('data', myAdapter);          // custom
// Note: only touches storage. Does not reset in-memory signals, and if
// persist is active a queued timer could re-populate the key right after.
```

See the [full reference](persist.md#api-reference) for all options including custom storage adapters, `indexedDBStorage()`, `onHydrated`, `serialize`/`deserialize`, and timing options.
