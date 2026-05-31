// Bench harness — reads URL params once into BENCH, runs the auto-drive
// loop + frame sampling loop, writes results to window.__bench__.
//
// Per-mode files import { BENCH, AUTOMATED, runAutoBench } from here. The
// matrix runner / single-run UI also lives in graph-benchmark-automated.tsx
// and dispatches on BENCH.mode to mount the right Graph component.

import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { type DriveFn, type Pos, getRenders, resetRenders } from './shared';

export type Mode =
  | 'signal' // refsignal blessed path (useRefSignalEffect + setAttribute)
  | 'signal-render' // refsignal *opt-in* React path (useRefSignalRender)
  | 'jotai' // jotai blessed path (useAtom)
  | 'jotai-imperative' // jotai escape hatch (store.sub + ref)
  | 'zustand' // zustand blessed path (useStore selector)
  | 'zustand-imperative' // zustand escape hatch (subscribeWithSelector + ref)
  | 'mobx' // mobx blessed path (observable + observer)
  | 'mobx-autorun' // mobx escape hatch (autorun + ref + setAttribute)
  | 'react'; // useState in parent — no escape hatch exists

export type DriveMode = 'raf' | 'interval';
export type Renderer = 'svg' | 'canvas';

// Read once from the URL on module load. Everything below reads from BENCH
// directly instead of plumbing rate/escapeBatching/warmup/durationSec
// through every component layer — these params are immutable for the
// page lifetime.
export const BENCH: {
  mode: Mode;
  nodes: number;
  durationSec: number;
  warmupMs: number;
  rate: number;
  escapeBatching: boolean;
  // 'raf': fire `rate` drives per requestAnimationFrame tick (default).
  //        Useful for replicating the docs' "fast manual drag" but the
  //        driver's effective event rate drops as the page slows.
  // 'interval': fire one drive every `intervalMs` ms via setInterval,
  //             decoupled from rAF — matches how real pointer hardware
  //             keeps firing events independent of the page's frame rate.
  driveMode: DriveMode;
  intervalMs: number;
  // 'svg' (default): per-node React components rendering SVG elements;
  //                  stresses React reconciliation + SVG paint pipeline.
  // 'canvas': single <canvas> with one imperative draw loop reading state;
  //           bypasses per-node reconciliation, GPU upload bounded by
  //           viewport.
  renderer: Renderer;
  matrix: boolean;
  matrixModes: Mode[];
  matrixNodes: number[];
} = (() => {
  const sp = new URLSearchParams(window.location.search);
  const validModes: Mode[] = [
    'signal',
    'signal-render',
    'jotai',
    'jotai-imperative',
    'zustand',
    'zustand-imperative',
    'mobx',
    'mobx-autorun',
    'react',
  ];
  const modeParam = sp.get('mode') as Mode | null;
  const clampNodes = (n: number) =>
    Math.max(9, Math.min(20000, Math.round(n) || 100));
  const parseModeList = (s: string | null): Mode[] => {
    if (!s) return validModes;
    return s
      .split(',')
      .map((x) => x.trim() as Mode)
      .filter((x) => validModes.includes(x));
  };
  const parseNodeList = (s: string | null): number[] => {
    if (!s) return [200, 500, 1000, 2000];
    return s
      .split(',')
      .map((x) => clampNodes(+x))
      .filter((n) => Number.isFinite(n));
  };
  return {
    mode: modeParam && validModes.includes(modeParam) ? modeParam : 'signal',
    nodes: clampNodes(+(sp.get('nodes') ?? 100)),
    durationSec: Math.max(0, +(sp.get('autodrag') ?? 0) || 0),
    warmupMs: Math.max(0, +(sp.get('warmup') ?? 1000) || 1000),
    rate: Math.max(1, Math.min(64, +(sp.get('rate') ?? 1) || 1)),
    // escape=0 disables flushSync wrap; default on so each in-frame drive
    // gets its own render+notify cycle (matches real pointermove dispatch).
    escapeBatching: (sp.get('escape') ?? '1') !== '0',
    driveMode: (sp.get('driveMode') === 'interval'
      ? 'interval'
      : 'raf') as DriveMode,
    intervalMs: Math.max(0.5, Math.min(100, +(sp.get('intervalMs') ?? 4) || 4)),
    renderer: (sp.get('renderer') === 'canvas' ? 'canvas' : 'svg') as Renderer,
    // Matrix mode: iterate {modes × matrixNodes} sequentially in the page
    // and accumulate results — designed for running on the user's native
    // browser without Playwright. URL: ?matrix=1&autodrag=10&rate=8
    matrix: sp.get('matrix') === '1',
    matrixModes: parseModeList(sp.get('modes')),
    matrixNodes: parseNodeList(sp.get('matrixNodes')),
  };
})();

export const AUTOMATED = BENCH.durationSec > 0;

export type BenchSample = { tSec: number; fps: number; rps: number };

export type BenchResult = {
  ready: true;
  mode: string;
  nodes: number;
  durationSec: number;
  warmupMs: number;
  rate: number;
  escapeBatching: boolean;
  driveMode: DriveMode;
  intervalMs: number;
  renderer: Renderer;
  samples: BenchSample[];
  fpsMean: number;
  fpsMedian: number;
  fpsMin: number;
  fpsMax: number;
  rpsMean: number;
  rpsMedian: number;
};

declare global {
  interface Window {
    __bench__?: BenchResult | { ready: false; phase: string };
  }
}

function setBenchPhase(phase: string) {
  window.__bench__ = { ready: false, phase };
}

function mean(xs: number[]) {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Sweep parameters chosen so the dragged node visibly streaks across the
// graph at any node count, matching the "frantic drag" the docs benchmark
// was measured under.
const SWEEP_RADIUS = 200; // SVG units — visible against the 80-unit grid pitch
const SWEEP_VELOCITY = 6; // rad/sec — ~1 revolution per second

export function runAutoBench(opts: {
  mode: string;
  nodes: number;
  drive: DriveFn;
  initial: Pos;
}): () => void {
  const { mode, nodes, drive, initial } = opts;
  const {
    durationSec,
    warmupMs,
    rate,
    escapeBatching,
    driveMode,
    intervalMs,
    renderer,
  } = BENCH;
  let cancelled = false;
  let phase: 'warmup' | 'measure' = 'warmup';
  const mountedAt = performance.now();
  let measureStart = 0;
  let lastSampleAt = 0;
  let framesInWindow = 0;
  let prevRenders = 0;
  const samples: BenchSample[] = [];

  setBenchPhase('warmup');

  // doDrive — common to both schedulers. flushSync wraps each call so
  // React can't batch consecutive setStates within the same microtask.
  // (No-op for RefSignal mode since drive doesn't touch React state.)
  const doDrive = (pos: Pos) => {
    if (escapeBatching) {
      flushSync(() => {
        drive(pos);
      });
    } else {
      drive(pos);
    }
  };

  const computePos = (angle: number): Pos => ({
    x: initial.x + SWEEP_RADIUS * Math.cos(angle),
    y: initial.y + SWEEP_RADIUS * Math.sin(angle),
  });

  const finish = () => {
    const fpsList = samples.map((s) => s.fps);
    const rpsList = samples.map((s) => s.rps);
    window.__bench__ = {
      ready: true,
      mode,
      nodes,
      durationSec,
      warmupMs,
      rate,
      escapeBatching,
      driveMode,
      intervalMs,
      renderer,
      samples,
      fpsMean: +mean(fpsList).toFixed(2),
      fpsMedian: median(fpsList),
      fpsMin: fpsList.length ? Math.min(...fpsList) : 0,
      fpsMax: fpsList.length ? Math.max(...fpsList) : 0,
      rpsMean: +mean(rpsList).toFixed(2),
      rpsMedian: median(rpsList),
    };
  };

  // Driver loop — fires drives. Either bursts in rAF or ticks on a fixed
  // setInterval. setInterval is closer to real pointer hardware (events
  // keep firing while the page is JS-bound); rAF mode self-throttles when
  // the page slows.
  let stopDriver: (() => void) | null = null;
  const startDriver = () => {
    if (driveMode === 'interval') {
      const id = window.setInterval(() => {
        if (cancelled) return;
        const t = (performance.now() - measureStart) / 1000;
        if (t >= durationSec) return;
        doDrive(computePos(t * SWEEP_VELOCITY));
      }, intervalMs);
      stopDriver = () => {
        window.clearInterval(id);
      };
    } else {
      // rAF-burst: fire `rate` drives per frame, spread across the angular
      // slice the cursor would traverse in 1/60s at SWEEP_VELOCITY.
      let rafId = 0;
      const tick = () => {
        if (cancelled) return;
        const now = performance.now();
        const t = (now - measureStart) / 1000;
        if (t >= durationSec) return;
        const baseAngle = t * SWEEP_VELOCITY;
        const frameSlice = SWEEP_VELOCITY / 60;
        for (let i = 0; i < rate; i++) {
          doDrive(computePos(baseAngle + (i / rate) * frameSlice));
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      stopDriver = () => {
        cancelAnimationFrame(rafId);
      };
    }
  };

  // Sampling loop — always rAF. Counts actual painted frames per second.
  let samplingRaf = 0;
  const sample = () => {
    if (cancelled) return;
    const now = performance.now();

    if (phase === 'warmup') {
      if (now - mountedAt < warmupMs) {
        samplingRaf = requestAnimationFrame(sample);
        return;
      }
      phase = 'measure';
      measureStart = now;
      lastSampleAt = now;
      framesInWindow = 0;
      resetRenders();
      prevRenders = 0;
      setBenchPhase('measure');
      startDriver();
    }

    const t = (now - measureStart) / 1000;
    if (t >= durationSec) {
      stopDriver?.();
      finish();
      return;
    }

    framesInWindow++;
    if (now - lastSampleAt >= 1000) {
      const r = getRenders();
      samples.push({
        tSec: samples.length + 1,
        fps: framesInWindow,
        rps: r - prevRenders,
      });
      framesInWindow = 0;
      prevRenders = r;
      lastSampleAt = now;
    }
    samplingRaf = requestAnimationFrame(sample);
  };

  samplingRaf = requestAnimationFrame(sample);
  return () => {
    cancelled = true;
    cancelAnimationFrame(samplingRaf);
    stopDriver?.();
  };
}

// Hook for the Stats badge — observes the result on window and exposes
// a "done" flag so the page can render a sentinel for Playwright.
export function useBenchDone() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (window.__bench__?.ready) {
        setDone(true);
        window.clearInterval(id);
      }
    }, 100);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  return done;
}
