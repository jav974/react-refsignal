// Shared canvas drawing + setup helpers used by both `graph/canvas.tsx`
// (manual demo) and `graph/automated.tsx` (autobench).
//
// Nothing in here knows about RefSignal, Jotai, Zustand, or React state.
// State management lives in the per-mode wrapper components; this file
// just owns the canvas element, the rAF loop, hit-testing, and the
// raster primitives that match the SVG node visuals.

import React, { useCallback, useEffect, useRef } from 'react';

export type Pos = { x: number; y: number };
export type Edge = [number, number];

export const canvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  touchAction: 'none',
  cursor: 'grab',
};

export function barW(id: number) {
  return ((id * 7 + 3) % 29) + 3;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Node sprite cache. Each node's visual is mostly invariant per
// accent color: only the ID number and the metric bar width depend on
// the per-node id. We rasterize the invariant parts (body, accent line,
// ports, "process" label, bar background) into an offscreen canvas once
// per accent, then `drawImage` it at each position — collapsing ~10
// per-node ops into a single blit.
const NODE_SPRITE_W = 60; // SVG units; includes ±24 ports + slack
const NODE_SPRITE_H = 40;
const NODE_SPRITE_OVERSAMPLE = 4; // rasterize at 4× to stay crisp under zoom
const spriteCache = new Map<string, HTMLCanvasElement>();

function getNodeSprite(accent: string): HTMLCanvasElement {
  let sprite = spriteCache.get(accent);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = NODE_SPRITE_W * NODE_SPRITE_OVERSAMPLE;
  sprite.height = NODE_SPRITE_H * NODE_SPRITE_OVERSAMPLE;
  const s = sprite.getContext('2d')!;
  s.scale(NODE_SPRITE_OVERSAMPLE, NODE_SPRITE_OVERSAMPLE);
  s.translate(NODE_SPRITE_W / 2, NODE_SPRITE_H / 2);
  // Body
  s.fillStyle = '#0f172a';
  s.strokeStyle = '#334155';
  s.lineWidth = 0.75;
  roundRectPath(s, -24, -16, 48, 32, 4);
  s.fill();
  s.stroke();
  // Accent line
  s.strokeStyle = accent;
  s.lineWidth = 1.5;
  s.beginPath();
  s.moveTo(-20, -8);
  s.lineTo(20, -8);
  s.stroke();
  // "process" label (id-independent)
  s.fillStyle = '#64748b';
  s.font = '5.5px system-ui, sans-serif';
  s.textAlign = 'center';
  s.textBaseline = 'middle';
  s.fillText('process', 0, 1);
  // Metric bar background (id-independent)
  s.fillStyle = '#1e293b';
  s.fillRect(-16, 5, 32, 2.5);
  // Ports
  s.fillStyle = '#1e293b';
  s.strokeStyle = '#475569';
  s.lineWidth = 0.75;
  s.beginPath();
  s.arc(-24, 0, 3, 0, Math.PI * 2);
  s.fill();
  s.stroke();
  s.beginPath();
  s.arc(24, 0, 3, 0, Math.PI * 2);
  s.fill();
  s.stroke();
  spriteCache.set(accent, sprite);
  return sprite;
}

// Draw in batched passes (bodies → labels → bars) rather than fully drawing
// each node before the next. The per-node parts (font, fill colors, alpha)
// are identical across nodes, so setting them once per pass instead of once
// per node removes tens of thousands of canvas state mutations per redraw at
// high node counts — `ctx.font =` in particular re-parses the font string on
// every assignment, and that per-node reassignment was the redraw bottleneck
// (and why the canvas felt laggy while the dirty-flag gating was already fine).
export function drawScene(
  ctx: CanvasRenderingContext2D,
  positions: Pos[],
  edges: Edge[],
  accent: string,
) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();

  // Edges — one path, one stroke.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    const p1 = positions[a];
    const p2 = positions[b];
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  const n = positions.length;
  const sprite = getNodeSprite(accent);

  // Pass 1: node bodies — one blit each, no per-node ctx state.
  for (let i = 0; i < n; i++) {
    const p = positions[i];
    ctx.drawImage(
      sprite,
      p.x - NODE_SPRITE_W / 2,
      p.y - NODE_SPRITE_H / 2,
      NODE_SPRITE_W,
      NODE_SPRITE_H,
    );
  }

  // Pass 2: id labels — text state set once for all.
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 7px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const p = positions[i];
    ctx.fillText(String(i), p.x, p.y - 7);
  }

  // Pass 3: metric bars — one fillStyle + alpha for all.
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < n; i++) {
    const p = positions[i];
    ctx.fillRect(p.x - 16, p.y + 5, barW(i), 2.5);
  }
  ctx.globalAlpha = 1;
}

export type CanvasLayout = { scale: number; dx: number; dy: number };

// rAF loop + ResizeObserver-driven fit-to-container transform.
//
// `dirtyRef` is optional. When provided, the rAF tick only redraws when
// dirty is true (and then clears the flag). Callers set dirty=true when
// state changes (typically via a subscription to their store). When
// dirtyRef is omitted the loop redraws every frame — useful for noisy
// continuous animations but expensive at high element counts.
export function useCanvasScene({
  w,
  h,
  edges,
  accent,
  readPositions,
  dirtyRef,
}: {
  w: number;
  h: number;
  edges: Edge[];
  accent: string;
  readPositions: () => Pos[];
  dirtyRef?: React.RefObject<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef({ scale: 1, dx: 0, dy: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d')!;

    let raf = 0;
    const resize = () => {
      const cw = canvas.clientWidth || 1;
      const ch = canvas.clientHeight || 1;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      const scale = Math.min(cw / w, ch / h);
      const dx = (cw - w * scale) / 2;
      const dy = (ch - h * scale) / 2;
      layoutRef.current = { scale, dx, dy };
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, dx * dpr, dy * dpr);
      // Force a redraw after the buffer + transform change.
      if (dirtyRef) dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const tick = () => {
      if (!dirtyRef || dirtyRef.current) {
        drawScene(ctx, readPositions(), edges, accent);
        if (dirtyRef) dirtyRef.current = false;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [w, h, edges, accent, readPositions, dirtyRef]);

  return { canvasRef, layoutRef };
}

// Translate client (mouse) coords into the graph's SVG-coord space,
// undoing the canvas fit-transform (scale + letterbox offset).
export function clientToCanvas(
  canvas: HTMLCanvasElement,
  cx: number,
  cy: number,
  layout: CanvasLayout,
): Pos {
  const rect = canvas.getBoundingClientRect();
  const lx = cx - rect.left;
  const ly = cy - rect.top;
  return {
    x: (lx - layout.dx) / layout.scale,
    y: (ly - layout.dy) / layout.scale,
  };
}

export function hitTest(positions: Pos[], p: Pos): number {
  const r2 = 28 * 28;
  let bestIdx = -1;
  let bestD = r2;
  for (let i = 0; i < positions.length; i++) {
    const dx = positions[i].x - p.x;
    const dy = positions[i].y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Manual pointer drag for the canvas renderer. The SVG branch wires drag
// per-<g>; on canvas there are no DOM nodes to hook, so we hit-test against
// the live positions on pointerdown and forward moves to `writeNode`, which
// each mode implements against its own store (sig.update / store.set / etc).
export function useCanvasDrag({
  canvasRef,
  layoutRef,
  readPositions,
  writeNode,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  layoutRef: React.RefObject<CanvasLayout>;
  readPositions: () => Pos[];
  writeNode: (idx: number, pos: Pos) => void;
}) {
  const dragIdx = useRef(-1);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const p = clientToCanvas(canvas, e.clientX, e.clientY, layoutRef.current);
      const idx = hitTest(readPositions(), p);
      if (idx < 0) return;
      const node = readPositions()[idx];
      offset.current = { x: node.x - p.x, y: node.y - p.y };
      dragIdx.current = idx;
      canvas.setPointerCapture(e.pointerId);
    },
    [canvasRef, layoutRef, readPositions],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (dragIdx.current < 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const p = clientToCanvas(canvas, e.clientX, e.clientY, layoutRef.current);
      writeNode(dragIdx.current, {
        x: p.x + offset.current.x,
        y: p.y + offset.current.y,
      });
    },
    [canvasRef, layoutRef, writeNode],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (dragIdx.current < 0) return;
      dragIdx.current = -1;
      canvasRef.current?.releasePointerCapture(e.pointerId);
    },
    [canvasRef],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}
