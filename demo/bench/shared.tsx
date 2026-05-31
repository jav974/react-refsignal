// Shared primitives used by every benchmark mode + the harness.
//
// Nothing here knows about a specific state library — it's the types,
// graph generator, SVG node visual, drag helpers, color constants, and
// the global render counter that the Stats badge reads.

import React, { useRef } from 'react';

export type Pos = { x: number; y: number };
export type Edge = [number, number];
export type DriveFn = (pos: Pos) => void;

export function generateGraph(count: number) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const sp = 80;
  const pad = 50;

  const nodes: Pos[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      x: (i % cols) * sp + pad,
      y: Math.floor(i / cols) * sp + pad,
    });
  }

  const edges: Edge[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    if (c + 1 < cols && i + 1 < count) edges.push([i, i + 1]);
    if (i + cols < count) edges.push([i, i + cols]);
    if (c + 1 < cols && i + cols + 1 < count) edges.push([i, i + cols + 1]);
    if (c > 0 && i + cols - 1 < count) edges.push([i, i + cols - 1]);
  }

  return {
    nodes,
    edges,
    w: (cols - 1) * sp + pad * 2,
    h: (rows - 1) * sp + pad * 2,
  };
}

export function countEdges(n: number): number {
  const cols = Math.ceil(Math.sqrt(n));
  let e = 0;
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    if (c + 1 < cols && i + 1 < n) e++;
    if (i + cols < n) e++;
    if (c + 1 < cols && i + cols + 1 < n) e++;
    if (c > 0 && i + cols - 1 < n) e++;
  }
  return e;
}

export function toSvg(svg: SVGSVGElement, cx: number, cy: number): Pos {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: cx, y: cy };
  const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

export function barW(id: number) {
  return ((id * 7 + 3) % 29) + 3;
}

// Module-level render counter — every mode's component body calls
// bumpRender() at the top, the Stats badge reads it per second. Reset
// by runAutoBench at measure-phase start so each cell gets a clean
// baseline.
let _renders = 0;
export function bumpRender() {
  _renders++;
}
export function getRenders() {
  return _renders;
}
export function resetRenders() {
  _renders = 0;
}

// Accent colours per state library.
export const SIG_C = '#4a9eff';
export const JOTAI_C = '#a855f7';
export const ZUS_C = '#f59e0b';
export const MOBX_C = '#10b981';
export const REACT_C = '#ff6b4a';

// Shared SVG node visual — 8 child elements. Used identically across
// every mode so the painted scene is byte-for-byte comparable.
export function nodeInner(id: number, accent: string) {
  return (
    <>
      <rect
        x={-24}
        y={-16}
        width={48}
        height={32}
        rx={4}
        fill="#0f172a"
        stroke="#334155"
        strokeWidth={0.75}
      />
      <line
        x1={-20}
        y1={-8}
        x2={20}
        y2={-8}
        stroke={accent}
        strokeWidth={1.5}
      />
      <text
        y={-10.5}
        textAnchor="middle"
        fill="#e2e8f0"
        fontSize={7}
        fontWeight="600"
        pointerEvents="none"
      >
        {id}
      </text>
      <text
        y={0.5}
        textAnchor="middle"
        fill="#64748b"
        fontSize={5.5}
        pointerEvents="none"
      >
        process
      </text>
      <rect x={-16} y={5} width={32} height={2.5} rx={1} fill="#1e293b" />
      <rect
        x={-16}
        y={5}
        width={barW(id)}
        height={2.5}
        rx={1}
        fill={accent}
        opacity={0.5}
      />
      <circle
        cx={-24}
        cy={0}
        r={3}
        fill="#1e293b"
        stroke="#475569"
        strokeWidth={0.75}
      />
      <circle
        cx={24}
        cy={0}
        r={3}
        fill="#1e293b"
        stroke="#475569"
        strokeWidth={0.75}
      />
    </>
  );
}

// Drag helpers — used by manual SVG pointer drag in every mode. The
// auto-driver bypasses these (it writes state directly).
export function useDragRefs() {
  return {
    dragging: useRef(false),
    offset: useRef({ x: 0, y: 0 }),
  };
}

export function startDrag(
  e: React.PointerEvent<SVGElement>,
  nodePos: Pos,
  refs: ReturnType<typeof useDragRefs>,
) {
  const svg = e.currentTarget.ownerSVGElement!;
  const p = toSvg(svg, e.clientX, e.clientY);
  refs.offset.current = { x: nodePos.x - p.x, y: nodePos.y - p.y };
  refs.dragging.current = true;
  e.currentTarget.setPointerCapture(e.pointerId);
}

export function endDrag(
  e: React.PointerEvent<SVGElement>,
  refs: ReturnType<typeof useDragRefs>,
) {
  refs.dragging.current = false;
  e.currentTarget.releasePointerCapture(e.pointerId);
}

export function dragPos(
  e: React.PointerEvent<SVGElement>,
  refs: ReturnType<typeof useDragRefs>,
): Pos | null {
  if (!refs.dragging.current) return null;
  const svg = e.currentTarget.ownerSVGElement!;
  const p = toSvg(svg, e.clientX, e.clientY);
  return { x: p.x + refs.offset.current.x, y: p.y + refs.offset.current.y };
}

export const svgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};
