// Grid model: one RefSignal per cell, holding the cell's age. Helpers seed,
// clear, and advance the grid. `tick` snapshots to a flat buffer first so
// neighbour reads never see partial mid-batch updates, then writes only the
// cells that actually flipped — that selective write is what keeps re-renders
// proportional to churn, not grid size.

import { batch, createRefSignal, type RefSignal } from 'react-refsignal';
import type { Pattern } from './patterns';

export type CellSignal = RefSignal<number> & { dispose: () => void };

export function dimsOf(grid: RefSignal<number>[][]): { w: number; h: number } {
  return { h: grid.length, w: grid[0]?.length ?? 0 };
}

export function makeGrid(w: number, h: number): CellSignal[][] {
  const g: CellSignal[][] = [];
  for (let y = 0; y < h; y++) {
    const row: CellSignal[] = [];
    for (let x = 0; x < w; x++) row.push(createRefSignal(0));
    g.push(row);
  }
  return g;
}

export function clearGrid(grid: RefSignal<number>[][]) {
  batch(() => {
    for (const row of grid) for (const sig of row) sig.update(0);
  });
}

export function placePattern(grid: RefSignal<number>[][], pattern: Pattern) {
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

// Reused snapshot buffer — `tick` runs up to 60×/s and a fresh
// Uint8Array(w*h) each time was needless GC churn. Grown when the grid does;
// only indices [0, w*h) are written-then-read each tick, so a larger leftover
// buffer is harmless. (tick is single-threaded and non-reentrant.)
let snapshot = new Uint8Array(0);

export function tick(grid: RefSignal<number>[][]): {
  changed: number;
  alive: number;
} {
  const { w, h } = dimsOf(grid);
  // Snapshot to a flat buffer first — neighbour reads must not see partial updates.
  const cur =
    snapshot.length >= w * h ? snapshot : (snapshot = new Uint8Array(w * h));
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

export function patternFits(pattern: Pattern, w: number, h: number): boolean {
  if (pattern.cells === 'random') return true;
  const ys = pattern.cells.map((c) => c[0]);
  const xs = pattern.cells.map((c) => c[1]);
  return (
    Math.max(...xs) - Math.min(...xs) < w &&
    Math.max(...ys) - Math.min(...ys) < h
  );
}
