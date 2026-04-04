# Patterns

← [Back to README](../README.md) · [Concepts](concepts.md) · [API Reference](api.md) · [Broadcast](broadcast.md)

---

- [Custom Providers with `createRefSignalContextHook`](#custom-providers-with-createrefsignalcontexthook)
- [Draggable nodes and connections](#draggable-nodes-and-connections)
- [Signal store with context](#signal-store-with-context)
- [Collections of signals](#collections-of-signals)
- [Derived signals with `useRefSignalMemo`](#derived-signals-with-userefsignalmemo)
- [Batching multiple updates](#batching-multiple-updates)
- [High-frequency data with divergent consumers](#high-frequency-data-with-divergent-consumers)
- [Filtered renders at a threshold](#filtered-renders-at-a-threshold)
- [Module-scope signals and debounced consumers](#module-scope-signals-and-debounced-consumers)

---

## Custom Providers with `createRefSignalContextHook`

`createRefSignalContext` covers the common case — define a factory, get a Provider. When the Provider needs more: accepting props, running effects, subscribing to external sources — reach for `createRefSignalContextHook` and write the Provider body yourself.

The key rule: **`useMemo` owns signal construction** (empty dependency array — signals are stable across re-renders); **`useEffect` owns side effects** (props in the dependency array — reruns when they change). Mixing these up is the most common mistake.

**Props and async data loading**

A `UserProvider` that accepts a `userId` prop, fetches user data, and writes results into signals:

```tsx
import { useMemo, useEffect, type ReactNode } from 'react';
import {
  createRefSignal,
  createRefSignalContextHook,
} from 'react-refsignal';

type UserStore = {
  name: ReturnType<typeof createRefSignal<string>>;
  score: ReturnType<typeof createRefSignal<number>>;
  isLoading: ReturnType<typeof createRefSignal<boolean>>;
};

const [UserContext, useUserContext] =
  createRefSignalContextHook<UserStore>('User');

function UserProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  // Empty deps — signals are constructed once and remain stable.
  const store = useMemo(
    () => ({
      name: createRefSignal(''),
      score: createRefSignal(0),
      isLoading: createRefSignal(false),
    }),
    [],
  );

  // userId in deps — re-fetches whenever userId changes.
  // .update() notifies subscribers so components with renderOn see the new values.
  useEffect(() => {
    store.isLoading.update(true);
    fetchUser(userId).then((user) => {
      store.name.update(user.name);
      store.score.update(user.score);
      store.isLoading.update(false);
    });
  }, [userId]);

  return <UserContext.Provider value={store}>{children}</UserContext.Provider>;
}

// Re-renders when isLoading or name changes — hook usage is identical
// to createRefSignalContext
function UserProfile() {
  const { isLoading, name } = useUserContext({
    renderOn: ['isLoading', 'name'],
    unwrap: true,
  });
  if (isLoading) return <span>Loading…</span>;
  return <span>{name}</span>;
}
```

**Subscribing to external events**

When the data source is long-lived (WebSocket, EventEmitter, `window` events), the Provider subscribes in `useEffect` and writes to signals on each incoming message. Cleanup handles unsubscription:

```tsx
import { useMemo, useEffect, type ReactNode } from 'react';
import { createRefSignal, createRefSignalContextHook } from 'react-refsignal';

type MarketStore = {
  price: ReturnType<typeof createRefSignal<number>>;
  volume: ReturnType<typeof createRefSignal<number>>;
};

const [MarketContext, useMarketContext] =
  createRefSignalContextHook<MarketStore>('Market');

function MarketDataProvider({
  children,
  symbol,
}: {
  children: ReactNode;
  symbol: string;
}) {
  const store = useMemo(
    () => ({
      price: createRefSignal(0),
      volume: createRefSignal(0),
    }),
    [],
  );

  useEffect(() => {
    const ws = new WebSocket(`wss://feed.example.com/${symbol}`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      store.price.update(msg.price);
      store.volume.update(msg.volume);
    };
    return () => ws.close();
  }, [symbol]);

  return (
    <MarketContext.Provider value={store}>{children}</MarketContext.Provider>
  );
}
```

When `symbol` changes, the old WebSocket is closed and a new one is opened — signals keep their identity, so all subscribers stay connected without re-mounting.

> **`useImperativeHandle`** follows the same pattern: expose signal references through a forwarded ref so parent components can call `.update()` imperatively. The Provider body stays plain React — no new rules apply.

---

## Draggable nodes and connections

**[Live demo on StackBlitz](https://stackblitz.com/edit/vitejs-vite-jurlgxkf?file=index.html)**

The scenario from the README's Why section: a graph where dragging a node moves it and updates all attached connections — with zero React re-renders during the drag.

Each node's position lives in a signal. A `Connection` subscribes to exactly its two endpoint signals. Moving node A notifies only the connections attached to A — node B and unrelated connections never know anything happened.

```tsx
import { useRef } from 'react';
import { useRefSignal, useRefSignalEffect } from 'react-refsignal';
import type { RefSignal } from 'react-refsignal';

type Position = { x: number; y: number };

function DraggableNode({ position }: { position: RefSignal<Position> }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Keep DOM in sync with the signal — no re-render
  useRefSignalEffect(() => {
    if (ref.current) {
      ref.current.style.transform =
        `translate(${position.current.x}px, ${position.current.y}px)`;
    }
  }, [position]);

  return (
    <div
      ref={ref}
      style={{ position: 'absolute', width: 80, height: 40, cursor: 'grab' }}
      onPointerDown={() => { dragging.current = true; }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        position.current.x += e.movementX;
        position.current.y += e.movementY;
        position.notifyUpdate(); // notifies subscribers — component does not re-render
      }}
    />
  );
}

function Connection({ from, to }: { from: RefSignal<Position>; to: RefSignal<Position> }) {
  const lineRef = useRef<SVGLineElement>(null);

  // Redraws when either endpoint moves — independently, no React re-render
  useRefSignalEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    el.setAttribute('x1', String(from.current.x));
    el.setAttribute('y1', String(from.current.y));
    el.setAttribute('x2', String(to.current.x));
    el.setAttribute('y2', String(to.current.y));
  }, [from, to]);

  return <line ref={lineRef} stroke="currentColor" strokeWidth={2} />;
}

function Graph() {
  const posA = useRefSignal<Position>({ x: 100, y: 150 });
  const posB = useRefSignal<Position>({ x: 400, y: 150 });
  const posC = useRefSignal<Position>({ x: 250, y: 300 });

  return (
    <div style={{ position: 'relative', width: 600, height: 400 }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <Connection from={posA} to={posB} />
        <Connection from={posB} to={posC} />
        <Connection from={posA} to={posC} />
      </svg>
      <DraggableNode position={posA} />
      <DraggableNode position={posB} />
      <DraggableNode position={posC} />
    </div>
  );
}
```

Drag any node — only the connections attached to it redraw. `Graph` never re-renders. `DraggableNode` never re-renders. The `Connection` effects run directly, synchronously, bypassing React entirely.

---

## Signal store with context

`createRefSignalContext` builds a typed store where each component opts into re-renders only for the signals it uses. Components that don't pass `renderOn` never re-render on signal updates.

```tsx
import { useEffect } from 'react';
import { createRefSignal, createRefSignalContext } from 'react-refsignal';

const { GameProvider, useGameContext } = createRefSignalContext('Game', () => ({
  playerName: createRefSignal('Player 1'),
  score: createRefSignal(0),
  lives: createRefSignal(3),
  isPaused: createRefSignal(false),
}));

function App() {
  return (
    <GameProvider>
      <HUD />
      <GameCanvas />
      <PauseMenu />
    </GameProvider>
  );
}

// Re-renders only when score or lives change
function HUD() {
  const { score, lives } = useGameContext({ renderOn: ['score', 'lives'], unwrap: true });
  return (
    <div>
      <span>Score: {score}</span>
      <span>Lives: {lives}</span>
    </div>
  );
}

// Never re-renders — reads signals imperatively in a loop
function GameCanvas() {
  const store = useGameContext(); // no renderOn

  useEffect(() => {
    let id: number;
    const tick = () => {
      if (!store.isPaused.current) {
        store.score.update(store.score.current + 1);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [store]);

  return <canvas />;
}

// Re-renders only when isPaused changes
function PauseMenu() {
  const { isPaused, setIsPaused } = useGameContext({ renderOn: ['isPaused'], unwrap: true });
  if (!isPaused) return null;
  return <button onClick={() => setIsPaused(false)}>Resume</button>;
}
```

---

## Collections of signals

Each item in a collection can be its own signal. Updating one item re-renders only the component rendering that item — the list component is unaffected.

```tsx
import { createRefSignal, createRefSignalContext, useRefSignalRender, batch } from 'react-refsignal';
import type { RefSignal } from 'react-refsignal';

type Product = { id: number; name: string; price: number };

const { ShopProvider, useShopContext } = createRefSignalContext('Shop', () => ({
  products: createRefSignal<RefSignal<Product>[]>([]),
}));

// Re-renders when the products array changes (item added or removed)
function ProductList() {
  const store = useShopContext({ renderOn: ['products'] });
  return (
    <>
      {store.products.current.map((productSignal) => (
        <ProductItem key={productSignal.current.id} signal={productSignal} />
      ))}
    </>
  );
}

// Re-renders only when this specific product changes — other products are unaffected
function ProductItem({ signal }: { signal: RefSignal<Product> }) {
  useRefSignalRender([signal]);
  return <div>{signal.current.name} — ${signal.current.price}</div>;
}

// Actions — updating one product re-renders only that ProductItem
function useShopActions() {
  const store = useShopContext();

  const addProduct = (product: Product) => {
    store.products.update([...store.products.current, createRefSignal(product)]);
  };

  const updatePrice = (signal: RefSignal<Product>, newPrice: number) => {
    signal.update({ ...signal.current, price: newPrice });
  };

  // Batch update: one notification per signal, fired together after the batch
  const applyDiscount = (signals: RefSignal<Product>[], pct: number) => {
    batch(() => {
      signals.forEach((s) => s.update({ ...s.current, price: s.current.price * (1 - pct) }));
    });
  };

  return { addProduct, updatePrice, applyDiscount };
}
```

---

## Derived signals with `useRefSignalMemo`

Compute a signal's value from other signals or React state. The factory runs exactly once per change regardless of the source.

```tsx
import { useState } from 'react';
import { useRefSignal, useRefSignalMemo, useRefSignalEffect } from 'react-refsignal';

function PriceCalculator() {
  const basePrice = useRefSignal(100);
  const [taxRate, setTaxRate] = useState(0.2);

  // Recomputes when basePrice fires OR when taxRate (React state) changes
  const total = useRefSignalMemo(
    () => basePrice.current * (1 + taxRate),
    [basePrice, taxRate],
  );

  useRefSignalEffect(() => {
    console.log('Total price:', total.current);
  }, [total]);

  return (
    <div>
      <button onClick={() => basePrice.update(basePrice.current + 10)}>
        Increase base price
      </button>
      <button onClick={() => setTaxRate((r) => r + 0.05)}>
        Increase tax rate
      </button>
    </div>
  );
}
```

Derived signals are fully composable:

```tsx
const count = useRefSignal(1);
const doubled = useRefSignalMemo(() => count.current * 2, [count]);
const quadrupled = useRefSignalMemo(() => doubled.current * 2, [doubled]);
```

---

## Batching multiple updates

Use `batch` when multiple signals should notify their subscribers together with a single shared `lastUpdated` timestamp.

**Auto-inference** (recommended) — tracks `.update()` calls automatically:

```ts
import { batch } from 'react-refsignal';

batch(() => {
  playerX.update(10);
  playerY.update(20);
  health.update(80);
});
// Each signal's listeners called exactly once, after the batch
// All three receive the same lastUpdated value
```

**Explicit deps** — required when mutating `.current` directly or calling `.notify()` manually:

```ts
batch(() => {
  playerX.current = 10;
  playerY.current = 20;
}, [playerX, playerY]);
```

> **Important:** In auto-inference mode, only `.update()` calls are tracked. Calls to `.notify()` or `.notifyUpdate()` inside an auto-inference batch fire immediately. Use explicit deps if you need to batch those.

**Nested batches** — the inner batch flushes when it completes; the outer continues accumulating:

```ts
batch(() => {
  playerX.update(10);

  batch(() => {
    playerY.update(20); // flushed here — playerY listeners called with value 20
  });

  playerX.update(30); // overwrites 10; playerX listeners called at outer end with value 30
});
```

**Error safety** — if the callback throws, the batch flushes via `finally` before rethrowing:

```ts
try {
  batch(() => {
    signalA.update(1);
    throw new Error('something went wrong');
  });
} catch (e) {
  // signalA listeners were still called
}
```

---

The patterns above each focus on one signal consumed one way at a time. The patterns below show a different dimension: **one signal consumed simultaneously by multiple independent subscribers, each with its own update rate and its own relationship to React's render cycle**. This is the architectural property that most clearly separates `react-refsignal` from state libraries — consumers are decoupled not just in what they render, but in when and how they receive updates.

Each example uses one subscription mechanism per component for clarity. In practice, nothing prevents mixing them in the same component — `useRefSignalEffect` for the imperative path and a context hook with `renderOn` for the render path coexist naturally:

```tsx
function AudioMonitor() {
  // Re-renders at most every 500ms when rms changes
  const store = useAudioContext({ renderOn: ['rms'], throttle: 500 });

  // Fires on every buffer update — completely independent of the render cycle
  useRefSignalEffect(() => {
    sendAudioRealtime(store.buffer.current);
  }, [store.buffer]);

  return <meter value={store.rms.current} min={0} max={1} />;
}
```

The effect fires on every `buffer` update. The component re-renders at most every 500ms on `rms` changes. Both run independently in the same component.

---

## High-frequency data with divergent consumers

A single audio buffer signal drives three completely independent consumers at three completely different rates — none of them aware of the others.

```tsx
import { useMemo, useEffect, useRef } from 'react';
import {
  createRefSignal,
  createRefSignalContextHook,
  useRefSignalEffect,
} from 'react-refsignal';

type AudioStore = {
  buffer: ReturnType<typeof createRefSignal<Float32Array>>;
  rms: ReturnType<typeof createRefSignal<number>>;
};

const [AudioContext, useAudioContext] =
  createRefSignalContextHook<AudioStore>('Audio');

function AudioProvider({ children }: { children: React.ReactNode }) {
  const store = useMemo(
    () => ({
      buffer: createRefSignal<Float32Array>(new Float32Array(0)),
      rms: createRefSignal(0),
    }),
    [],
  );

  useEffect(() => {
    // Audio worklet feeds raw PCM many times per second
    const processor = connectAudioWorklet((chunk: Float32Array) => {
      store.buffer.update(chunk);
      store.rms.update(computeRms(chunk));
    });
    return () => processor.disconnect();
  }, [store]);

  return <AudioContext.Provider value={store}>{children}</AudioContext.Provider>;
}

// Consumer 1 — real-time sender: fires on every signal notification, React never involved
function AudioSender() {
  const store = useAudioContext(); // no renderOn — this component never re-renders

  useRefSignalEffect(() => {
    sendAudioRealtime(store.buffer.current);
  }, [store.buffer]);

  return null;
}

// Consumer 2 — visualization: re-renders at most every 500ms
function AudioVisualizer() {
  const store = useAudioContext({ renderOn: ['rms'], throttle: 500 });

  return (
    <div>
      <meter value={store.rms.current} min={0} max={1} />
      <span>{(store.rms.current * 100).toFixed(1)} dBFS</span>
    </div>
  );
}

// Consumer 3 — canvas waveform: multiple buffer updates per frame collapse into one draw
function WaveformCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const store = useAudioContext(); // no renderOn — imperative canvas draw, no re-render

  useRefSignalEffect(
    () => { drawWaveform(canvasRef.current, store.buffer.current); },
    [store.buffer],
    { rAF: true },
  );

  return <canvas ref={canvasRef} width={800} height={200} />;
}
```

`AudioSender`, `AudioVisualizer`, and `WaveformCanvas` all subscribe to the same signals. The signal has no knowledge of its consumers. `AudioSender` runs on every notification with no delay. `AudioVisualizer` re-renders at most twice per second. `WaveformCanvas` draws at most once per animation frame. Three update rates, one signal, zero coordination code.

---

## Filtered renders at a threshold

Subscribing to a signal is not the same as re-rendering on it. `filter` lets a component subscribe to a signal but only schedule a React re-render when a condition on the store's current values passes — all other notifications are invisible to React.

```tsx
import { createRefSignal, createRefSignalContext, useRefSignalEffect } from 'react-refsignal';

const { SensorProvider, useSensorContext } = createRefSignalContext('Sensor', () => ({
  temperature: createRefSignal(20),
  pressure: createRefSignal(1013),
}));

// Always-on telemetry — fires on every update, no React involvement
function TelemetryReporter() {
  const store = useSensorContext(); // no renderOn

  useRefSignalEffect(() => {
    telemetry.send({ temperature: store.temperature.current, pressure: store.pressure.current });
  }, [store.temperature, store.pressure]);

  return null;
}

// Only re-renders when temperature crosses the critical threshold.
// Updates below 80° are invisible to React — no reconciliation work is done.
function OverheatAlert() {
  const store = useSensorContext({
    renderOn: ['temperature'],
    filter: (store) => store.temperature > 80,
  });

  if (store.temperature.current <= 80) return null;
  return <div className="alert">OVERHEAT: {store.temperature.current}°C</div>;
}

// Throttled gauge — re-renders at most once per second regardless of signal frequency
function TemperatureGauge() {
  const store = useSensorContext({ renderOn: ['temperature'], throttle: 1000 });
  return <meter value={store.temperature.current} min={-50} max={150} />;
}
```

When the sensor sends 78°C → 79°C → 81°C, `TelemetryReporter` has seen all three values in real time. `TemperatureGauge` may have seen one or two depending on the throttle window. `OverheatAlert` re-renders exactly once — on 81°C, the first notification that passes the filter.

---

## Module-scope signals and debounced consumers

Signals do not need to live inside components or context factories. `createRefSignal` at module scope creates a signal that lives for the application's lifetime and can be imported directly by any component — no Provider, no context.

```tsx
import { createRefSignal, useRefSignalEffect, useRefSignalRender } from 'react-refsignal';

// Created once at module load. Any component can import and subscribe directly.
export const btcPrice = createRefSignal<number>(0, 'btcPrice');
export const btcVolume = createRefSignal<number>(0, 'btcVolume');

// Connect the WebSocket feed once at application startup
const ws = new WebSocket('wss://feed.example.com/btc');
ws.onmessage = (e) => {
  const { price, volume } = JSON.parse(e.data) as { price: number; volume: number };
  btcPrice.update(price);
  btcVolume.update(volume);
};

// Consumer 1 — order execution: every tick matters, React never involved
function OrderManager() {
  useRefSignalEffect(() => {
    checkStopLossConditions(btcPrice.current);
  }, [btcPrice]);

  return null;
}

// Consumer 2 — price ticker: throttled display, at most 5 re-renders per second
function PriceTicker() {
  useRefSignalRender([btcPrice], { throttle: 200 });
  return <span>${btcPrice.current.toLocaleString()}</span>;
}

// Consumer 3 — volume chart: debounced with a maxWait ceiling.
// Waits for 300ms of quiet before redrawing, but guarantees a flush every 1s
// during sustained bursts — preventing indefinite deferral on a busy feed.
function VolumeChart() {
  useRefSignalRender([btcVolume], { debounce: 300, maxWait: 1000 });
  return <BarChart data={btcVolume.current} />;
}
```

`btcPrice` and `btcVolume` are plain module-level constants. `OrderManager`, `PriceTicker`, and `VolumeChart` can live in completely unrelated parts of the component tree — they share the signal reference directly, not through a React context. Module-scope signals are the right choice when the data source is global and long-lived and no factory logic is needed.

`debounce: 300, maxWait: 1000` is the correct shape for expensive consumers: defer work while updates are frequent, but never fall more than one second behind on a sustained stream.
