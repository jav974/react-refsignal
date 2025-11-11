# react-refsignal

[![CI](https://github.com/jav974/react-refsignal/actions/workflows/ci.yml/badge.svg)](https://github.com/jav974/react-refsignal/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jav974/react-refsignal/graph/badge.svg?token=32TYI353M2)](https://codecov.io/gh/jav974/react-refsignal)
![React >=18.0.0](https://img.shields.io/badge/react-%3E%3D18.0.0-blue)
[![npm version](https://img.shields.io/npm/v/react-refsignal.svg)](https://www.npmjs.com/package/react-refsignal)
[![npm downloads](https://img.shields.io/npm/dt/react-refsignal.svg)](https://www.npmjs.com/package/react-refsignal)
[![bundlephobia](https://badgen.net/bundlephobia/minzip/react-refsignal)](https://bundlephobia.com/result?p=react-refsignal)
[![MIT License](https://img.shields.io/github/license/jav974/react-refsignal.svg)](LICENSE)

A lightweight React hook library for managing and subscribing to signals within refs, enabling efficient updates and notifications without unnecessary renders.

## Features

- **Signal-like refs**: Mutable values with subscription and notification support.
- **No unnecessary renders**: Update values and notify listeners without triggering React re-renders.
- **Fine-grained reactivity**: Subscribe to changes, batch updates, and trigger effects or renders only when needed.
- **TypeScript support**: Fully typed API for safe usage.
- **DevTools**: Built-in debugging tools with update tracking, signal inspection, and Redux DevTools integration.

## Installation

```sh
npm install react-refsignal
```
**Requires React 18.0.0 or newer.**

## Usage

### 1. `useRefSignal`

Create a signal-like ref with subscription and update methods.
The RefSignal object is an extension of React.RefObject, with additional methods to update, subscribe and notify. So you can still use a RefSignal like a normal React.RefObject.

```typescript
import { useRefSignal } from "react-refsignal";

function MyComponent() {
  const count = useRefSignal(0);

  // Subscribe to changes
  useEffect(() => {
    const listener = (val: number) => console.log("Count changed:", val);
    count.subscribe(listener);
    return () => count.unsubscribe(listener);
  }, [count]);

  return (
    <button onClick={() => count.update(count.current + 1)}>
      Increment ({count.current})
    </button>
  );
}
```

### 2. `useRefSignalEffect`

Run an effect when one or more signals or dependencies change.
This hook internally uses useEffect on the dependency list, you can safely replace your useEffect with a useRefSignalEffect if any of your depencency is a RefSignal and you want to track its changes.

```typescript
import { useRefSignal, useRefSignalEffect } from "react-refsignal";

function MyComponent() {
  const count = useRefSignal(0);

  useRefSignalEffect(() => {
    console.log("Count changed to", count.current);
  }, [count]);

  // ...
}
```

### 3. `useRefSignalMemo`

Create a derived signal whose value is memoized from other signals or dependencies.
This hook internally uses useMemo, and useRefSignalEffect, so dependency list can contain non RefSignal values as well.

```typescript
import { useRefSignal, useRefSignalMemo } from "react-refsignal";

function MyComponent() {
  const count = useRefSignal(1);
  const double = useRefSignalMemo(() => count.current * 2, [count]);

  useRefSignalEffect(() => {
    console.log("Double changed:", double.current);
  }, [double]);

  // count.update(21); // Will trigger double recompute, then effect on double
}
```

### 4. `useRefSignalRender`

Force a component to re-render when one or more signals update.
This hook only takes RefSignal objects as dependencies.

```typescript
import { useRefSignal, useRefSignalRender } from "react-refsignal";

function MyComponent() {
  const count = useRefSignal(0);

  // This will re-render the component when count updates or gets notified
  useRefSignalRender([count]);

  // count.update(1); => Triggers re-render
  // count.notifyUpdate(); => Trigger re-render
  // count.notify(); => Triggers re-render

  return <div>Count: {count.current}</div>;
}
```

### 5. Batching Updates

Batch multiple signal updates and defer notifications until the end of a callback.

**Auto-inference (recommended)**: Automatically tracks signals updated via `.update()`:

```typescript
import { batch } from "react-refsignal";

// Automatically infers signalA and signalB as dependencies
batch(() => {
  signalA.update(1);
  signalB.update(2);
});
```

**Explicit dependencies**: Useful for direct mutations or manual `.notify()` calls:

```typescript
// Required when mutating .current directly
batch(() => {
  signalA.current = 1;
  signalB.current = 2;
}, [signalA, signalB]);
```

### 6. DevTools

react-refsignal includes powerful debugging tools to help you track signal updates and inspect state changes during development.

#### Configuration

```typescript
import { configureDevTools } from "react-refsignal";

// Configure DevTools (typically in your app initialization)
configureDevTools({
  enabled: true,              // Enable devtools (default: true in development)
  logUpdates: true,           // Log signal updates to console
  reduxDevTools: false,       // Enable Redux DevTools Extension integration
  maxHistory: 100,            // Maximum number of updates to keep in history
});
```

#### Named Signals

Give your signals meaningful names for easier debugging:

```typescript
const count = useRefSignal(0, 'userCount');
const items = useRefSignal([], 'shoppingCart');

// Access the debug name
console.log(count.getDebugName?.()); // 'userCount'
```

#### Update History

Track all signal updates with timestamps:

```typescript
import { devtools } from "react-refsignal";

// Get update history
const history = devtools.getUpdateHistory();
// Returns: [{ signalId, oldValue, newValue, timestamp, ... }]

// Clear history
devtools.clearHistory();
```

#### Signal Inspection

Find and inspect signals by name:

```typescript
// Get a specific signal by name
const signal = devtools.getSignalByName('userCount');
console.log(signal?.current);

// Get all tracked signals
const allSignals = devtools.getAllSignals();
// Returns: [{ name: 'userCount', signal: RefSignal }, ...]
```

#### Redux DevTools Integration

When enabled, react-refsignal integrates with the Redux DevTools Extension for time-travel debugging and state inspection:

```typescript
configureDevTools({
  enabled: true,
  reduxDevTools: true,  // Enable Redux DevTools Extension
});
```

**DevTools are automatically disabled in production** (`process.env.NODE_ENV === 'production'`) to minimize bundle size and eliminate overhead.

## Usage with Context Providers

This project truly shines when combined with React Context, allowing RefSignals to be passed down through your component hierarchy. Updating a RefSignal will not trigger a re-render unless you explicitly want it.

This pattern is especially powerful for collections: each item in a collection can be a RefSignal. Modifying an individual item's signal will only trigger updates or re-renders in the corresponding child component.

Here's an example in TypeScript:

```typescript

function Provider({ children }) {
  // The product collection is a RefSignal containing RefSignal<Product> items
  const products = useRefSignal<RefSignal<Product>[]>([]);

  // You can create product signals outside of hooks using createRefSignal<Product>(productData)
  const addProduct = useCallback((product: Product) => {
    products.current.push(createRefSignal(product));
    products.notifyUpdate(); // Updates lastUpdated and triggers listeners
  }, []);

  const removeProduct = useCallback((product: Product) => {
    products.update(
      products.current.filter(
        (productSignal: RefSignal<Product>) => productSignal.current.id !== product.id
      )
    );
  }, []);

  // Optional: add an update method for a product
  const updateProduct = useCallback((product: Product) => {
    const productSignal = products.current.find(
      (signal) => signal.current.id === product.id
    );
    productSignal?.update(product);
  }, []);

  // Batch updates to avoid triggering listeners multiple times
  useEffect(() => {
    batch(() => {
      // Example: load multiple products at once
      // products.current.push(...);
      // products.notifyUpdate(); // Not needed if using batch

      // Example: update another RefSignal, e.g., user
      // user.current = ...;
    }, [products /*, user */]);
    // Listeners for products (and user) will be invoked once
  }, []);

  return (
    <Provider value={{ products, addProduct, removeProduct, updateProduct }}>
      {children}
    </Provider>
  );
}

function ProductListComponent({ products }: { products: RefSignal<RefSignal<Product>[]> }) {
  // Re-render when the products array changes (add/remove/replace)
  useRefSignalRender([products]);

  return (
    <>
      {products.current.map((product: RefSignal<Product>) => (
        <ProductComponent key={product.current.id} product={product} />
      ))}
    </>
  );
}

function ProductComponent({ product }: { product: RefSignal<Product> }) {
  // Re-render only when this product changes or is notified
  useRefSignalRender([product]);

  const { updateProduct } = useProvider();

  // These methods will trigger a re-render:
  // product.update({...});
  // product.notify();
  // product.notifyUpdate();
  // updateProduct({...});

  return (
    // ...your product UI...
  );
}

// Pattern: wrapper for RefSignal items in a collection
function RefSignalWrapper({ refSignal, componentFactory }) {
  useRefSignalRender([refSignal]);
  return componentFactory(refSignal.current);
}
```

## API Reference

### `useRefSignal<T>(initialValue: T): RefSignal<T>`

Creates a signal-like ref with subscription and update methods.

### `useRefSignalEffect(effect: React.EffectCallback, dependencies: React.DependencyList)`

Runs an effect when any of the provided `RefSignal` objects or dependencies change.

### `useRefSignalMemo<T>(factory: () => T, dependencies: React.DependencyList): RefSignal<T>`

Creates a memoized `RefSignal` whose value is derived from other signals or dependencies.

### `useRefSignalRender(dependencies: RefSignal[], callback?: () => boolean): () => void`

Forces a component to re-render when any of the provided `RefSignal` objects update.
Optionally, you can provide a callback function; a re-render will only occur if this function returns `true`.
The returned function can also be called manually to force a re-render.

### `batch(callback: () => void, dependencies?: RefSignal[])`

Batches updates to multiple `RefSignal` objects and defers notifications until the callback completes.

**Auto-inference mode** (when `dependencies` is omitted): Automatically tracks signals updated via `.update()` and batches their notifications.

**Explicit mode** (when `dependencies` is provided): Batches notifications for the specified signals, useful for direct `.current` mutations or manual `.notify()` calls.

### `createRefSignal<T>(initialValue: T, debugName?: string): RefSignal<T>`

Creates a `RefSignal` object programmatically, allowing you to instantiate a signal outside of React hooks.
Optionally provide a `debugName` for DevTools tracking.

### `configureDevTools(config: Partial<DevToolsConfig>)`

Configure DevTools behavior:
- `enabled` - Enable/disable devtools (default: `true` in development)
- `logUpdates` - Log signal updates to console
- `reduxDevTools` - Enable Redux DevTools Extension integration
- `maxHistory` - Maximum number of updates to keep in history (default: 100)

## Changes from v0.1.* to v1.*
⚠️ Breaking Change in v1.0.0

What’s Changed
- Structure of RefSignal:
  - Access data directly from `.current` instead of `.ref.current`
  - Access lastUpdated directly from `.lastUpdated` instead of `.lastUpdated.current`

RefSignal now extends React.RefObject instead of containing it internally.
This change improves developer experience by simplifying data access paths.

No other changes: All functionalities remain the same.

## License

MIT