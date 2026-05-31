// jotai — two modes:
//   2.  jotai             (blessed): useAtom(atom) returns [value, set]
//                                     and subscribes the component via
//                                     useSyncExternalStore. Per-atom React
//                                     re-render when its value changes.
//   2b. jotai-imperative  (escape):  useStore() + store.sub(atom, listener)
//                                     inside useEffect. Listener writes
//                                     setAttribute directly on a ref. No
//                                     React re-renders on update.
//
// Both share JCanvasView for renderer=canvas. (Canvas always uses the
// imperative store.sub pattern — useAtom would defeat canvas's point.)

import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  atom,
  useAtom,
  Provider as JotaiProvider,
  useStore as useJotaiStore,
} from 'jotai';
import type { PrimitiveAtom } from 'jotai';
import { canvasStyle, useCanvasScene } from '../canvas-helpers';
import {
  JOTAI_C,
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

type PosAtom = PrimitiveAtom<Pos>;

// ---------------------------------------------------------------
// 2. Jotai blessed path — useAtom per node + edge
// ---------------------------------------------------------------

const JNode = memo(function JNode({
  id,
  posAtom,
}: {
  id: number;
  posAtom: PosAtom;
}) {
  bumpRender();
  const [pos, setPos] = useAtom<Pos>(posAtom);
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
        if (p) setPos(p);
      }}
      onPointerUp={(e) => {
        endDrag(e, drag);
      }}
    >
      {nodeInner(id, JOTAI_C)}
    </g>
  );
});

const JEdge = memo(function JEdge({
  fromAtom,
  toAtom,
}: {
  fromAtom: PosAtom;
  toAtom: PosAtom;
}) {
  bumpRender();
  const [from] = useAtom<Pos>(fromAtom);
  const [to] = useAtom<Pos>(toAtom);
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

function JAutoDriver({
  posAtom,
  initial,
  count,
}: {
  posAtom: PosAtom;
  initial: Pos;
  count: number;
}) {
  const [, setPos] = useAtom<Pos>(posAtom);
  // setPos identity is stable across renders, exclude from deps to avoid
  // re-running the benchmark inside its own lifetime.
  useEffect(() => {
    return runAutoBench({
      mode: 'jotai',
      nodes: count,
      drive: setPos,
      initial,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posAtom, count]);
  return null;
}

function JCanvasView({
  atoms,
  initialPositions,
  edges,
  w,
  h,
}: {
  atoms: PosAtom[];
  initialPositions: Pos[];
  edges: Edge[];
  w: number;
  h: number;
}) {
  bumpRender();
  const store = useJotaiStore();
  const positionsRef = useRef(initialPositions.map((p) => ({ ...p })));
  const dirtyRef = useRef(true);
  const readPositions = useCallback(() => {
    for (let i = 0; i < atoms.length; i++) {
      positionsRef.current[i] = store.get(atoms[i]);
    }
    return positionsRef.current;
  }, [atoms, store]);
  useEffect(() => {
    const onChange = () => {
      dirtyRef.current = true;
    };
    const unsubs = atoms.map((a) => store.sub(a, onChange));
    return () => {
      for (const u of unsubs) u();
    };
  }, [atoms, store]);
  const { canvasRef } = useCanvasScene({
    w,
    h,
    edges,
    accent: JOTAI_C,
    readPositions,
    dirtyRef,
  });
  return <canvas ref={canvasRef} style={canvasStyle} />;
}

export function JGraph({
  count,
  renderer,
}: {
  count: number;
  renderer?: Renderer;
}) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const atoms = useMemo<PosAtom[]>(
    () => nodes.map((n) => atom({ ...n })),
    [nodes],
  );
  const r = renderer ?? BENCH.renderer;
  return (
    <JotaiProvider>
      {r === 'canvas' ? (
        <JCanvasView
          atoms={atoms}
          initialPositions={nodes}
          edges={edges}
          w={w}
          h={h}
        />
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
          {edges.map(([a, b], i) => (
            <JEdge key={i} fromAtom={atoms[a]} toAtom={atoms[b]} />
          ))}
          {atoms.map((a, i) => (
            <JNode key={i} id={i} posAtom={a} />
          ))}
        </svg>
      )}
      {AUTOMATED && (
        <JAutoDriver posAtom={atoms[0]} initial={nodes[0]} count={count} />
      )}
    </JotaiProvider>
  );
}

// ---------------------------------------------------------------
// 2b. Jotai imperative — useStore + store.sub
// ---------------------------------------------------------------
// Component mounts once, then updates flow store.set → store.sub
// listener → direct DOM mutation. No React re-renders on update.
// Listener takes no args — must call store.get(atom) inside.

function JImpNode({ posAtom, id }: { posAtom: PosAtom; id: number }) {
  bumpRender();
  const store = useJotaiStore();
  const gRef = useRef<SVGGElement>(null);
  const drag = useDragRefs();
  useEffect(() => {
    const apply = (p: Pos) => {
      gRef.current?.setAttribute('transform', `translate(${p.x},${p.y})`);
    };
    apply(store.get(posAtom));
    return store.sub(posAtom, () => apply(store.get(posAtom)));
  }, [posAtom, store]);
  const initial = store.get(posAtom);
  return (
    <g
      ref={gRef}
      transform={`translate(${initial.x},${initial.y})`}
      cursor="grab"
      onPointerDown={(e) => {
        startDrag(e, store.get(posAtom), drag);
      }}
      onPointerMove={(e) => {
        const p = dragPos(e, drag);
        if (p) store.set(posAtom, p);
      }}
      onPointerUp={(e) => {
        endDrag(e, drag);
      }}
    >
      {nodeInner(id, JOTAI_C)}
    </g>
  );
}

function JImpEdge({
  fromAtom,
  toAtom,
}: {
  fromAtom: PosAtom;
  toAtom: PosAtom;
}) {
  bumpRender();
  const store = useJotaiStore();
  const ref = useRef<SVGLineElement>(null);
  useEffect(() => {
    const apply = () => {
      const f = store.get(fromAtom);
      const t = store.get(toAtom);
      const el = ref.current;
      if (!el) return;
      el.setAttribute('x1', String(f.x));
      el.setAttribute('y1', String(f.y));
      el.setAttribute('x2', String(t.x));
      el.setAttribute('y2', String(t.y));
    };
    apply();
    const u1 = store.sub(fromAtom, apply);
    const u2 = store.sub(toAtom, apply);
    return () => {
      u1();
      u2();
    };
  }, [fromAtom, toAtom, store]);
  const f = store.get(fromAtom);
  const t = store.get(toAtom);
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

function JImpAutoDriver({
  posAtom,
  initial,
  count,
}: {
  posAtom: PosAtom;
  initial: Pos;
  count: number;
}) {
  const [, setPos] = useAtom<Pos>(posAtom);
  useEffect(() => {
    return runAutoBench({
      mode: 'jotai-imperative',
      nodes: count,
      drive: setPos,
      initial,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posAtom, count]);
  return null;
}

export function JImpGraph({
  count,
  renderer,
}: {
  count: number;
  renderer?: Renderer;
}) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const atoms = useMemo<PosAtom[]>(
    () => nodes.map((n) => atom({ ...n })),
    [nodes],
  );
  const r = renderer ?? BENCH.renderer;
  return (
    <JotaiProvider>
      {r === 'canvas' ? (
        <JCanvasView
          atoms={atoms}
          initialPositions={nodes}
          edges={edges}
          w={w}
          h={h}
        />
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
          {edges.map(([a, b], i) => (
            <JImpEdge key={i} fromAtom={atoms[a]} toAtom={atoms[b]} />
          ))}
          {atoms.map((a, i) => (
            <JImpNode key={i} id={i} posAtom={a} />
          ))}
        </svg>
      )}
      {AUTOMATED && (
        <JImpAutoDriver posAtom={atoms[0]} initial={nodes[0]} count={count} />
      )}
    </JotaiProvider>
  );
}
