// Replay — a comet of ghosts retracing your cursor's exact path.
//
// One live signal (`pointer`), many `useReplayRefSignal` views of it at
// increasing delays. Each ghost IS what the pointer *was* N ms ago — same
// path, same spacing, just time-shifted. Stop moving and the ghosts drain in
// order, catching up one by one: the buffered timeline made visible.
//
// Every ghost is consumed exactly like the live source — point it at a
// different timeline and position a div in a `frame`-coalesced effect.

import { useEffect, useRef } from 'react';
import { usePulseRefSignal, useRefSignalEffect } from 'react-refsignal';
import { CodeChip } from '../../common/components/CodeChip';
import { FpsBadge } from '../../common/components/FpsBadge';
import { useTrackPointer } from '../../common/hooks/useTrackPointer';
import { Ghost } from './components/Ghost';
import {
  canvasStyle,
  fpsWrap,
  headStyle,
  hintStyle,
  legendStyle,
  pageStyle,
  titleBlock,
  titleStyle,
} from './styles/replay.styles';

// Increasing gaps so the comet spreads as it trails — the tail lags more than
// the head, which reads as a natural easing even though every ghost replays at
// a constant offset.
const GHOSTS = [
  { ms: 110, size: 34, hue: 190 },
  { ms: 240, size: 30, hue: 205 },
  { ms: 400, size: 26, hue: 220 },
  { ms: 600, size: 22, hue: 238 },
  { ms: 850, size: 18, hue: 256 },
  { ms: 1150, size: 15, hue: 274 },
  { ms: 1500, size: 12, hue: 292 },
];

// The trail lives exactly as long as the slowest ghost's delay, so its tail
// sits right where that ghost is and the trace vanishes as the ghost passes.
const TRAIL_MS = Math.max(...GHOSTS.map((g) => g.ms));

export default function Replay() {
  // Cursor → pointer signal (window pointermove), owned by the hook. The
  // off-screen sentinel keeps the trail blank until the first real move.
  const pointer = useTrackPointer({
    initial: { x: -100, y: -100 },
    name: 'replay.pointer',
  });
  const headRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);

  // A frame clock drives the trail's per-frame fade — the trail must keep
  // decaying even while the pointer is still, so we can't lean on the pointer
  // signal alone. Still no hand-rolled rAF loop: the pulse IS the loop.
  const frame = usePulseRefSignal('frame', 'replay.frame');

  // Live head — same effect shape as every ghost, just zero delay.
  useRefSignalEffect(
    () => {
      const el = headRef.current;
      if (!el) return;
      el.style.transform = `translate(${pointer.current.x - 9}px, ${
        pointer.current.y - 9
      }px)`;
    },
    [pointer],
    { frame: true },
  );

  // Size the trail canvas to the viewport at device-pixel resolution, redone
  // on resize. Drawing happens in CSS pixels (the transform absorbs DPR).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctxRef.current = ctx;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);

  // The faint path under the comet. Each frame we sample the live pointer into
  // a timestamped buffer, drop everything older than the slowest ghost, and
  // redraw — so the trail's tail lands exactly where that ghost is and the
  // trace evaporates as the last replayed signal passes it. Each segment's
  // opacity ramps with age, fading the path into nothing at the tail.
  useRefSignalEffect(() => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    const now = performance.now();
    const pts = trail.current;

    // Sample the live pointer (skip the off-screen sentinel and no-op repeats).
    const p = pointer.current;
    const last = pts[pts.length - 1];
    if (p.x >= 0 && (!last || last.x !== p.x || last.y !== p.y)) {
      pts.push({ x: p.x, y: p.y, t: now });
    }

    // Drop points the slowest ghost has already passed.
    const cutoff = now - TRAIL_MS;
    let drop = 0;
    while (drop < pts.length && pts[drop].t < cutoff) drop++;
    if (drop > 0) pts.splice(0, drop);

    // Full redraw, additive so overlaps glow. No shadowBlur — the 'lighter'
    // blend keeps it neon while staying cheap enough to never touch 120fps.
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = 1 - (now - pts[i].t) / TRAIL_MS; // 1 at head → 0 at tail
      ctx.strokeStyle = `rgba(127, 214, 255, ${a * 0.6})`;
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }, [frame]);

  return (
    <div style={pageStyle}>
      {/* Trail canvas first in DOM so the comet and head paint above it. */}
      <canvas ref={canvasRef} style={canvasStyle} />

      <div style={fpsWrap}>
        <FpsBadge />
      </div>

      {/* Tail first so the bright head paints over it. */}
      {GHOSTS.map((g) => (
        <Ghost key={g.ms} source={pointer} {...g} />
      ))}

      <div ref={headRef} style={headStyle} />

      <div style={titleBlock}>
        <div style={titleStyle}>replay</div>
        <div style={hintStyle}>
          Move your cursor — draw a loop, then stop. The comet retraces your
          exact path, each ghost a fixed delay behind. When you stop, the
          buffered timeline drains in order: ghosts catch up one by one.
        </div>
      </div>

      <div style={legendStyle}>
        One <CodeChip>pointer</CodeChip> signal, seven{' '}
        <CodeChip>useReplayRefSignal(pointer, ms)</CodeChip> views at increasing{' '}
        <CodeChip>ms</CodeChip>. Each ghost is what the pointer <em>was</em>{' '}
        that long ago — consumed by the same <CodeChip>frame</CodeChip>
        -coalesced effect as the live head.
      </div>
    </div>
  );
}
