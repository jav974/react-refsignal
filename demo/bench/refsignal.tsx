// react-refsignal — two modes:
//   1.  signal         (blessed): useRefSignalEffect + setAttribute on a ref.
//                                  Zero React renders, deps array, listener
//                                  receives the changed signal via closure.
//   1b. signal-render  (opt-in):  useRefSignalRender([sig]) makes the
//                                  component re-render via React on signal
//                                  change — apples-to-apples vs useAtom /
//                                  useStore(selector).
//
// Both share the same SigCanvasView for the renderer=canvas branch.

import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import {
  createRefSignal,
  useRefSignalEffect,
  useRefSignalRender,
} from 'react-refsignal';
import type { RefSignal } from 'react-refsignal';
import { canvasStyle, useCanvasDrag, useCanvasScene } from '../canvas-helpers';
import {
  SIG_C,
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

// ---------------------------------------------------------------
// 1. RefSignal blessed path
// ---------------------------------------------------------------

function SigNode({ sig, id }: { sig: RefSignal<Pos>; id: number }) {
  bumpRender();
  const gRef = useRef<SVGGElement>(null);
  const drag = useDragRefs();

  useRefSignalEffect(() => {
    gRef.current?.setAttribute(
      'transform',
      `translate(${sig.current.x},${sig.current.y})`,
    );
  }, [sig]);

  return (
    <g
      ref={gRef}
      transform={`translate(${sig.current.x},${sig.current.y})`}
      cursor="grab"
      onPointerDown={(e) => {
        startDrag(e, sig.current, drag);
      }}
      onPointerMove={(e) => {
        const p = dragPos(e, drag);
        if (p) sig.update(p);
      }}
      onPointerUp={(e) => {
        endDrag(e, drag);
      }}
    >
      {nodeInner(id, SIG_C)}
    </g>
  );
}

function SigEdge({ from, to }: { from: RefSignal<Pos>; to: RefSignal<Pos> }) {
  bumpRender();
  const ref = useRef<SVGLineElement>(null);
  useRefSignalEffect(
    () => {
      const el = ref.current;
      if (!el) return;
      el.setAttribute('x1', String(from.current.x));
      el.setAttribute('y1', String(from.current.y));
      el.setAttribute('x2', String(to.current.x));
      el.setAttribute('y2', String(to.current.y));
    },
    [from, to],
    { frame: true },
  );
  return (
    <line
      ref={ref}
      x1={from.current.x}
      y1={from.current.y}
      x2={to.current.x}
      y2={to.current.y}
      stroke="rgba(255,255,255,0.18)"
      strokeWidth={1}
    />
  );
}

function SigAutoDriver({
  sig,
  initial,
  count,
}: {
  sig: RefSignal<Pos>;
  initial: Pos;
  count: number;
}) {
  useEffect(() => {
    return runAutoBench({
      mode: 'signal',
      nodes: count,
      drive: (p) => sig.update(p),
      initial,
    });
  }, [sig, initial, count]);
  return null;
}

function SigCanvasView({
  sigs,
  edges,
  w,
  h,
}: {
  sigs: RefSignal<Pos>[];
  edges: Edge[];
  w: number;
  h: number;
}) {
  bumpRender();
  const positionsRef = useRef(sigs.map((s) => s.current));
  const dirtyRef = useRef(true);
  const readPositions = useCallback(() => {
    for (let i = 0; i < sigs.length; i++) {
      positionsRef.current[i] = sigs[i].current;
    }
    return positionsRef.current;
  }, [sigs]);
  // Mark dirty whenever any signal mutates. One listener per signal —
  // RefSignal's subscribe is a WeakMap insert, so this is O(N) once.
  useEffect(() => {
    const onChange = () => {
      dirtyRef.current = true;
    };
    for (const s of sigs) s.subscribe(onChange);
    return () => {
      for (const s of sigs) s.unsubscribe(onChange);
    };
  }, [sigs]);
  const { canvasRef, layoutRef } = useCanvasScene({
    w,
    h,
    edges,
    accent: SIG_C,
    readPositions,
    dirtyRef,
  });
  const drag = useCanvasDrag({
    canvasRef,
    layoutRef,
    readPositions,
    writeNode: (i, p) => sigs[i].update(p),
  });
  return <canvas ref={canvasRef} style={canvasStyle} {...drag} />;
}

export function SigGraph({
  count,
  renderer,
}: {
  count: number;
  renderer?: Renderer;
}) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const sigs = useMemo(
    () => nodes.map((n) => createRefSignal({ ...n })),
    [nodes],
  );
  useEffect(() => {
    return () => {
      for (const s of sigs) s.dispose();
    };
  }, [sigs]);
  const r = renderer ?? BENCH.renderer;
  return (
    <>
      {r === 'canvas' ? (
        <SigCanvasView sigs={sigs} edges={edges} w={w} h={h} />
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
          {edges.map(([a, b], i) => (
            <SigEdge key={i} from={sigs[a]} to={sigs[b]} />
          ))}
          {sigs.map((s, i) => (
            <SigNode key={i} sig={s} id={i} />
          ))}
        </svg>
      )}
      {AUTOMATED && (
        <SigAutoDriver sig={sigs[0]} initial={nodes[0]} count={count} />
      )}
    </>
  );
}

// ---------------------------------------------------------------
// 1b. RefSignal *render* — opt-in React-rendering path
// ---------------------------------------------------------------
// useRefSignalRender([sig]) subscribes the component so React re-renders
// it whenever the signal changes. Same DX surface as useAtom (jotai) and
// useStore(selector) (zustand). Use case: when you want the value in JSX
// and don't mind the React reconciliation cost.

function SigRenderNode({ sig, id }: { sig: RefSignal<Pos>; id: number }) {
  bumpRender();
  useRefSignalRender([sig]);
  const drag = useDragRefs();
  return (
    <g
      transform={`translate(${sig.current.x},${sig.current.y})`}
      cursor="grab"
      onPointerDown={(e) => {
        startDrag(e, sig.current, drag);
      }}
      onPointerMove={(e) => {
        const p = dragPos(e, drag);
        if (p) sig.update(p);
      }}
      onPointerUp={(e) => {
        endDrag(e, drag);
      }}
    >
      {nodeInner(id, SIG_C)}
    </g>
  );
}

function SigRenderEdge({
  from,
  to,
}: {
  from: RefSignal<Pos>;
  to: RefSignal<Pos>;
}) {
  bumpRender();
  useRefSignalRender([from, to]);
  return (
    <line
      x1={from.current.x}
      y1={from.current.y}
      x2={to.current.x}
      y2={to.current.y}
      stroke="rgba(255,255,255,0.18)"
      strokeWidth={1}
    />
  );
}

function SigRenderAutoDriver({
  sig,
  initial,
  count,
}: {
  sig: RefSignal<Pos>;
  initial: Pos;
  count: number;
}) {
  useEffect(() => {
    return runAutoBench({
      mode: 'signal-render',
      nodes: count,
      drive: (p) => sig.update(p),
      initial,
    });
  }, [sig, initial, count]);
  return null;
}

export function SigRenderGraph({
  count,
  renderer,
}: {
  count: number;
  renderer?: Renderer;
}) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const sigs = useMemo(
    () => nodes.map((n) => createRefSignal({ ...n })),
    [nodes],
  );
  useEffect(() => {
    return () => {
      for (const s of sigs) s.dispose();
    };
  }, [sigs]);
  const r = renderer ?? BENCH.renderer;
  return (
    <>
      {r === 'canvas' ? (
        <SigCanvasView sigs={sigs} edges={edges} w={w} h={h} />
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
          {edges.map(([a, b], i) => (
            <SigRenderEdge key={i} from={sigs[a]} to={sigs[b]} />
          ))}
          {sigs.map((s, i) => (
            <SigRenderNode key={i} sig={s} id={i} />
          ))}
        </svg>
      )}
      {AUTOMATED && (
        <SigRenderAutoDriver sig={sigs[0]} initial={nodes[0]} count={count} />
      )}
    </>
  );
}
