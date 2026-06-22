// Same per-cell signal model as DOM mode, but listeners mark pixels dirty and
// one frame flush does a single putImageData per frame — ~100× faster than DOM
// mode at high cell counts. N dirty-bumps coalesce into one repaint via
// `frame: true`.

import React, { useEffect, useRef } from 'react';
import {
  useRefSignal,
  useRefSignalEffect,
  type RefSignal,
} from 'react-refsignal';
import { ageColorU32 } from '../logic/color';
import { dimsOf } from '../logic/grid';
import { canvasGridStyle } from '../styles/game-of-life.styles';

export function CanvasGrid({
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
  const dirtyBump = useRefSignal(0, 'gol.dirtyBump');
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
      style={canvasGridStyle}
    />
  );
}
