# Signals driving imperative renderers

← [Back to README](../README.md) · [Concepts](concepts.md) · [API Reference](api.md) · [Patterns](patterns.md)

---

Canvas 2D, WebGL, Pixi, Three.js, SVG with direct DOM writes, Web Audio — anywhere the "renderer" is a JavaScript object with imperative methods, you do not want React in the hot path. Every reconcile-and-diff cycle for a frame-rate update is wasted work; the renderer has its own internal state and tells you exactly where to write to.

RefSignal is built for this. A signal update bypasses React entirely: `useRefSignalEffect` runs on every fire with access to the latest value, and you call the renderer's API directly. React stays responsible for the *structure* of the scene (mounting / unmounting / wiring props); signals drive the *values* that flow through it.

This page documents three patterns:

1. The canonical "signal → imperative draw" loop.
2. Polymorphic `RefSignal<T> | T` props for components that accept either a static value or a reactive one.
3. When to step out of this pattern and use React normally.

---

## The canonical pattern

Subscribe to a signal inside `useRefSignalEffect`, read `.current`, call the renderer. That is the whole shape:

```tsx
import { useRef } from 'react';
import { useRefSignalEffect, type RefSignal } from 'react-refsignal';

type Point = { x: number; y: number };

function Cursor({ position }: { position: RefSignal<Point> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useRefSignalEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 400, 300);
    ctx.fillStyle = '#4a9eff';
    ctx.beginPath();
    ctx.arc(position.current.x, position.current.y, 8, 0, Math.PI * 2);
    ctx.fill();
  }, [position]);

  return <canvas ref={canvasRef} width={400} height={300} />;
}
```

**What this does — and what it does not:**

- The React tree renders `<canvas>` once. No re-render happens when `position` updates.
- Every signal update fires the effect synchronously. The effect reads `position.current`, clears the canvas, and draws. ~0 React work per frame.
- At 60 pointer events / sec with React + `memo`, you would reconcile the Cursor component 60 times per second. Here you reconcile it *never*. The effect is the only thing that runs, and it only does the draw work.

**Coalescing multiple fires per frame:** if several signals feed the same renderer, updates can arrive faster than the display refreshes. Use `{ rAF: true }` to batch into one draw per animation frame:

```tsx
useRefSignalEffect(() => {
  drawScene();
}, [cameraX, cameraY, zoom, selection], { rAF: true });
```

One scene redraw per frame regardless of how many of those four signals fire in between. This is the default pattern for anything heavier than a few state mutations per frame.

---

## Driving a retained renderer (Pixi, Three.js, WebGL)

"Retained" renderers keep their own scene graph — you don't clear-and-redraw each frame, you mutate graphics objects in place. The shape is the same, you just call setters:

```tsx
import { Application, Graphics } from 'pixi.js';
import { useRef, useEffect } from 'react';
import { useRefSignalEffect, type RefSignal } from 'react-refsignal';

type Point = { x: number; y: number };

function PixiCircle({
  center,
  radius,
}: {
  center: RefSignal<Point>;
  radius: RefSignal<number>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const graphicsRef = useRef<Graphics | null>(null);

  // React handles mount / unmount of the Pixi application
  useEffect(() => {
    const host = hostRef.current!;
    const app = new Application({ width: 400, height: 300 });
    host.appendChild(app.view as HTMLCanvasElement);
    const g = new Graphics();
    app.stage.addChild(g);
    graphicsRef.current = g;
    return () => {
      app.destroy(true, { children: true });
      graphicsRef.current = null;
    };
  }, []);

  // Signals drive the draw — no React re-renders
  useRefSignalEffect(() => {
    const g = graphicsRef.current;
    if (!g) return;
    g.clear();
    g.beginFill(0x4a9eff);
    g.drawCircle(center.current.x, center.current.y, radius.current);
    g.endFill();
  }, [center, radius], { rAF: true });

  return <div ref={hostRef} />;
}
```

The `useEffect` mounts the renderer (React's job — it owns lifecycle). The `useRefSignalEffect` drives the scene graph (signals' job — they own values). These two effects coexist cleanly because they operate on different concerns.

Same shape works for Three.js meshes, WebGL uniforms, Web Audio nodes — anywhere you have a handle you can mutate.

---

## Polymorphic `RefSignal<T> | T` props

A useful pattern when writing reusable components: accept *either* a plain value *or* a signal for the same prop. Callers who already have a signal pass it through reactively; callers with a one-shot value pass the raw object.

```tsx
import { useRefSignalMemo, isRefSignal, type RefSignal } from 'react-refsignal';

type Point = { x: number; y: number };
type MaybeSignal<T> = RefSignal<T> | T;

function BezierCurve({
  from,
  to,
}: {
  from: MaybeSignal<Point>;
  to: MaybeSignal<Point>;
}) {
  // Normalize both inputs into stable signals for downstream consumers.
  // useRefSignalMemo auto-subscribes to any RefSignals in `deps`, so when
  // `from` is a signal its fires re-run the factory; when it's a raw value
  // the factory just returns it.
  const fromSig = useRefSignalMemo(
    () => (isRefSignal(from) ? from.current : from),
    [from],
  );
  const toSig = useRefSignalMemo(
    () => (isRefSignal(to) ? to.current : to),
    [to],
  );

  const ref = useRef<SVGPathElement>(null);
  useRefSignalEffect(() => {
    const path = ref.current;
    if (!path) return;
    const f = fromSig.current;
    const t = toSig.current;
    path.setAttribute('d', `M ${f.x},${f.y} C ${f.x + 50},${f.y} ${t.x - 50},${t.y} ${t.x},${t.y}`);
  }, [fromSig, toSig], { rAF: true });

  return <path ref={ref} stroke="#4a9eff" fill="none" strokeWidth={2} />;
}
```

**Why this is clean:**

- Callers who have reactive endpoints get live updates with zero boilerplate.
- Callers who have static endpoints pass them as plain objects — no need to wrap in `useRefSignal` just to satisfy the prop type.
- Downstream code in the component only deals with one shape (`RefSignal<Point>`), simplifying every effect and computation that reads from it.

**When the inner signal's identity is itself dynamic** — for instance if `from` is `() => nodes.current.get(id)` where the Map contents change over time — reach for [`useRefSignalFollow`](api.md#userefsignalfollowt-getter-deps-options) instead, which handles identity swaps via the `trackSignals` machinery.

---

## When NOT to use this pattern

This is a load-bearing pattern for high-frequency imperative renderers. It is *not* the right tool for:

- **Low-frequency UI state.** A settings dialog toggle does not need to bypass React. `useRefSignalRender` or ordinary `useState` is simpler and cheaper to maintain.
- **Things React actually renders well.** Virtual DOM diffing is fast enough for tree-structured UI with hundreds of elements updating at human-interaction speed. Don't pre-optimize.
- **Text-heavy updates via DOM.** If you're just changing the text of a `<div>` on every signal fire, `useRefSignalRender` + `{signal.current}` is idiomatic React and performs fine.

The rough line: if the renderer has an imperative API and the updates come in faster than ~10 Hz, use the pattern on this page. Otherwise use React normally.

---

## Caveats

**Refs may not be populated on the first effect run.** If the canvas / graphics host mounts via a `ref`, guard with `if (!ref.current) return` at the top of each effect body. The mount `useRefSignalEffect` runs after React attaches refs, but subsequent signal-triggered fires can arrive before the renderer is constructed in a sibling `useEffect`. The early-return handles both.

**Cleanup runs only on unmount / deps change** — not between signal fires. This is intentional; the whole point is that signal-triggered effect runs are cheap. If your renderer genuinely needs teardown per frame (e.g., you allocate a new texture), do it inside the effect body, not in a returned cleanup function.

**Re-entrancy is allowed.** An effect can update the same signals it watches — `useRefSignalEffect` will re-fire. Don't build infinite loops, but controlled cascades (e.g., "updating `dragPosition` recomputes `snappedPosition`") work as expected.

**StrictMode double-mounting** causes the mount effect to run twice in development. Make sure your imperative setup is idempotent or uses a mount-ref guard. Signal-triggered fires after the first real mount are unaffected.
