// demo/graph-benchmark.tsx
//
// Draggable-graph benchmark: RefSignal vs Jotai vs Zustand vs React+memo.
// Run locally:  npm run dev
// Or paste into a Vite + React StackBlitz (install react-refsignal, zustand, jotai).
//
// What to watch:
//   - Crank the slider to 500-2000 nodes and drag a node in each mode.
//   - Compare FPS, renders/sec, and the Chrome profiler flame chart.

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useContext,
  createContext,
  memo,
} from 'react';
import { createRefSignal, useRefSignalEffect } from 'react-refsignal';
import type { RefSignal } from 'react-refsignal';
import { create } from 'zustand';
import { atom, useAtom, Provider as JotaiProvider } from 'jotai';

// ---------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------

type Pos = { x: number; y: number };
type Edge = [number, number];

function generateGraph(count: number) {
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

function toSvg(svg: SVGSVGElement, cx: number, cy: number): Pos {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: cx, y: cy };
  const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function barW(id: number) {
  return ((id * 7 + 3) % 29) + 3;
}

let _renders = 0;
function bumpRender() { _renders++; }
function getRenders() { return _renders; }
function resetRenders() { _renders = 0; }

// ---------------------------------------------------------------
// Accent colours
// ---------------------------------------------------------------

const SIG_C = '#4a9eff';
const JOTAI_C = '#a855f7';
const ZUS_C = '#f59e0b';
const REACT_C = '#ff6b4a';

// ---------------------------------------------------------------
// Shared node SVG body (8 child elements)
// ---------------------------------------------------------------

function nodeInner(id: number, accent: string) {
  return (
    <>
      <rect x={-24} y={-16} width={48} height={32} rx={4} fill="#0f172a" stroke="#334155" strokeWidth={0.75} />
      <line x1={-20} y1={-8} x2={20} y2={-8} stroke={accent} strokeWidth={1.5} />
      <text y={-10.5} textAnchor="middle" fill="#e2e8f0" fontSize={7} fontWeight="600" pointerEvents="none">{id}</text>
      <text y={0.5} textAnchor="middle" fill="#64748b" fontSize={5.5} pointerEvents="none">process</text>
      <rect x={-16} y={5} width={32} height={2.5} rx={1} fill="#1e293b" />
      <rect x={-16} y={5} width={barW(id)} height={2.5} rx={1} fill={accent} opacity={0.5} />
      <circle cx={-24} cy={0} r={3} fill="#1e293b" stroke="#475569" strokeWidth={0.75} />
      <circle cx={24} cy={0} r={3} fill="#1e293b" stroke="#475569" strokeWidth={0.75} />
    </>
  );
}

// ---------------------------------------------------------------
// Shared drag helpers
// ---------------------------------------------------------------

function useDragRefs() {
  return {
    dragging: useRef(false),
    offset: useRef<Pos>({ x: 0, y: 0 }),
  };
}

function startDrag(
  e: React.PointerEvent,
  nodePos: Pos,
  refs: ReturnType<typeof useDragRefs>,
) {
  const svg = e.currentTarget.ownerSVGElement!;
  const p = toSvg(svg, e.clientX, e.clientY);
  refs.offset.current = { x: nodePos.x - p.x, y: nodePos.y - p.y };
  refs.dragging.current = true;
  e.currentTarget.setPointerCapture(e.pointerId);
}

function endDrag(e: React.PointerEvent, refs: ReturnType<typeof useDragRefs>) {
  refs.dragging.current = false;
  e.currentTarget.releasePointerCapture(e.pointerId);
}

function dragPos(e: React.PointerEvent, refs: ReturnType<typeof useDragRefs>): Pos | null {
  if (!refs.dragging.current) return null;
  const svg = e.currentTarget.ownerSVGElement!;
  const p = toSvg(svg, e.clientX, e.clientY);
  return { x: p.x + refs.offset.current.x, y: p.y + refs.offset.current.y };
}

// ===============================================================
// 1. RefSignal mode — zero re-renders, direct DOM
// ===============================================================

function SigNode({ sig, id }: { sig: RefSignal<Pos>; id: number }) {
  bumpRender();
  const gRef = useRef<SVGGElement>(null);
  const drag = useDragRefs();

  useRefSignalEffect(() => {
    gRef.current?.setAttribute('transform', `translate(${sig.current.x},${sig.current.y})`);
  }, [sig]);

  return (
    <g ref={gRef} transform={`translate(${sig.current.x},${sig.current.y})`} cursor="grab"
      onPointerDown={(e) => startDrag(e, sig.current, drag)}
      onPointerMove={(e) => { const p = dragPos(e, drag); if (p) sig.update(p); }}
      onPointerUp={(e) => endDrag(e, drag)}
    >
      {nodeInner(id, SIG_C)}
    </g>
  );
}

function SigEdge({ from, to }: { from: RefSignal<Pos>; to: RefSignal<Pos> }) {
  bumpRender();
  const ref = useRef<SVGLineElement>(null);
  useRefSignalEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute('x1', String(from.current.x));
    el.setAttribute('y1', String(from.current.y));
    el.setAttribute('x2', String(to.current.x));
    el.setAttribute('y2', String(to.current.y));
  }, [from, to], { rAF: true });
  return (
    <line ref={ref}
      x1={from.current.x} y1={from.current.y}
      x2={to.current.x} y2={to.current.y}
      stroke="rgba(255,255,255,0.18)" strokeWidth={1}
    />
  );
}

function SigGraph({ count }: { count: number }) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const sigs = useMemo(() => nodes.map((n) => createRefSignal<Pos>({ ...n })), [nodes]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
      {edges.map(([a, b], i) => <SigEdge key={i} from={sigs[a]} to={sigs[b]} />)}
      {sigs.map((s, i) => <SigNode key={i} sig={s} id={i} />)}
    </svg>
  );
}

// ===============================================================
// 2. Jotai mode — atom per position, targeted re-renders
// ===============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PosAtom = any; // PrimitiveAtom<Pos> — using any to avoid version-specific type imports

const JNode = memo(function JNode({ id, posAtom }: { id: number; posAtom: PosAtom }) {
  bumpRender();
  const [pos, setPos] = useAtom<Pos>(posAtom);
  const drag = useDragRefs();

  return (
    <g transform={`translate(${pos.x},${pos.y})`} cursor="grab"
      onPointerDown={(e) => startDrag(e, pos, drag)}
      onPointerMove={(e) => { const p = dragPos(e, drag); if (p) setPos(p); }}
      onPointerUp={(e) => endDrag(e, drag)}
    >
      {nodeInner(id, JOTAI_C)}
    </g>
  );
});

const JEdge = memo(function JEdge({ fromAtom, toAtom }: { fromAtom: PosAtom; toAtom: PosAtom }) {
  bumpRender();
  const [from] = useAtom<Pos>(fromAtom);
  const [to] = useAtom<Pos>(toAtom);
  return (
    <line
      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
      stroke="rgba(255,255,255,0.18)" strokeWidth={1}
    />
  );
});

function JGraph({ count }: { count: number }) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const atoms = useMemo(() => nodes.map((n) => atom<Pos>({ ...n })), [nodes]);
  return (
    <JotaiProvider>
      <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
        {edges.map(([a, b], i) => <JEdge key={i} fromAtom={atoms[a]} toAtom={atoms[b]} />)}
        {atoms.map((a, i) => <JNode key={i} id={i} posAtom={a} />)}
      </svg>
    </JotaiProvider>
  );
}

// ===============================================================
// 3. Zustand mode — individual selectors, selector fan-out
// ===============================================================

type ZState = { positions: Pos[] };

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
    <g transform={`translate(${pos.x},${pos.y})`} cursor="grab"
      onPointerDown={(e) => startDrag(e, pos, drag)}
      onPointerMove={(e) => {
        const p = dragPos(e, drag);
        if (!p) return;
        store.setState((prev) => {
          const next = [...prev.positions];
          next[id] = p;
          return { positions: next };
        });
      }}
      onPointerUp={(e) => endDrag(e, drag)}
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
      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
      stroke="rgba(255,255,255,0.18)" strokeWidth={1}
    />
  );
});

function ZGraph({ count }: { count: number }) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const store = useMemo(() => createPosStore(nodes), [nodes]);
  return (
    <ZStoreCtx.Provider value={store}>
      <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
        {edges.map(([a, b], i) => <ZEdge key={i} a={a} b={b} />)}
        {nodes.map((_, i) => <ZNode key={i} id={i} />)}
      </svg>
    </ZStoreCtx.Provider>
  );
}

// ===============================================================
// 4. React + memo mode — parent-driven state (common pattern)
// ===============================================================

const RNode = memo(function RNode({
  id, pos, onDown, onMove, onUp,
}: {
  id: number; pos: Pos;
  onDown: (id: number, e: React.PointerEvent) => void;
  onMove: (id: number, e: React.PointerEvent) => void;
  onUp: (id: number, e: React.PointerEvent) => void;
}) {
  bumpRender();
  return (
    <g transform={`translate(${pos.x},${pos.y})`} cursor="grab"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onDown(id, e); }}
      onPointerMove={(e) => onMove(id, e)}
      onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); onUp(id, e); }}
    >
      {nodeInner(id, REACT_C)}
    </g>
  );
});

const REdge = memo(function REdge({ from, to }: { from: Pos; to: Pos }) {
  bumpRender();
  return (
    <line
      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
      stroke="rgba(255,255,255,0.18)" strokeWidth={1}
    />
  );
});

function RGraph({ count }: { count: number }) {
  const { nodes: init, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const [positions, setPositions] = useState(init);
  const posRef = useRef(init);
  const dragRef = useRef<number | null>(null);
  const offsetRef = useRef<Pos>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { setPositions(init); posRef.current = init; }, [init]);

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
      next[id] = { x: p.x + offsetRef.current.x, y: p.y + offsetRef.current.y };
      posRef.current = next;
      return next;
    });
  }, []);

  const onUp = useCallback((_id: number, _e: React.PointerEvent) => {
    dragRef.current = null;
  }, []);

  bumpRender();

  return (
    <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
      {edges.map(([a, b], i) => <REdge key={i} from={positions[a]} to={positions[b]} />)}
      {positions.map((pos, i) => (
        <RNode key={i} id={i} pos={pos} onDown={onDown} onMove={onMove} onUp={onUp} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------
// Stats overlay
// ---------------------------------------------------------------

function Stats({ mode }: { mode: string }) {
  const fpsRef = useRef<HTMLSpanElement>(null);
  const rpsRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frames = 0;
    let prevTime = performance.now();
    let prevRenders = getRenders();
    let id: number;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - prevTime >= 1000) {
        const r = getRenders();
        if (fpsRef.current) fpsRef.current.textContent = String(frames);
        if (rpsRef.current) rpsRef.current.textContent = String(r - prevRenders);
        frames = 0;
        prevRenders = r;
        prevTime = now;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [mode]);
  return (
    <>
      <span style={statBadge}>FPS <b ref={fpsRef} style={{ minWidth: 28, display: 'inline-block' }}>--</b></span>
      <span style={statBadge}>renders/s <b ref={rpsRef} style={{ minWidth: 36, display: 'inline-block' }}>--</b></span>
    </>
  );
}

// ---------------------------------------------------------------
// Styles
// ---------------------------------------------------------------

const svgStyle: React.CSSProperties = { width: '100%', height: '100%', display: 'block' };

const statBadge: React.CSSProperties = {
  background: '#0d1117', padding: '4px 10px', borderRadius: 4, fontSize: 13, fontFamily: 'monospace',
};

function btnStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '5px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
    fontWeight: 600, fontSize: 12, background: active ? color : '#333',
    color: '#fff', opacity: active ? 1 : 0.6, transition: 'opacity 0.15s',
  };
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

type Mode = 'signal' | 'jotai' | 'zustand' | 'react';

const MODE_META: Record<Mode, { color: string; label: string; hint: string }> = {
  signal:  { color: SIG_C,   label: 'RefSignal',          hint: 'Zero re-renders — DOM updated directly via effects' },
  jotai:   { color: JOTAI_C, label: 'Jotai (atoms)',      hint: 'Atom-per-position — only changed node + edges re-render' },
  zustand: { color: ZUS_C,   label: 'Zustand (selectors)', hint: 'Individual selectors — all 16k+ selectors run per frame' },
  react:   { color: REACT_C, label: 'React + memo',       hint: 'Parent-driven state — parent re-renders entire subtree each frame' },
};

function countEdges(n: number): number {
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

export default function GraphBenchmark() {
  const [mode, setMode] = useState<Mode>('signal');
  const [count, setCount] = useState(100);
  const edges = useMemo(() => countEdges(count), [count]);
  const meta = MODE_META[mode];

  const switchMode = (m: Mode) => { resetRenders(); setMode(m); };

  return (
    <div style={{
      background: '#1a1a2e', color: '#fff', height: '100vh',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, sans-serif', userSelect: 'none',
    }}>
      {/* toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', background: '#16213e', flexWrap: 'wrap',
      }}>
        {(Object.keys(MODE_META) as Mode[]).map((m) => (
          <button key={m} onClick={() => switchMode(m)} style={btnStyle(mode === m, MODE_META[m].color)}>
            {MODE_META[m].label}
          </button>
        ))}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 12 }}>
          Nodes
          <input type="range" min={9} max={2000} value={count}
            onChange={(e) => { resetRenders(); setCount(+e.target.value); }} />
        </label>

        <span style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>
          {count}n + {edges}e = <b>{count + edges}</b>
        </span>

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Stats mode={mode} />
        </span>
      </div>

      {/* hint */}
      <div style={{
        padding: '3px 14px', fontSize: 11, opacity: 0.4,
        background: '#16213e', borderTop: '1px solid #1a1a2e',
      }}>
        {meta.hint}
      </div>

      {/* graph */}
      <div style={{ flex: 1, overflow: 'hidden', padding: 8 }}>
        {mode === 'signal'  && <SigGraph key={`s-${count}`} count={count} />}
        {mode === 'jotai'   && <JGraph key={`j-${count}`} count={count} />}
        {mode === 'zustand' && <ZGraph key={`z-${count}`} count={count} />}
        {mode === 'react'   && <RGraph key={`r-${count}`} count={count} />}
      </div>
    </div>
  );
}
