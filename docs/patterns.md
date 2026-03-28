# Patterns

## High-frequency updates — game loops and canvas

The primary use case for react-refsignal is updating values many times per second without triggering React's render cycle.

```tsx
import { useEffect, useRef } from 'react';
import { useRefSignal, useRefSignalEffect } from 'react-refsignal';

function GameCanvas() {
  const position = useRefSignal({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Animation loop — mutates position directly for performance, then fires
  // notify() (not notifyUpdate()) so useRefSignalRender is never triggered
  useEffect(() => {
    let id: number;

    const tick = () => {
      position.current.x += 1;
      position.notify();
      id = requestAnimationFrame(tick);
    };

    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  // Redraws whenever notify() fires — no React re-render
  useRefSignalEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 800, 600);
    ctx.fillRect(position.current.x, position.current.y, 20, 20);
  }, [position]);

  return <canvas ref={canvasRef} width={800} height={600} />;
}
```

`notify()` is used here rather than `notifyUpdate()` because `lastUpdated` never needs to change — no component renders on this signal. `useRefSignalEffect` fires on both.

---

## Signal store with context

`createRefSignalContext` builds a typed store where each component opts into re-renders only for the signals it uses. Components that don't pass `renderOn` never re-render on signal updates.

```tsx
import { createRefSignal, createRefSignalContext, ALL } from 'react-refsignal';

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

// Never re-renders — reads signals in a game loop
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

// Re-renders when isPaused changes
function PauseMenu() {
  const { isPaused, setIsPaused } = useGameContext({
    renderOn: ['isPaused'],
    unwrap: true,
  });

  if (!isPaused) return null;
  return <button onClick={() => setIsPaused(false)}>Resume</button>;
}
```

---

## Collections of signals

Each item in a collection can be its own signal. Updating an item re-renders only the component rendering that item — the list component is unaffected.

```tsx
import { useRefSignal, useRefSignalRender, createRefSignal, createRefSignalContext, batch } from 'react-refsignal';
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

// Adding a product: notify the list to re-render, individual items are unaffected
function addProduct(store: ReturnType<typeof useShopContext>, product: Product) {
  store.products.update([...store.products.current, createRefSignal(product)]);
}

// Updating a product: only the corresponding ProductItem re-renders
function updatePrice(productSignal: RefSignal<Product>, newPrice: number) {
  productSignal.update({ ...productSignal.current, price: newPrice });
}

// Adding many products at once — one notification for the list
function loadProducts(store: ReturnType<typeof useShopContext>, incoming: Product[]) {
  const next = [...store.products.current, ...incoming.map(createRefSignal)];
  store.products.update(next);
}

// Batch update multiple individual products — one notification per signal
function applyDiscount(products: RefSignal<Product>[], pct: number) {
  batch(() => {
    products.forEach((s) => s.update({ ...s.current, price: s.current.price * (1 - pct) }));
  });
}
```

---

## Derived signals with `useRefSignalMemo`

Compute a signal's value from other signals or React state. The factory is called exactly once per change regardless of the source.

```tsx
import { useRefSignal, useRefSignalMemo, useRefSignalEffect } from 'react-refsignal';
import { useState } from 'react';

function PriceCalculator() {
  const basePrice = useRefSignal(100);
  const [taxRate, setTaxRate] = useState(0.2);

  // Recomputes when basePrice fires OR when taxRate (React state) changes
  const total = useRefSignalMemo(
    () => basePrice.current * (1 + taxRate),
    [basePrice, taxRate],
  );

  // Runs whenever total updates — whether from a signal or React state change
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

Derived signals can be passed down to child components and subscribed to like any other signal. They are fully composable:

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
    playerY.update(20); // flushed here — playerY listeners called
  });

  playerX.update(30); // overwrites 10; playerX listeners called at outer end
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
