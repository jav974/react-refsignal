// Conway's Game of Life — one signal per cell. Only the ~5-15% of cells that
// flip per tick re-render (DOM mode) or repaint (Canvas mode). Open the
// Profiler and watch the "changed/tick" counter live.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  batch,
  createRefSignal,
  usePulseRefSignal,
  useRefSignal,
  useRefSignalEffect,
  type RefSignal,
} from 'react-refsignal';
import { FpsBadge } from './fps';

// ---------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------

type Cells = [number, number][]; // [row, col]

const GLIDER: Cells = [
  [0, 1],
  [1, 2],
  [2, 0],
  [2, 1],
  [2, 2],
];

const PULSAR: Cells = [
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 8],
  [0, 9],
  [0, 10],
  [2, 0],
  [2, 5],
  [2, 7],
  [2, 12],
  [3, 0],
  [3, 5],
  [3, 7],
  [3, 12],
  [4, 0],
  [4, 5],
  [4, 7],
  [4, 12],
  [5, 2],
  [5, 3],
  [5, 4],
  [5, 8],
  [5, 9],
  [5, 10],
  [7, 2],
  [7, 3],
  [7, 4],
  [7, 8],
  [7, 9],
  [7, 10],
  [8, 0],
  [8, 5],
  [8, 7],
  [8, 12],
  [9, 0],
  [9, 5],
  [9, 7],
  [9, 12],
  [10, 0],
  [10, 5],
  [10, 7],
  [10, 12],
  [12, 2],
  [12, 3],
  [12, 4],
  [12, 8],
  [12, 9],
  [12, 10],
];

const GOSPER: Cells = [
  [4, 0],
  [4, 1],
  [5, 0],
  [5, 1],
  [4, 10],
  [5, 10],
  [6, 10],
  [3, 11],
  [7, 11],
  [2, 12],
  [2, 13],
  [8, 12],
  [8, 13],
  [5, 14],
  [3, 15],
  [7, 15],
  [4, 16],
  [5, 16],
  [6, 16],
  [5, 17],
  [2, 20],
  [3, 20],
  [4, 20],
  [2, 21],
  [3, 21],
  [4, 21],
  [1, 22],
  [5, 22],
  [0, 24],
  [1, 24],
  [5, 24],
  [6, 24],
  [2, 34],
  [2, 35],
  [3, 34],
  [3, 35],
];

const R_PENTOMINO: Cells = [
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 1],
  [2, 1],
];

type Pattern = { name: string; cells: Cells | 'random' };

const PATTERNS: Pattern[] = [
  { name: 'Glider', cells: GLIDER },
  { name: 'Pulsar', cells: PULSAR },
  { name: 'Gosper gun', cells: GOSPER },
  { name: 'R-pentomino', cells: R_PENTOMINO },
  { name: 'Random 30%', cells: 'random' },
];

// ---------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------

const SIZES = [40, 60, 80, 100] as const;
type Size = (typeof SIZES)[number];

const CELL_PX = [3, 4, 6, 8, 12] as const;
type CellPx = (typeof CELL_PX)[number];

function dimsOf(grid: RefSignal<number>[][]): { w: number; h: number } {
  return { h: grid.length, w: grid[0]?.length ?? 0 };
}

// Cell value is "age": 0 = dead, n > 0 = alive for n ticks (drives coloring).
function makeGrid(w: number, h: number): RefSignal<number>[][] {
  const g: RefSignal<number>[][] = [];
  for (let y = 0; y < h; y++) {
    const row: RefSignal<number>[] = [];
    for (let x = 0; x < w; x++) row.push(createRefSignal(0));
    g.push(row);
  }
  return g;
}

function clearGrid(grid: RefSignal<number>[][]) {
  batch(() => {
    for (const row of grid) for (const sig of row) sig.update(0);
  });
}

function placePattern(grid: RefSignal<number>[][], pattern: Pattern) {
  const { w, h } = dimsOf(grid);
  const cells = pattern.cells;
  if (cells === 'random') {
    batch(() => {
      for (const row of grid) {
        for (const sig of row) sig.update(Math.random() < 0.3 ? 1 : 0);
      }
    });
    return;
  }
  const ys = cells.map((c) => c[0]);
  const xs = cells.map((c) => c[1]);
  const ph = Math.max(...ys) - Math.min(...ys);
  const pw = Math.max(...xs) - Math.min(...xs);
  const ox = Math.floor((w - pw) / 2) - Math.min(...xs);
  const oy = Math.floor((h - ph) / 2) - Math.min(...ys);
  batch(() => {
    for (const row of grid) for (const sig of row) sig.update(0);
    for (const [py, px] of cells) {
      const x = px + ox;
      const y = py + oy;
      if (x >= 0 && x < w && y >= 0 && y < h) grid[y][x].update(1);
    }
  });
}

function tick(grid: RefSignal<number>[][]): { changed: number; alive: number } {
  const { w, h } = dimsOf(grid);
  // Snapshot to a flat buffer first — neighbour reads must not see partial updates.
  const cur = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cur[y * w + x] = grid[y][x].current > 0 ? 1 : 0;
    }
  }
  let changed = 0;
  let alive = 0;
  batch(() => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0;
        // Toroidal neighbourhood — wraps at edges.
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = (x + dx + w) % w;
            const ny = (y + dy + h) % h;
            n += cur[ny * w + nx]!;
          }
        }
        const wasAlive = cur[y * w + x] === 1;
        const willBeAlive = wasAlive ? n === 2 || n === 3 : n === 3;
        const oldAge = grid[y][x].current;
        const newAge = willBeAlive ? oldAge + 1 : 0;
        if (newAge !== oldAge) {
          grid[y][x].update(newAge);
          changed++;
        }
        if (willBeAlive) alive++;
      }
    }
  });
  return { changed, alive };
}

function patternFits(pattern: Pattern, w: number, h: number): boolean {
  if (pattern.cells === 'random') return true;
  const ys = pattern.cells.map((c) => c[0]);
  const xs = pattern.cells.map((c) => c[1]);
  return (
    Math.max(...xs) - Math.min(...xs) < w &&
    Math.max(...ys) - Math.min(...ys) < h
  );
}

// ---------------------------------------------------------------
// Coloring
// ---------------------------------------------------------------

const DEAD = '#0b0d18';
const DEAD_RGB: [number, number, number] = [0x0b, 0x0d, 0x18];

// Age → HSL. Sweep cyan (newborn) → green → yellow → orange → red (old).
function hslAtAge(age: number): { h: number; s: number; l: number } {
  const t = Math.min(1, age / 30);
  return {
    h: 190 - t * 190,
    s: 85,
    l: 45 + (1 - t) * 15,
  };
}

function ageColor(age: number): string {
  if (age === 0) return DEAD;
  const { h, s, l } = hslAtAge(age);
  return `hsl(${h.toFixed(0)}, ${s}%, ${l.toFixed(0)}%)`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lN - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// ABGR little-endian LUT for canvas pixel writes. Ages > 30 clamp to red.
const COLOR_LUT_U32: Uint32Array = (() => {
  const lut = new Uint32Array(31);
  const pack = (r: number, g: number, b: number) =>
    ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
  lut[0] = pack(...DEAD_RGB);
  for (let i = 1; i <= 30; i++) {
    const { h, s, l } = hslAtAge(i);
    const [r, g, b] = hslToRgb(h, s, l);
    lut[i] = pack(r, g, b);
  }
  return lut;
})();

function ageColorU32(age: number): number {
  return COLOR_LUT_U32[Math.min(age, 30)];
}

// Cell subscribes to one signal; only its own update fires the effect.

let _cellRenders = 0;
function bumpRender() {
  _cellRenders++;
}
function takeRenders() {
  const r = _cellRenders;
  _cellRenders = 0;
  return r;
}

const Cell = memo(function Cell({
  sig,
  onPaint,
}: {
  sig: RefSignal<number>;
  onPaint: (sig: RefSignal<number>) => void;
}) {
  bumpRender();
  const ref = useRef<HTMLDivElement>(null);
  // Imperative paint — React renders this once at mount, the signal does the rest.
  useRefSignalEffect(() => {
    const el = ref.current;
    if (el) el.style.background = ageColor(sig.current);
  }, [sig]);
  return (
    <div
      ref={ref}
      onPointerDown={() => {
        onPaint(sig);
      }}
      onPointerEnter={(e) => {
        if (e.buttons === 1) onPaint(sig);
      }}
      style={{ background: ageColor(sig.current) }}
    />
  );
});

// Same per-cell signal model, but listeners mark pixels dirty and one frame
// flush does a single putImageData per frame — ~100× faster than DOM mode.
function CanvasGrid({
  grid,
  onPaint,
}: {
  grid: RefSignal<number>[][];
  onPaint: (sig: RefSignal<number>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onPaintRef = useRef(onPaint);
  onPaintRef.current = onPaint;
  const { w, h } = dimsOf(grid);

  // Per-cell listeners push indices into `dirty` and bump `dirtyBump`. The
  // flush below subscribes to it with `frame: true` — N bumps coalesce into one frame.
  const dirty = useRef(new Set<number>()).current;
  const dirtyBump = useRefSignal(0);
  const paintRef = useRef<{
    ctx: CanvasRenderingContext2D;
    pixels: Uint32Array;
    imgData: ImageData;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const imgData = ctx.createImageData(w, h);
    const pixels = new Uint32Array(imgData.data.buffer);
    paintRef.current = { ctx, pixels, imgData };
    dirty.clear();

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        pixels[y * w + x] = ageColorU32(grid[y][x].current);
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const unsubs: Array<() => void> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const sig = grid[y][x];
        const listener = () => {
          dirty.add(idx);
          dirtyBump.notify();
        };
        sig.subscribe(listener);
        unsubs.push(() => {
          sig.unsubscribe(listener);
        });
      }
    }

    return () => {
      paintRef.current = null;
      for (const u of unsubs) u();
    };
  }, [grid, w, h, dirty, dirtyBump]);

  useRefSignalEffect(
    () => {
      const p = paintRef.current;
      if (!p || dirty.size === 0) return;
      const { ctx, pixels, imgData } = p;
      for (const idx of dirty) {
        const y = (idx / w) | 0;
        const x = idx - y * w;
        pixels[idx] = ageColorU32(grid[y][x].current);
      }
      dirty.clear();
      ctx.putImageData(imgData, 0, 0);
    },
    [dirtyBump, grid, w, h, dirty],
    { frame: true },
  );

  const handlePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === 'pointermove' && e.buttons !== 1) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * w);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * h);
    if (x >= 0 && x < w && y >= 0 && y < h) {
      onPaintRef.current(grid[y][x]);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointer}
      onPointerMove={handlePointer}
      style={{
        imageRendering: 'pixelated',
        width: '100%',
        height: '100%',
        display: 'block',
        background: DEAD,
        touchAction: 'none',
        userSelect: 'none',
      }}
    />
  );
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

type Mode = 'dom' | 'canvas';

export default function GameOfLife() {
  const [mode, setMode] = useState<Mode>('dom');
  const [size, setSize] = useState<Size>(80); // DOM mode: square dim
  const [cellPx, setCellPx] = useState<CellPx>(6); // Canvas mode: pixels per cell
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(20); // ticks/sec target
  const [tickN, setTickN] = useState(0);
  const [stats, setStats] = useState({ alive: 0, changed: 0, rps: 0 });

  // Canvas-mode stage size; initial fallback corrected after mount.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageDims, setStageDims] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth - 32 : 1024,
    h: typeof window !== 'undefined' ? window.innerHeight - 140 : 720,
  }));

  useEffect(() => {
    const measure = () => {
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      setStageDims((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    // Measure post-paint; only re-measure on viewport resize, not toolbar reflows.
    const rafId = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measure);
    };
  }, []);

  const dims = useMemo(() => {
    if (mode === 'dom') return { w: size, h: size };
    return {
      w: Math.max(16, Math.floor(stageDims.w / cellPx)),
      h: Math.max(16, Math.floor(stageDims.h / cellPx)),
    };
  }, [mode, size, cellPx, stageDims]);

  const grid = useMemo(() => makeGrid(dims.w, dims.h), [dims.w, dims.h]);

  // Seed with pulsar, fall back to glider if it doesn't fit.
  useEffect(() => {
    const initial = patternFits(PATTERNS[1], dims.w, dims.h)
      ? PATTERNS[1]
      : PATTERNS[0];
    placePattern(grid, initial);
    setTickN(0);
    setStats({ alive: 0, changed: 0, rps: 0 });
  }, [grid, dims.w, dims.h]);

  // Tick loop, rate-gated against `frame.elapsed`.
  const frame = usePulseRefSignal('raf');
  const lastTickRef = useRef(0);
  const sampleStartRef = useRef(0);
  useEffect(() => {
    if (!running) return;
    lastTickRef.current = 0;
    sampleStartRef.current = 0;
    takeRenders();
  }, [running, speed, grid]);
  useRefSignalEffect(() => {
    if (!running) return;
    const now = frame.elapsed;
    const interval = 1000 / speed;
    let alive = stats.alive;
    let changed = stats.changed;
    let didTick = false;
    if (now - lastTickRef.current >= interval) {
      const r = tick(grid);
      alive = r.alive;
      changed = r.changed;
      lastTickRef.current = now;
      didTick = true;
    }
    if (now - sampleStartRef.current >= 1000) {
      const rps = takeRenders();
      setStats({ alive, changed, rps });
      sampleStartRef.current = now;
    } else if (didTick) {
      setStats((s) => ({ ...s, alive, changed }));
    }
    if (didTick) setTickN((n) => n + 1);
  }, [frame, running, speed, grid]);

  const onPaint = useCallback(
    (sig: RefSignal<number>) => {
      if (running) return; // only paint when paused
      sig.update(sig.current > 0 ? 0 : 1);
    },
    [running],
  );

  const stepOnce = useCallback(() => {
    const { alive, changed } = tick(grid);
    setTickN((n) => n + 1);
    setStats((s) => ({ ...s, alive, changed }));
  }, [grid]);

  const total = dims.w * dims.h;
  const changedPct =
    total > 0 ? ((stats.changed / total) * 100).toFixed(1) : '0';

  return (
    <div style={pageStyle}>
      <div style={toolbarStyle}>
        {PATTERNS.map((p) => {
          const ok = patternFits(p, dims.w, dims.h);
          return (
            <button
              key={p.name}
              disabled={!ok}
              onClick={() => {
                placePattern(grid, p);
              }}
              style={btnStyle(false, '#4a9eff', !ok)}
              title={ok ? '' : `Doesn't fit ${dims.w}×${dims.h}`}
            >
              {p.name}
            </button>
          );
        })}
        <button
          onClick={() => {
            clearGrid(grid);
          }}
          style={btnStyle(false, '#64748b')}
        >
          Clear
        </button>

        <span style={sep} />

        <button
          onClick={() => {
            setRunning((r) => !r);
          }}
          style={btnStyle(running, running ? '#f97316' : '#10b981')}
        >
          {running ? 'Pause' : 'Play'}
        </button>
        <button
          disabled={running}
          onClick={stepOnce}
          style={btnStyle(false, '#4a9eff', running)}
        >
          Step
        </button>

        <label style={sliderLabel}>
          Speed
          <input
            type="range"
            min={1}
            max={60}
            value={speed}
            onChange={(e) => {
              setSpeed(+e.target.value);
            }}
          />
          <span style={tinyMono}>{speed}/s</span>
        </label>

        <span style={sep} />

        <span
          style={{
            display: 'flex',
            gap: 0,
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => {
              setMode('dom');
            }}
            style={{ ...btnStyle(mode === 'dom', '#4a9eff'), borderRadius: 0 }}
          >
            DOM
          </button>
          <button
            onClick={() => {
              setMode('canvas');
            }}
            style={{
              ...btnStyle(mode === 'canvas', '#a855f7'),
              borderRadius: 0,
            }}
          >
            Canvas
          </button>
        </span>

        {mode === 'dom' ? (
          <label style={sliderLabel}>
            Size
            <select
              value={size}
              onChange={(e) => {
                setSize(+e.target.value as Size);
              }}
              style={selectStyle}
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}×{s}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label style={sliderLabel}>
            Cell px
            <select
              value={cellPx}
              onChange={(e) => {
                setCellPx(+e.target.value as CellPx);
              }}
              style={selectStyle}
            >
              {CELL_PX.map((p) => (
                <option key={p} value={p}>
                  {p}px
                </option>
              ))}
            </select>
          </label>
        )}

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Stat label="grid" value={`${dims.w}×${dims.h}`} />
          <Stat label="tick" value={tickN} />
          <Stat label="alive" value={`${stats.alive}/${total}`} />
          <Stat
            label="changed/tick"
            value={`${stats.changed} (${changedPct}%)`}
            highlight
          />
          <Stat label="renders/s" value={stats.rps || '--'} />
          <FpsBadge src={frame} />
        </span>
      </div>

      <div style={hintStyle}>
        Zero React renders post-mount — the signal listener writes directly.{' '}
        {mode === 'dom' ? (
          <>
            <b>DOM</b>: per-cell <code style={codeStyle}>style.background</code>{' '}
            writes (bottlenecks at 100×100 + Random).
          </>
        ) : (
          <>
            <b>Canvas</b>: {dims.w}×{dims.h} = {total.toLocaleString()} signals;
            one <code style={codeStyle}>putImageData</code> per frame. Try
            Random + 60/s.
          </>
        )}{' '}
        Click/drag (paused) to paint.
      </div>

      <div ref={stageRef} style={{ flex: 1, overflow: 'hidden', padding: 8 }}>
        {mode === 'dom' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${dims.w}, 1fr)`,
              gridTemplateRows: `repeat(${dims.h}, 1fr)`,
              gap: 1,
              background: '#1e293b',
              width: '100%',
              height: '100%',
              aspectRatio: '1 / 1',
              margin: '0 auto',
              maxHeight: '100%',
              maxWidth: 'min(100%, calc(100vh - 140px))',
              touchAction: 'none',
              userSelect: 'none',
            }}
            onPointerLeave={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
          >
            {grid.map((row, y) =>
              row.map((sig, x) => (
                <Cell key={`${y}-${x}`} sig={sig} onPaint={onPaint} />
              )),
            )}
          </div>
        ) : (
          <CanvasGrid grid={grid} onPaint={onPaint} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// UI bits
// ---------------------------------------------------------------

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <span
      style={{
        background: '#0d1117',
        padding: '4px 10px',
        borderRadius: 4,
        fontSize: 12,
        fontFamily: 'monospace',
        border: highlight ? '1px solid #4a9eff' : '1px solid transparent',
      }}
    >
      {label} <b style={{ color: highlight ? '#4a9eff' : '#fff' }}>{value}</b>
    </span>
  );
}

const pageStyle: React.CSSProperties = {
  background: '#1a1a2e',
  color: '#fff',
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'system-ui, sans-serif',
  userSelect: 'none',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  background: '#16213e',
  flexWrap: 'wrap',
};

const hintStyle: React.CSSProperties = {
  padding: '3px 14px',
  fontSize: 11,
  opacity: 0.55,
  background: '#16213e',
  borderTop: '1px solid #1a1a2e',
};

const sliderLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  opacity: 0.85,
};

const selectStyle: React.CSSProperties = {
  background: '#0d1117',
  color: '#fff',
  border: '1px solid #334155',
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 12,
};

const tinyMono: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  opacity: 0.7,
  minWidth: 32,
};

const sep: React.CSSProperties = {
  width: 1,
  height: 20,
  background: '#334155',
};

const codeStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 11,
  background: 'rgba(255,255,255,0.1)',
};

function btnStyle(
  active: boolean,
  color: string,
  disabled = false,
): React.CSSProperties {
  return {
    padding: '5px 12px',
    border: 'none',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
    fontSize: 12,
    background: active ? color : '#333',
    color: '#fff',
    opacity: disabled ? 0.3 : active ? 1 : 0.75,
    transition: 'opacity 0.15s',
  };
}
