// Conway's Game of Life — one signal per cell. Only the ~5-15% of cells that
// flip per tick re-render (DOM mode) or repaint (Canvas mode). Open the
// Profiler and watch the "changed/tick" counter live.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  usePulseRefSignal,
  useRefSignal,
  useRefSignalEffect,
  type RefSignal,
} from 'react-refsignal';
import { CodeChip } from '../../common/components/CodeChip';
import { FpsBadge } from '../../common/components/FpsBadge';
import { Stat } from '../../common/components/Stat';
import { useElementSize } from '../../common/hooks/useElementSize';
import {
  btnStyle,
  hintStyle,
  selectStyle,
  separator,
  sliderLabel,
  toolbarStyle,
} from '../../common/styles';
import { Cell, takeRenders } from './components/Cell';
import { CanvasGrid } from './components/CanvasGrid';
import { GolStats } from './components/GolStats';
import {
  clearGrid,
  makeGrid,
  placePattern,
  patternFits,
  tick,
} from './logic/grid';
import {
  CELL_PX,
  PATTERNS,
  SIZES,
  type CellPx,
  type Size,
} from './logic/patterns';
import {
  domGridStyle,
  modeToggle,
  pageStyle,
  rightGroup,
  stageStyle,
  tinyMono,
} from './styles/game-of-life.styles';

type Mode = 'dom' | 'canvas';

export default function GameOfLife() {
  const [mode, setMode] = useState<Mode>('dom');
  const [size, setSize] = useState<Size>(80); // DOM mode: square dim
  const [cellPx, setCellPx] = useState<CellPx>(6); // Canvas mode: pixels per cell
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(20); // ticks/sec target
  // Live counters in signals, not React state — bumping them each tick must not
  // re-render GameOfLife (that would re-create the whole cell grid). Only the
  // <GolStats> leaf subscribes. (Same move as the agents demo.)
  const tickN = useRefSignal(0, 'gol.tickN');
  const stats = useRefSignal({ alive: 0, changed: 0, rps: 0 }, 'gol.stats');

  // Canvas-mode stage size; initial fallback corrected after mount.
  const { ref: stageRef, size: stage } = useElementSize(() => ({
    width: window.innerWidth - 32,
    height: window.innerHeight - 140,
  }));

  const dims = useMemo(() => {
    if (mode === 'dom') return { w: size, h: size };
    return {
      w: Math.max(16, Math.floor(stage.width / cellPx)),
      h: Math.max(16, Math.floor(stage.height / cellPx)),
    };
  }, [mode, size, cellPx, stage]);

  const grid = useMemo(() => makeGrid(dims.w, dims.h), [dims.w, dims.h]);

  // Dispose every cell signal when the grid re-rolls (dims change) or on
  // unmount. The grid is ~thousands of signals; without cleanup, every
  // resize would stack the previous generation in the devtools registry.
  useEffect(() => {
    return () => {
      for (const row of grid) for (const cell of row) cell.dispose();
    };
  }, [grid]);

  // Seed with pulsar, fall back to glider if it doesn't fit.
  useEffect(() => {
    const initial = patternFits(PATTERNS[1], dims.w, dims.h)
      ? PATTERNS[1]
      : PATTERNS[0];
    placePattern(grid, initial);
    tickN.update(0);
    stats.update({ alive: 0, changed: 0, rps: 0 });
  }, [grid, dims.w, dims.h, tickN, stats]);

  // Tick loop, rate-gated against `frame.elapsed`.
  const frame = usePulseRefSignal('frame', 'gol.frame');
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
    let alive = stats.current.alive;
    let changed = stats.current.changed;
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
      stats.update({ alive, changed, rps });
      sampleStartRef.current = now;
    } else if (didTick) {
      stats.update({ ...stats.current, alive, changed });
    }
    if (didTick) tickN.update(tickN.current + 1);
    // tickN/stats are written here, not subscribed — they stay out of the deps
    // (subscribing to a signal you write would re-fire the effect).
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
    tickN.update(tickN.current + 1);
    stats.update({ ...stats.current, alive, changed });
  }, [grid, tickN, stats]);

  const total = dims.w * dims.h;

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

        <span style={separator} />

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

        <span style={separator} />

        <span style={modeToggle}>
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

        <span style={rightGroup}>
          <Stat label="grid" value={`${dims.w}×${dims.h}`} />
          <GolStats tickN={tickN} stats={stats} total={total} />
          <FpsBadge src={frame} />
        </span>
      </div>

      <div style={hintStyle}>
        Zero React renders post-mount — the signal listener writes directly.{' '}
        {mode === 'dom' ? (
          <>
            <b>DOM</b>: per-cell <CodeChip>style.background</CodeChip> writes
            (bottlenecks at 100×100 + Random).
          </>
        ) : (
          <>
            <b>Canvas</b>: {dims.w}×{dims.h} = {total.toLocaleString()} signals;
            one <CodeChip>putImageData</CodeChip> per frame. Try Random + 60/s.
          </>
        )}{' '}
        Click/drag (paused) to paint.
      </div>

      <div ref={stageRef} style={stageStyle}>
        {mode === 'dom' ? (
          <div
            style={domGridStyle(dims.w, dims.h)}
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
