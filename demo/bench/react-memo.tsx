// react + memo — the "vanilla React" baseline. State lives in a parent
// useState, child Node/Edge components are memoized so only the dragged
// node + connected edges re-render. No imperative escape hatch — every
// update goes through React's reconciliation.

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { canvasStyle, useCanvasScene } from '../canvas-helpers';
import {
  REACT_C,
  bumpRender,
  generateGraph,
  nodeInner,
  svgStyle,
  toSvg,
  type Edge,
  type Pos,
} from './shared';
import { AUTOMATED, BENCH, runAutoBench, type Renderer } from './harness';

const RNode = memo(function RNode({
  id,
  pos,
  onDown,
  onMove,
  onUp,
}: {
  id: number;
  pos: Pos;
  onDown: (id: number, e: React.PointerEvent) => void;
  onMove: (id: number, e: React.PointerEvent) => void;
  onUp: (id: number, e: React.PointerEvent) => void;
}) {
  bumpRender();
  return (
    <g
      transform={`translate(${pos.x},${pos.y})`}
      cursor="grab"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown(id, e);
      }}
      onPointerMove={(e) => {
        onMove(id, e);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        onUp(id, e);
      }}
    >
      {nodeInner(id, REACT_C)}
    </g>
  );
});

const REdge = memo(function REdge({ from, to }: { from: Pos; to: Pos }) {
  bumpRender();
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

function RCanvasView({
  positions,
  edges,
  w,
  h,
}: {
  positions: Pos[];
  edges: Edge[];
  w: number;
  h: number;
}) {
  bumpRender();
  const posRef = useRef(positions);
  const dirtyRef = useRef(true);
  useEffect(() => {
    posRef.current = positions;
    dirtyRef.current = true;
  }, [positions]);
  const readPositions = useCallback(() => posRef.current, []);
  const { canvasRef } = useCanvasScene({
    w,
    h,
    edges,
    accent: REACT_C,
    readPositions,
    dirtyRef,
  });
  return <canvas ref={canvasRef} style={canvasStyle} />;
}

export function RGraph({
  count,
  renderer,
}: {
  count: number;
  renderer?: Renderer;
}) {
  const {
    nodes: init,
    edges,
    w,
    h,
  } = useMemo(() => generateGraph(count), [count]);
  const [positions, setPositions] = useState(init);
  const posRef = useRef(init);
  const dragRef = useRef<number | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setPositions(init);
    posRef.current = init;
  }, [init]);

  const onDown = useCallback((id: number, e: React.PointerEvent) => {
    dragRef.current = id;
    const svg = svgRef.current!;
    const p = toSvg(svg, e.clientX, e.clientY);
    const cur = posRef.current[id];
    offsetRef.current = { x: cur.x - p.x, y: cur.y - p.y };
  }, []);

  const onMove = useCallback((_id: number, e: React.PointerEvent) => {
    const id = dragRef.current;
    if (id === null) return;
    const svg = svgRef.current!;
    const p = toSvg(svg, e.clientX, e.clientY);
    setPositions((prev) => {
      const next = [...prev];
      next[id] = {
        x: p.x + offsetRef.current.x,
        y: p.y + offsetRef.current.y,
      };
      posRef.current = next;
      return next;
    });
  }, []);

  const onUp = useCallback((_id: number, _e: React.PointerEvent) => {
    dragRef.current = null;
  }, []);

  // Auto-driver for React mode is inline because it needs the local
  // setPositions setter.
  useEffect(() => {
    if (!AUTOMATED) return;
    return runAutoBench({
      mode: 'react',
      nodes: count,
      drive: (p) => {
        setPositions((prev) => {
          const next = [...prev];
          next[0] = p;
          posRef.current = next;
          return next;
        });
      },
      initial: init[0],
    });
  }, [count, init]);

  bumpRender();

  const r = renderer ?? BENCH.renderer;
  if (r === 'canvas') {
    return <RCanvasView positions={positions} edges={edges} w={w} h={h} />;
  }
  return (
    <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
      {edges.map(([a, b], i) => (
        <REdge key={i} from={positions[a]} to={positions[b]} />
      ))}
      {positions.map((pos, i) => (
        <RNode
          key={i}
          id={i}
          pos={pos}
          onDown={onDown}
          onMove={onMove}
          onUp={onUp}
        />
      ))}
    </svg>
  );
}
