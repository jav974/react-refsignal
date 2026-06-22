// zustand — two modes:
//   3.  zustand              (blessed): per-component selector
//                                        `store(s => s.positions[id])`.
//                                        useSyncExternalStore subscribes;
//                                        React re-renders the component on
//                                        selected-value change.
//   3b. zustand-imperative   (escape):  subscribeWithSelector middleware +
//                                        store.subscribe(selector, listener,
//                                        { equalityFn }) + setAttribute on
//                                        a ref. No React re-renders.
//
// Each mode owns its own store + context (the middleware changes the store
// type).

import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { canvasStyle, useCanvasDrag, useCanvasScene } from '../canvas-helpers';
import {
  ZUS_C,
  bumpRender,
  dragPos,
  endDrag,
  generateGraph,
  nodeInner,
  startDrag,
  svgStyle,
  useDragRefs,
  type Edge,
  type Pos,
} from './shared';
import { AUTOMATED, BENCH, runAutoBench, type Renderer } from './harness';

type ZState = { positions: Pos[] };

// ---------------------------------------------------------------
// 3. Zustand blessed path — per-component selectors
// ---------------------------------------------------------------

function createPosStore(init: Pos[]) {
  return create<ZState>(() => ({ positions: init.map((n) => ({ ...n })) }));
}

type ZStoreHook = ReturnType<typeof createPosStore>;

const ZStoreCtx = createContext<ZStoreHook | null>(null);

function useZStore() {
  return useContext(ZStoreCtx)!;
}

const ZNode = memo(function ZNode({ id }: { id: number }) {
  bumpRender();
  const store = useZStore();
  const pos = store((s) => s.positions[id]);
  const drag = useDragRefs();

  return (
    <g
      transform={`translate(${pos.x},${pos.y})`}
      cursor="grab"
      onPointerDown={(e) => {
        startDrag(e, pos, drag);
      }}
      onPointerMove={(e) => {
        const p = dragPos(e, drag);
        if (!p) return;
        store.setState((prev) => {
          const next = [...prev.positions];
          next[id] = p;
          return { positions: next };
        });
      }}
      onPointerUp={(e) => {
        endDrag(e, drag);
      }}
    >
      {nodeInner(id, ZUS_C)}
    </g>
  );
});

const ZEdge = memo(function ZEdge({ a, b }: { a: number; b: number }) {
  bumpRender();
  const store = useZStore();
  const from = store((s) => s.positions[a]);
  const to = store((s) => s.positions[b]);
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke="rgba(255,255,255,0.18)"
      strokeWidth={1}
    />
  );
});

function ZAutoDriver({
  id,
  initial,
  count,
}: {
  id: number;
  initial: Pos;
  count: number;
}) {
  const store = useZStore();
  useEffect(() => {
    return runAutoBench({
      mode: 'zustand',
      nodes: count,
      drive: (p) => {
        store.setState((prev) => {
          const next = [...prev.positions];
          next[id] = p;
          return { positions: next };
        });
      },
      initial,
    });
  }, [store, id, initial, count]);
  return null;
}

function ZCanvasView({ edges, w, h }: { edges: Edge[]; w: number; h: number }) {
  bumpRender();
  const store = useZStore();
  const dirtyRef = useRef(true);
  const readPositions = useCallback(() => store.getState().positions, [store]);
  useEffect(() => {
    return store.subscribe(() => {
      dirtyRef.current = true;
    });
  }, [store]);
  const { canvasRef, layoutRef } = useCanvasScene({
    w,
    h,
    edges,
    accent: ZUS_C,
    readPositions,
    dirtyRef,
  });
  const drag = useCanvasDrag({
    canvasRef,
    layoutRef,
    readPositions,
    writeNode: (i, p) =>
      store.setState((prev) => {
        const next = [...prev.positions];
        next[i] = p;
        return { positions: next };
      }),
  });
  return <canvas ref={canvasRef} style={canvasStyle} {...drag} />;
}

export function ZGraph({
  count,
  renderer,
}: {
  count: number;
  renderer?: Renderer;
}) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const store = useMemo(() => createPosStore(nodes), [nodes]);
  const r = renderer ?? BENCH.renderer;
  return (
    <ZStoreCtx.Provider value={store}>
      {r === 'canvas' ? (
        <ZCanvasView edges={edges} w={w} h={h} />
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
          {edges.map(([a, b], i) => (
            <ZEdge key={i} a={a} b={b} />
          ))}
          {nodes.map((_, i) => (
            <ZNode key={i} id={i} />
          ))}
        </svg>
      )}
      {AUTOMATED && <ZAutoDriver id={0} initial={nodes[0]} count={count} />}
    </ZStoreCtx.Provider>
  );
}

// ---------------------------------------------------------------
// 3b. Zustand imperative — subscribeWithSelector + ref + setAttribute
// ---------------------------------------------------------------
// The middleware adds a (selector, listener, options?) overload to
// store.subscribe so each node listens only to its own positions[id]
// slice. Without it, every component listener would fire on every
// setState — fan-out collapse.

function createPosStoreSel(init: Pos[]) {
  return create<ZState>()(
    subscribeWithSelector(() => ({
      positions: init.map((n) => ({ ...n })),
    })),
  );
}

type ZStoreSelHook = ReturnType<typeof createPosStoreSel>;

const ZImpStoreCtx = createContext<ZStoreSelHook | null>(null);

function useZImpStore() {
  return useContext(ZImpStoreCtx)!;
}

function ZImpNode({ id }: { id: number }) {
  bumpRender();
  const store = useZImpStore();
  const gRef = useRef<SVGGElement>(null);
  const drag = useDragRefs();
  useEffect(() => {
    const apply = (p: Pos) => {
      gRef.current?.setAttribute('transform', `translate(${p.x},${p.y})`);
    };
    apply(store.getState().positions[id]);
    return store.subscribe((state) => state.positions[id], apply);
  }, [store, id]);
  const initial = store.getState().positions[id];
  return (
    <g
      ref={gRef}
      transform={`translate(${initial.x},${initial.y})`}
      cursor="grab"
      onPointerDown={(e) => {
        startDrag(e, store.getState().positions[id], drag);
      }}
      onPointerMove={(e) => {
        const p = dragPos(e, drag);
        if (!p) return;
        store.setState((prev) => {
          const next = [...prev.positions];
          next[id] = p;
          return { positions: next };
        });
      }}
      onPointerUp={(e) => {
        endDrag(e, drag);
      }}
    >
      {nodeInner(id, ZUS_C)}
    </g>
  );
}

function ZImpEdge({ a, b }: { a: number; b: number }) {
  bumpRender();
  const store = useZImpStore();
  const ref = useRef<SVGLineElement>(null);
  useEffect(() => {
    const apply = () => {
      const { positions } = store.getState();
      const f = positions[a];
      const t = positions[b];
      const el = ref.current;
      if (!el) return;
      el.setAttribute('x1', String(f.x));
      el.setAttribute('y1', String(f.y));
      el.setAttribute('x2', String(t.x));
      el.setAttribute('y2', String(t.y));
    };
    apply();
    const u1 = store.subscribe((s) => s.positions[a], apply);
    const u2 = store.subscribe((s) => s.positions[b], apply);
    return () => {
      u1();
      u2();
    };
  }, [store, a, b]);
  const f = store.getState().positions[a];
  const t = store.getState().positions[b];
  return (
    <line
      ref={ref}
      x1={f.x}
      y1={f.y}
      x2={t.x}
      y2={t.y}
      stroke="rgba(255,255,255,0.18)"
      strokeWidth={1}
    />
  );
}

function ZImpAutoDriver({
  id,
  initial,
  count,
}: {
  id: number;
  initial: Pos;
  count: number;
}) {
  const store = useZImpStore();
  useEffect(() => {
    return runAutoBench({
      mode: 'zustand-imperative',
      nodes: count,
      drive: (p) => {
        store.setState((prev) => {
          const next = [...prev.positions];
          next[id] = p;
          return { positions: next };
        });
      },
      initial,
    });
  }, [store, id, initial, count]);
  return null;
}

function ZImpCanvasView({
  edges,
  w,
  h,
}: {
  edges: Edge[];
  w: number;
  h: number;
}) {
  bumpRender();
  const store = useZImpStore();
  const dirtyRef = useRef(true);
  const readPositions = useCallback(() => store.getState().positions, [store]);
  useEffect(() => {
    return store.subscribe(() => {
      dirtyRef.current = true;
    });
  }, [store]);
  const { canvasRef, layoutRef } = useCanvasScene({
    w,
    h,
    edges,
    accent: ZUS_C,
    readPositions,
    dirtyRef,
  });
  const drag = useCanvasDrag({
    canvasRef,
    layoutRef,
    readPositions,
    writeNode: (i, p) =>
      store.setState((prev) => {
        const next = [...prev.positions];
        next[i] = p;
        return { positions: next };
      }),
  });
  return <canvas ref={canvasRef} style={canvasStyle} {...drag} />;
}

export function ZImpGraph({
  count,
  renderer,
}: {
  count: number;
  renderer?: Renderer;
}) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const store = useMemo(() => createPosStoreSel(nodes), [nodes]);
  const r = renderer ?? BENCH.renderer;
  return (
    <ZImpStoreCtx.Provider value={store}>
      {r === 'canvas' ? (
        <ZImpCanvasView edges={edges} w={w} h={h} />
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
          {edges.map(([a, b], i) => (
            <ZImpEdge key={i} a={a} b={b} />
          ))}
          {nodes.map((_, i) => (
            <ZImpNode key={i} id={i} />
          ))}
        </svg>
      )}
      {AUTOMATED && <ZImpAutoDriver id={0} initial={nodes[0]} count={count} />}
    </ZImpStoreCtx.Provider>
  );
}
