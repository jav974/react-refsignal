# Pulse

← [Back to README](../README.md) · [API Reference](api.md) · [Concepts](concepts.md) · [Patterns](patterns.md) · [Decision Tree](decision-tree.md)

---

A **pulse signal** is a signal that fires on a schedule. `.current` is `performance.now()` at the last tick; subscribers run; computed signals downstream recompute. There is no `setInterval`-in-`useEffect` to write, no cleanup to forget, no timer to coordinate across components.

It replaces three patterns in one primitive:

1. The classic `useEffect(() => { const id = setInterval(...); return () => clearInterval(id); }, [])` dance — declarative now.
2. The "force re-render every minute so 'X ago' updates" pattern — one shared `now` signal, scoped subscribers, no global re-renders.
3. The hand-rolled animation loop — `dt`/`tick`/`elapsed` available without bookkeeping.

- [Quick start](#quick-start)
- [The shape of a pulse signal](#the-shape-of-a-pulse-signal)
- [Lifecycle](#lifecycle)
- [Drivers — `setInterval` vs `requestAnimationFrame`](#drivers--setinterval-vs-requestanimationframe)
- [Reactive cadences with `updatePulse`](#reactive-cadences-with-updatepulse)
- [Recipes](#recipes)
  - [Live "X ago" timestamps](#live-x-ago-timestamps)
  - [Auth-token refresh](#auth-token-refresh)
  - [Game loop with `dt`](#game-loop-with-dt)
  - [Shared tick via provider — one timer, many components](#shared-tick-via-provider--one-timer-many-components)
  - [Heartbeat that reacts to game state](#heartbeat-that-reacts-to-game-state)
  - [Polling with exponential backoff](#polling-with-exponential-backoff)
- [What pulse can't compose with](#what-pulse-cant-compose-with)
- [SSR](#ssr)

---

## Quick start

```ts
import { createPulseRefSignal, usePulseRefSignal } from 'react-refsignal';

// Outside React — module scope, context factories, anywhere.
const now      = createPulseRefSignal('1000ms'); // every second
const loop     = createPulseRefSignal('60fps');  // throttled to 60
const frame    = createPulseRefSignal('frame');  // every frame, native rate
const everyHalf = createPulseRefSignal(500);     // number — same as '500ms'

// Inside React — lifetime tied to the component.
function Clock() {
  const now = usePulseRefSignal('1000ms');
  useRefSignalRender([now]);
  return <span>{new Date().toLocaleTimeString()}</span>;
}
```

Four accepted rate formats:

| Form | Driver | Note |
|---|---|---|
| `number` (e.g. `100`) | `setInterval` | ms — same as the `'Nms'` form |
| `'Nms'` (e.g. `'250ms'`, `'16.67ms'`) | `setInterval` | ms with explicit unit |
| `'Nfps'` (e.g. `'60fps'`, `'30fps'`) | `requestAnimationFrame` | throttled to at most N/sec, paused on hidden tabs |
| `'frame'` | `requestAnimationFrame` | every frame at the display's native rate (60Hz / 120Hz / 144Hz / …), no throttle. `'raf'` is an accepted synonym — both are first-class. |

Decimals are accepted in both numeric string forms.

---

## The shape of a pulse signal

`PulseRefSignal` extends `ReadonlyRefSignal<number>` with three additional readonly fields — `dt`, `tick`, `elapsed`. They look like parallel reactive state, but they aren't: you can't `watch(loop.dt, …)`. They are **tick-context metadata** — values coherent with `.current` *at the moment subscribers fire*, like `event.timeStamp` inside a DOM event handler.

```ts
const loop = createPulseRefSignal('60fps');

loop.subscribe(() => {
  loop.current; // performance.now() at this tick — the reactive value
  loop.dt;      // ms since previous tick — context for THIS fire
  loop.tick;    // 1, 2, 3, …
  loop.elapsed; // ms since first tick of this session
});
```

The reactive surface is still `.current`. The metadata rides along.

| Field | Meaning |
|---|---|
| `current` | `performance.now()` at the most recent tick. Reactive — bumps `lastUpdated`, fires subscribers. |
| `dt` | Milliseconds since the previous tick. `0` between sessions; on the first tick, `0` (or the time since timer start, whichever the implementation deems honest — see [Lifecycle](#lifecycle)). |
| `tick` | Number of ticks fired in the current session. `0` before the first fire, increments by `1` each tick. |
| `elapsed` | Milliseconds since the first tick of the current session. `0` until the second tick. |

> **Why a number, not an object?**  Most use cases (clocks, "X ago", token TTLs) want a primitive. Forcing every reader to write `now.current.now` to get the time would tax the dominant case to make game-loop code marginally cleaner. The metadata-on-the-side shape pays the cost where the cost lands: game/sim code, where `loop.dt` is one identifier instead of one destructure.

---

## Lifecycle

Pulse signals are **lazy**. The timer only runs while the signal has at least one subscriber:

- `0 → 1` subscriber transition → timer starts; `dt`/`tick`/`elapsed` reset to `0`.
- `1 → 0` subscriber transition → timer stops.
- `.dispose()` (only on `createPulseRefSignal`'s return; the React hook owns its own disposal) → timer stops, subscribers cleared.

**Session reset**, not accumulating state. If subscribers go to zero and back — e.g., a component using the signal unmounts and a sibling remounts — the next session starts fresh: `tick = 0`, `elapsed = 0`. The first new tick's `dt` is measured from the new session start, not from whenever the previous session stopped. Otherwise an idle gap would manifest as a single huge `dt` spike — the wrong thing for game/sim code, and meaningless for clocks.

A pulse signal that is never subscribed to never installs a timer. It costs nothing.

---

## Drivers — `setInterval` vs `requestAnimationFrame`

The rate format picks the driver:

- **`'frame'` → `requestAnimationFrame`, every frame.** Follows the display's native refresh rate — 60Hz, 120Hz, 144Hz, whatever the user has. No throttle gate, no target fps to pick, no skipped frames on a faster display. Pauses on hidden tabs. Use this when "as fast as the screen draws" is what you actually want — game loops, frame-based animation, FPS counters. `'raf'` is an accepted synonym.
- **`'Nfps'` → `requestAnimationFrame`, throttled to N.** Same RAF driver, but skips frames to cap firing at N/sec. Useful for power-saving (`'30fps'` for a passive animation) or for a target rate that should hold even on a 144Hz display. Note that `'60fps'` on a 60Hz display effectively matches `'frame'`; on a 120Hz display it actively throttles you to ~60. If you're not sure which you want, `'frame'` is usually it.
- **`number` / `'Nms'` → `setInterval`.** Continues firing on hidden tabs (subject to browser's background-tab throttling). Drift may accumulate over long sessions. Use this for clocks, polling, heartbeats, token refresh — anything where missing a tick on a hidden tab would be a bug, not a feature.

You'd reach for `'Nms'` over a number when you want the unit to show up in code review (`'250ms'` reads as a duration; `250` could be anything).

---

## Reactive cadences with `updatePulse`

The rate isn't only configuration — it's also data. A heartbeat speeds up under stress and slows at rest. Polling backs off when the server is slow. Frame rate adapts to a perf budget. For all of these, the cadence itself flows through the reactive system. `updatePulse(newRate)` is the method that lets pulse signals participate.

```ts
const heartbeat = createPulseRefSignal('1000ms');
heartbeat.updatePulse('500ms'); // double the rate
```

Semantics:

- **Validates the new rate** — same parser as the constructor; throws on invalid. The timer is not disturbed if validation fails.
- **Continuity preserved** — `tick` and `elapsed` keep accumulating across the rate change. Only `lastTickTime` is reset, so the next `dt` is measured from the rate-change moment rather than spanning the restart at the old cadence.
- **Idle store** — if no subscribers are attached, `updatePulse` just stores the new rate. The next `0 → 1` subscriber transition triggers the usual full-session reset and uses the new rate.
- **Driver may switch** — `updatePulse('1000ms' → '60fps')` swaps the `setInterval`-driven loop for a `requestAnimationFrame` loop transparently.

> **In React, drive `updatePulse` with `useRefSignalEffect`, not `useEffect`.** A `useEffect(..., [rate.current])` only re-evaluates when the *component* re-renders — but signals updating doesn't trigger re-renders by default, so the effect fires once on mount and never again. `useRefSignalEffect` subscribes to the signal directly:
>
> ```ts
> useRefSignalEffect(() => {
>   pulse.updatePulse(rateSignal.current);
> }, [rateSignal]);
> ```

> **Cycle warning** — pulse can now participate in reactive feedback loops (a tick updates X, X drives the rate, the new rate updates the pulse). Same shape as any cycle in the reactive graph: it's the user's responsibility to ensure convergence (idempotent rate functions, dampening, hysteresis bands).

---

## Recipes

### Live "X ago" timestamps

The canonical case. Every social/feed/dashboard app has it. The naive solution forces a global `setInterval(forceUpdate, 60_000)` at the app root, re-rendering everything once a minute. With pulse, you have a `now` signal pulsing once a minute, and only the components reading it re-render — exactly when needed, never otherwise.

```tsx
import { createPulseRefSignal, useRefSignalRender } from 'react-refsignal';

// Module-scope: one signal for the whole app, lazily started by the first reader.
const now = createPulseRefSignal('60000ms'); // every minute

function RelativeTime({ at }: { at: number }) {
  useRefSignalRender([now]);
  return <time>{formatAgo(at, now.current)}</time>;
}
```

Mount fifty `<RelativeTime />` cells; you get fifty subscribers on one `setInterval`. Unmount them all and the timer stops. There is no global re-render — only the `<RelativeTime />` instances re-render, every minute, in lockstep.

### Auth-token refresh

```ts
import { createPulseRefSignal } from 'react-refsignal';

// Refresh four minutes before a five-minute token expires.
const refreshTick = createPulseRefSignal(4 * 60 * 1000);
refreshTick.subscribe(() => {
  void refreshAuthToken();
});
```

That's it. No `useEffect`, no stale-closure ref dance, no cleanup forgotten on a route change. The subscription lives where the auth code lives.

### Game loop with `dt`

```tsx
function Particles() {
  const loop = usePulseRefSignal('frame');

  useRefSignalEffect(() => {
    advancePhysics(loop.dt);   // ms since previous tick
    if (loop.tick % 60 === 0) emitDebugFrame();
    drawScene(canvasRef.current!);
  }, [loop]);

  return <canvas ref={canvasRef} />;
}
```

`loop.dt` is the delta you'd normally compute by tracking `performance.now()` and a `last` ref. `loop.tick` gates effects that should happen every Nth frame. `loop.elapsed` drives time-based easing without a separate clock signal.

For variable-step physics this is what you want; for fixed-step physics you'd accumulate `loop.dt` and step at a fixed rate inside the effect. Pulse gives you the heartbeat; the simulation strategy is yours.

### Shared tick via provider — one timer, many components

This is the architectural pattern that elevates pulse from "syntactic sugar over `setInterval`" to a primitive that changes how you organize time-driven UI.

Without it, fifty "X ago" cells means fifty `setInterval` instances, each with its own drift, each cleaning up on unmount, each re-rendering its component once a minute on a slightly different wall-clock instant. Cumulative cascade: cells flip from "5 minutes ago" to "6 minutes ago" at staggered moments; the eye notices.

With it, fifty cells means **one** timer (lazily started when the first cell mounts), perfectly synchronized fires, zero drift between them.

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import {
  usePulseRefSignal,
  useRefSignalRender,
  type PulseRefSignal,
} from 'react-refsignal';

const NowContext = createContext<PulseRefSignal | null>(null);

export function NowProvider({ children }: { children: ReactNode }) {
  const now = usePulseRefSignal('60000ms');
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export function useNow(): PulseRefSignal {
  const now = useContext(NowContext);
  if (!now) throw new Error('useNow must be used inside NowProvider');
  return now;
}

function RelativeTime({ at }: { at: number }) {
  const now = useNow();
  useRefSignalRender([now]);
  return <time>{formatAgo(at, now.current)}</time>;
}
```

Wrap the relevant subtree in `<NowProvider>` and every consumer shares one timer. The timer doesn't even start until at least one consumer subscribes, and stops if they all leave — automatic, no orchestration.

Same shape works at any cadence: a `<TickProvider rate="60fps">` for animation, a `<HeartbeatProvider>` for connection pings. One timer per cadence, regardless of how many components need it.

### Heartbeat that reacts to game state

The cadence is data: heart-beats-per-minute is driven by stamina and danger signals. `updatePulse` makes the pulse signal a first-class participant in the reactive graph instead of a fixed clock.

```tsx
import {
  useRefSignal,
  useRefSignalMemo,
  useRefSignalEffect,
  usePulseRefSignal,
  type PulseRate,
} from 'react-refsignal';

function Heart() {
  const stamina = useRefSignal(100);
  const danger = useRefSignal(0);

  // Computed signal: derives the desired cadence from gameplay state.
  const heartRate = useRefSignalMemo(
    () => `${msPerBeat(stamina.current, danger.current)}ms` as PulseRate,
    [stamina, danger],
  );

  // The pulse — initial cadence is the resting rate; updatePulse is what
  // wires the cadence to the computed.
  const heartbeat = usePulseRefSignal('1000ms');

  // Direct signal subscription — no React render needed, no stale closures.
  useRefSignalEffect(() => {
    heartbeat.updatePulse(heartRate.current);
  }, [heartRate]);

  // Drive a visual pulse on each beat.
  useRefSignalEffect(() => {
    pulseAnimation.fire();
  }, [heartbeat]);

  return <HeartIcon ref={pulseAnimation.ref} />;
}
```

Two signals, one computed, two effects, no `setInterval`-in-`useEffect`, no stale-closure dance, no re-renders. The whole behavior is in the reactive graph — change the model (`stamina.update(50)`) and the visuals follow.

### Polling with exponential backoff

Backoff is a domain pattern — polling, retry — built on top of `updatePulse`. Pulse stays minimal; the backoff lives in user-land and gets ten lines of code.

```tsx
import { useRef } from 'react';
import { usePulseRefSignal, type PulseRefSignal } from 'react-refsignal';

interface BackoffPulse {
  pulse: PulseRefSignal;
  onError: () => void;
  onSuccess: () => void;
}

function useBackoffPulse(
  initialMs: number,
  { maxMs, factor = 2 }: { maxMs: number; factor?: number },
): BackoffPulse {
  const pulse = usePulseRefSignal(initialMs);
  const currentMs = useRef(initialMs);
  return {
    pulse,
    onError: () => {
      currentMs.current = Math.min(currentMs.current * factor, maxMs);
      pulse.updatePulse(currentMs.current);
    },
    onSuccess: () => {
      currentMs.current = initialMs;
      pulse.updatePulse(currentMs.current);
    },
  };
}

function FeedPoller() {
  const { pulse, onError, onSuccess } = useBackoffPulse(1000, { maxMs: 30_000 });

  useRefSignalEffect(() => {
    void fetch('/api/feed')
      .then((r) => (r.ok ? onSuccess() : onError()))
      .catch(onError);
  }, [pulse]);

  return null;
}
```

On error, the polling interval doubles up to a 30s ceiling. On success, it resets. The library exposes nothing new — the recipe is the composition. Add jitter, max-attempts, abort-on-unmount as the use case demands; none of it needs to grow the core API.

---

## What pulse can't compose with

The TypeScript signature of `createPulseRefSignal` doesn't expose `persist` or `broadcast` options. They're absent intentionally:

- **Pulse + persist** — the value being persisted is `performance.now()`, which is reference-frame-bound to the current document (`performance.timeOrigin`). On a future page load it's interpreted in a different reference frame and is meaningless. Persisting it would flood storage with useless writes. *If you want autosave-on-a-cadence, that's a different pattern: a draft signal with `persist`, a separate pulse signal whose subscriber calls `saveToServer(draft.current)`. Two signals, composed at the consumer.*
- **Pulse + broadcast** — same reference-frame issue (each tab has its own `timeOrigin`, so the broadcast value is unintelligible to other tabs), plus a many-to-many tick storm where every tab sends its own ticks to every other tab. The "shared tick across tabs" use case exists but requires leader election, which isn't this primitive.

If you need either of these compositions, the pattern is "two signals, composed at the consumer level" — not enhancers stacked on a pulse signal.

### A pulse signal *inside* a persisted or broadcast store has the same problem

The signal-level type guard does **not** extend through stores. A `PulseRefSignal` placed inside a `persist()`-wrapped or `broadcast()`-wrapped store factory compiles cleanly and breaks at runtime in the same two ways:

```ts
// ✗ Don't.
const factory = persist(
  () => ({
    cursor: createRefSignal({ x: 0, y: 0 }),
    now:    createPulseRefSignal('1000ms'), // every tick → store snapshot changes → flush
  }),
  { key: 'session' },
);
```

Every tick is a state change in the store, so the enhancer fires on every tick: persist flushes the snapshot to storage, broadcast sends the whole thing to other tabs. Both operate on `performance.now()`-shaped data that is meaningless outside this document. The pulse signal being typed as `ReadonlyRefSignal` at the surface doesn't protect it — at runtime, broadcast adapters call `.update()` directly on the underlying object, so foreign tabs happily overwrite a local tab's `.current` with their own `performance.now()` values.

The rule generalizes: **pulse signals do not belong in any container that serializes or transports their value**. The composition that does work is:

- pulse signal **adjacent to** the persisted / broadcasted store, not inside it
- pulse subscribers read from / write to that store as needed

```tsx
<NowProvider>                       {/* PulseRefSignal */}
  <SessionStoreProvider>            {/* broadcast / persist'd store */}
    <App />
  </SessionStoreProvider>
</NowProvider>
```

Components that need both pull from both. The pulse drives effects that read or write the persisted store — but pulse itself never enters it.

---

## SSR

`createPulseRefSignal` and `usePulseRefSignal` construct cleanly on the server: `.current` initializes to `performance.now()` (Node provides it), `dt`/`tick`/`elapsed` are `0`. No timer is installed when `typeof window === 'undefined'`. Subscribing on the server is a no-op for tick purposes — the listener registers, but no tick will fire.

On hydration, the timer starts naturally on the first client-side subscription. There is no manual hydration step.
