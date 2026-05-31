// Shared Stats badge — counts painted frames via a rAF pulse signal and
// reads the module-level render counter from bench/shared. Used by both
// graph-benchmark.tsx (manual demo) and graph-benchmark-automated.tsx.

import React, { useEffect, useRef } from 'react';
import { usePulseRefSignal, useRefSignalEffect } from 'react-refsignal';
import { getRenders } from './shared';

export const statBadge: React.CSSProperties = {
  background: '#0d1117',
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'monospace',
};

export function Stats({ mode }: { mode: string }) {
  const fpsRef = useRef<HTMLSpanElement>(null);
  const rpsRef = useRef<HTMLSpanElement>(null);
  const frame = usePulseRefSignal('raf', 'graph.statsFrame');
  const framesRef = useRef(0);
  const lastSampleRef = useRef(0);
  const prevRendersRef = useRef(0);

  useEffect(() => {
    framesRef.current = 0;
    lastSampleRef.current = frame.elapsed;
    prevRendersRef.current = getRenders();
  }, [mode, frame]);

  useRefSignalEffect(() => {
    if (frame.tick === 0) return;
    framesRef.current++;
    if (frame.elapsed - lastSampleRef.current >= 1000) {
      const r = getRenders();
      if (fpsRef.current)
        fpsRef.current.textContent = String(framesRef.current);
      if (rpsRef.current)
        rpsRef.current.textContent = String(r - prevRendersRef.current);
      framesRef.current = 0;
      prevRendersRef.current = r;
      lastSampleRef.current = frame.elapsed;
    }
  }, [frame]);
  return (
    <>
      <span style={statBadge}>
        FPS{' '}
        <b ref={fpsRef} style={{ minWidth: 28, display: 'inline-block' }}>
          --
        </b>
      </span>
      <span style={statBadge}>
        renders/s{' '}
        <b ref={rpsRef} style={{ minWidth: 36, display: 'inline-block' }}>
          --
        </b>
      </span>
    </>
  );
}
