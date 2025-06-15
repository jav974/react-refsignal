# react-refsignal

[![CI](https://github.com/jav974/react-refsignal/actions/workflows/ci.yml/badge.svg)](https://github.com/jav974/react-refsignal/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jav974/react-refsignal/graph/badge.svg?token=32TYI353M2)](https://codecov.io/gh/jav974/react-refsignal)
[![npm version](https://img.shields.io/npm/v/react-refsignal.svg)](https://www.npmjs.com/package/react-refsignal)
[![npm downloads](https://img.shields.io/npm/dt/react-refsignal.svg)](https://www.npmjs.com/package/react-refsignal)
[![MIT License](https://img.shields.io/github/license/jav974/react-refsignal.svg)](LICENSE)

A lightweight React hook library for managing and subscribing to signals within refs, enabling efficient updates and notifications without unnecessary renders.

## Features

- **Signal-like refs**: Mutable values with subscription and notification support.
- **No unnecessary renders**: Update values and notify listeners without triggering React re-renders.
- **Fine-grained reactivity**: Subscribe to changes, batch updates, and trigger effects or renders only when needed.
- **TypeScript support**: Fully typed API for safe usage.

## Installation

```sh
npm install react-refsignal
```

## Usage

### 1. `useRefSignal`

Create a signal-like ref with subscription and update methods.

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

```typescript
import { useRefSignal, useRefSignalMemo } from "react-refsignal";

function MyComponent() {
  const count = useRefSignal(1);
  const double = useRefSignalMemo(() => count.current * 2, [count]);

  useEffect(() => {
    double.subscribe(val => console.log("Double changed:", val));
  }, [double]);

  // ...
}
```

### 4. `useRefSignalRender`

Force a component to re-render when one or more signals update.

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

```typescript
import { batch } from "react-refsignal";

batch(() => {
  signalA.update(1);
  signalB.update(2);
}, [signalA, signalB]);
```

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

### `useRefSignalEffect(effect, dependencies)`

Runs an effect when any of the provided signals or dependencies change.

### `useRefSignalMemo(factory, dependencies)`

Creates a memoized signal whose value is derived from other signals or dependencies.

### `useRefSignalRender(dependencies)`

Forces a component to re-render when any of the provided signals update.

### `batch(callback, dependencies)`

Batches updates to multiple signals and defers notifications until the callback completes.

## Changes from v0.1.* to v1.0.0
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